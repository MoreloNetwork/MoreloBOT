import assert from "node:assert/strict";
import test from "node:test";
import { formatTipResult, getOnlineRecipientIds } from "../api/tip-utils.js";

test("tip response includes transaction hash, amount, and recipient details", () => {
	const response = formatTipResult("Tip sent", {
		txHash: "tx-hash-123",
		totalAmount: 1500000000n,
		recipients: [ { recipientId: "12345", amount: 1500000000n } ]
	});

	assert.match(response, /Hash: tx-hash-123/);
	assert.match(response, /Amount: 1\.500000000 MRL/);
	assert.match(response, /Recipients \(1\):/);
	assert.match(response, /<@12345> - 1\.500000000 MRL/);
});

test("tipall response lists up to 15 recipients and reports the rest", () => {
	const recipients = Array.from({ length: 17 }, (_, index) => ({
		recipientId: String(index + 1),
		amount: 1000000000n
	}));
	const response = formatTipResult("Tip distributed", {
		txHash: "bulk-hash",
		totalAmount: 17000000000n,
		recipients
	});

	assert.match(response, /Hash: bulk-hash/);
	assert.match(response, /Amount: 17\.000000000 MRL/);
	assert.match(response, /Recipients \(17\):/);
	assert.match(response, /<@15> - 1\.000000000 MRL/);
	assert.doesNotMatch(response, /<@16>/);
	assert.match(response, /and 2 more/);
});

test("tipall only includes cached online non-bot members", () => {
	const services = {
		bot: {
			guilds: new Map([ [ "guild-1", { members: new Map([
				[ "1", { id: "1", status: "online", user: { bot: false } } ],
				[ "2", { id: "2", status: "offline", user: { bot: false } } ],
				[ "3", { id: "3", status: "online", user: { bot: true } } ],
				[ "4", { id: "4", user: { bot: false } } ]
			]) } ] ])
		}
	};

	assert.deepEqual(getOnlineRecipientIds(services, "guild-1"), [ "1" ]);
});

test("tipall rejects when guild members are unavailable", () => {
	assert.throws(() => getOnlineRecipientIds({ bot: { guilds: new Map() } }, "guild-1"), /members are not available/);
});
