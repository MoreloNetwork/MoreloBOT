import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getUserIdsByAccount, sendUserTip, sendUserTips } from "../api/wallet-users.js";

test("account indexes map back to every configured Discord user", async t => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "morelobot-users-"));
	const filePath = path.join(directory, "users.json");
	t.after(() => rm(directory, { recursive: true, force: true }));
	await writeFile(filePath, JSON.stringify({ "100": 0, "200": 1, "300": 0 }));

	assert.deepEqual(await getUserIdsByAccount({}, filePath, 0), [ "100", "300" ]);
});

test("multi-recipient tip creates one transaction with all destinations", async t => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "morelobot-multi-tip-"));
	const filePath = path.join(directory, "users.json");
	t.after(() => rm(directory, { recursive: true, force: true }));
	await writeFile(filePath, JSON.stringify({ "100": 0, "200": 1, "300": 2 }));
	let createTxCalls = 0;
	let txConfig;
	const wallet = {
		getAddress: async accountIndex => "address-" + accountIndex,
		createAccount: async () => ({ getIndex: () => 3 }),
		getSubaddress: async () => ({
			getBalance: () => 1000n,
			getUnlockedBalance: () => 1000n,
			getNumBlocksToUnlock: () => 0
		}),
		createTx: async config => {
			createTxCalls++;
			txConfig = config;
			return { getHash: () => "multi-tx" };
		}
	};
	const recorded = [];
	const store = { recordTips: async (...args) => recorded.push(args) };

	const result = await sendUserTips(wallet, filePath, "100", [
		{ recipientId: "200", amount: 101n },
		{ recipientId: "multi-recipient-300", amount: 100n }
	], undefined, store);

	assert.deepEqual(result, {
		txHash: "multi-tx",
		totalAmount: 201n,
		recipients: [
			{ recipientId: "200", amount: 101n },
			{ recipientId: "multi-recipient-300", amount: 100n }
		]
	});
	assert.equal(createTxCalls, 1);
	assert.deepEqual(txConfig.destinations, [
		{ address: "address-1", amount: 101n },
		{ address: "address-3", amount: 100n }
	]);
	assert.equal(txConfig.accountIndex, 0);
	assert.equal(txConfig.relay, true);
	assert.equal(recorded.length, 1);
	assert.deepEqual(recorded[0][2], [
		{ recipientId: "200", amount: 101n },
		{ recipientId: "multi-recipient-300", amount: 100n }
	]);
});

test("test mode blocks multi-recipient transfers before wallet access", async () => {
	const previousMode = process.env.MORELOBOT_TEST_MODE;
	let walletAccessed = false;
	process.env.MORELOBOT_TEST_MODE = "1";
	try {
		await assert.rejects(
			sendUserTips({ getAddress() { walletAccessed = true; } }, "", "100", [
				{ recipientId: "200", amount: 1n }
			]),
			/MRL transfers are disabled in test mode/
		);
		assert.equal(walletAccessed, false);
	} finally {
		if(previousMode === undefined) {
			delete process.env.MORELOBOT_TEST_MODE;
		} else {
			process.env.MORELOBOT_TEST_MODE = previousMode;
		}
	}
});

test("test mode blocks wallet transfers before calling createTx", async () => {
	const previousMode = process.env.MORELOBOT_TEST_MODE;
	let transferCalled = false;
	process.env.MORELOBOT_TEST_MODE = "1";
	try {
		await assert.rejects(
			sendUserTip({ createTx() { transferCalled = true; } }, "", "100", "200", "1"),
			/MRL transfers are disabled in test mode/
		);
		assert.equal(transferCalled, false);
	} finally {
		if(previousMode === undefined) {
			delete process.env.MORELOBOT_TEST_MODE;
		} else {
			process.env.MORELOBOT_TEST_MODE = previousMode;
		}
	}
});
