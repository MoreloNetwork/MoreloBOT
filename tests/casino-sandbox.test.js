import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import CasinoSandbox from "../casino/casino-sandbox.js";
import CasinoSandboxStore from "../casino/casino-sandbox-store.js";
import CasinoSandboxBlockStore from "../casino/casino-sandbox-block-store.js";

function createSandbox(randomValues) {
	const state = { balance: 1_000_000_000_000n, blackjack: undefined, bets: [] };
	const store = {
		getBalance: async () => state.balance,
		setBalance: async (_userId, balance) => { state.balance = BigInt(balance); },
		getBlackjack: async () => state.blackjack && structuredClone(state.blackjack),
		setBlackjack: async (_userId, hand) => { state.blackjack = hand && structuredClone(hand); },
		createBet: async bet => { state.bets.push(bet); return bet; }
	};
	const sandbox = new CasinoSandbox({
		store,
		blockStore: {},
		config: { casinoAdminUserIds: [ "690157533498704062" ], casinoMinBet: "0.001", casinoMaxBet: "0.1" },
		daemon: {},
		dependencies: { randomInt: () => randomValues.shift() }
	});
	return { sandbox, state };
}

test("blackjack hit keeps dealer's visible card in the response", async () => {
	const { sandbox } = createSandbox([ 6, 3, 1, 1, 10, 3, 12, 2, 1, 3 ]);
	await sandbox.startBlackjack("690157533498704062", "0.001");

	const result = await sandbox.hitBlackjack("690157533498704062");

	assert.equal(result.status, "playing");
	assert.deepEqual(result.player, [ "7♣", "2♥", "2♣" ]);
	assert.equal(result.dealerVisible, "J♣");
});

test("blackjack bust reveals dealer hand and returns payout and balance", async () => {
	const { sandbox, state } = createSandbox([ 9, 0, 8, 1, 10, 2, 12, 3, 4, 0 ]);
	await sandbox.startBlackjack("690157533498704062", "0.001");

	const result = await sandbox.hitBlackjack("690157533498704062");

	assert.equal(result.status, "bust");
	assert.deepEqual(result.player, [ "10♠", "9♥", "5♠" ]);
	assert.deepEqual(result.dealer, [ "J♦", "K♣" ]);
	assert.equal(result.payout, "0");
	assert.equal(result.balance, String(state.balance));
	assert.equal(state.blackjack, undefined);
});

test("sandbox allows multiple hash predictions per user and settles winners on the new top block", async t => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "morelobot-casino-sandbox-block-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const store = new CasinoSandboxStore(path.join(directory, "sandbox.json"), "1000000000000");
	const blockStore = new CasinoSandboxBlockStore(path.join(directory, "block-bets.json"));
	const winners = [];
	const hash = "0123456789abcdef".repeat(4);
	let height = 42;
	const sandbox = new CasinoSandbox({
		store,
		blockStore,
		config: {
			casinoAdminUserIds: [ "690157533498704062" ],
			casinoMinBet: "0.001",
			casinoMaxBet: "0.1",
			casinoSandboxHouseBalance: "1000000"
		},
		daemon: {
			getInfo: async () => ({ getHeight: () => height }),
			getBlockByHeight: async targetHeight => ({ getHeight: () => targetHeight, getHash: () => hash })
		},
		dependencies: { onWin: async bet => winners.push(bet) }
	});

	const firstBet = await sandbox.play("690157533498704062", "guess", "cdef", "0.001");
	const secondBet = await sandbox.play("690157533498704062", "guess", "abcdef", "0.001");
	assert.equal((await blockStore.getRoundBets(43)).length, 2);

	height = 43;
	const result = await sandbox.checkForNewBlocks();
	assert.equal(result.settledBlocks.length, 1);
	assert.equal(result.settledBlocks[0].height, 43);
	assert.equal(result.settledBlocks[0].hash, hash);
	assert.deepEqual(result.settledBlocks[0].bets.map(bet => bet.won), [ true, true ]);
	assert.deepEqual(result.settledBlocks[0].bets.map(bet => bet.id), [ firstBet.id, secondBet.id ]);
	assert.deepEqual(winners, []);
});
