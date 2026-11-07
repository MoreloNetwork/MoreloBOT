import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import CasinoBlockGame, { getBlockGuessPayout, matchesBlockGuess } from "../casino/casino-block-game.js";
import CasinoBlockStore from "../casino/casino-block-store.js";

const blockHash = "0123456789abcdef".repeat(4);

async function createGame(t, options = {}) {
	const directory = await mkdtemp(path.join(os.tmpdir(), "morelobot-casino-block-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const store = new CasinoBlockStore(path.join(directory, "bets.json"));
	const transfers = [];
	const wallet = {
		getUnlockedBalance: async accountIndex => accountIndex === 9
			? options.houseBalance ?? 100_000_000_000_000n
			: 10_000_000_000n,
		getAddress: async accountIndex => "address-" + accountIndex
	};
	const daemon = {
		getInfo: async () => ({ getHeight: () => options.height ?? 42 }),
		getBlockByHeight: async height => ({ getHash: () => options.hash || blockHash, getHeight: () => height })
	};
	const config = {
		casinoEnabled: true,
		casinoHouseAccountIndex: 9,
		casinoMinBet: "0.001",
		casinoFeeReserve: "0.001"
	};
	const game = new CasinoBlockGame({
		wallet,
		daemon,
		config,
		store,
		sendTransaction: async transaction => {
			transfers.push(transaction);
			return "tx-" + transfers.length;
		},
		dependencies: {
			getUserAccount: async () => 4,
			getUserAddress: async () => "address-user"
		}
	});

	return { game, store, transfers, config };
}

test("block guess payouts scale with the number of matching characters", () => {
	assert.equal(getBlockGuessPayout(100n, 1), 1500n);
	assert.equal(getBlockGuessPayout(100n, 2), 24000n);
	assert.equal(getBlockGuessPayout(100n, 6), 1572864000n);
	assert.equal(matchesBlockGuess(blockHash, "cdef"), true);
	assert.equal(matchesBlockGuess(blockHash, "CDEF"), true);
	assert.equal(matchesBlockGuess(blockHash, "cde0"), false);
	assert.throws(() => getBlockGuessPayout(100n, 7), /1 to 6/);
});

test("predictions persist for the current height and settle once when its block arrives", async t => {
	const { game, store, transfers } = await createGame(t);
	const bet = await game.play("user-1", "cdef", "0.1");
	assert.equal(bet.targetHeight, 42);
	assert.equal(bet.status, "open");
	assert.equal(transfers.length, 1);
	const first = await game.checkForNewBlocks();
	assert.equal(first.settledBlocks.length, 0);
	const minedGame = new CasinoBlockGame({
		wallet: game.wallet,
		daemon: {
			getInfo: async () => ({ getHeight: () => 43 }),
			getBlockByHeight: async height => ({ getHash: () => blockHash, getHeight: () => height })
		},
		config: game.config,
		store,
		sendTransaction: async transaction => {
			transfers.push(transaction);
			return "tx-" + transfers.length;
		},
		dependencies: { getUserAddress: async () => "address-user" }
	});
	const mined = await minedGame.checkForNewBlocks();
	assert.equal(mined.settledBlocks.length, 1);
	assert.equal(mined.settledBlocks[0].status, "settled");
	assert.equal(mined.settledBlocks[0].bets[0].won, true);
	assert.equal(transfers.length, 2);
	await store.markBlockAnnounced(42);
	const repeated = await minedGame.checkForNewBlocks();
	assert.equal(repeated.settledBlocks.length, 0);
	assert.equal(transfers.length, 2);
	assert.equal((await store.getBet(bet.id)).status, "settled");
});

test("round prevents duplicate guesses from one user and rejects unaffordable payout liability", async t => {
	const { game } = await createGame(t);
	await game.play("user-2", "ab", "0.1");
	await assert.rejects(game.play("user-2", "cd", "0.1"), /already have a prediction/);
	const underfunded = await createGame(t, { houseBalance: 1n });
	await assert.rejects(underfunded.game.play("user-3", "abcdef", "0.1"), /cannot cover/);
});

test("unresolved transfers are retained for review and block round records are durable", async t => {
	const { game, store, config } = await createGame(t);
	const bet = await game.play("user-4", "cdef", "0.1");
	await store.updateBet(bet.id, { status: "payout_submitting" });
	const block = await game.settleBlock(42, blockHash);
	assert.equal(block.status, "needs_review");
	const reopened = new CasinoBlockStore(store.filePath);
	assert.equal((await reopened.getBlock(42)).hash, blockHash);
	assert.equal((await reopened.getBet(bet.id)).status, "needs_review");
	config.casinoEnabled = false;
	await assert.rejects(game.play("user-5", "aa", "0.1"), /disabled/);
});

test("block game can share the casino service operation queue", async t => {
	const { game } = await createGame(t);
	let called = false;
	const shared = new CasinoBlockGame({
		wallet: game.wallet,
		daemon: game.daemon,
		config: game.config,
		store: game.store,
		dependencies: {
			serialize: async action => {
				called = true;
				return action();
			},
			getUserAccount: async () => 4
		}
	});
	await assert.rejects(shared.play("user-5", "bad!", "0.1"), /hexadecimal/);
	assert.equal(called, true);
});

test("a block mined during stake transfer is held for operator review", async t => {
	const { game, store, transfers } = await createGame(t);
	let height = 42;
	game.daemon.getInfo = async () => ({ getHeight: () => height });
	game.sendTransaction = async transaction => {
		transfers.push(transaction);
		height = 43;
		return "late-stake-hash";
	};
	await assert.rejects(game.play("user-6", "abcd", "0.1"), /needs operator review/);
	const [ bet ] = await store.getRoundBets(42);
	assert.equal(bet.status, "needs_review");
	assert.equal(bet.failureStage, "late_stake");
	assert.equal(bet.stakeTxHash, "late-stake-hash");
});
