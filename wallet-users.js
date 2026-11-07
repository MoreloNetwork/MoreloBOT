import fs from "node:fs/promises";
import path from "node:path";

const atomicUnits = 1000000000n;
let users;
let usersPromise;
const pendingAccounts = new Map();
let saveQueue = Promise.resolve();

function loadUsers(filePath, wallet, legacyAddressesPath) {
	if(users) {
		return Promise.resolve(users);
	}
	if(!usersPromise) {
		usersPromise = (async () => {
			try {
				const contents = await fs.readFile(filePath, "utf8");
				const data = JSON.parse(contents);
				users = data && typeof data === "object" && !Array.isArray(data) ? data : {};
			} catch(ex) {
				if(ex.code !== "ENOENT") {
					throw ex;
				}
				users = {};
				if(legacyAddressesPath) {
					try {
						const legacyContents = await fs.readFile(legacyAddressesPath, "utf8");
						const legacyData = JSON.parse(legacyContents);
						const entries = Array.isArray(legacyData) ? legacyData : legacyData?.data;
						if(Array.isArray(entries)) {
							for(const entry of entries) {
								if(entry?.user_id == null || typeof entry.address !== "string") {
									continue;
								}
								try {
									const address = await wallet.getAddressIndex(entry.address);
									users[String(entry.user_id)] = address.getAccountIndex();
								} catch {
									// Ignore addresses not present in the configured wallet.
								}
							}
						}
						if(Object.keys(users).length > 0) {
							await saveUsers(filePath);
						}
					} catch(legacyError) {
						if(legacyError.code !== "ENOENT") {
							throw legacyError;
						}
					}
				}
			}
			return users;
		})().catch(ex => {
			users = undefined;
			usersPromise = undefined;
			throw ex;
		});
	}
	return usersPromise;
}

function saveUsers(filePath) {
	saveQueue = saveQueue.catch(() => {}).then(async () => {
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		const tempPath = filePath + ".tmp";
		await fs.writeFile(tempPath, JSON.stringify(users), { mode: 0o600 });
		await fs.rename(tempPath, filePath);
	});
	return saveQueue;
}

export async function getUserAccount(wallet, filePath, userId, legacyAddressesPath = "addresses.json") {
	filePath ||= "wallets/users.json";
	const records = await loadUsers(filePath, wallet, legacyAddressesPath);
	const key = String(userId);
	if(Number.isInteger(records[key]) && records[key] >= 0) {
		return records[key];
	}
	if(pendingAccounts.has(key)) {
		return pendingAccounts.get(key);
	}

	const pending = (async () => {
		const account = await wallet.createAccount("discord-" + key);
		records[key] = account.getIndex();
		await saveUsers(filePath);
		return records[key];
	})();
	pendingAccounts.set(key, pending);
	try {
		return await pending;
	} finally {
		pendingAccounts.delete(key);
	}
}

export async function getUserIdsByAccount(wallet, filePath, accountIndex, legacyAddressesPath = "addresses.json") {
	const records = await loadUsers(filePath || "wallets/users.json", wallet, legacyAddressesPath);
	return Object.keys(records).filter(userId => records[userId] === accountIndex);
}

export function parseMRLAmount(value) {
	const text = String(value ?? "");
	if(!/^\d{1,18}(?:\.\d{1,9})?$/.test(text)) {
		throw new Error("Enter an amount greater than zero with up to 9 decimal places.");
	}
	const [ whole, fraction = "" ] = text.split(".");
	const amount = BigInt(whole) * atomicUnits + BigInt((fraction + "000000000").slice(0, 9));
	if(amount <= 0n) {
		throw new Error("The amount must be greater than zero.");
	}
	return amount;
}

export async function getUserBalance(wallet, filePath, userId, legacyAddressesPath) {
	const accountIndex = await getUserAccount(wallet, filePath, userId, legacyAddressesPath);
	const subaddress = await wallet.getSubaddress(accountIndex, 0);
	return {
		accountIndex,
		balance: subaddress.getBalance(),
		unlockedBalance: subaddress.getUnlockedBalance(),
		numBlocksToUnlock: subaddress.getNumBlocksToUnlock()
	};
}

export async function sendUserTip(wallet, filePath, senderId, recipientId, amount, legacyAddressesPath, notificationStore) {
	if(process.env.MORELOBOT_TEST_MODE === "1") {
		throw new Error("MRL transfers are disabled in test mode.");
	}
	if(String(senderId) === String(recipientId)) {
		throw new Error("You cannot tip yourself.");
	}
	const atomicAmount = parseMRLAmount(amount);
	const sender = await getUserBalance(wallet, filePath, senderId, legacyAddressesPath);
	if(atomicAmount > sender.unlockedBalance) {
		const error = new Error("Not enough unlocked MRL to cover the tip and transaction fee.");
		error.code = "INSUFFICIENT_FUNDS";
		throw error;
	}
	const recipientIndex = await getUserAccount(wallet, filePath, recipientId, legacyAddressesPath);
	const address = await wallet.getAddress(recipientIndex, 0);
	let transaction;
	try {
		transaction = await wallet.createTx({
			accountIndex: sender.accountIndex,
			address,
			amount: atomicAmount,
			relay: true
		});
	} catch(ex) {
		if(Number(ex.code) === -37) {
			const error = new Error("Not enough unlocked MRL to cover the tip and transaction fee.");
			error.code = "INSUFFICIENT_FUNDS";
			throw error;
		}
		throw ex;
	}
	const txHash = transaction.getHash();
	if(notificationStore) {
		try {
			await notificationStore.recordTip(txHash, senderId, recipientId, atomicAmount);
		} catch(ex) {
			console.error("Can't save tip notification metadata:", ex);
		}
	}
	return txHash;
}

export async function sendUserTips(wallet, filePath, senderId, recipients, legacyAddressesPath, notificationStore) {
	if(process.env.MORELOBOT_TEST_MODE === "1") {
		throw new Error("MRL transfers are disabled in test mode.");
	}
	if(!Array.isArray(recipients) || recipients.length === 0) {
		throw new Error("At least one tip recipient is required.");
	}
	const uniqueRecipients = new Set();
	const destinations = [];
	let totalAmount = 0n;
	for(const recipient of recipients) {
		const recipientId = String(recipient.recipientId);
		if(recipientId === String(senderId)) {
			continue;
		}
		if(uniqueRecipients.has(recipientId)) {
			continue;
		}
		uniqueRecipients.add(recipientId);
		const amount = typeof recipient.amount === "bigint" ? recipient.amount : parseMRLAmount(recipient.amount);
		if(amount <= 0n) {
			throw new Error("Each tip amount must be greater than zero.");
		}
		const accountIndex = await getUserAccount(wallet, filePath, recipientId, legacyAddressesPath);
		const address = await wallet.getAddress(accountIndex, 0);
		destinations.push({ address, amount });
		totalAmount += amount;
	}
	if(destinations.length === 0) {
		throw new Error("There are no eligible recipients for this tip.");
	}
	const sender = await getUserBalance(wallet, filePath, senderId, legacyAddressesPath);
	if(totalAmount > sender.unlockedBalance) {
		const error = new Error("Not enough unlocked MRL to cover the tip and transaction fee.");
		error.code = "INSUFFICIENT_FUNDS";
		throw error;
	}
	let transaction;
	try {
		transaction = await wallet.createTx({
			accountIndex: sender.accountIndex,
			destinations,
			relay: true
		});
	} catch(ex) {
		if(Number(ex.code) === -37) {
			const error = new Error("Not enough unlocked MRL to cover the tip and transaction fee.");
			error.code = "INSUFFICIENT_FUNDS";
			throw error;
		}
		throw ex;
	}
	const txHash = transaction.getHash();
	if(notificationStore) {
		try {
			await notificationStore.recordTips(txHash, senderId, recipients
				.filter(recipient => String(recipient.recipientId) !== String(senderId))
				.map(recipient => ({
					recipientId: String(recipient.recipientId),
					amount: typeof recipient.amount === "bigint" ? recipient.amount : parseMRLAmount(recipient.amount)
				})));
		} catch(ex) {
			console.error("Can't save tip notification metadata:", ex);
		}
	}
	return txHash;
}

export function formatWalletBalance(amount) {
	let value = BigInt(amount);
	const negative = value < 0n;
	if(negative) {
		value = -value;
	}
	return (negative ? "-" : "") + (value / atomicUnits) + "." + String(value % atomicUnits).padStart(9, "0") + " MRL";
}
