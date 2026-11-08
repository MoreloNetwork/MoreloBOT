import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function loadCasinoGuideMessageIds(filePath) {
	try {
		const saved = JSON.parse(await fs.readFile(filePath, "utf8"));
		return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
	} catch(ex) {
		if(ex.code === "ENOENT") {
			return {};
		}
		throw ex;
	}
}

export async function saveCasinoGuideMessageIds(filePath, messageIds) {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const tempPath = filePath + "." + process.pid + "." + randomUUID() + ".tmp";
	await fs.writeFile(tempPath, JSON.stringify(messageIds), { mode: 0o600 });
	try {
		for(let attempt = 0; ; attempt++) {
			try {
				await fs.rename(tempPath, filePath);
				return;
			} catch(ex) {
				if(![ "EPERM", "EBUSY", "EACCES" ].includes(ex.code) || attempt >= 4) {
					throw ex;
				}
				await new Promise(resolve => setTimeout(resolve, 50 * 2 ** attempt));
			}
		}
	} catch(ex) {
		await fs.rm(tempPath, { force: true }).catch(() => {});
		throw ex;
	}
}

export async function ensureCasinoGuide(channel, game, guide, messageIds, saveIds) {
	const key = channel.id + ":" + game;
	const marker = "**Casino guide: " + game + "**";
	const pins = await channel.getPins();
	let existing = pins.find(message => typeof message.content === "string" && message.content.includes(marker));
	if(!existing && messageIds[key]) {
		try {
			const saved = await channel.getMessage(messageIds[key]);
			if(typeof saved.content === "string" && saved.content.includes(marker)) {
				existing = saved;
			}
		} catch {}
	}
	if(existing) {
		if(!pins.some(message => message.id === existing.id)) {
			await channel.pinMessage(existing.id);
		}
		if(messageIds[key] !== existing.id) {
			messageIds[key] = existing.id;
			await saveIds(messageIds);
		}
		return { id: existing.id, published: false };
	}

	const message = await channel.createMessage({ content: marker + "\n" + guide + "\n\nTip: use the `m!casino` commands in this channel." });
	await channel.pinMessage(message.id);
	messageIds[key] = message.id;
	await saveIds(messageIds);
	return { id: message.id, published: true };
}
