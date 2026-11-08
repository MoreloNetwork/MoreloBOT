import assert from "node:assert/strict";
import test from "node:test";
import { buildCasinoLeaderboard, formatCasinoLeaderboard } from "../casino/casino-leaderboard.js";
import { updateCasinoLeaderboard } from "../core/casino-leaderboard-publisher.js";

const wager = (userId, stake, payout, won, status = "settled") => ({ userId, stake, payout, won, status });

test("leaderboard aggregates settled gross winnings, largest single win, and losses", () => {
	const rankings = buildCasinoLeaderboard([
		wager("u1", "1000000000", "2000000000", true),
		wager("u1", "1000000000", "0", false),
		wager("u2", "5000000000", "0", false),
		wager("u3", "1000000000", "3000000000", true),
		wager("u4", "1000000000", "9000000000", true, "needs_review")
	], [
		wager("u1", "1000000000", "5000000000", true)
	]);

	assert.deepEqual(rankings.topWins.map(player => [ player.userId, player.totalWins ]), [ [ "u1", 7000000000n ], [ "u3", 3000000000n ] ]);
	assert.deepEqual(rankings.largestWins.map(player => [ player.userId, player.largestWin ]), [ [ "u1", 5000000000n ], [ "u3", 3000000000n ] ]);
	assert.deepEqual(rankings.largestLosses.map(player => [ player.userId, player.totalLosses ]), [ [ "u2", 5000000000n ], [ "u1", 1000000000n ] ]);
	assert.match(formatCasinoLeaderboard(rankings), /Top 10 total winnings/);
	assert.match(formatCasinoLeaderboard(rankings), /Top 10 largest losses/);
});

test("leaderboard limits each section to ten users", () => {
	const wagers = Array.from({ length: 12 }, (_, index) => wager("u" + index, "1000000000", String((index + 1) * 1000000000), true));
	const rankings = buildCasinoLeaderboard(wagers, []);
	assert.equal(rankings.topWins.length, 10);
	assert.equal(rankings.largestWins.length, 10);
});

test("publisher creates once and edits the existing leaderboard message", async () => {
	const messages = [];
	const edits = [];
	const bot = {
		user: { id: "bot-1" },
		getMessages: async () => messages,
		createMessage: async (channelId, content) => {
			const message = { id: "leaderboard-1", channelId, content, author: { id: "bot-1" } };
			messages.push(message);
			return message;
		},
		editMessage: async (channelId, id, content) => {
			edits.push({ channelId, id, content });
			return { id, channelId, content, author: { id: "bot-1" } };
		}
	};
	const channel = { id: "leaderboard-channel" };
	const data = { wagers: [ wager("u1", "1000000000", "2000000000", true) ], blockBets: [] };

	await updateCasinoLeaderboard({ bot, channel, ...data });
	await updateCasinoLeaderboard({ bot, channel, ...data, wagers: [ wager("u1", "1000000000", "3000000000", true) ] });

	assert.equal(messages.length, 1);
	assert.equal(edits.length, 1);
	assert.match(edits[0].content, /3\.000000000 MRL/);
});
