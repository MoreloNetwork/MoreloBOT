import { formatMRL } from "../api/wallet.js";

export async function clearUnpinnedChannelMessages(bot, channel, logger) {
	const pins = await channel.getPins();
	const pinnedIds = new Set(pins.map(message => message.id));
	let before;
	let removed = 0;
	const failures = [];
	while(true) {
		const messages = await bot.getMessages(channel.id, { limit: 100, ...(before ? { before } : {}) });
		if(!messages.length) break;
		for(const message of messages) {
			if(!message.pinned && !pinnedIds.has(message.id)) {
				try {
					await bot.deleteMessage(channel.id, message.id);
					removed++;
				} catch(ex) {
					logger?.warn("Can't clear guess-game message %s:", message.id, ex);
					failures.push(ex);
				}
			}
		}
		if(failures.length || messages.length < 100) break;
		before = messages[messages.length - 1].id;
	}
	if(failures.length) throw new Error("Could not clear " + failures.length + " guess-game channel message(s).");
	return removed;
}

export async function announceGuessRound({ bot, channel, store, logger, testMode, previousBlock, newHeight }) {
	const marker = "Guess round transition: " + newHeight;
	const roundState = await store.getRound(newHeight);
	if(roundState?.status === "announced") return false;
	const latestMessages = await bot.getMessages(channel.id, { limit: 100 });
	if(latestMessages.some(message => message.author?.id === bot.user?.id && message.content?.includes(marker))) {
		await store.markRoundAnnounced(newHeight);
		return false;
	}
	const bets = previousBlock?.bets || [];
	const isWinner = bet => bet.won && bet.status === "settled";
	const winners = bets.filter(isWinner);
	const lines = bets.length
		? bets.map(bet => "<@" + bet.userId + ">: `" + bet.guess + "` — "
			+ (isWinner(bet) ? "WIN " + formatMRL(BigInt(bet.payout)) + (testMode ? " test MRL" : " MRL")
				+ (bet.payoutTxHash ? " (`" + bet.payoutTxHash + "`)" : "") : "no win")
			+ (bet.status !== "settled" ? " (" + bet.status + ")" : "")).join("\n")
		: "No predictions were placed.";
	const title = previousBlock
		? "Round " + previousBlock.height + " ended" + (previousBlock.hash ? " with hash `" + previousBlock.hash + "`" : "")
			+ ". " + winners.length + " winner(s)."
		: "Guess-the-hash round started.";
	const content = marker + "\n" + (testMode ? "[TEST] " : "") + title + "\n" + lines
		+ "\n\nNew round started: predict block **" + newHeight + "** with `m!guess <suffix> <amount>`.";
	if(roundState?.status !== "announcing") {
		await clearUnpinnedChannelMessages(bot, channel, logger);
		await store.markRoundAnnouncing(newHeight);
	}
	try {
		await bot.createMessage(channel.id, {
			content,
			allowedMentions: { users: [ ...new Set(bets.map(bet => String(bet.userId))) ] }
		});
	} catch(ex) {
		const newestMessages = await bot.getMessages(channel.id, { limit: 100 }).catch(() => []);
		if(!newestMessages.some(message => message.author?.id === bot.user?.id && message.content?.includes(marker))) throw ex;
	}
	await store.markRoundAnnounced(newHeight);
	return true;
}
