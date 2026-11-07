import { UserError } from "./command-utils.js";
import {
	getUserAccount as getMappedUserAccount,
	getUserIdsByAccount
} from "./wallet-users.js";

const atomicUnits = 1000000000n;
// WALLET_RPC_ERROR_CODE_NOT_ENOUGH_MONEY and WALLET_RPC_ERROR_CODE_NOT_ENOUGH_UNLOCKED_MONEY
const notEnoughMoneyCodes = new Set([ -17, -37 ]);
// WALLET_RPC_ERROR_CODE_WRONG_ADDRESS
const wrongAddressCode = -2;

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
			console.log("Using existing wallet RPC at %s", url);
		} catch {
			console.log("Starting wallet RPC at %s", url);
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
		await wallet.close(true).catch(ex => console.error("Can't save wallet:", ex));
		await wallet.stopProcess();
	} else {
		await wallet.save();
	}
}

export async function connectWalletRpc(monero, config, binPath, execExt, onOwnedProcess = () => {}) {
	const wallet = await connectWallet(monero, config, binPath, execExt);
	const process = wallet.getProcess?.();
	if(process) {
		onOwnedProcess(process);
	}
	return { wallet, ownsProcess: Boolean(process), process };
}

export async function stopOwnedWalletRpc(wallet, ownsProcess, child = wallet?.getProcess?.()) {
	if(ownsProcess && wallet) {
		await closeWallet(wallet);
	} else if(child && !child.killed) {
		child.kill();
	}
}

export async function getAccountUsers(wallet, config = {}) {
	const { result } = await wallet.getRpcConnection().sendJsonRequest("get_accounts");
	const accounts = new Map();
	for(const account of result.subaddress_accounts || []) {
		const accountIndex = Number(account.account_index);
		if(!Number.isInteger(accountIndex)) {
			continue;
		}
		if(config.walletUsersPath) {
			const userIds = await getUserIdsByAccount(
				wallet,
				config.walletUsersPath,
				accountIndex,
				config.legacyAddressesPath
			);
			if(userIds.length) {
				accounts.set(accountIndex, userIds[0]);
			}
		} else {
			const userId = account.label?.startsWith("discord-") ? account.label.slice(8) : "";
			if(accountIndex !== 0 && /^\d+$/.test(userId)) {
				accounts.set(accountIndex, userId);
			}
		}
	}
	return accounts;
}

export async function getUserAccount(wallet, userId, config = {}) {
	return getMappedUserAccount(
		wallet,
		config.walletUsersPath || "wallets/users.json",
		userId,
		config.legacyAddressesPath
	);
}

export async function getUserAddress(wallet, userId, config = {}) {
	const accountIndex = await getUserAccount(wallet, userId, config);
	return wallet.getAddress(accountIndex, 0);
}

export async function getUserBalance(wallet, userId, config = {}) {
	const accountIndex = await getUserAccount(wallet, userId, config);
	const subaddress = await wallet.getSubaddress(accountIndex, 0);
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
	if(process.env.MORELOBOT_TEST_MODE === "1") {
		throw new UserError("MRL transfers are disabled in test mode.");
	}
	const total = destinations.reduce((sum, destination) => sum + destination.amount, 0n);
	if(total > await wallet.getUnlockedBalance(accountIndex)) {
		throw notEnoughMoney();
	}
	try {
		const txs = destinations.length === 1
			? [ await wallet.createTx({ accountIndex, ...destinations[0], relay: true }) ]
			: await wallet.createTxs({ accountIndex, destinations, relay: true });
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

export async function withdraw(wallet, userId, address, amountText, config = {}) {
	if(process.env.MORELOBOT_TEST_MODE === "1") {
		throw new UserError("MRL transfers are disabled in test mode.");
	}
	const accountIndex = await getUserAccount(wallet, userId, config);
	const destination = { address, amount: 0n };
	if(String(amountText).toLowerCase() !== "all") {
		destination.amount = parseMRL(amountText);
		return send(wallet, accountIndex, [ destination ]);
	}
	if(await wallet.getUnlockedBalance(accountIndex) === 0n) {
		throw new UserError("You have no unlocked MRL to withdraw.");
	}
	try {
		const txs = await wallet.sweepUnlocked({ accountIndex, destinations: [ destination ], relay: true });
		return txs.map(tx => tx.getHash());
	} catch(ex) {
		throw toUserError(ex);
	}
}
