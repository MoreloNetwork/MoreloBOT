import { randomUUID } from "node:crypto";
import { UserError } from "./command-utils.js";
import { formatMRL, getUserAccount, getUserAddress, parseMRL } from "./wallet.js";

const openStatuses = new Set([ "stake_submitting", "open", "payout_submitting", "needs_review" ]);

export function getBlockGuessPayout(stake, length) {
	if(typeof stake !== "bigint" || stake <= 0n || !Number.isInteger(length) || length < 1 || length > 6) {
		throw new UserError("Block predictions must contain 1 to 6 hexadecimal characters and a positive bet.");
	}
	return stake * 15n * (16n ** BigInt(length - 1));
}

export function matchesBlockGuess(hash, guess) {
	return typeof hash === "string" && /^[\da-f]{64}$/i.test(hash)
		&& typeof guess === "string" && /^[\da-f]{1,6}$/i.test(guess)
		&& hash.toLowerCase().endsWith(guess.toLowerCase());
}

function shortError(ex) {
	return typeof ex?.message === "string" ? ex.message.slice(0, 240) : "Unknown wallet error";
}

export default class CasinoBlockGame {
	constructor({ wallet, daemon, config, store, sendTransaction, dependencies = {} }) {
		this.wallet = wallet;
		this.daemon = daemon;
		this.config = config;
		this.store = store;
		this.serializeOperation = dependencies.serialize;
		this.getUserAccount = dependencies.getUserAccount || getUserAccount;
		this.getUserAddress = dependencies.getUserAddress || getUserAddress;
		this.sendTransaction = sendTransaction || (async options => {
			if(process.env.MORELOBOT_TEST_MODE === "1") {
				throw new UserError("MRL transfers are disabled in test mode.");
			}
			const transaction = await this.wallet.createTx({ ...options, relay: true });
			return transaction.getHash();
		});
		this.queue = Promise.resolve();
	}

	serialize(operation) {
		if(this.serializeOperation) {
			return this.serializeOperation(operation);
		}
		const result = this.queue.catch(() => {}).then(operation);
		this.queue = result.catch(() => {});
		return result;
	}

	play(userId, guess, amountText) {
		return this.serialize(() => this.playNow(userId, guess, amountText));
	}

	async playNow(userId, guess, amountText) {
		if(this.config.casinoEnabled !== true) {
			throw new UserError("MRL casino is disabled until its house account is configured.");
		}
		if(process.env.MORELOBOT_TEST_MODE === "1") {
			throw new UserError("MRL transfers are disabled in test mode.");
		}
		const prediction = String(guess ?? "").toLowerCase();
		if(!/^[\da-f]{1,6}$/.test(prediction)) {
			throw new UserError("Choose a 1 to 6 character hexadecimal block-hash suffix.");
		}
		const stake = parseMRL(amountText);
		const minimum = parseMRL(this.config.casinoMinBet);
		const feeReserve = parseMRL(this.config.casinoFeeReserve);
		if(stake < minimum) {
			throw new UserError("Bet must be at least " + formatMRL(minimum) + ".");
		}
		const info = await this.daemon.getInfo();
		const targetHeight = info.getHeight();
		const houseAccountIndex = Number(this.config.casinoHouseAccountIndex);
		if(!Number.isSafeInteger(houseAccountIndex) || houseAccountIndex < 1) {
			throw new UserError("Casino house account is not configured.");
		}
		const existingBet = await this.store.getUserRoundBet(targetHeight, userId);
		if(existingBet) {
			throw new UserError("You already have a prediction for block " + targetHeight + ".");
		}
		const roundBets = await this.store.getRoundBets(targetHeight);
		if(roundBets.some(bet => bet.status === "stake_submitting" || bet.status === "needs_review")) {
			throw new UserError("This block round is awaiting wager review and cannot accept additional predictions.");
		}
		const accountIndex = await this.getUserAccount(this.wallet, userId, this.config);
		if(accountIndex === houseAccountIndex) {
			throw new UserError("You cannot place bets from the casino house account.");
		}
		const balance = await this.wallet.getUnlockedBalance(accountIndex);
		if(balance < stake + feeReserve) {
			throw new UserError("Not enough unlocked MRL to cover the bet and transaction fee.");
		}
		const payout = getBlockGuessPayout(stake, prediction.length);
		const liability = await this.store.getLiability();
		const houseBalance = await this.wallet.getUnlockedBalance(houseAccountIndex);
		if(houseBalance < liability + payout + feeReserve) {
			throw new UserError("Casino house cannot cover this prediction's maximum payout.");
		}
		const currentInfo = await this.daemon.getInfo();
		if(currentInfo.getHeight() !== targetHeight) {
			throw new UserError("The block round has closed; no prediction was placed.");
		}
		const houseAddress = await this.wallet.getAddress(houseAccountIndex, 0);
		const id = randomUUID();
		const bet = {
			id,
			userId: String(userId),
			guess: prediction,
			targetHeight,
			stake: String(stake),
			payout: String(payout),
			feeReserve: String(feeReserve),
			status: "stake_submitting",
			createdAt: Date.now()
		};
		await this.store.createBet(bet);
		let stakeTxHash;
		try {
			stakeTxHash = await this.sendTransaction({ accountIndex, address: houseAddress, amount: stake });
		} catch(ex) {
			await this.store.updateBet(id, { status: "needs_review", failureStage: "stake", failureMessage: shortError(ex) }).catch(() => {});
			throw new UserError("Prediction " + id.slice(0, 8) + " needs review; do not retry until its transfer is checked.");
		}
		const currentHeight = (await this.daemon.getInfo()).getHeight();
		if(currentHeight > targetHeight) {
			await this.store.updateBet(id, {
				status: "needs_review",
				stakeTxHash,
				failureStage: "late_stake",
				failureMessage: "The target block was mined before the stake completed."
			});
			throw new UserError("The stake was sent after the round closed; prediction " + id.slice(0, 8) + " needs operator review.");
		}
		return this.store.updateBet(id, { status: "open", stakeTxHash });
	}

	getCurrentRound() {
		return this.daemon.getInfo().then(async info => {
			const height = info.getHeight();
			return { height, bets: await this.store.getRoundBets(height) };
		});
	}

	async checkForNewBlocks() {
		return this.serialize(async () => {
			const info = await this.daemon.getInfo();
			const height = info.getHeight();
			const pendingHeights = [...new Set((await this.store.getOpenBets())
				.filter(bet => bet.targetHeight < height).map(bet => bet.targetHeight))];
			for(const targetHeight of pendingHeights) {
				const block = await this.daemon.getBlockByHeight(targetHeight);
				const hash = block?.getHash?.() || block?.hash;
				if(hash) await this.settleBlockNow(targetHeight, hash);
			}
			const settledBlocks = [];
			for(const block of await this.store.getUnannouncedSettledBlocks()) {
				settledBlocks.push({ ...block, bets: await this.store.getRoundBets(block.height) });
			}
			return { height, settledBlocks };
		});
	}

	async getOpenBets(userId) {
		this.requireAdmin(userId);
		return this.store.getOpenBets();
	}

	async resolveBet(adminId, betId, resolution, proof) {
		this.requireAdmin(adminId);
		if(![ "settled", "void" ].includes(resolution)) {
			throw new UserError("Resolution must be `settled` or `void`.");
		}
		const evidence = String(proof ?? "").trim();
		if(resolution === "settled" && !/^[\da-f]{64}$/i.test(evidence)) {
			throw new UserError("Settled predictions require the verified 64-character transaction or block hash.");
		}
		if(resolution === "void" && evidence !== "no-transfer-confirmed" && !/^[\da-f]{64}$/i.test(evidence)) {
			throw new UserError("Void resolution requires a verified 64-character hash or `no-transfer-confirmed`.");
		}
		const bet = await this.store.getBet(betId);
		if(!bet || !openStatuses.has(bet.status)) {
			throw new UserError("Open block prediction was not found.");
		}
		const resolved = await this.store.updateBet(betId, {
			status: resolution === "settled" ? "settled" : "cancelled",
			resolution,
			resolutionProof: evidence,
			resolvedBy: String(adminId),
			resolvedAt: Date.now()
		});
		const pendingBets = (await this.store.getRoundBets(bet.targetHeight)).filter(entry => openStatuses.has(entry.status));
		if(!pendingBets.length) {
			const block = await this.store.getBlock(bet.targetHeight);
			if(block) {
				await this.store.updateBlock(bet.targetHeight, { status: "settled", settledAt: Date.now() });
			}
		}
		return resolved;
	}

	requireAdmin(userId) {
		const allowedIds = Array.isArray(this.config.casinoAdminUserIds)
			? this.config.casinoAdminUserIds.map(String)
			: [];
		if(!allowedIds.includes(String(userId))) {
			throw new UserError("You are not allowed to manage casino wagers.");
		}
	}

	async settleBlock(height, hash) {
		return this.serialize(() => this.settleBlockNow(height, hash));
	}

	async settleBlockNow(height, hash) {
		if(!Number.isSafeInteger(height) || !/^[\da-f]{64}$/i.test(hash)) {
			throw new Error("Invalid block height or hash for casino settlement.");
		}
		const existingBlock = await this.store.getBlock(height);
		if(existingBlock?.status === "settled") {
			return existingBlock;
		}
		await this.store.recordBlock(height, hash.toLowerCase());
		const bets = await this.store.getRoundBets(height);
		const houseAccountIndex = Number(this.config.casinoHouseAccountIndex);
		for(const bet of bets) {
			if(bet.status === "stake_submitting" || bet.status === "payout_submitting") {
				await this.store.updateBet(bet.id, { status: "needs_review", failureStage: bet.status });
				continue;
			}
			if(bet.status !== "open") {
				continue;
			}
			const won = matchesBlockGuess(hash, bet.guess);
			if(!won) {
				await this.store.updateBet(bet.id, { status: "settled", blockHash: hash.toLowerCase(), won: false, settledAt: Date.now() });
				continue;
			}
			await this.store.updateBet(bet.id, { status: "payout_submitting", blockHash: hash.toLowerCase(), won: true });
			try {
				const userAddress = await this.getUserAddress(this.wallet, bet.userId, this.config);
				const payoutTxHash = await this.sendTransaction({
					accountIndex: houseAccountIndex,
					address: userAddress,
					amount: BigInt(bet.payout)
				});
				await this.store.updateBet(bet.id, { status: "settled", payoutTxHash, settledAt: Date.now() });
			} catch(ex) {
				await this.store.updateBet(bet.id, { status: "needs_review", failureStage: "payout", failureMessage: shortError(ex) });
			}
		}
		const openBets = (await this.store.getRoundBets(height)).filter(bet => openStatuses.has(bet.status));
		return this.store.updateBlock(height, {
			status: openBets.length ? "needs_review" : "settled",
			settledAt: Date.now()
		});
	}

	async checkForNewBlocks() {
		return this.serialize(async () => {
			const info = await this.daemon.getInfo();
			const height = info.getHeight();
			const settledBlocks = [];
			const pendingHeights = [ ...new Set((await this.store.getOpenBets())
				.filter(bet => bet.targetHeight < height)
				.map(bet => bet.targetHeight)) ];
			for(const targetHeight of pendingHeights) {
				const block = await this.daemon.getBlockByHeight(targetHeight);
				const hash = block?.getHash?.() || block?.hash;
				if(hash) {
					await this.settleBlockNow(targetHeight, hash);
				}
			}
			for(const settledBlock of await this.store.getUnannouncedSettledBlocks()) {
				const bets = await this.store.getRoundBets(settledBlock.height);
				settledBlocks.push({ ...settledBlock, bets });
			}
			return { height, settledBlocks };
		});
	}
}