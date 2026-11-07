import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withdraw } from "../api/wallet.js";

test("withdrawal uses the configured dev account mapping", async t => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "morelobot-withdraw-"));
	const filePath = path.join(directory, "users.json");
	t.after(() => rm(directory, { recursive: true, force: true }));
	await writeFile(filePath, JSON.stringify({ "100": 4 }));
	let txConfig;
	const wallet = {
		getAddress: async () => "",
		getUnlockedBalance: async accountIndex => {
			assert.equal(accountIndex, 4);
			return 1000n;
		},
		createTx: async config => {
			txConfig = config;
			return { getHash: () => "withdraw-hash" };
		}
	};

	const hashes = await withdraw(wallet, "100", "destination", "0.000000001", { walletUsersPath: filePath });

	assert.deepEqual(hashes, [ "withdraw-hash" ]);
	assert.equal(txConfig.accountIndex, 4);
	assert.equal(txConfig.address, "destination");
	assert.equal(txConfig.amount, 1n);
});

test("withdrawal is blocked in test mode before wallet access", async () => {
	const previousMode = process.env.MORELOBOT_TEST_MODE;
	let walletAccessed = false;
	process.env.MORELOBOT_TEST_MODE = "1";
	try {
		await assert.rejects(
			withdraw({ getRpcConnection() { walletAccessed = true; } }, "100", "destination", "1"),
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
