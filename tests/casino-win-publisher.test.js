import assert from "node:assert/strict";
import test from "node:test";
import publishCasinoWin from "../core/casino-win-publisher.js";

function createLogger() {
	const errors = [];
	return { errors, err: (...args) => errors.push(args) };
}

test("publishes a win to the only wins channel when no channel ID is configured", async () => {
	const sent = [];
	const logger = createLogger();
	const channel = { id: "channel-1", name: "wins", createMessage() {} };
	const bot = {
		guilds: new Map([ [ "guild-1", { channels: new Map([ [ channel.id, channel ] ]) } ] ]),
		getChannel: () => undefined,
		createMessage: async (...args) => sent.push(args)
	};

	assert.equal(await publishCasinoWin({ bot, config: {}, logger }, "Win!", [ "user-1" ]), true);
	assert.deepEqual(sent, [ [ "channel-1", { content: "Win!", allowedMentions: { users: [ "user-1" ] } } ] ]);
	assert.equal(logger.errors.length, 0);
});

test("does not guess when multiple wins channels exist", async () => {
	let sent = false;
	const logger = createLogger();
	const makeChannel = id => ({ id, name: "wins", createMessage() {} });
	const bot = {
		guilds: new Map([ [ "guild-1", { channels: new Map([ [ "one", makeChannel("one") ], [ "two", makeChannel("two") ] ]) } ] ]),
		getChannel: () => undefined,
		createMessage: async () => { sent = true; }
	};

	assert.equal(await publishCasinoWin({ bot, config: {}, logger }, "Win!", []), false);
	assert.equal(sent, false);
	assert.equal(logger.errors.length, 1);
});

test("logs Discord errors when publishing a win", async () => {
	const logger = createLogger();
	const bot = {
		guilds: new Map(),
		getChannel: id => ({ id }),
		createMessage: async () => { throw new Error("Missing permissions"); }
	};

	assert.equal(await publishCasinoWin({ bot, config: { casinoWinsChannel: "channel-1" }, logger }, "Win!", []), false);
	assert.equal(logger.errors.length, 1);
	assert.equal(logger.errors[0][0], "Can't publish casino win:");
});
