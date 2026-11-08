import { randomUUID, randomInt } from "node:crypto";
import { UserError } from "../core/command-utils.js";
import { getBlockGuessPayout } from "./casino-block-game.js";
import { resolveCoinflip, resolveRoulette, spinRoulette, tossCoin } from "./casino-games.js";
import { parseMRL } from "../api/wallet.js";

function cardValue(card) {
	return Math.min(card.rank, 10);
}

function handValue(cards) {
	let total = 0;
	let aces = 0;
	for(const card of cards) {
		total += cardValue(card);
		aces += card.rank === 1 ? 1 : 0;
	}
	while(aces && total + 10 <= 21) {
		total += 10;
		aces--;
	}
	return total;
}

function drawCard(random = randomInt) {
	const rank = random(13) + 1;
	const suit = [ "♠", "♥", "♦", "♣" ][random(4)];
	return { rank, suit };
}

function formatCard(card) {
	return (card.rank === 1 ? "A" : card.rank === 11 ? "J" : card.rank === 12 ? "Q" : card.rank === 13 ? "K" : card.rank) + card.suit;
}

export default class CasinoSandbox {
	constructor({ store, blockStore, config, daemon, dependencies = {} }) {
		this.store = store;
		this.blockStore = blockStore;
		this.config = config;
		this.daemon = daemon;
		this.randomInt = dependencies.randomInt || randomInt;
		this.spinRoulette = dependencies.spinRoulette || spinRoulette;
		this.tossCoin = dependencies.tossCoin || tossCoin;
		this.onWin = dependencies.onWin || (async () => {});
		this.queue = Promise.resolve();
	}

	serialize(action) {
		const operation = this.queue.catch(() => {}).then(action);
		this.queue = operation.catch(() => {});
		return operation;
	}

	requireAdmin(userId) {
		const admins = Array.isArray(this.config.casinoAdminUserIds) ? this.config.casinoAdminUserIds.map(String) : [];
		if(!admins.includes(String(userId))) {
			throw new UserError("Casino sandbox is currently available only to configured administrators.");
		}
	}

	async balance(userId) {
		return this.store.getBalance(userId);
	}

	async play(userId, game, selection, amountText) {
		return this.serialize(() => this.playNow(userId, game, selection, amountText));
	}

	async playNow(userId, game, selection, amountText) {
		const amount = parseMRL(amountText);
		const minimum = parseMRL(this.config.casinoMinBet || "0.001");
		if(amount < minimum) {
			throw new UserError("Test bet is below the configured minimum.");
		}
		const maximum = parseMRL(this.config.casinoMaxBet || "0.1");
		if(amount > maximum) {
			throw new UserError("Test bet exceeds the configured maximum.");
		}
		const balance = await this.store.getBalance(userId);
		if(balance < amount) {
			throw new UserError("Not enough test balance.");
		}
		const id = randomUUID();
		if(game === "guess") {
			return this.createGuess(userId, selection, amount, balance, id);
		}
		if(game === "roulette") {
			const outcome = this.spinRoulette();
			const resolution = resolveRoulette(selection, outcome, amount);
			return this.settleInstant(userId, game, selection, amount, balance, resolution.result, resolution.won, resolution.payout, id);
		}
		if(game === "coinflip") {
			const outcome = this.tossCoin();
			const resolution = resolveCoinflip(selection, outcome, amount);
			return this.settleInstant(userId, game, selection, amount, balance, outcome, resolution.won, resolution.payout, id);
		}
		if(game === "dice") {
			if(!/^[1-6]$/.test(String(selection))) {
				throw new UserError("Choose a number from 1 to 6.");
			}
			const result = this.randomInt(6) + 1;
			const won = Number(selection) === result;
			const payout = won ? amount * 57n / 10n : 0n;
			return this.settleInstant(userId, game, selection, amount, balance, result, won, payout, id);
		}
		throw new UserError("Choose `guess`, `roulette`, `blackjack`, or `dice`.");
	}

	async settleInstant(userId, game, selection, amount, balance, outcome, won, payout, id) {
		const newBalance = balance - amount + payout;
		await this.store.setBalance(userId, newBalance);
		const bet = {
			id,
			userId: String(userId),
			game,
			selection: String(selection),
			outcome,
			stake: String(amount),
			payout: String(payout),
			won,
			status: "settled",
			createdAt: Date.now()
		};
		await this.store.createBet(bet);
		if(won) {
			await this.onWin(bet).catch(() => {});
		}
		return { ...bet, balance: String(newBalance) };
	}

	async createGuess(userId, guess, amount, balance, id) {
		const prediction = String(guess ?? "").toLowerCase();
		if(!/^[\da-f]{1,6}$/.test(prediction)) {
			throw new UserError("Choose a 1 to 6 character hexadecimal block-hash suffix.");
		}
		const round = await this.daemon.getInfo();
		const targetHeight = round.getHeight() + 1;
		const payout = getBlockGuessPayout(amount, prediction.length);
		if(await this.blockStore.getLiability() + payout > BigInt(this.config.casinoSandboxHouseBalance || "1000000") * 1000000000n) {
			throw new UserError("Sandbox house cannot cover this prediction's maximum test payout.");
		}
		const currentInfo = await this.daemon.getInfo();
		if(currentInfo.getHeight() + 1 !== targetHeight) {
			throw new UserError("The block round has closed; no prediction was placed.");
		}
		await this.store.setBalance(userId, balance - amount);
		return this.blockStore.createBet({
			id, userId: String(userId), game: "guess", guess: prediction, selection: prediction,
			targetHeight, stake: String(amount), payout: String(payout), feeReserve: "0", won: false,
			status: "open", createdAt: Date.now()
		});
	}

	async getCurrentRound(userId) {
		const info = await this.daemon.getInfo();
		const height = info.getHeight() + 1;
		const [ bets, previousBlock ] = await Promise.all([
			this.blockStore.getRoundBets(height),
			this.blockStore.getBlock(height - 1)
		]);
		const previousRound = previousBlock
			? {
				height: height - 1,
				hash: previousBlock.hash,
				hashSuffix: String(previousBlock.hash).slice(-6),
				bets: await this.blockStore.getRoundBets(height - 1)
			}
			: undefined;
		return { height, bets, previousRound };
	}

	async settleGuessRound(height, hash) {
		return this.serialize(async () => {
			if(!/^[\da-f]{64}$/i.test(hash)) {
				throw new Error("Invalid block hash for sandbox settlement.");
			}
			const existing = await this.blockStore.getBlock(height);
			if(existing) {
				if(existing.hash !== hash.toLowerCase()) throw new Error("Sandbox block height was recorded with a different hash.");
				return [];
			}
			await this.blockStore.recordBlock(height, hash.toLowerCase());
			const bets = await this.blockStore.getRoundBets(height);
			const settled = [];
			const houseBalance = BigInt(this.config.casinoSandboxHouseBalance || "1000000") * 1000000000n;
			let available = houseBalance - await this.blockStore.getLiability();
			for(const bet of bets) {
				if(bet.status !== "open") {
					continue;
				}
				const won = hash.toLowerCase().endsWith(bet.guess);
				const payout = won && BigInt(bet.payout) <= available ? BigInt(bet.payout) : 0n;
				if(won && payout === 0n) {
					await this.blockStore.updateBet(bet.id, { status: "needs_review", won: true, blockHash: hash.toLowerCase(), failureStage: "sandbox_house_liability" });
					continue;
				}
				available -= payout;
				const balance = await this.store.getBalance(bet.userId);
				await this.store.setBalance(bet.userId, balance + payout);
				const result = await this.blockStore.updateBet(bet.id, { won, payout: String(payout), status: "settled", blockHash: hash.toLowerCase() });
				settled.push(result);
			}
			const pendingBets = (await this.blockStore.getRoundBets(height)).some(bet => bet.status === "open" || bet.status === "needs_review");
			if(!pendingBets) await this.blockStore.updateBlock(height, { status: "settled", settledAt: Date.now() });
			return settled;
		});
	}

	async checkForNewBlocks() {
		const info = await this.daemon.getInfo();
		const currentHeight = info.getHeight();
		const pendingHeights = [...new Set((await this.blockStore.getOpenBets())
			.filter(bet => bet.targetHeight <= currentHeight).map(bet => bet.targetHeight))];
		const settledBlocks = [];
		for(const height of pendingHeights) {
			const block = await this.daemon.getBlockByHeight(height);
			const hash = block?.getHash?.() || block?.hash;
			if(hash) {
				await this.settleGuessRound(height, hash);
			}
		}
		for(const block of await this.blockStore.getUnannouncedSettledBlocks()) {
			settledBlocks.push({ ...block, bets: await this.blockStore.getRoundBets(block.height) });
		}
		return { height: currentHeight, settledBlocks };
	}

	async startBlackjack(userId, amountText) {
		return this.serialize(async () => {
			const existing = await this.store.getBlackjack(userId);
			if(existing) {
				throw new UserError("Finish or stand on your current blackjack hand first.");
			}
			const stake = parseMRL(amountText);
			const balance = await this.store.getBalance(userId);
			if(stake < parseMRL(this.config.casinoMinBet || "0.001")
				|| stake > parseMRL(this.config.casinoMaxBet || "0.1") || balance < stake) {
				throw new UserError("Invalid bet or insufficient test balance.");
			}
			const player = [ drawCard(this.randomInt), drawCard(this.randomInt) ];
			const dealer = [ drawCard(this.randomInt), drawCard(this.randomInt) ];
			const hand = { stake: String(stake), player, dealer, createdAt: Date.now() };
			if(handValue(player) === 21) {
				const dealerNatural = handValue(dealer) === 21;
				const payout = dealerNatural ? stake : stake * 5n / 2n;
				await this.store.setBalance(userId, balance - stake + payout);
				const bet = { id: randomUUID(), userId: String(userId), game: "blackjack", stake: String(stake), payout: String(payout), won: !dealerNatural, outcome: dealerNatural ? "push" : "blackjack", status: "settled", createdAt: Date.now() };
				await this.store.createBet(bet);
				if(bet.won) {
					await this.onWin(bet).catch(() => {});
				}
				return { status: dealerNatural ? "push" : "blackjack", player: player.map(formatCard), dealer: dealer.map(formatCard), payout: String(payout), balance: String(balance - stake + payout) };
			}
			await this.store.setBalance(userId, balance - stake);
			await this.store.setBlackjack(userId, hand);
			return { status: "playing", player: player.map(formatCard), playerValue: handValue(player), dealerVisible: formatCard(dealer[0]), stake: String(stake) };
		});
	}

	async hitBlackjack(userId) {
		return this.serialize(async () => {
			const hand = await this.store.getBlackjack(userId);
			if(!hand) {
				throw new UserError("No active blackjack hand.");
			}
			hand.player.push(drawCard(this.randomInt));
			if(handValue(hand.player) > 21) {
				await this.finishBlackjack(userId, hand, "bust", 0n);
			} else {
				await this.store.setBlackjack(userId, hand);
			}
			const busted = handValue(hand.player) > 21;
			return {
				status: busted ? "bust" : "playing",
				player: hand.player.map(formatCard),
				playerValue: handValue(hand.player),
				...(busted ? {
					dealer: hand.dealer.map(formatCard),
					payout: "0",
					balance: String(await this.store.getBalance(userId))
				} : { dealerVisible: formatCard(hand.dealer[0]) })
			};
		});
	}

	async standBlackjack(userId) {
		return this.serialize(async () => {
			const hand = await this.store.getBlackjack(userId);
			if(!hand) {
				throw new UserError("No active blackjack hand.");
			}
			while(handValue(hand.dealer) < 17) {
				hand.dealer.push(drawCard(this.randomInt));
			}
			const playerValue = handValue(hand.player);
			const dealerValue = handValue(hand.dealer);
			const result = playerValue > 21 || (dealerValue <= 21 && dealerValue > playerValue)
				? "lost" : playerValue === dealerValue ? "push" : "won";
			const stake = BigInt(hand.stake);
			const payout = result === "won" ? stake * 2n : result === "push" ? stake : 0n;
			await this.finishBlackjack(userId, hand, result, payout);
			return { status: result, player: hand.player.map(formatCard), dealer: hand.dealer.map(formatCard), playerValue, dealerValue, payout: String(payout), balance: String(await this.store.getBalance(userId)) };
		});
	}

	async finishBlackjack(userId, hand, result, payout) {
		const balance = await this.store.getBalance(userId);
		await this.store.setBalance(userId, balance + payout);
		const bet = { id: randomUUID(), userId: String(userId), game: "blackjack", stake: hand.stake, payout: String(payout), won: result === "won" || result === "blackjack", outcome: result, status: "settled", createdAt: Date.now() };
		await this.store.createBet(bet);
		if(bet.won) {
			await this.onWin(bet).catch(() => {});
		}
		await this.store.setBlackjack(userId, undefined);
	}

	async getOpenBets(userId) {
		this.requireAdmin(userId);
		const [ wagers, blockBets ] = await Promise.all([this.store.getOpenBets(), this.blockStore.getOpenBets()]);
		return [ ...wagers, ...blockBets ];
	}

	async resolveBet(userId, betId, resolution, proof) {
		this.requireAdmin(userId);
		if(![ "settled", "void" ].includes(resolution) || !proof) {
			throw new UserError("Provide a resolution (`settled` or `void`) and review note.");
		}
		const blockBet = await this.blockStore.getBet(betId);
		if(blockBet && [ "open", "needs_review" ].includes(blockBet.status)) {
			if(resolution === "void") {
				const balance = await this.store.getBalance(blockBet.userId);
				await this.store.setBalance(blockBet.userId, balance + BigInt(blockBet.stake));
			}
			const resolved = await this.blockStore.updateBet(betId, {
				status: resolution === "settled" ? "settled" : "cancelled",
				resolution,
				resolutionProof: String(proof),
				resolvedBy: String(userId),
				resolvedAt: Date.now()
			});
			const pendingBets = (await this.blockStore.getRoundBets(blockBet.targetHeight)).some(bet => bet.status === "open" || bet.status === "needs_review");
			if(!pendingBets) {
				const block = await this.blockStore.getBlock(blockBet.targetHeight);
				if(block) await this.blockStore.updateBlock(blockBet.targetHeight, { status: "settled", settledAt: Date.now() });
			}
			return resolved;
		}
		const bet = await this.store.getBet(betId);
		if(!bet || bet.status !== "needs_review") {
			throw new UserError("Open sandbox bet was not found.");
		}
		if(resolution === "void") {
			const balance = await this.store.getBalance(bet.userId);
			await this.store.setBalance(bet.userId, balance + BigInt(bet.stake));
		}
		const resolved = await this.store.updateBet(betId, { status: resolution === "settled" ? "settled" : "cancelled", resolution, resolutionProof: String(proof), resolvedBy: String(userId), resolvedAt: Date.now() });
		return resolved;
	}

	async history(userId) {
		return this.store.getHistory(userId);
	}
}
