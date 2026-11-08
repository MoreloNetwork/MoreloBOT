import assert from "node:assert/strict";
import test from "node:test";
import WalletNotificationPostgresStore from "../api/wallet-notification-postgres-store.js";

class FakeNotificationDatabase {
	constructor() {
		this.state = undefined;
	}

	async query(sql, params = []) {
		if(sql.startsWith("SELECT state FROM wallet_notification_state")) {
			return { rows: this.state ? [ { state: this.state } ] : [] };
		}
		if(sql.startsWith("INSERT INTO wallet_notification_state")) {
			this.state = JSON.parse(params[0]);
			return { rows: [] };
		}
		if(sql.startsWith("UPDATE wallet_notification_state")) {
			this.state = JSON.parse(params[0]);
			return { rows: [] };
		}
		throw new Error("Unsupported SQL in FakeNotificationDatabase: " + sql);
	}
}

test("postgres notification store persists tips, preferences, message state and progress", async () => {
	const database = new FakeNotificationDatabase();
	const store = new WalletNotificationPostgresStore(database);

	await store.recordTip("tx-1", "sender-1", "recipient-1", 123n);
	await store.setNotification("event-1", { status: "unconfirmed", userId: "recipient-1" });
	await store.setNotificationPreferences("recipient-1", { tips: false });
	await store.setMessage("txpool", { channelId: "channel-1", messageId: "message-1" });
	await store.setHistoryProgress(120);
	await store.setHistoryProgress(110);

	const reopened = new WalletNotificationPostgresStore(database);
	assert.deepEqual(await reopened.getTip("tx-1"), {
		senderId: "sender-1",
		recipientId: "recipient-1",
		amount: "123",
		recordedAt: (await reopened.getTip("tx-1")).recordedAt
	});
	assert.deepEqual(await reopened.getNotification("event-1"), { status: "unconfirmed", userId: "recipient-1" });
	assert.deepEqual(await reopened.getNotificationPreferences("recipient-1"), { tips: false, transfers: true });
	assert.deepEqual(await reopened.getMessage("txpool"), { channelId: "channel-1", messageId: "message-1" });
	assert.deepEqual(await reopened.getHistoryProgress(), { initialized: true, lastScannedHeight: 120 });
});

test("postgres notification store resolves per-recipient metadata for multi-tip transactions", async () => {
	const database = new FakeNotificationDatabase();
	const store = new WalletNotificationPostgresStore(database);

	await store.recordTips("tx-many", "sender-1", [
		{ recipientId: "recipient-1", amount: 10n },
		{ recipientId: "recipient-2", amount: 20n }
	]);

	const tip = await store.getTipForRecipient("tx-many", "recipient-2");
	assert.equal(tip.senderId, "sender-1");
	assert.equal(tip.recipientId, "recipient-2");
	assert.equal(tip.amount, "20");
	assert.equal(tip.txHash, "tx-many");
	assert.equal(await store.getTipForRecipient("tx-many", "recipient-3"), undefined);
});
