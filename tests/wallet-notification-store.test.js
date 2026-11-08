import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import WalletNotificationStore from "../api/wallet-notification-store-legacy.js";

test("tip metadata, notifications, and scan progress survive reopening the store", async t => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "morelobot-store-"));
	const filePath = path.join(directory, "notifications.json");
	t.after(() => rm(directory, { recursive: true, force: true }));

	const first = new WalletNotificationStore(filePath);
	await first.recordTip("tx-1", "200", "100", 123n);
	await first.setNotification("event-1", { status: "unconfirmed", userId: "100" });
	assert.deepEqual(await first.getNotificationPreferences("100"), { tips: true, transfers: true });
	await first.setNotificationPreferences("100", { tips: false });
	await first.setMessage("txpool", { channelId: "channel-1", messageId: "message-1" });
	await first.setHistoryProgress(120);
	await first.setHistoryProgress(90);

	const reopened = new WalletNotificationStore(filePath);
	const tip = await reopened.getTip("tx-1");
	assert.equal(tip.senderId, "200");
	assert.equal(tip.recipientId, "100");
	assert.equal(tip.amount, "123");
	assert.ok(tip.recordedAt > 0);
	assert.deepEqual(await reopened.getNotification("event-1"), { status: "unconfirmed", userId: "100" });
	assert.deepEqual(await reopened.getNotificationPreferences("100"), { tips: false, transfers: true });
	assert.deepEqual(await reopened.getMessage("txpool"), { channelId: "channel-1", messageId: "message-1" });
	assert.deepEqual(await reopened.getHistoryProgress(), { initialized: true, lastScannedHeight: 120 });
});

test("multi-recipient tip metadata is resolved by transaction hash and recipient", async t => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "morelobot-store-multi-tip-"));
	const filePath = path.join(directory, "notifications.json");
	t.after(() => rm(directory, { recursive: true, force: true }));
	const store = new WalletNotificationStore(filePath);
	await store.recordTips("tx-many", "100", [
		{ recipientId: "200", amount: 25n },
		{ recipientId: "300", amount: 35n }
	]);

	assert.deepEqual(await store.getTipForRecipient("tx-many", "200"), {
		senderId: "100",
		recipientId: "200",
		amount: "25",
		txHash: "tx-many",
		recordedAt: (await store.getTip("tx-many:200")).recordedAt
	});
	assert.equal(await store.getTipForRecipient("tx-many", "400"), undefined);
});

test("notification store retries transient Windows rename locks", async t => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "morelobot-notification-retry-"));
	const filePath = path.join(directory, "notifications.json");
	t.after(() => rm(directory, { recursive: true, force: true }));
	let attempts = 0;
	const store = new WalletNotificationStore(filePath, {
		rename: async (...args) => {
			attempts++;
			if(attempts < 3) {
				const error = new Error("temporary file lock");
				error.code = "EPERM";
				throw error;
			}
			const { rename } = await import("node:fs/promises");
			return rename(...args);
		},
		wait: async () => {}
	});

	await store.setNotification("event", { status: "unconfirmed" });
	assert.equal(attempts, 3);
	assert.equal(JSON.parse(await readFile(filePath, "utf8")).notifications.event.status, "unconfirmed");
	assert.deepEqual((await readdir(directory)).filter(name => name.endsWith(".tmp")), []);
});
