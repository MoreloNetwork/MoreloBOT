import { formatMRL } from "../api/wallet.js";

export function buildCasinoLeaderboard(wagers, blockBets, limit = 10) {
	const totals = new Map();
	const entries = [ ...wagers, ...blockBets ].filter(entry => entry.status === "settled");
	for(const entry of entries) {
		const userId = String(entry.userId);
		let record = totals.get(userId);
		if(!record) {
			record = { userId, totalWins: 0n, largestWin: 0n, totalLosses: 0n };
			totals.set(userId, record);
		}
		const stake = BigInt(entry.stake || "0");
		const payout = BigInt(entry.payout || "0");
		if(entry.won && payout > 0n) {
			record.totalWins += payout;
			if(payout > record.largestWin) record.largestWin = payout;
		} else if(!entry.won) {
			record.totalLosses += stake;
		}
	}
	const players = [ ...totals.values() ];
	const topWins = players.filter(player => player.totalWins > 0n)
		.sort((left, right) => compareBigInt(right.totalWins, left.totalWins) || left.userId.localeCompare(right.userId))
		.slice(0, limit);
	const largestWins = players.filter(player => player.largestWin > 0n)
		.sort((left, right) => compareBigInt(right.largestWin, left.largestWin) || left.userId.localeCompare(right.userId))
		.slice(0, limit);
	const largestLosses = players.filter(player => player.totalLosses > 0n)
		.sort((left, right) => compareBigInt(right.totalLosses, left.totalLosses) || left.userId.localeCompare(right.userId))
		.slice(0, limit);
	return { topWins, largestWins, largestLosses };
}

function compareBigInt(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function formatCasinoLeaderboard(rankings) {
	const formatSection = (title, players, valueSelector) => "**" + title + "**\n"
		+ (players.length
			? players.map((player, index) => (index + 1) + ". <@" + player.userId + "> — " + valueSelector(player)).join("\n")
			: "No results yet.");
	return "🏆 **Casino leaderboard**\n\n"
		+ formatSection("Top 10 total winnings", rankings.topWins, player => formatMRL(player.totalWins)) + "\n\n"
		+ formatSection("Top 10 largest single wins", rankings.largestWins, player => formatMRL(player.largestWin)) + "\n\n"
		+ formatSection("Top 10 largest losses", rankings.largestLosses, player => formatMRL(player.totalLosses));
}
