import fs from "node:fs/promises";
import path from "node:path";
import helper from "../core/helper.js";
import { formatMRL, getAccountUsers } from "./wallet.js";

const pollInterval = 30000;

/**
 * Sends users a DM about every incoming transfer to their wallet account, once per transaction.
 * It uses the raw get_transfers RPC because monero-ts can't parse Morelo's transfer entries
 * (they have subaddr_index but no subaddr_indices).
 */
export function startNotifications(wallet, bot, config) {
	const statePath = path.join(config.walletsPath || "wallets", "notifications.json");
	let state, timer, stopped = false;

	async function loadState() {
		try {
			return JSON.parse(await fs.readFile(statePath, "utf8"));
		} catch(ex) {
			if(ex.code !== "ENOENT") {
				throw ex;
			}
			// First start: remember the existing transfers instead of announcing the whole history
			return null;
		}
	}

	async function notify(userId, senderId, amount, txid, confirmed) {
		const from = senderId ? "a tip of **" + formatMRL(amount) + "** from <@" + senderId + ">" : "**" + formatMRL(amount) + "**";
		const status = confirmed ? "It is confirmed and unlocks after a few blocks." : "It is not confirmed yet.";
		try {
			const channel = await bot.getDMChannel(userId);
			await bot.createMessage(channel.id, "You received " + from + ". " + status + "\nTransaction: `" + txid + "`");
		} catch(ex) {
			helper.warn("Can't send transfer notification to user %s:", userId, ex.message);
		}
	}

	async function poll() {
		state ??= await loadState();
		const height = await wallet.getHeight();
		const { result } = await wallet.getRpcConnection().sendJsonRequest("get_transfers", {
			in: true,
			out: true,
			pending: true,
			pool: true,
			all_accounts: true,
			filter_by_height: true,
			// min_height is exclusive, the overlap is deduplicated by the notified keys
			min_height: Math.max(0, (state?.height ?? height) - 2)
		});
		const users = await getAccountUsers(wallet, config);
		const senders = new Map([ ...result.out || [], ...result.pending || [] ].map(transfer => [ transfer.txid, users.get(transfer.subaddr_index.major) ]));

		// A transaction can pay several subaddresses of one account
		const incoming = new Map();
		for(const transfer of [ ...result.in || [], ...result.pool || [] ]) {
			const key = transfer.txid + ":" + transfer.subaddr_index.major;
			const entry = incoming.get(key) ?? { ...transfer, amount: 0n };
			entry.amount += BigInt(transfer.amount);
			incoming.set(key, entry);
		}
		const notified = new Set(state?.notified);
		for(const [ key, transfer ] of incoming) {
			const userId = users.get(transfer.subaddr_index.major);
			const senderId = senders.get(transfer.txid);
			if(state && !notified.has(key) && userId && senderId !== userId) {
				await notify(userId, senderId, transfer.amount, transfer.txid, transfer.type === "in");
			}
		}

		// Keys outside the height window are dropped, later polls don't return those transfers
		const next = { height, notified: [ ...incoming.keys() ] };
		if(JSON.stringify(next) !== JSON.stringify(state)) {
			await fs.mkdir(path.dirname(statePath), { recursive: true });
			// Write and rename so a crash can't leave a truncated file
			await fs.writeFile(statePath + ".tmp", JSON.stringify(next));
			await fs.rename(statePath + ".tmp", statePath);
		}
		state = next;
	}

	const loop = async () => {
		try {
			await poll();
		} catch(ex) {
			helper.err("Transfer notifications:", ex);
		}
		if(!stopped) {
			timer = setTimeout(loop, pollInterval);
		}
	};
	timer = setTimeout(loop, 0);

	return {
		poll,
		stop() {
			stopped = true;
			clearTimeout(timer);
		}
	};
}
