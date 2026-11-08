import { formatMRL } from "../api/wallet.js";
import { getOption, reply, sendMessage } from "../core/command-utils.js";

function formatWager(wager) {
	const outcome = wager.game === "coinflip"
		? wager.outcome
		: wager.outcome.number + " " + wager.outcome.color;
	const status = [ "settled", "cancelled" ].includes(wager.status) ? wager.status : "needs review";
	return "`" + wager.id.slice(0, 8) + "` " + wager.game + " " + wager.selection
		+ " → " + outcome + "; stake " + formatMRL(BigInt(wager.stake))
		+ (wager.won ? "; payout " + formatMRL(BigInt(wager.payout)) : "; lost")
		+ "; " + status;
}

function formatTestPlay(result) {
	const payout = BigInt(result.payout || "0");
	const outcome = result.game === "roulette" && result.outcome?.number != null
		? formatRouletteOutcome(result.outcome)
		: result.game === "dice" ? "🎲 " + result.outcome
			: result.game === "coinflip" ? (result.outcome === "heads" ? "🪙 Heads" : "🪙 Tails")
				: result.outcome;
	return "🧪 TEST casino " + result.game + ": " + (outcome ?? result.status) + ". "
		+ (result.won ? "Win; test payout " + formatMRL(payout) + "." : "No win; test stake was consumed.")
		+ "\nTest balance: " + formatMRL(BigInt(result.balance ?? "0")) + ". No MRL was transferred.";
}

function formatRouletteOutcome(outcome) {
	const emoji = outcome.color === "red" ? "🔴" : outcome.color === "black" ? "⚫" : "🟢";
	return emoji + " **" + outcome.number + "** " + outcome.color;
}

async function animateRoulette(bot, channel, result, testMode, logger) {
	const frames = [ "🔴 7 ⚫ 20 🟢 0 🔴 3 ⚫ 18", "⚫ 26 🔴 9 ⚫ 30 🟢 0 🔴 12", "🔴 5 ⚫ 22 🔴 14 ⚫ 31 🟢 0", "⚫ 17 🔴 1 ⚫ 24 🔴 16 🟢 0" ];
	const prefix = testMode ? "🧪 TEST " : "";
	let message;
	try {
		message = await bot.createMessage(channel.id, prefix + "🎰 Roulette wheel spinning…\n" + frames[0]);
		for(let index = 1; index < frames.length; index++) {
			await new Promise(resolve => setTimeout(resolve, 300));
			await bot.editMessage(channel.id, message.id, prefix + "🎰 Roulette wheel spinning…\n" + frames[index]);
		}
		await bot.editMessage(channel.id, message.id, prefix + "🎰 Result: " + formatRouletteOutcome(result.outcome) + ". "
			+ (result.won ? "Win; payout " + formatMRL(BigInt(result.payout)) + "." : "No win.")
			+ (testMode ? " Test balance: " + formatMRL(BigInt(result.balance)) + ". No MRL was transferred." : ""));
		return true;
	} catch(ex) {
		logger?.err("Roulette animation failed after wager processing:", ex);
		return { error: ex };
	}
}

function formatBlockRound(round) {
	const bets = (round.bets || [])
		.filter(bet => [ "open", "settled", "needs_review", "payout_submitting" ].includes(bet.status))
		.slice(0, 15);
	const lines = [
		bets.length
			? (round.testMode ? "TEST block " : "Block ") + round.height + " predictions:\n" + bets
				.map(bet => "`" + bet.guess + "` — " + formatMRL(BigInt(bet.stake))
					+ (bet.status === "settled" ? (bet.won ? "; won " + formatMRL(BigInt(bet.payout)) : "; lost") : "; " + bet.status))
				.join("\n")
			: "Block " + round.height + " has no predictions yet."
	];
	if(round.previousRound?.hash) {
		const previousBets = (round.previousRound.bets || []).slice(0, 25);
		lines.push(
			"",
			(round.testMode ? "TEST " : "") + "Previous round " + round.previousRound.height + ":",
			"Block hash: `" + round.previousRound.hash + "`",
			"Last 6 chars: `" + round.previousRound.hashSuffix + "`"
		);
		if(previousBets.length) {
			lines.push(
				"Predictions:",
				...previousBets.map(bet => "<@" + bet.userId + "> guessed `" + bet.guess + "` (" + formatMRL(BigInt(bet.stake)) + ") — "
					+ (bet.status === "settled" ? (bet.won ? "won" : "lost") : bet.status))
			);
		}
	}
	return lines.join("\n");
}

export function formatPlay(result) {
	const outcome = result.game === "coinflip"
		? result.outcome
		: result.game === "roulette" ? formatRouletteOutcome(result.outcome)
			: result.game === "dice" ? "🎲 **" + result.outcome + "**"
				: result.outcome;
	const status = result.won
		? "Won; payout " + formatMRL(BigInt(result.payout)) + " was sent."
		: "Lost; the stake was sent to the house.";
	return (result.game === "coinflip" ? "🪙 " : "🎰 ") + "Casino " + result.game + ": " + outcome + ". " + status
		+ "\nWager: `" + result.id.slice(0, 8) + "`; stake: " + formatMRL(BigInt(result.stake))
		+ "\nTransaction: `" + (result.payoutTxHash || result.stakeTxHash) + "`";
}

async function runCasino(userId, action, args, casino, sandbox, context) {
	const testMode = casino.config?.casinoTestMode === true;
	const adminIds = Array.isArray(casino.config?.casinoAdminUserIds) ? casino.config.casinoAdminUserIds.map(String) : [];
	const isAdmin = adminIds.includes(String(userId));
	if(!testMode && !isAdmin) {
		return "Casino is currently restricted to configured administrators.";
	}
	if(testMode && action === "coinflip") {
		const [ selection, amount ] = args;
		if(!selection || !amount) return "Usage: `m!casino coinflip <heads|tails> <test amount>`.";
		return formatTestPlay(await sandbox.play(userId, "coinflip", selection.toLowerCase(), amount));
	}
	if(action === "balance") {
		if(testMode) {
			return "Sandbox balance: " + formatMRL(await sandbox.balance(userId)) + ". No real MRL.";
		}
		const balance = await casino.getBalance(userId);
		const locked = balance.balance - balance.unlockedBalance;
		return "Tip-wallet MRL balance: " + formatMRL(balance.balance)
			+ "\nUnlocked: " + formatMRL(balance.unlockedBalance)
			+ "\nLocked: " + formatMRL(locked > 0n ? locked : 0n);
	}
	if(action === "history") {
		if(testMode) {
			const bets = await sandbox.history(userId);
			return bets.length
				? bets.map(bet => "`" + bet.id.slice(0, 8) + "` " + bet.game + " " + (bet.outcome || bet.guess || bet.selection || "")
					+ "; stake " + formatMRL(BigInt(bet.stake)) + "; payout " + formatMRL(BigInt(bet.payout)) + "; " + bet.status).join("\n")
				: "No sandbox games played yet.";
		}
		const wagers = await casino.getHistory(userId);
		return wagers.length ? wagers.map(formatWager).join("\n") : "No casino wagers yet.";
	}
	if(action === "block") {
		const round = testMode ? await sandbox.getCurrentRound(userId) : await casino.blockGame.getCurrentRound();
		round.testMode = testMode;
		return formatBlockRound(round);
	}
	if(testMode && action === "guess") {
		const [ prediction, amount ] = args;
		if(!prediction || !amount) {
			return "Usage: `m!casino guess <1-6 hex characters> <amount>`.";
		}
		const bet = testMode
			? await sandbox.play(userId, "guess", prediction, amount)
			: await casino.blockGame.play(userId, prediction, amount);
		return (testMode ? "TEST prediction `" : "Prediction `") + bet.guess + "` placed for block " + bet.targetHeight + "; stake "
			+ formatMRL(BigInt(bet.stake)) + ", potential gross payout " + formatMRL(BigInt(bet.payout))
			+ (testMode ? ". Test balance only; no MRL was transferred." : " MRL.");
	}
	if(testMode && (action === "dice" || action === "roulette")) {
		const [ selection, amount ] = args;
		if(!selection || !amount) {
			return action === "dice" ? "Usage: `m!casino dice <1-6> <test amount>`." : "Usage: `m!casino roulette <red|black|0-36> <test amount>`.";
		}
		const result = await sandbox.play(userId, action, selection.toLowerCase(), amount);
		if(action === "roulette" && context?.bot && context?.channel) {
			return {
				content: formatTestPlay(result),
				animation: () => animateRoulette(context.bot, context.channel, result, true, context.logger),
				fallback: formatTestPlay(result)
			};
		}
		return formatTestPlay(result);
	}
	if(!testMode && action === "dice") {
		const [ selection, amount ] = args;
		if(!selection || !amount) return "Usage: `m!casino dice <1-6> <amount>`.";
		return formatPlay(await casino.play(userId, action, selection, amount));
	}
	if(!testMode && action === "roulette") {
		const [ selection, amount ] = args;
		if(!selection || !amount) return "Usage: `m!casino roulette <red|black|0-36> <amount>`.";
		const result = await casino.play(userId, action, selection.toLowerCase(), amount);
		if(context?.bot && context?.channel) {
			return {
				content: formatPlay(result),
				animation: () => animateRoulette(context.bot, context.channel, result, false, context.logger),
				fallback: formatPlay(result)
			};
		}
		return formatPlay(result);
	}
	if(testMode && action === "blackjack") {
		const [ blackjackAction, amount ] = args;
		let result;
		if(blackjackAction === "hit") {
			result = await sandbox.hitBlackjack(userId);
		} else if(blackjackAction === "stand") {
			result = await sandbox.standBlackjack(userId);
		} else if(blackjackAction === "start" && amount) {
			result = await sandbox.startBlackjack(userId, amount);
		} else {
			return "Usage: `m!casino blackjack start <test amount>`, then `hit` or `stand`.";
		}
		const formatCard = card => card.replace(/([♠♥♦♣])$/, suit => ({ "♠": "♠️", "♥": "♥️", "♦": "♦️", "♣": "♣️" })[suit]);
		return "🧪 TEST blackjack " + result.status + ": player " + (result.player || []).map(formatCard).join(" ")
			+ (result.dealer ? "; dealer " + result.dealer.map(formatCard).join(" ") : "; dealer shows " + formatCard(result.dealerVisible))
			+ (result.payout ? "; test payout " + formatMRL(BigInt(result.payout)) : "")
			+ (result.balance ? "; test balance " + formatMRL(BigInt(result.balance)) : "") + ". No MRL was transferred.";
	}
	if(action === "blockpending" && testMode) {
		if(!isAdmin) {
			return "This sandbox action is available only to configured administrators.";
		}
		const bets = (await (testMode ? sandbox.getOpenBets(userId) : casino.blockGame.getOpenBets(userId))).slice(0, 10);
		return bets.length
			? bets.map(bet => "`" + bet.id + "` " + (testMode ? "TEST " : "") + "block " + bet.targetHeight + " <@" + bet.userId + "> `" + bet.guess + "` — " + bet.status).join("\n")
			: "No block predictions need review.";
	}
	if(action === "blockresolve" && testMode) {
		if(!isAdmin) {
			return "This sandbox action is available only to configured administrators.";
		}
		const [ betId, resolution, proof ] = args;
		if(!betId || !resolution || !proof) {
			return "Usage: `m!casino blockresolve <bet-id> <settled|void> <verified-hash|no-transfer-confirmed>`.";
		}
		const bet = await (testMode ? sandbox.resolveBet(userId, betId, resolution.toLowerCase(), proof)
			: casino.blockGame.resolveBet(userId, betId, resolution.toLowerCase(), proof));
		return "Block prediction `" + bet.id.slice(0, 8) + "` marked " + bet.status + ". No transfer was sent.";
	}
	if(action === "pending" && testMode) {
		if(!isAdmin) {
			return "This sandbox action is available only to configured administrators.";
		}
		const wagers = (await (testMode ? sandbox.getOpenBets(userId) : casino.getOpenWagers(userId))).slice(0, 10);
		return wagers.length ? wagers.map(wager => formatWager(wager) + " (user " + wager.userId
			+ "; full ID: `" + wager.id + "`)").join("\n")
			: "No wagers need review.";
	}
	if(action === "resolve" && testMode) {
		if(!isAdmin) {
			return "This sandbox action is available only to configured administrators.";
		}
		const [ wagerId, resolution, proof ] = args;
		if(!wagerId || !resolution || !proof) {
			return "Usage: `m!casino resolve <wager-id> <settled|void> <tx-hash|no-transfer-confirmed>`.";
		}
		const wager = await (testMode ? sandbox.resolveBet(userId, wagerId, resolution.toLowerCase(), proof)
			: casino.resolveWager(userId, wagerId, resolution.toLowerCase(), proof));
		return "Wager `" + wager.id.slice(0, 8) + "` marked " + wager.status + ". No transfer was sent by this command.";
	}
	if(testMode) {
		return "Sandbox games: `balance`, `history`, `block`, `guess <suffix> <test amount>`, `coinflip <heads|tails> <test amount>`, `roulette <pick> <test amount>`, `dice <1-6> <test amount>`, `blackjack start <test amount>`, `blackjack hit|stand`.";
	}
	if(action !== "coinflip" && action !== "roulette" && action !== "dice") {
		return "Use `m!casino balance`, `history`, `coinflip <heads|tails> <amount>`, `roulette <red|black|0-36> <amount>`, or `dice <1-6> <amount>`.";
	}
	const [ selection, amount ] = args;
	if(!selection || !amount) {
		return action === "coinflip"
			? "Usage: `m!casino coinflip <heads|tails> <amount>`."
			: action === "roulette"
				? "Usage: `m!casino roulette <red|black|0-36> <amount>`."
				: "Usage: `m!casino dice <1-6> <amount>`.";
	}
	return formatPlay(await casino.play(userId, action, selection.toLowerCase(), amount));
}

export default {
	messageAliases: [ "coinflip", "guess", "roulette", "blackjack", "dice" ],
	args_min: 1, args_max: 4, hide_msg: true, where: 0, cooldown: 5,
	description: "Check your casino balance/history or place an MRL wager",
	options: [
		{
			name: "game",
			description: "Casino action",
			type: 3,
			required: true,
			choices: [
				{ name: "Balance", value: "balance" },
				{ name: "History", value: "history" },
				{ name: "Current block round", value: "block" },
				{ name: "Guess block hash suffix", value: "guess" },
				{ name: "Review block predictions (operator)", value: "blockpending" },
				{ name: "Resolve block prediction (operator)", value: "blockresolve" },
				{ name: "Coinflip", value: "coinflip" },
				{ name: "Roulette", value: "roulette" },
				{ name: "Dice", value: "dice" },
				{ name: "Blackjack", value: "blackjack" },
				{ name: "Review pending wagers (operator)", value: "pending" },
				{ name: "Resolve wager (operator)", value: "resolve" }
			]
		},
		{ name: "selection", description: "Game selection or 1-6 character block-hash suffix", type: 3, required: false },
		{ name: "amount", description: "Wager amount in MRL", type: 3, required: false },
		{ name: "wager_id", description: "Full wager or block-prediction ID for operator resolution", type: 3, required: false },
		{
			name: "resolution",
			description: "Operator decision after checking the wallet",
			type: 3,
			required: false,
			choices: [ { name: "Settled", value: "settled" }, { name: "Void", value: "void" } ]
		},
		{ name: "proof", description: "Verified tx/block hash or no-transfer-confirmed", type: 3, required: false }
	],
	async run(message, cmd, args, hide, services) {
		const action = cmd === "casino" ? args[0]?.toLowerCase() : cmd === "guessnexthash" ? "guess" : cmd;
		const gameChannels = services.casino.config?.casinoGameChannels || {};
		const blockActions = [ "guess", "block", "blockpending", "blockresolve" ];
		const isGameAction = [ "coinflip", "roulette", "blackjack", "dice" ].includes(action) || blockActions.includes(action);
		const targetChannelId = blockActions.includes(action) ? gameChannels.guessNextHash : gameChannels[action];
		if(isGameAction && targetChannelId && message.channel.id !== targetChannelId) {
			return "Use this game in <#" + targetChannelId + ">. Your wager was not placed.";
		}
		if(isGameAction && !targetChannelId) {
			return "The channel for this game is not configured. Please contact a casino administrator.";
		}
		const actionArgs = cmd === "casino" ? args.slice(1) : args;
		const result = await runCasino(message.author.id, action, actionArgs, services.casino, services.casinoSandbox, {
			bot: services.bot,
			channel: message.channel,
			logger: services.logger
		});
		if(result?.animation) {
			const animation = await result.animation();
			if(animation?.error) {
				await sendMessage(services.bot, message.channel, result.fallback);
			}
			return undefined;
		}
		return result;
	},
	async runSlash(interaction, hide, services) {
		const action = getOption(interaction, "game");
		const args = [
			getOption(interaction, "wager_id"),
			getOption(interaction, "resolution"),
			getOption(interaction, "proof")
		];
		const result = await runCasino(
			interaction.user.id,
			action,
			[ getOption(interaction, "selection"), getOption(interaction, "amount"), ...args ].filter(value => value != null),
			services.casino,
			services.casinoSandbox,
			{ interaction, logger: services.logger }
		);
		if(result?.animation) {
			await interaction.defer(64);
			const animation = await result.animation();
			await interaction.createMessage({ content: animation?.error ? result.fallback : "Roulette result is shown above.", flags: 64 });
			return;
		}
		await reply(interaction, result);
	}
};
