import { formatCasinoLeaderboard, buildCasinoLeaderboard } from "../casino/casino-leaderboard.js";

const marker = "🏆 **Casino leaderboard**";

export async function updateCasinoLeaderboard({ bot, channel, wagers, blockBets }) {
	const content = formatCasinoLeaderboard(buildCasinoLeaderboard(wagers, blockBets));
	const messages = await bot.getMessages(channel.id, { limit: 100 });
	const existing = messages.find(message => message.author?.id === bot.user?.id && message.content?.includes(marker));
	if(existing) {
		if(existing.content !== content) await bot.editMessage(channel.id, existing.id, content);
		return existing;
	}
	return bot.createMessage(channel.id, content);
}
