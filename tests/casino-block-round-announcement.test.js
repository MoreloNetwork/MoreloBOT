import assert from "node:assert/strict";
import test from "node:test";
import { announceGuessRound, clearUnpinnedChannelMessages } from "../core/casino-block-round-announcement.js";

function createChannel(messages, pinned) {
	return {
		id: "guess-channel",
		getPins: async () => pinned.map(id => messages.find(message => message.id === id)).filter(Boolean)
	};
}

function createBot(messages, pinnedIds = []) {
	const sent = [];
	return {
		user: { id: "bot-1" },
		sent,
		getMessages: async (_channelId, { limit, before } = {}) => {
			const end = before ? messages.findIndex(message => message.id === before) : messages.length;
			const page = messages.slice(Math.max(0, end - limit), end).reverse();
			return page.map(message => ({ ...message, pinned: pinnedIds.includes(message.id) }));
		},
		deleteMessage: async (_channelId, id) => {
			const index = messages.findIndex(message => message.id === id);
			if(index !== -1) messages.splice(index, 1);
		},
		createMessage: async (channelId, content) => {
			const message = { id: "new-" + (messages.length + 1), channelId, content: content.content, author: { id: "bot-1" } };
			messages.push(message);
			sent.push({ channelId, payload: content });
			return message;
		}
	};
}

function createRoundStore() {
	let lastRound = 0;
	const rounds = new Map();
	return {
		getRound: async height => rounds.get(height),
		markRoundAnnouncing: async height => { rounds.set(height, { height, status: "announcing" }); },
		markRoundAnnounced: async height => { lastRound = Math.max(lastRound, height); rounds.set(height, { height, status: "announced" }); }
	};
}

test("clears every non-pinned message and preserves pinned instructions", async () => {
	const messages = [
		{ id: "pin", content: "instructions" },
		{ id: "old-1", content: "a" },
		{ id: "old-2", content: "b" }
	];
	const removed = await clearUnpinnedChannelMessages(createBot(messages), createChannel(messages, [ "pin" ]));

	assert.equal(removed, 2);
	assert.deepEqual(messages.map(message => message.id), [ "pin" ]);
});

test("cleans channel history across multiple pages without deleting a pinned guide", async () => {
	const messages = Array.from({ length: 205 }, (_, index) => ({ id: "message-" + index, content: "old" }));
	messages[150].content = "instructions";
	const bot = createBot(messages, [ "message-150" ]);
	const removed = await clearUnpinnedChannelMessages(bot, createChannel(messages, [ "message-150" ]));

	assert.equal(removed, 204);
	assert.deepEqual(messages.map(message => message.id), [ "message-150" ]);
});

test("announces round results and next height once, after preserving the pinned guide", async () => {
	const messages = [
		{ id: "pin", content: "instructions" },
		{ id: "guess-1", content: "m!guess cdef 0.1" }
	];
	const bot = createBot(messages);
	const channel = createChannel(messages, [ "pin" ]);
	const store = createRoundStore();
	const previousBlock = {
		height: 100,
		hash: "a".repeat(64),
		bets: [
			{ userId: "user-1", guess: "cdef", won: true, status: "settled", payout: "200000000", payoutTxHash: "tx-hash" },
			{ userId: "user-2", guess: "1111", won: false, status: "settled", payout: "0" }
		]
	};

	assert.equal(await announceGuessRound({ bot, channel, store, testMode: false, previousBlock, newHeight: 101 }), true);
	assert.deepEqual(messages.map(message => message.id), [ "pin", "new-2" ]);
	assert.match(messages[1].content, /Round 100 ended/);
	assert.match(messages[1].content, /<@user-1>: `cdef` — WIN 0\.200000000 MRL/);
	assert.match(messages[1].content, /<@user-2>: `1111` — no win/);
	assert.match(messages[1].content, /New round started: predict block \*\*101\*\*/);
	assert.deepEqual(bot.sent[0].payload.allowedMentions.users, [ "user-1", "user-2" ]);
	assert.equal(await announceGuessRound({ bot, channel, store, testMode: false, previousBlock, newHeight: 101 }), false);
	assert.equal(messages.filter(message => message.content.includes("Guess round transition: 101")).length, 1);
});

test("round summary can report no winners only in the game channel", async () => {
	const messages = [ { id: "pin", content: "instructions" }, { id: "guess-1", content: "m!guess ffff 0.1" } ];
	const bot = createBot(messages);
	const channel = createChannel(messages, [ "pin" ]);
	const store = createRoundStore();

	await announceGuessRound({
		bot,
		channel,
		store,
		testMode: false,
		previousBlock: {
			height: 100,
			hash: "a".repeat(64),
			bets: [ { userId: "user-1", guess: "ffff", won: false, status: "settled", payout: "0", stake: "1000000000" } ]
		},
		newHeight: 101
	});

	assert.match(messages.at(-1).content, /no win/);
	assert.equal(bot.sent.length, 1);
	assert.equal(bot.sent[0].channelId, channel.id);
});

test("retries a failed announcement without clearing the channel a second time", async () => {
	const messages = [ { id: "pin", content: "instructions" }, { id: "guess-1", content: "guess" } ];
	const bot = createBot(messages);
	const channel = createChannel(messages, [ "pin" ]);
	const store = createRoundStore();
	const previousBlock = { height: 100, bets: [] };
	const createMessage = bot.createMessage;
	bot.createMessage = async () => { throw new Error("Discord unavailable"); };
	await assert.rejects(announceGuessRound({ bot, channel, store, testMode: false, previousBlock, newHeight: 101 }), /Discord unavailable/);
	assert.deepEqual(messages.map(message => message.id), [ "pin" ]);
	bot.createMessage = createMessage;
	assert.equal(await announceGuessRound({ bot, channel, store, testMode: false, previousBlock, newHeight: 101 }), true);
	assert.equal(messages.filter(message => message.content.includes("Guess round transition: 101")).length, 1);
});
