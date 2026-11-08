import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import CasinoSandboxStore from "../casino/casino-sandbox-store-legacy.js";

async function createPath(t) {
	const directory = await mkdtemp(path.join(os.tmpdir(), "morelobot-casino-sandbox-store-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return { directory, filePath: path.join(directory, "sandbox.json") };
}

test("sandbox store retries a transient Windows rename lock without losing state", async t => {
	const { filePath } = await createPath(t);
	let attempts = 0;
	const store = new CasinoSandboxStore(filePath, "1000", {
		rename: async (...args) => {
			attempts++;
			if(attempts < 3) {
				const error = new Error("temporary file lock");
				error.code = "EPERM";
				throw error;
			}
			const { rename } = await import("node:fs/promises");
			return rename(...args);
		},
		wait: async () => {}
	});

	await store.setBalance("admin", 123456789n);
	await store.setBlackjack("admin", { stake: "1000000", player: [], dealer: [] });

	assert.equal(attempts, 4);
	const saved = JSON.parse(await readFile(filePath, "utf8"));
	assert.equal(saved.balances.admin, "123456789");
	assert.equal(saved.blackjack.admin.stake, "1000000");
});

test("sandbox store leaves existing state intact after persistent rename failure", async t => {
	const { directory, filePath } = await createPath(t);
	const original = JSON.stringify({ version: 1, balances: { admin: "42" }, bets: [], blackjack: {} });
	const { writeFile } = await import("node:fs/promises");
	await writeFile(filePath, original);
	const store = new CasinoSandboxStore(filePath, "1000", {
		rename: async () => {
			const error = new Error("persistent file lock");
			error.code = "EPERM";
			throw error;
		},
		wait: async () => {}
	});

	await assert.rejects(store.setBalance("admin", 100n), { code: "EPERM" });

	assert.equal(await readFile(filePath, "utf8"), original);
	assert.deepEqual((await readdir(directory)).filter(name => name.endsWith(".tmp")), []);
});
