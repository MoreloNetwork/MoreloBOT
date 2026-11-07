import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import CasinoStore from "../casino/casino-store.js";

async function createStore(t) {
	const directory = await mkdtemp(path.join(os.tmpdir(), "morelobot-casino-store-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return path.join(directory, "wagers.json");
}

const wager = (id, userId, status = "stake_submitting") => ({
	id,
	userId,
	game: "coinflip",
	selection: "heads",
	stake: "100000000",
	payout: "200000000",
	outcome: "heads",
	won: true,
	status,
	createdAt: Date.now()
});

test("casino wager state and resolution survive reopening the store", async t => {
	const filePath = await createStore(t);
	const first = new CasinoStore(filePath);
	await first.createWager(wager("wager-1", "user-1"));
	assert.equal((await first.getOpenWager("user-1")).id, "wager-1");
	await first.updateWager("wager-1", {
		status: "settled",
		stakeTxHash: "stake-hash",
		payoutTxHash: "payout-hash"
	});

	const reopened = new CasinoStore(filePath);
	assert.equal(await reopened.getOpenWager("user-1"), undefined);
	const [ saved ] = await reopened.getUserWagers("user-1");
	assert.equal(saved.id, "wager-1");
	assert.equal(saved.status, "settled");
	assert.equal(saved.stakeTxHash, "stake-hash");
	assert.equal(saved.payoutTxHash, "payout-hash");
});

test("concurrent writes preserve every wager and open items remain reviewable", async t => {
	const store = new CasinoStore(await createStore(t));
	await Promise.all([
		store.createWager(wager("wager-1", "user-1")),
		store.createWager(wager("wager-2", "user-2", "needs_review")),
		store.createWager(wager("wager-3", "user-3", "payout_submitting"))
	]);

	assert.deepEqual((await store.getOpenWagers()).map(entry => entry.id).sort(), [
		"wager-1", "wager-2", "wager-3"
	]);
	assert.equal((await new CasinoStore(store.filePath).getUserWagers("user-2"))[0].status, "needs_review");
});

test("the store rejects malformed persisted data instead of resetting wager history", async t => {
	const filePath = await createStore(t);
	const { writeFile } = await import("node:fs/promises");
	await writeFile(filePath, JSON.stringify({ version: 2, wagers: [] }));
	await assert.rejects(new CasinoStore(filePath).load(), /Unsupported casino wager store format/);
});
