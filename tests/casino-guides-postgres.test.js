import assert from "node:assert/strict";
import test from "node:test";
import { loadCasinoGuideMessageIds, saveCasinoGuideMessageIds } from "../core/casino-guides-postgres.js";

class FakeGuideDatabase {
	constructor() {
		this.ids = new Map();
		this.inTransaction = false;
	}

	async query(sql, params = []) {
		if(sql === "BEGIN") {
			this.inTransaction = true;
			return { rows: [] };
		}
		if(sql === "COMMIT") {
			this.inTransaction = false;
			return { rows: [] };
		}
		if(sql === "ROLLBACK") {
			this.inTransaction = false;
			return { rows: [] };
		}
		if(sql.startsWith("SELECT key, message_id FROM casino_guide_message_ids")) {
			return { rows: Array.from(this.ids.entries()).map(([ key, messageId ]) => ({ key, message_id: messageId })) };
		}
		if(sql.startsWith("DELETE FROM casino_guide_message_ids")) {
			this.ids.clear();
			return { rows: [] };
		}
		if(sql.startsWith("INSERT INTO casino_guide_message_ids")) {
			this.ids.set(String(params[0]), String(params[1]));
			return { rows: [] };
		}
		throw new Error("Unsupported SQL in FakeGuideDatabase: " + sql);
	}
}

test("postgres guide helpers persist and reload message IDs", async () => {
	const database = new FakeGuideDatabase();
	await saveCasinoGuideMessageIds(database, {
		"channel-1:coinflip": "id-1",
		"channel-1:roulette": "id-2"
	});

	assert.deepEqual(await loadCasinoGuideMessageIds(database), {
		"channel-1:coinflip": "id-1",
		"channel-1:roulette": "id-2"
	});

	await saveCasinoGuideMessageIds(database, { "channel-2:dice": "id-3" });
	assert.deepEqual(await loadCasinoGuideMessageIds(database), { "channel-2:dice": "id-3" });
});
