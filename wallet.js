import helper from "./helper.js";
import { UserError } from "./command-utils.js";

const atomicUnits = 1000000000n;
const labelPrefix = "discord-";
// WALLET_RPC_ERROR_CODE_NOT_ENOUGH_MONEY and WALLET_RPC_ERROR_CODE_NOT_ENOUGH_UNLOCKED_MONEY
const notEnoughMoneyCodes = new Set([ -17, -37 ]);
// WALLET_RPC_ERROR_CODE_WRONG_ADDRESS
const wrongAddressCode = -2;

let accountsPromise;
const creatingAccounts = new Map();

export async function connectWallet(monero, config, binPath, execExt) {
	let wallet;
	if(config.walletURL) {
		wallet = await monero.connectToWalletRpc(config.walletURL);
		await wallet.getVersion();
	} else {
		const port = String(config.walletRpcPort || 38304);
		const url = "http://127.0.0.1:" + port;
		try {
			wallet = await monero.connectToWalletRpc(url);
			await wallet.getVersion();
			helper.log("Using existing wallet RPC at %s", url);
		} catch {
			helper.log("Starting wallet RPC at %s", url);
			wallet = await monero.connectToWalletRpc([
				binPath + "morelo-wallet-rpc" + execExt,
				"--daemon-address", config.daemonURL || "http://localhost:38302",
				"--rpc-bind-ip", "127.0.0.1",
				"--rpc-bind-port", port,
				"--disable-rpc-login",
				"--wallet-dir", config.walletsPath || "wallets"
			]);
		}
	}

	try {
		await wallet.getPrimaryAddress();
	} catch {
		try {
			await wallet.openWallet(config.walletName || "tips", config.walletPassword || "");
		} catch(ex) {
			await closeWallet(wallet).catch(() => {});
			throw ex;
		}
	}
	return wallet;
}

/**
 * Saves the wallet and stops the wallet RPC process if the bot started it.
 */
export async function closeWallet(wallet) {
	if(!wallet) {
		return;
	}
	if(wallet.getProcess()) {
		await wallet.close(true).catch(ex => helper.err("Can't save wallet:", ex));
		await wallet.stopProcess();
	} else {
		await wallet.save();
	}
}

/**
 * Maps Discord user IDs to wallet accounts using the account labels,
 * so the wallet file is the only state to back up.
 */
async function loadAccounts(wallet) {
	const response = await wallet.getRpcConnection().sendJsonRequest("get_accounts");
	const accounts = new Map();
	for(const account of response.result.subaddress_accounts) {
		const userId = account.label?.startsWith(labelPrefix) ? account.label.slice(labelPrefix.length) : "";
		if(account.account_index === 0 || !/^\d+$/.test(userId)) {
			continue;
		}
		if(accounts.has(userId)) {
			helper.warn("Duplicate wallet account for user %s: %i (using %i)", userId, account.account_index, accounts.get(userId));
			continue;
		}
		accounts.set(userId, account.account_index);
	}
	helper.log("Loaded %i user wallet accounts", accounts.size);
	return accounts;
}

function getAccounts(wallet) {
	accountsPromise ??= loadAccounts(wallet).catch(ex => {
		accountsPromise = undefined;
		throw ex;
	});
	return accountsPromise;
}

/**
 * Returns a map of wallet account indices to Discord user IDs.
 */
export async function getAccountUsers(wallet) {
	return new Map([ ...await getAccounts(wallet) ].map(([ userId, accountIndex ]) => [ accountIndex, userId ]));
}

export async function getUserAccount(wallet, userId) {
	const accounts = await getAccounts(wallet);
	const key = String(userId);
	if(accounts.has(key)) {
		return accounts.get(key);
	}
	if(!creatingAccounts.has(key)) {
		creatingAccounts.set(key, (async () => {
			const account = await wallet.createAccount(labelPrefix + key);
			accounts.set(key, account.getIndex());
			// wallet RPC keeps new accounts in memory only until the wallet is stored
			await wallet.save();
			return account.getIndex();
		})().finally(() => creatingAccounts.delete(key)));
	}
	return creatingAccounts.get(key);
}

export async function getUserAddress(wallet, userId) {
	return wallet.getAddress(await getUserAccount(wallet, userId), 0);
}

export async function getUserBalance(wallet, userId) {
	const subaddress = await wallet.getSubaddress(await getUserAccount(wallet, userId), 0);
	return {
		balance: subaddress.getBalance(),
		unlockedBalance: subaddress.getUnlockedBalance(),
		numBlocksToUnlock: subaddress.getNumBlocksToUnlock()
	};
}

export function parseMRL(value) {
	const text = String(value ?? "").trim();
	if(!/^\d{1,10}(?:\.\d{1,9})?$/.test(text)) {
		throw new UserError("Enter an amount in MRL with up to 9 decimal places, e.g. `1.5`.");
	}
	const [ whole, fraction = "" ] = text.split(".");
	const amount = BigInt(whole) * atomicUnits + BigInt(fraction.padEnd(9, "0"));
	if(amount <= 0n) {
		throw new UserError("The amount must be greater than zero.");
	}
	return amount;
}

export function formatMRL(amount, digits = 9) {
	let value = BigInt(amount);
	const negative = value < 0n;
	if(negative) {
		value = -value;
	}
	const scale = 10n ** BigInt(digits);
	const rounded = (value * scale + atomicUnits / 2n) / atomicUnits;
	const fraction = digits ? "." + String(rounded % scale).padStart(digits, "0") : "";
	return (negative ? "-" : "") + (rounded / scale) + fraction + " MRL";
}

function notEnoughMoney() {
	return new UserError("Not enough unlocked MRL to cover the amount and the transaction fee.");
}

function toUserError(ex) {
	const code = ex.getCode?.();
	if(notEnoughMoneyCodes.has(code)) {
		return notEnoughMoney();
	}
	if(code === wrongAddressCode || ex.message === "Invalid destination address") {
		return new UserError("That is not a valid Morelo address.");
	}
	return ex;
}

async function send(wallet, accountIndex, destinations) {
	const total = destinations.reduce((sum, destination) => sum + destination.amount, 0n);
	if(total > await wallet.getUnlockedBalance(accountIndex)) {
		throw notEnoughMoney();
	}
	try {
		const txs = await wallet.createTxs({ accountIndex, destinations, relay: true });
		return txs.map(tx => tx.getHash());
	} catch(ex) {
		throw toUserError(ex);
	}
}

/**
 * Splits the amount evenly among the recipients in a single transfer, so either
 * everyone is paid or nobody is. Indivisible atomic units stay with the sender.
 */
export async function tipUsers(wallet, senderId, recipientIds, amountText) {
	const recipients = [ ...new Set(recipientIds.map(String)) ].filter(id => id !== String(senderId));
	if(recipients.length === 0) {
		throw new UserError("There are no eligible recipients for this tip.");
	}
	const share = parseMRL(amountText) / BigInt(recipients.length);
	if(share === 0n) {
		throw new UserError("The amount is too small to split among " + recipients.length + " recipients.");
	}
	const senderAccount = await getUserAccount(wallet, senderId);
	// Check before creating accounts for all the recipients
	if(share * BigInt(recipients.length) > await wallet.getUnlockedBalance(senderAccount)) {
		throw notEnoughMoney();
	}
	const destinations = [];
	for(const recipientId of recipients) {
		destinations.push({ address: await getUserAddress(wallet, recipientId), amount: share });
	}
	return {
		recipients,
		share,
		hashes: await send(wallet, senderAccount, destinations)
	};
}

export async function withdraw(wallet, userId, address, amountText) {
	const accountIndex = await getUserAccount(wallet, userId);
	if(String(amountText).toLowerCase() !== "all") {
		return send(wallet, accountIndex, [ { address, amount: parseMRL(amountText) } ]);
	}
	if(await wallet.getUnlockedBalance(accountIndex) === 0n) {
		throw new UserError("You have no unlocked MRL to withdraw.");
	}
	try {
		const txs = await wallet.sweepUnlocked({ accountIndex, address, relay: true });
		return txs.map(tx => tx.getHash());
	} catch(ex) {
		throw toUserError(ex);
	}
}
