import { randomUUID } from "node:crypto";
import { UserError } from "../core/command-utils.js";
import { formatMRL, getUserAccount, getUserAddress, parseMRL } from "../api/wallet.js";
import { resolveCoinflip, resolveDice, resolveRoulette, rollDice, spinRoulette, tossCoin } from "./casino-games.js";

function configuredAmount(value, name) {
	try {
		return parseMRL(value);
	} catch {
		throw new UserError("Casino configuration is invalid: " + name + ".");
	}
}

function validateSelection(game, selection) {
	if(game === "coinflip") {
		resolveCoinflip(selection, "heads", 1n);
		return;
	}
	if(game === "roulette") {
		resolveRoulette(selection, { number: 0 }, 1n);
		return;
	}
	if(game === "dice") {
		resolveDice(selection, 1, 1n);
		return;
	}
	throw new UserError("Choose `coinflip`, `roulette`, or `dice`.");
}

function getMaximumPayout(game, selection, stake) {
	if(game === "roulette" && /^\d+$/.test(String(selection))) return stake * 36n;
	if(game === "dice") return stake * 57n / 10n;
	return stake * 2n;
}

function shortError(ex) {
	return typeof ex?.message === "string" ? ex.message.slice(0, 240) : "Unknown wallet error";
}

export default class CasinoService {
	constructor({ wallet, config, store, sendTransaction, sendStakeTransaction, sendPayoutTransaction, dependencies = {} }) {
		this.wallet = wallet;
		this.houseWallet = dependencies.houseWallet || wallet;
		this.config = config;
		this.store = store;
		this.getUserAccount = dependencies.getUserAccount || getUserAccount;
		this.getUserAddress = dependencies.getUserAddress || getUserAddress;
		this.tossCoin = dependencies.tossCoin || tossCoin;
		this.spinRoulette = dependencies.spinRoulette || spinRoulette;
		this.rollDice = dependencies.rollDice || rollDice;
		this.onWin = dependencies.onWin || (async () => {});
		this.sendStakeTransaction = sendStakeTransaction || sendTransaction || (async options => {
			if(process.env.MORELOBOT_TEST_MODE === "1") {
				throw new UserError("MRL transfers are disabled in test mode.");
			}
			const transaction = await this.wallet.createTx({ ...options, relay: true });
			return transaction.getHash();
		});
		this.sendPayoutTransaction = sendPayoutTransaction || sendTransaction || (async options => {
			if(process.env.MORELOBOT_TEST_MODE === "1") {
				throw new UserError("MRL transfers are disabled in test mode.");
			}
			const transaction = await this.houseWallet.createTx({ ...options, relay: true });
			return transaction.getHash();
		});
		this.queue = Promise.resolve();
	}

	play(userId, game, selection, amountText) {
		return this.serialize(() => this.playNow(userId, game, selection, amountText));
	}

	serialize(action) {
		const operation = this.queue.catch(() => {}).then(action);
		this.queue = operation.catch(() => {});
		return operation;
	}

	async playNow(userId, game, selection, amountText) {
		if(this.config.casinoEnabled !== true) {
			throw new UserError("MRL casino is disabled until its house wallet is configured.");
		}
		if(process.env.MORELOBOT_TEST_MODE === "1") {
			throw new UserError("MRL transfers are disabled in test mode.");
		}
		validateSelection(game, selection);

		const stake = parseMRL(amountText);
		const minimum = configuredAmount(this.config.casinoMinBet, "casinoMinBet");
		const feeReserve = configuredAmount(this.config.casinoFeeReserve, "casinoFeeReserve");
		if(stake < minimum) {
			throw new UserError("Bet must be at least " + formatMRL(minimum) + ".");
		}

		const openWager = await this.store.getOpenWager(userId);
		if(openWager) {
			throw new UserError("Wager " + openWager.id.slice(0, 8) + " needs review before you can play again.");
		}

		const userAccountIndex = await this.getUserAccount(this.wallet, userId, this.config);
		const userBalance = await this.wallet.getUnlockedBalance(userAccountIndex);
		if(userBalance < stake + feeReserve) {
			throw new UserError("Not enough unlocked MRL to cover the bet and transaction fee.");
		}
		const maximumPayout = getMaximumPayout(game, selection, stake);
		const houseBalance = await this.houseWallet.getUnlockedBalance(0);
		if(houseBalance < maximumPayout + feeReserve) {
			throw new UserError("Casino house does not have enough unlocked MRL to cover the maximum payout.");
		}

		const outcome = game === "coinflip" ? this.tossCoin()
			: game === "roulette" ? this.spinRoulette() : this.rollDice();
		const resolution = game === "coinflip"
			? resolveCoinflip(selection, outcome, stake)
			: game === "roulette" ? resolveRoulette(selection, outcome, stake) : resolveDice(selection, outcome, stake);
		const houseAddress = await this.houseWallet.getAddress(0, 0);
		const userAddress = resolution.won
			? await this.getUserAddress(this.wallet, userId, this.config)
			: undefined;
		const id = randomUUID();
		const wager = {
			id,
			userId: String(userId),
			game,
			selection: String(selection),
			stake: String(stake),
			payout: String(resolution.payout),
			outcome: outcome,
			won: resolution.won,
			status: "stake_submitting",
			createdAt: Date.now()
		};
		await this.store.createWager(wager);

		let stakeTxHash;
		try {
			stakeTxHash = await this.sendStakeTransaction({
				accountIndex: userAccountIndex,
				address: houseAddress,
				amount: stake
			});
		} catch(ex) {
			await this.store.updateWager(id, {
				status: "needs_review",
				failureStage: "stake",
				failureMessage: shortError(ex)
			}).catch(() => {});
			throw new UserError("Wager " + id.slice(0, 8) + " needs review; do not retry until its transfer is checked.");
		}

		await this.store.updateWager(id, { status: "stake_sent", stakeTxHash });
		if(!resolution.won) {
			await this.store.updateWager(id, { status: "settled" });
			return { ...wager, stakeTxHash, status: "settled" };
		}

		await this.store.updateWager(id, { status: "payout_submitting" });
		let payoutTxHash;
		try {
			payoutTxHash = await this.sendPayoutTransaction({
				accountIndex: 0,
				address: userAddress,
				amount: resolution.payout
			});
		} catch(ex) {
			await this.store.updateWager(id, {
				status: "needs_review",
				failureStage: "payout",
				failureMessage: shortError(ex)
			}).catch(() => {});
			throw new UserError("Wager " + id.slice(0, 8) + " won, but the payout needs review. Do not retry.");
		}
		await this.store.updateWager(id, { status: "settled", payoutTxHash });
		const settledWager = { ...wager, stakeTxHash, payoutTxHash, status: "settled" };
		await this.onWin(settledWager).catch(() => {});
		return settledWager;
	}

	getHistory(userId, limit = 10) {
		return this.store.getUserWagers(userId, limit);
	}

	async getBalance(userId) {
		const accountIndex = await this.getUserAccount(this.wallet, userId, this.config);
		const subaddress = await this.wallet.getSubaddress(accountIndex, 0);
		return {
			balance: subaddress.getBalance(),
			unlockedBalance: subaddress.getUnlockedBalance()
		};
	}

	async getOpenWagers(adminId) {
		this.requireAdmin(adminId);
		return this.store.getOpenWagers();
	}

	async resolveWager(adminId, wagerId, resolution, proof) {
		this.requireAdmin(adminId);
		if(![ "settled", "void" ].includes(resolution)) {
			throw new UserError("Resolution must be `settled` or `void`.");
		}
		const evidence = String(proof ?? "").trim();
		if(resolution === "settled" && !/^[\da-f]{64}$/i.test(evidence)) {
			throw new UserError("Settled wagers require the verified 64-character transaction hash.");
		}
		if(resolution === "void" && evidence !== "no-transfer-confirmed" && !/^[\da-f]{64}$/i.test(evidence)) {
			throw new UserError("Void resolution requires a refund transaction hash or `no-transfer-confirmed`.");
		}
		const wager = await this.store.getWager(wagerId);
		if(!wager || ![ "stake_submitting", "stake_sent", "payout_submitting", "needs_review" ].includes(wager.status)) {
			throw new UserError("Open casino wager was not found.");
		}
		return this.store.updateWager(wagerId, {
			status: resolution === "settled" ? "settled" : "cancelled",
			resolution,
			resolutionProof: evidence,
			resolvedBy: String(adminId),
			resolvedAt: Date.now()
		});
	}

	requireAdmin(userId) {
		const allowedIds = Array.isArray(this.config.casinoAdminUserIds)
			? this.config.casinoAdminUserIds.map(String)
			: [];
		if(!allowedIds.includes(String(userId))) {
			throw new UserError("You are not allowed to manage casino wagers.");
		}
	}
}
