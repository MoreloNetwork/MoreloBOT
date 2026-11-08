import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureCasinoGuide, loadCasinoGuideMessageIds, saveCasinoGuideMessageIds } from "../core/casino-guides.js";

async function createPath(t) {
	const directory = await mkdtemp(path.join(os.tmpdir(), "morelobot-guides-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return path.join(directory, "casino-guide-message-ids.json");
}

function createChannel({ pins = [], savedMessages = new Map() } = {}) {
	const calls = { getPins: 0, getMessage: [], createMessage: [], pinMessage: [] };
	return {
		calls,
		getPins: async () => { calls.getPins++; return pins; },
		getMessage: async id => {
			calls.getMessage.push(id);
			if(!savedMessages.has(id)) throw new Error("Unknown message");
			return savedMessages.get(id);
		},
		createMessage: async message => {
			calls.createMessage.push(message);
			return { id: "created-1", content: message.content };
		},
		pinMessage: async id => calls.pinMessage.push(id),
		id: "channel-1"
	};
}

const guide = "How to play roulette";
const existingPin = { id: "pinned-1", content: "**Casino guide: roulette**\\nHow to play roulette" };

test("casino guide reuses an existing pinned instruction and records its ID", async t => {
	const filePath = await createPath(t);
	const channel = createChannel({ pins: [ existingPin ] });
	const ids = await loadCasinoGuideMessageIds(filePath);
	let saves = 0;

	const result = await ensureCasinoGuide(channel, "roulette", guide, ids, async values => {
		saves++;
		await saveCasinoGuideMessageIds(filePath, values);
	});

	assert.deepEqual(result, { id: "pinned-1", published: false });
	assert.equal(channel.calls.getPins, 1);
	assert.equal(channel.calls.createMessage.length, 0);
	assert.equal(channel.calls.pinMessage.length, 0);
	assert.equal(saves, 1);
	assert.deepEqual(await loadCasinoGuideMessageIds(filePath), { "channel-1:roulette": "pinned-1" });
});

test("casino guide checks pinned messages before using the stored message ID", async () => {
	const channel = createChannel({ pins: [ existingPin ] });
	const ids = { "channel-1:roulette": "old-id" };
	const result = await ensureCasinoGuide(channel, "roulette", guide, ids, async () => {});

	assert.deepEqual(result, { id: "pinned-1", published: false });
	assert.deepEqual(channel.calls.getMessage, []);
	assert.equal(channel.calls.createMessage.length, 0);
});

test("casino guide reuses a stored message ID and pins it without publishing another", async () => {
	const channel = createChannel({ savedMessages: new Map([ [ "saved-1", existingPin ] ]) });
	const ids = { "channel-1:roulette": "saved-1" };
	const result = await ensureCasinoGuide(channel, "roulette", guide, ids, async () => {});

	assert.deepEqual(result, { id: "pinned-1", published: false });
	assert.deepEqual(channel.calls.getMessage, [ "saved-1" ]);
	assert.deepEqual(channel.calls.pinMessage, [ "pinned-1" ]);
	assert.equal(channel.calls.createMessage.length, 0);
});

test("casino guide publishes, pins, and persists the new message ID only when none exists", async t => {
	const filePath = await createPath(t);
	const channel = createChannel();
	const ids = {};
	const result = await ensureCasinoGuide(channel, "roulette", guide, ids, values => saveCasinoGuideMessageIds(filePath, values));

	assert.deepEqual(result, { id: "created-1", published: true });
	assert.equal(channel.calls.getPins, 1);
	assert.equal(channel.calls.createMessage.length, 1);
	assert.deepEqual(channel.calls.pinMessage, [ "created-1" ]);
	assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), { "channel-1:roulette": "created-1" });
});
