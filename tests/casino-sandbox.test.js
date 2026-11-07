import assert from "node:assert/strict";
import test from "node:test";
import CasinoSandbox from "../casino/casino-sandbox.js";

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
