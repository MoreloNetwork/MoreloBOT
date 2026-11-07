import assert from "node:assert/strict";
import test from "node:test";
import casinoCommand from "../commands/casino.js";

test("message casino command forwards a normalized bet and formats the result", async () => {
	let call;
	const response = await casinoCommand.run(
		{ author: { id: "user-1" } },
		"casino",
		[ "coinflip", "HEADS", "0.1" ],
		false,
		{ casino: { play: async (...args) => {
			call = args;
			return {
				id: "wager-123456",
				game: "coinflip",
				outcome: "heads",
				won: true,
				payout: "200000000",
				stake: "100000000",
				payoutTxHash: "tx-hash"
			};
		} } }
	);

	assert.deepEqual(call, [ "user-1", "coinflip", "heads", "0.1" ]);
	assert.match(response, /Won; payout 0\.200000000 MRL was sent/);
	assert.match(response, /tx-hash/);
});

test("message casino command places a block suffix prediction", async () => {
	let call;
	const response = await casinoCommand.run(
		{ author: { id: "user-3" } },
		"casino",
		[ "guess", "CDEF", "0.1" ],
		false,
		{ casino: { blockGame: { play: async (...args) => {
			call = args;
			return { guess: "cdef", targetHeight: 123, stake: "100000000", payout: "384000000000" };
		} } } }
	);

	assert.deepEqual(call, [ "user-3", "CDEF", "0.1" ]);
	assert.match(response, /placed for block 123/);
	assert.match(response, /potential gross payout 384\.000000000 MRL/);
});

test("block status action returns the current prediction round", async () => {
	const response = await casinoCommand.run(
		{ author: { id: "user-4" } },
		"casino",
		[ "block" ],
		false,
		{ casino: { blockGame: { getCurrentRound: async () => ({ height: 456, bets: [] }) } } }
	);

	assert.match(response, /Block 456/);
	assert.match(response, /no predictions/);
});

test("slash balance replies privately", async () => {
	let response;
	await casinoCommand.runSlash({
		user: { id: "user-2" },
		data: { options: [ { name: "game", value: "balance" } ] },
		createMessage: async message => { response = message; }
	}, false, {
		casino: {
			getBalance: async () => ({ balance: 1500000000n, unlockedBalance: 1000000000n })
		}
	});

	assert.equal(response.flags, 64);
	assert.match(response.content, /1\.500000000 MRL/);
	assert.match(response.content, /0\.500000000 MRL/);
});

test("slash resolution forwards the proof and does not send transfers", async () => {
	let call;
	let response;
	await casinoCommand.runSlash({
		user: { id: "admin-1" },
		data: { options: [
			{ name: "game", value: "resolve" },
			{ name: "wager_id", value: "wager-123456" },
			{ name: "resolution", value: "settled" },
			{ name: "proof", value: "a".repeat(64) }
		] },
		createMessage: async message => { response = message; }
	}, false, {
		casino: {
			resolveWager: async (...args) => {
				call = args;
				return { id: "wager-123456", status: "settled" };
			}
		}
	});

	assert.deepEqual(call, [ "admin-1", "wager-123456", "settled", "a".repeat(64) ]);
	assert.equal(response.flags, 64);
	assert.match(response.content, /No transfer was sent/);
});
