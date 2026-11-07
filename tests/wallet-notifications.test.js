import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import WalletNotificationStore from "../api/wallet-notification-store.js";
import {
	getIncomingTransferKey,
	getTransferStatus,
	normalizeWalletTransfersResponse,
	startWalletNotifications
} from "../api/wallet-notifications.js";

function makeTransfer({ hash, amount = 1000000000n, accountIndex = 0, subaddressIndex = 0, confirmed = true, locked = false, height = 90 }) {
	const tx = {
		getHash: () => hash,
		height,
		getHeight: () => height,
		getIsConfirmed: () => confirmed,
		getIsLocked: () => locked
	};
	return {
		getTx: () => tx,
		getAccountIndex: () => accountIndex,
		getSubaddressIndex: () => subaddressIndex,
		getAmount: () => amount
	};
}

async function makeContext(t, { transfers = [], failDM = false } = {}) {
	const directory = await mkdtemp(path.join(os.tmpdir(), "morelobot-notifications-"));
	const usersPath = path.join(directory, "users.json");
	const storePath = path.join(directory, "notifications.json");
	await writeFile(usersPath, JSON.stringify({ "100": 0 }));
	await mkdir(path.join(directory, "wallets"), { recursive: true });
	const sent = [];
	const edited = [];
	const listeners = [];
	let dmFails = failDM;
	const wallet = {
		addListener: async listener => listeners.push(listener),
		removeListener: async listener => listeners.splice(listeners.indexOf(listener), 1),
		getIncomingTransfers: async query => query?.txQuery?.hash
			? transfers.filter(transfer => transfer.getTx().getHash() === query.txQuery.hash)
			: transfers.filter(transfer => !query?.txQuery?.minHeight || transfer.getTx().height >= query.txQuery.minHeight),
		getHeight: async () => 100
	};
	const bot = {
		getDMChannel: async userId => {
			if(dmFails) {
				throw new Error("DM is unavailable");
			}
			return { id: "dm-" + userId };
		},
		createMessage: async (channelId, content) => {
			const message = { id: "message-" + (sent.length + 1) };
			sent.push({ channelId, content, message });
			return message;
		},
		editMessage: async (channelId, messageId, content) => {
			const message = { id: messageId };
			edited.push({ channelId, messageId, content });
			return message;
		}
	};
	const logger = { warn() {}, error() {} };
	const store = new WalletNotificationStore(storePath);
	const config = {
		walletUsersPath: usersPath,
		legacyAddressesPath: path.join(directory, "missing-addresses.json")
	};
	const context = {
		directory,
		storePath,
		store,
		wallet,
		bot,
		config,
		service: undefined,
		listener: undefined,
		sent,
		edited,
		setDmFailure(value) { dmFails = value; }
	};
	context.service = await startWalletNotifications({
		wallet,
		bot,
		config,
		store,
		logger
	});
	t.after(async () => {
		await context.service?.stop();
		await rm(directory, { recursive: true, force: true });
	});
	context.listener = listeners[0];
	return context;
}

test("disabled tip preferences suppress tip DMs without replay after re-enabling", async t => {
	const ctx = await makeContext(t);
	await ctx.store.setNotificationPreferences("100", { tips: false });
	await ctx.store.recordTip("quiet-tip", "200", "100", 1000000000n);
	const transfer = makeTransfer({ hash: "quiet-tip", confirmed: false });
	ctx.wallet.getIncomingTransfers = async query => query?.txQuery?.hash === "quiet-tip" ? [ transfer ] : [];
	await ctx.listener.onOutputReceived({ getTx: () => transfer.getTx() });
	assert.equal(ctx.sent.length, 0);
	assert.equal((await ctx.store.getNotification("quiet-tip:0:0:100")).suppressed, true);

	await ctx.store.setNotificationPreferences("100", { tips: true });
	await ctx.listener.onOutputReceived({ getTx: () => transfer.getTx() });
	assert.equal(ctx.sent.length, 0);
});

test("disabled transfer preferences suppress ordinary incoming transfer DMs", async t => {
	const ctx = await makeContext(t);
	await ctx.store.setNotificationPreferences("100", { transfers: false });
	const transfer = makeTransfer({ hash: "quiet-transfer", confirmed: false });
	ctx.wallet.getIncomingTransfers = async query => query?.txQuery?.hash === "quiet-transfer" ? [ transfer ] : [];
	await ctx.listener.onOutputReceived({ getTx: () => transfer.getTx() });
	assert.equal(ctx.sent.length, 0);
	assert.equal((await ctx.store.getNotification("quiet-transfer:0:0:100")).suppressed, true);
});

async function restartContext(context) {
	await context.service.stop();
	const store = new WalletNotificationStore(context.storePath);
	context.store = store;
	context.service = await startWalletNotifications({
		wallet: context.wallet,
		bot: context.bot,
		config: context.config,
		store,
		logger: { warn() {}, error() {} }
	});
}

test("transfer keys include transaction, account, subaddress, and recipient", () => {
	const transfer = makeTransfer({ hash: "tx-1", accountIndex: 2, subaddressIndex: 3 });
	assert.equal(getIncomingTransferKey(transfer, "100"), "tx-1:2:3:100");
});

test("transfer status reflects unconfirmed, confirmed, and unlocked states", () => {
	assert.equal(getTransferStatus(makeTransfer({ hash: "pending", confirmed: false })), "unconfirmed");
	assert.equal(getTransferStatus(makeTransfer({ hash: "locked", locked: true })), "confirmed");
	assert.equal(getTransferStatus(makeTransfer({ hash: "unlocked" })), "unlocked");
});

test("wallet RPC legacy subaddr_index is normalized for monero-ts", () => {
	const response = {
		result: {
			in: [ { subaddr_index: { major: 2, minor: 3 } } ],
			out: [ { subaddr_indices: [ { major: 4, minor: 5 } ] } ]
		}
	};

	assert.equal(normalizeWalletTransfersResponse(response), response);
	assert.deepEqual(response.result.in[0].subaddr_indices, [ { major: 2, minor: 3 } ]);
	assert.deepEqual(response.result.out[0].subaddr_indices, [ { major: 4, minor: 5 } ]);
});

test("first start sends one historical summary and does not repeat it after restart", async t => {
	const ctx = await makeContext(t, { transfers: [ makeTransfer({ hash: "old-1" }), makeTransfer({ hash: "old-2", amount: 2000000000n }) ] });
	assert.equal(ctx.sent.length, 1);
	assert.match(ctx.sent[0].content, /Historical incoming transfers: 2/);
	assert.match(ctx.sent[0].content, /Total received: 3\.000000000 MRL/);
	const saved = JSON.parse(await readFile(ctx.storePath, "utf8"));
	assert.equal(saved.historyInitialized, true);
	assert.equal(Object.keys(saved.notifications).filter(key => key.startsWith("history:")).length, 1);
	await restartContext(ctx);
	assert.equal(ctx.sent.length, 1);
});

test("a new transfer is notified immediately and the same DM is updated as it confirms", async t => {
	const ctx = await makeContext(t);
	const transfer = makeTransfer({ hash: "new-1", confirmed: false });
	ctx.wallet.getIncomingTransfers = async query => query?.txQuery?.hash === "new-1" ? [ transfer ] : [];
	await ctx.listener.onOutputReceived({ getTx: () => transfer.getTx() });
	assert.equal(ctx.sent.length, 1);
	assert.match(ctx.sent[0].content, /unconfirmed/);
	await ctx.listener.onOutputReceived({ getTx: () => transfer.getTx() });
	assert.equal(ctx.sent.length, 1);
	transfer.getTx = () => ({ getHash: () => "new-1", getIsConfirmed: () => true, getIsLocked: () => true });
	await ctx.listener.onOutputReceived({ getTx: () => transfer.getTx() });
	assert.equal(ctx.edited.length, 1);
	assert.match(ctx.edited[0].content, /confirmed, locked/);
});

test("tip notifications include the recorded sender", async t => {
	const ctx = await makeContext(t);
	await ctx.store.recordTip("tip-1", "200", "100", 1000000000n);
	const transfer = makeTransfer({ hash: "tip-1", confirmed: false });
	ctx.wallet.getIncomingTransfers = async query => query?.txQuery?.hash === "tip-1" ? [ transfer ] : [];
	await ctx.listener.onOutputReceived({ getTx: () => transfer.getTx() });
	assert.match(ctx.sent[0].content, /tip from <@200>/);
});

test("failed DMs remain pending and are retried on restart", async t => {
	const ctx = await makeContext(t, { failDM: true });
	const transfer = makeTransfer({ hash: "offline-1", confirmed: false });
	ctx.wallet.getIncomingTransfers = async query => query?.txQuery?.hash === "offline-1" ? [ transfer ] : [];
	await ctx.listener.onOutputReceived({ getTx: () => transfer.getTx() });
	const pending = (await ctx.store.getNotifications()).find(([, record]) => record.txHash === "offline-1");
	assert.equal(pending[1].deliveryPending, true);
	ctx.setDmFailure(false);
	await restartContext(ctx);
	assert.equal(ctx.sent.length, 1);
	assert.equal((await ctx.store.getNotification(pending[0])).deliveryPending, false);
});
