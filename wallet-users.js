import fs from "node:fs/promises";
import path from "node:path";

const atomicUnits = 1000000000n;
let users;
const pendingAccounts = new Map();

async function loadUsers(filePath) {
	if(users) {
		return users;
	}
	try {
		const contents = await fs.readFile(filePath, "utf8");
		const data = JSON.parse(contents);
		users = data && typeof data === "object" && !Array.isArray(data) ? data : {};
	} catch(ex) {
		if(ex.code !== "ENOENT") {
			throw ex;
		}
		users = {};
	}
	return users;
}

async function saveUsers(filePath) {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const tempPath = filePath + ".tmp";
	await fs.writeFile(tempPath, JSON.stringify(users), { mode: 0o600 });
	await fs.rename(tempPath, filePath);
}

export async function getUserAccount(wallet, filePath, userId) {
	const records = await loadUsers(filePath);
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

export function parseMRLAmount(value) {
	const text = String(value ?? "");
	if(!/^\d+(?:\.\d{1,9})?$/.test(text)) {
		throw new Error("Enter an amount greater than zero with up to 9 decimal places.");
	}
	const [ whole, fraction = "" ] = text.split(".");
	const amount = BigInt(whole) * atomicUnits + BigInt((fraction + "000000000").slice(0, 9));
	if(amount <= 0n) {
		throw new Error("The amount must be greater than zero.");
	}
	return amount;
}

export async function getUserBalance(wallet, filePath, userId) {
	const accountIndex = await getUserAccount(wallet, filePath, userId);
	const [ balance, unlockedBalance ] = await Promise.all([
		wallet.getBalance(accountIndex),
		wallet.getUnlockedBalance(accountIndex)
	]);
	return { accountIndex, balance, unlockedBalance };
}

export async function sendUserTip(wallet, filePath, senderId, recipientId, amount) {
	if(String(senderId) === String(recipientId)) {
		throw new Error("You cannot tip yourself.");
	}
	const atomicAmount = parseMRLAmount(amount);
	const sender = await getUserBalance(wallet, filePath, senderId);
	if(atomicAmount > sender.unlockedBalance) {
		throw new Error("You do not have enough unlocked MRL for this tip.");
	}
	const recipientIndex = await getUserAccount(wallet, filePath, recipientId);
	const address = await wallet.getAddress(recipientIndex, 0);
	const transaction = await wallet.createTx({
		accountIndex: sender.accountIndex,
		address,
		amount: atomicAmount,
		relay: true
	});
	return transaction.getHash();
}

export function formatWalletBalance(amount) {
	return (Number(amount) / Number(atomicUnits)).toFixed(9) + " MRL";
}
