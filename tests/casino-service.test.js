import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import CasinoService from "../casino/casino-service.js";
import CasinoStore from "../casino/casino-store.js";

async function withNormalMode(action) {
	const previousMode = process.env.MORELOBOT_TEST_MODE;
	delete process.env.MORELOBOT_TEST_MODE;
	try {
		return await action();
	} finally {
		if(previousMode === undefined) {
			delete process.env.MORELOBOT_TEST_MODE;
		} else {
			process.env.MORELOBOT_TEST_MODE = previousMode;
		}
	}
}

async function createCasino(t, options = {}) {
	const directory = await mkdtemp(path.join(os.tmpdir(), "morelobot-casino-service-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const store = new CasinoStore(path.join(directory, "wagers.json"));
	const transfers = [];
	const wallet = {
		getRpcConnection: () => ({
			sendJsonRequest: async () => ({
				result: { subaddress_accounts: [ { account_index: 9 } ] }
			})
		}),
		getUnlockedBalance: async accountIndex => accountIndex === 9
			? options.houseBalance ?? 10_000_000_000n
			: options.userBalance ?? 2_000_000_000n,
		getAddress: async accountIndex => "address-" + accountIndex,
		getSubaddress: async () => ({
			getBalance: () => 2_000_000_000n,
			getUnlockedBalance: () => 2_000_000_000n
		})
	};
	const config = {
		casinoEnabled: true,
		casinoHouseAccountIndex: 9,
		casinoMinBet: "0.001",
		casinoMaxBet: "1",
		casinoFeeReserve: "0.001",
		casinoAdminUserIds: [ "admin-1" ],
		walletUsersPath: "unused-users.json"
	};
	const service = new CasinoService({
		wallet,
		config,
		store,
		sendTransaction: async transaction => {
			transfers.push(transaction);
			if(options.failTransferAt === transfers.length) {
				throw new Error("mock relay failure");
			}
			return "a".repeat(63) + transfers.length;
		},
		dependencies: {
			getUserAccount: async () => 4,
			getUserAddress: async () => "address-4",
			getUserIdsByAccount: async () => options.houseUsers || [],
			tossCoin: () => options.coinOutcome || "heads",
			spinRoulette: () => options.rouletteOutcome || { number: 17, color: "black" },
			onWin: options.onWin
		}
	});

	return { service, store, wallet, config, transfers };
}

test("the shared wins callback runs only after a winning payout is sent", async t => {
	await withNormalMode(async () => {
		const wins = [];
		const { service } = await createCasino(t, { onWin: async wager => wins.push(wager) });
		await service.play("user-win", "coinflip", "heads", "0.1");
		await service.play("user-loss", "coinflip", "tails", "0.1");
		assert.equal(wins.length, 1);
		assert.equal(wins[0].userId, "user-win");
		assert.ok(wins[0].payoutTxHash);
	});
});

test("a winning coinflip records the stake and pays the exact gross return", async t => {
	await withNormalMode(async () => {
		const { service, store, transfers } = await createCasino(t);
		const result = await service.play("user-1", "coinflip", "heads", "0.1");
		assert.equal(result.won, true);
		assert.equal(result.payout, "200000000");
		assert.equal(result.status, "settled");
		assert.deepEqual(transfers.map(({ accountIndex, address, amount }) => ({ accountIndex, address, amount })), [
			{ accountIndex: 4, address: "address-9", amount: 100000000n },
			{ accountIndex: 9, address: "address-4", amount: 200000000n }
		]);
		const [ saved ] = await store.getUserWagers("user-1");
		assert.equal(saved.status, "settled");
		assert.ok(saved.stakeTxHash);
		assert.ok(saved.payoutTxHash);
	});
});

test("a losing roulette bet only transfers the stake and is persisted as settled", async t => {
	await withNormalMode(async () => {
		const { service, store, transfers } = await createCasino(t, {
			rouletteOutcome: { number: 0, color: "green" }
		});
		const result = await service.play("user-2", "roulette", "red", "0.1");
		assert.equal(result.won, false);
		assert.equal(transfers.length, 1);
		assert.equal(transfers[0].amount, 100000000n);
		assert.equal((await store.getUserWagers("user-2"))[0].status, "settled");
	});
});

test("a failed payout is not retried and blocks another wager for that user", async t => {
	await withNormalMode(async () => {
		const { service, store, transfers } = await createCasino(t, { failTransferAt: 2 });
		await assert.rejects(service.play("user-3", "coinflip", "heads", "0.1"), /payout needs review/);
		const [ wager ] = await store.getUserWagers("user-3");
		assert.equal(wager.status, "needs_review");
		assert.equal(wager.failureStage, "payout");
		await assert.rejects(service.play("user-3", "coinflip", "heads", "0.1"), /needs review/);
		assert.equal(transfers.length, 2);
	});
});

test("casino is disabled by default and test mode blocks before wallet access", async t => {
	const { service, wallet, config, transfers } = await createCasino(t);
	config.casinoEnabled = false;
	await assert.rejects(service.play("user-4", "coinflip", "heads", "0.1"), /disabled/);
	config.casinoEnabled = true;
	let accessed = false;
	wallet.getRpcConnection = () => {
		accessed = true;
		throw new Error("wallet must not be accessed");
	};
	const previousMode = process.env.MORELOBOT_TEST_MODE;
	process.env.MORELOBOT_TEST_MODE = "1";
	try {
		await assert.rejects(service.play("user-4", "coinflip", "heads", "0.1"), /disabled in test mode/);
	} finally {
		if(previousMode === undefined) {
			delete process.env.MORELOBOT_TEST_MODE;
		} else {
			process.env.MORELOBOT_TEST_MODE = previousMode;
		}
	}
	assert.equal(accessed, false);
	assert.equal(transfers.length, 0);
});

test("house-account mappings and insufficient payout reserves reject bets before transfer", async t => {
	await withNormalMode(async () => {
		const mapped = await createCasino(t, { houseUsers: [ "discord-user" ] });
		await assert.rejects(mapped.service.play("user-5", "coinflip", "heads", "0.1"), /must not be assigned/);
		assert.equal(mapped.transfers.length, 0);

		const underfunded = await createCasino(t, { houseBalance: 1_000_000_000n });
		await assert.rejects(underfunded.service.play("user-6", "roulette", "17", "0.1"), /not have enough unlocked MRL/);
		assert.equal(underfunded.transfers.length, 0);
	});
});

test("only configured operators can resolve open wagers with audit evidence", async t => {
	const { service, store } = await createCasino(t);
	await store.createWager({
		id: "wager-123456",
		userId: "user-7",
		game: "coinflip",
		selection: "heads",
		stake: "100000000",
		payout: "200000000",
		outcome: "heads",
		won: true,
		status: "needs_review",
		createdAt: Date.now()
	});
	await assert.rejects(service.getOpenWagers("user-7"), /not allowed/);
	await assert.rejects(service.resolveWager("admin-1", "wager-123456", "settled", "bad-proof"), /64-character transaction hash/);
	const resolved = await service.resolveWager("admin-1", "wager-123456", "settled", "b".repeat(64));
	assert.equal(resolved.status, "settled");
	assert.equal(resolved.resolvedBy, "admin-1");
	assert.equal(resolved.resolutionProof, "b".repeat(64));
	assert.deepEqual(await service.getOpenWagers("admin-1"), []);
});
