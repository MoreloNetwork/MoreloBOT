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
		{ casino: { config: { casinoAdminUserIds: [ "user-1" ] }, play: async (...args) => {
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
		{ casino: { config: { casinoAdminUserIds: [ "user-3" ], casinoTestMode: true } }, casinoSandbox: { play: async (...args) => {
			call = args;
			return { guess: "cdef", targetHeight: 123, stake: "100000000", payout: "384000000000" };
		} } }
	);

	assert.deepEqual(call, [ "user-3", "guess", "CDEF", "0.1" ]);
	assert.match(response, /placed for block 123/);
	assert.match(response, /potential gross payout 384\.000000000 MRL/);
});

test("block status action returns the current prediction round", async () => {
	const response = await casinoCommand.run(
		{ author: { id: "user-4" } },
		"casino",
		[ "block" ],
		false,
		{ casino: { config: { casinoAdminUserIds: [ "user-4" ] }, blockGame: { getCurrentRound: async () => ({ height: 456, bets: [] }) } } }
	);

	assert.match(response, /Block 456/);
	assert.match(response, /no predictions/);
});

test("blackjack hit displays the dealer's visible card instead of undefined", async () => {
	const response = await casinoCommand.run(
		{ author: { id: "690157533498704062" } },
		"casino",
		[ "blackjack", "hit" ],
		false,
		{
			casino: { config: { casinoAdminUserIds: [ "690157533498704062" ], casinoTestMode: true } },
			casinoSandbox: { hitBlackjack: async () => ({ status: "playing", player: [ "7♣", "2♥", "2♣" ], dealerVisible: "J♣" }) }
		}
	);

	assert.match(response, /dealer shows J♣/);
	assert.match(response, /2♥️/);
	assert.doesNotMatch(response, /undefined/);
});

test("blackjack bust displays the revealed dealer hand and test balance", async () => {
	const response = await casinoCommand.run(
		{ author: { id: "690157533498704062" } },
		"casino",
		[ "blackjack", "hit" ],
		false,
		{
			casino: { config: { casinoAdminUserIds: [ "690157533498704062" ], casinoTestMode: true } },
			casinoSandbox: { hitBlackjack: async () => ({
				status: "bust",
				player: [ "7♣", "2♥", "2♣", "8♦" ],
				dealer: [ "J♣", "K♦" ],
				payout: "0",
				balance: "1000017000000"
			}) }
		}
	);

	assert.match(response, /dealer J♣(?:️)? K♦(?:️)?/);
	assert.match(response, /test payout 0\.000000000 MRL/);
	assert.match(response, /test balance 1000\.017000000 MRL/);
	assert.doesNotMatch(response, /undefined/);
});

test("slash balance replies privately", async () => {
	let response;
	await casinoCommand.runSlash({
		user: { id: "user-2" },
		data: { options: [ { name: "game", value: "balance" } ] },
		createMessage: async message => { response = message; }
	}, false, {
		casino: {
			config: { casinoAdminUserIds: [ "user-2" ] },
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
			config: { casinoAdminUserIds: [ "admin-1" ], casinoTestMode: true }
		},
		casinoSandbox: {
			resolveBet: async (...args) => {
				call = args;
				return { id: "wager-123456", status: "settled" };
			}
		}
	});

	assert.deepEqual(call, [ "admin-1", "wager-123456", "settled", "a".repeat(64) ]);
	assert.equal(response.flags, 64);
	assert.match(response.content, /No transfer was sent/);
});

test("roulette spins through wheel frames and ends with an emoji result", async () => {
	const edits = [];
	const response = await casinoCommand.run(
		{ author: { id: "690157533498704062" }, channel: { id: "channel-1" } },
		"casino",
		[ "roulette", "17", "1" ],
		false,
		{
			bot: {
				createMessage: async (channelId, content) => ({ id: "message-1", content }),
				editMessage: async (channelId, messageId, content) => edits.push(content)
			},
			casino: {
				config: { casinoAdminUserIds: [ "690157533498704062" ], casinoTestMode: true },
				casinoTestMode: true
			},
			casinoSandbox: {
				play: async () => ({ game: "roulette", outcome: { number: 17, color: "red" }, won: true, payout: "2000000000", balance: "1000000000" })
			}
		}
	);

	assert.equal(response, undefined);
	assert.equal(edits.length, 4);
	assert.match(edits[0], /wheel spinning/);
	assert.match(edits.at(-1), /🔴 \*\*17\*\*/);
	assert.match(edits.at(-1), /Test balance/);
});

test("roulette animation failures do not throw after the wager is processed", async () => {
	const errors = [];
	const messages = [];
	const message = { author: { id: "690157533498704062" }, channel: { id: "channel-1" } };
	const services = {
		bot: { createMessage: async (channelId, content) => {
			if(content.includes("spinning")) throw new Error("Discord unavailable");
			messages.push(content);
		} },
		logger: { err: (...args) => errors.push(args) },
		casino: {
			config: { casinoAdminUserIds: [ "690157533498704062" ] },
			play: async () => ({ id: "bet-1", game: "roulette", outcome: { number: 17, color: "red" }, won: false, payout: "0", stake: "100000000", stakeTxHash: "tx" })
		}
	};
	const response = await casinoCommand.run(
		message,
		"casino",
		[ "roulette", "17", "1" ],
		false,
		services
	);

	assert.equal(response, undefined);
	assert.equal(errors.length, 1);
	assert.match(messages[0], /Casino roulette/);
});
