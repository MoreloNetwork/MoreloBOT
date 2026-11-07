import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startNotifications } from "../notifications.js";

const transfer = (txid, major, amount, type, height = 0) => ({ txid, amount, type, height, subaddr_index: { major, minor: 0 } });

test("announces each incoming transfer once", async () => {
	const walletsPath = await fs.mkdtemp(path.join(os.tmpdir(), "morelobot-"));
	const sent = [];
	const bot = {
		getDMChannel: async id => ({ id }),
		createMessage: async (id, text) => {
			sent.push([ id, text ]);
			if(id === "999") {
				throw new Error("Cannot send messages to this user");
			}
		}
	};
	let height = 101;
	let transfers = { in: [ transfer("old", 1, 5, "in", 100) ] };
	const wallet = {
		getHeight: async () => height,
		getRpcConnection: () => ({
			async sendJsonRequest(method, params) {
				if(method === "get_accounts") {
					return { result: { subaddress_accounts: [
						{ account_index: 0, label: "Primary account" },
						{ account_index: 1, label: "discord-111" },
						{ account_index: 2, label: "discord-222" },
						{ account_index: 3, label: "discord-999" }
					] } };
				}
				return { result: { ...transfers, in: (transfers.in || []).filter(entry => entry.height > params.min_height) } };
			}
		})
	};
	const readState = async () => JSON.parse(await fs.readFile(path.join(walletsPath, "notifications.json"), "utf8"));

	const notifications = startNotifications(wallet, bot, { walletsPath });
	notifications.stop();
	await notifications.poll();
	assert.equal(sent.length, 0, "the first start skips existing transfers");

	transfers = { in: [ transfer("old", 1, 5, "in", 100) ], pool: [ transfer("deposit", 1, 1500000000, "pool") ] };
	await notifications.poll();
	assert.deepEqual(sent, [ [ "111", "You received **1.500000000 MRL**. It is not confirmed yet.\nTransaction: `deposit`" ] ]);

	height = 103;
	transfers = {
		in: [
			transfer("deposit", 1, 1500000000, "in", 102),
			transfer("tip", 2, 1000000000, "in", 102),
			transfer("tip", 2, 1000000000, "in", 102),
			transfer("tip", 3, 7, "in", 102)
		],
		out: [ transfer("tip", 1, 2000000007, "out", 102) ]
	};
	await notifications.poll();
	assert.equal(sent.length, 3, "a confirmed deposit is not announced again");
	assert.equal(sent[1][0], "222");
	assert.match(sent[1][1], /a tip of \*\*2\.000000000 MRL\*\* from <@111>\. It is confirmed/);
	assert.equal(sent[2][0], "999", "a failed DM does not stop the other notifications");

	const restarted = startNotifications(wallet, bot, { walletsPath });
	restarted.stop();
	await restarted.poll();
	assert.equal(sent.length, 3, "a restart does not announce anything again");

	height = 200;
	transfers = {};
	await restarted.poll();
	assert.deepEqual(await readState(), { height: 200, notified: [] }, "old transfers are pruned");
	await fs.rm(walletsPath, { recursive: true });
});
