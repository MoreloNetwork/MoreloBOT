export async function loadCasinoGuideMessageIds(database) {
	const result = await database.query("SELECT key, message_id FROM casino_guide_message_ids");
	return result.rows.reduce((map, row) => {
		map[row.key] = row.message_id;
		return map;
	}, {});
}

export async function saveCasinoGuideMessageIds(database, messageIds) {
	const ids = messageIds && typeof messageIds === "object" ? messageIds : {};
	await database.query("BEGIN");
	try {
		await database.query("DELETE FROM casino_guide_message_ids");
		const now = Date.now();
		for(const [ key, messageId ] of Object.entries(ids)) {
			await database.query(
				"INSERT INTO casino_guide_message_ids(key, message_id, updated_at) VALUES($1, $2, $3)",
				[ key, String(messageId), now ]
			);
		}
		await database.query("COMMIT");
	} catch(ex) {
		await database.query("ROLLBACK").catch(() => {});
		throw ex;
	}
}
