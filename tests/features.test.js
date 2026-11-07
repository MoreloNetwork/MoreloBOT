import assert from "node:assert/strict";
import test from "node:test";
import { formatMempool } from "../features.js";

test("mempool formatter shows transaction count, hashes, amounts, and fees", () => {
	const message = formatMempool({
		total: 1,
		transactions: [ {
			tx_hash: "abc123",
			amount_out: "123000000000",
			fee: "2500000"
		} ]
	}, new Date("2026-01-02T03:04:05.000Z"), 4000, "https://explorer.example");

	assert.match(message, /## Transaction Pool/);
	assert.match(message, /\*\*1\*\* pending transaction/);
	assert.match(message, /\[abc123\]\(https:\/\/explorer\.example\/tx\/abc123\)/);
	assert.match(message, /Amount: \*\*123\.000000000 MRL\*\*/);
	assert.match(message, /Fee: 0\.002500000 MRL/);
	assert.match(message, /<t:1767323045:F>/);
	assert.match(message, /<t:1767323045:R>/);
});

test("mempool formatter handles empty results and respects Discord message length", () => {
	assert.match(formatMempool({ total: 0, transactions: [] }, new Date("2026-01-02T03:04:05Z")), /pool is currently empty/);
	const message = formatMempool({
		total: 100,
		transactions: Array.from({ length: 100 }, (_, index) => ({ tx_hash: "hash-" + index }))
	}, new Date("2026-01-02T03:04:05Z"), 300);
	assert.ok(message.length <= 300);
	assert.match(message, /Additional transactions omitted/);
	assert.match(message, /Last updated/);
});
