import { createHash } from "node:crypto";
import { MoneroWalletListener } from "monero-ts";
import WalletNotificationStore from "./wallet-notification-store.js";
import { formatWalletBalance, getUserIdsByAccount } from "./wallet-users.js";

const statusLabels = {
	unconfirmed: "unconfirmed",
	confirmed: "confirmed, locked",
	unlocked: "confirmed and unlocked"
};

function getTransactionHash(transfer) {
	return transfer.getTx()?.getHash();
}

export function getIncomingTransferKey(transfer, userId) {
	return [
		getTransactionHash(transfer),
		transfer.getAccountIndex(),
		transfer.getSubaddressIndex(),
		String(userId)
	].join(":");
}

export function getTransferStatus(transfer) {
	const tx = transfer.getTx?.();
	if(!tx?.getIsConfirmed?.()) {
		return "unconfirmed";
	}
	return tx.getIsLocked?.() ? "confirmed" : "unlocked";
}

export function normalizeWalletTransfersResponse(response) {
	const groups = response?.result;
	if(!groups || typeof groups !== "object") {
		return response;
	}
	for(const transfers of Object.values(groups)) {
		if(!Array.isArray(transfers)) {
			continue;
		}
		for(const transfer of transfers) {
			if(!transfer || transfer.subaddr_indices || transfer.subaddr_index == null) {
				continue;
			}
			const index = transfer.subaddr_index;
			if(Array.isArray(index)) {
				transfer.subaddr_indices = index;
			} else if(typeof index === "object" && Number.isInteger(index.major) && Number.isInteger(index.minor)) {
				transfer.subaddr_indices = [ index ];
			} else if(Number.isInteger(index)) {
				transfer.subaddr_indices = [ { major: transfer.account_index ?? 0, minor: index } ];
			}
		}
	}
	return response;
}

function installWalletRpcCompatibility(wallet) {
	const connection = wallet.getRpcConnection?.();
	if(!connection || typeof connection.sendJsonRequest !== "function") {
		return () => {};
	}
	const original = connection.sendJsonRequest;
	const compatible = async function(method, params, timeoutMs) {
		const response = await original.call(this, method, params, timeoutMs);
		return method === "get_transfers" ? normalizeWalletTransfersResponse(response) : response;
	};
	connection.sendJsonRequest = compatible;
	return () => {
		if(connection.sendJsonRequest === compatible) {
			connection.sendJsonRequest = original;
		}
	};
}

function toRecord(transfer, userId, tip, historical = false) {
	const tx = transfer.getTx();
	return {
		kind: "transfer",
		userId: String(userId),
		txHash: tx.getHash(),
		accountIndex: transfer.getAccountIndex(),
		subaddressIndex: transfer.getSubaddressIndex(),
		amount: String(transfer.getAmount()),
		status: getTransferStatus(transfer),
		tip: tip && String(tip.recipientId) === String(userId) ? tip : undefined,
		historical
	};
}

function renderTransfer(record) {
	const amount = formatWalletBalance(BigInt(record.amount));
	const prefix = record.tip
		? "You received a tip from <@" + record.tip.senderId + ">"
		: "You received an on-chain transfer";
	return prefix + ": " + amount + " (" + statusLabels[record.status] + ").\nTransaction: " + record.txHash;
}

function renderHistory(records) {
	const total = records.reduce((sum, record) => sum + BigInt(record.amount), 0n);
	const tips = records.filter(record => record.tip);
	const lines = [
		"Historical incoming transfers: " + records.length,
		"Tips: " + tips.length + "; on-chain transfers: " + (records.length - tips.length),
		"Total received: " + formatWalletBalance(total)
	];
	for(const tip of tips.slice(0, 10)) {
		lines.push("Tip from <@" + tip.tip.senderId + ">: " + formatWalletBalance(BigInt(tip.amount))
			+ " (" + tip.txHash + ")");
	}
	if(tips.length > 10) {
		lines.push("Additional historical tips: " + (tips.length - 10));
	}
	return lines.join("\n");
}

export async function startWalletNotifications({ wallet, bot, config, store, logger = console }) {
	const restoreWalletRpc = installWalletRpcCompatibility(wallet);
	try {
		await store.load();
	} catch(ex) {
		restoreWalletRpc();
		throw ex;
	}
	let ready = false;
	let queue = Promise.resolve();
	let pendingHeight = 0;
	const pendingHashes = new Set();

	const enqueue = action => {
		queue = queue.then(action).catch(ex => logger.error?.("Wallet notifications:", ex));
		return queue;
	};

	async function sendDM(userId, content) {
		const channel = await bot.getDMChannel(userId);
		return {
			channelId: channel.id,
			message: await bot.createMessage(channel.id, content)
		};
	}

	async function deliverTransfer(key, record, previous) {
		if(previous?.historical || previous?.suppressed) {
			return;
		}
		const preferences = await store.getNotificationPreferences(record.userId);
		if(record.tip ? !preferences.tips : !preferences.transfers) {
			await store.setNotification(key, {
				...record,
				messageId: previous?.messageId,
				channelId: previous?.channelId,
				deliveryPending: false,
				suppressed: true
			});
			return;
		}
		if(previous?.messageId && previous.status === record.status) {
			return;
		}
		await store.setNotification(key, {
			...previous,
			...record,
			messageId: previous?.messageId,
			channelId: previous?.channelId,
			deliveryPending: true
		});
		try {
			let result;
			if(previous?.messageId && previous.channelId) {
				try {
					result = {
						channelId: previous.channelId,
						message: await bot.editMessage(previous.channelId, previous.messageId, renderTransfer(record))
					};
				} catch {
					result = await sendDM(record.userId, renderTransfer(record));
				}
			} else {
				result = await sendDM(record.userId, renderTransfer(record));
			}
			await store.setNotification(key, {
				...record,
				messageId: result.message.id,
				channelId: result.channelId,
				deliveryPending: false
			});
		} catch(ex) {
			logger.warn?.("Can't send wallet notification to Discord user " + record.userId + ":", ex);
		}
	}

	async function processTransfer(transfer) {
		const txHash = getTransactionHash(transfer);
		if(!txHash) {
			return;
		}
		const accountIndex = transfer.getAccountIndex();
		const userIds = await getUserIdsByAccount(
			wallet,
			config.walletUsersPath,
			accountIndex,
			config.legacyAddressesPath
		);
		for(const userId of userIds) {
			const key = getIncomingTransferKey(transfer, userId);
			const previous = await store.getNotification(key);
			const tip = await store.getTipForRecipient(txHash, userId);
			const record = toRecord(transfer, userId, tip, previous?.historical);
			await deliverTransfer(key, record, previous);
		}
	}

	async function processHistory(transfers) {
		const historicalByUser = new Map();
		for(const transfer of transfers) {
			const txHash = getTransactionHash(transfer);
			if(!txHash) {
				continue;
			}
			const userIds = await getUserIdsByAccount(
				wallet,
				config.walletUsersPath,
				transfer.getAccountIndex(),
				config.legacyAddressesPath
			);
			for(const userId of userIds) {
				const key = getIncomingTransferKey(transfer, userId);
				const previous = await store.getNotification(key);
				if(previous?.historical) {
					continue;
				}
				const tip = await store.getTipForRecipient(txHash, userId);
				const record = toRecord(transfer, userId, tip);
				const preferences = await store.getNotificationPreferences(userId);
				if(tip ? !preferences.tips : !preferences.transfers) {
					await store.setNotification(key, { ...record, historical: true, suppressed: true });
					continue;
				}
				if(previous) {
					await deliverTransfer(key, record, previous);
					continue;
				}
				if(record.status !== "unlocked") {
					await deliverTransfer(key, record);
					continue;
				}
				const records = historicalByUser.get(String(userId)) || [];
				records.push({ key, record });
				historicalByUser.set(String(userId), records);
			}
		}

		for(const [ userId, entries ] of historicalByUser) {
			const keys = entries.map(entry => entry.key).sort();
			const digest = createHash("sha256").update(keys.join("\n")).digest("hex");
			const digestKey = "history:" + userId + ":" + digest;
			let savedDigest = await store.getNotification(digestKey);
			if(!savedDigest?.messageId) {
				const content = renderHistory(entries.map(entry => entry.record));
				await store.setNotification(digestKey, {
					kind: "history",
					userId,
					content,
					eventKeys: keys,
					deliveryPending: true
				});
				try {
					const result = await sendDM(userId, content);
					savedDigest = {
						kind: "history",
						userId,
						content,
						eventKeys: keys,
						messageId: result.message.id,
						channelId: result.channelId,
						deliveryPending: false
					};
					await store.setNotification(digestKey, savedDigest);
				} catch(ex) {
					logger.warn?.("Can't send historical wallet summary to Discord user " + userId + ":", ex);
					continue;
				}
			}
			for(const { key, record } of entries) {
				await store.setNotification(key, {
					...record,
					historical: true,
					digestKey,
					messageId: savedDigest.messageId,
					channelId: savedDigest.channelId
				});
			}
		}
	}

	async function retryPendingNotifications() {
		for(const [ key, record ] of await store.getNotifications()) {
			if(!record.deliveryPending) {
				continue;
			}
			if(record.kind === "transfer") {
				const preferences = await store.getNotificationPreferences(record.userId);
				if(record.tip ? !preferences.tips : !preferences.transfers) {
					await store.setNotification(key, { ...record, historical: true, deliveryPending: false, suppressed: true });
					continue;
				}
			}
			if(record.kind === "history") {
				const preferences = await store.getNotificationPreferences(record.userId);
				if((record.categories || []).some(category => !preferences[category])) {
					await store.setNotification(key, { ...record, deliveryPending: false, suppressed: true });
					for(const event of record.eventRecords || []) {
						await store.setNotification(event.key, { ...event.record, historical: true, suppressed: true });
					}
					continue;
				}
				try {
					const result = await sendDM(record.userId, record.content);
					const delivered = {
						...record,
						messageId: result.message.id,
						channelId: result.channelId,
						deliveryPending: false
					};
					await store.setNotification(key, delivered);
					for(const eventKey of record.eventKeys || []) {
						const event = await store.getNotification(eventKey);
						if(event) {
							await store.setNotification(eventKey, {
								...event,
								historical: true,
								digestKey: key,
								messageId: result.message.id,
								channelId: result.channelId
							});
						}
					}
				} catch(ex) {
					logger.warn?.("Can't retry historical wallet summary for Discord user " + record.userId + ":", ex);
				}
			} else if(record.kind === "transfer" && !record.messageId) {
				await deliverTransfer(key, record);
			}
		}
	}

	async function processHash(txHash) {
		const transfers = await wallet.getIncomingTransfers({ txQuery: { hash: txHash } });
		for(const transfer of transfers) {
			await processTransfer(transfer);
		}
	}

	async function catchUp(height) {
		const progress = await store.getHistoryProgress();
		const minHeight = Math.max(0, progress.lastScannedHeight - 20);
		const transfers = await wallet.getIncomingTransfers({ txQuery: { minHeight } });
		await processHistory(transfers);
		const walletHeight = await wallet.getHeight();
		await store.setHistoryProgress(Math.max(height || 0, walletHeight), true);
	}

	const listener = new MoneroWalletListener();
	listener.onOutputReceived = async output => {
		const txHash = output.getTx()?.getHash();
		if(!txHash) {
			return;
		}
		if(!ready) {
			pendingHashes.add(txHash);
			return;
		}
		await enqueue(() => processHash(txHash));
	};
	listener.onNewBlock = async height => {
		pendingHeight = Math.max(pendingHeight, height || 0);
		if(ready) {
			await enqueue(() => catchUp(pendingHeight));
		}
	};

	try {
		await wallet.addListener(listener);
		const progress = await store.getHistoryProgress();
		const minHeight = progress.initialized ? Math.max(0, progress.lastScannedHeight - 20) : 0;
		const transfers = await wallet.getIncomingTransfers({ txQuery: { minHeight } });
		await processHistory(transfers);
		await retryPendingNotifications();
		await store.setHistoryProgress(await wallet.getHeight(), true);
		ready = true;
		for(const txHash of pendingHashes) {
			await enqueue(() => processHash(txHash));
		}
		pendingHashes.clear();
		if(pendingHeight) {
			await enqueue(() => catchUp(pendingHeight));
		}
	} catch(ex) {
		await wallet.removeListener(listener).catch(() => {});
		restoreWalletRpc();
		throw ex;
	}

	return {
		listener,
		async stop() {
			ready = false;
			await wallet.removeListener(listener);
			await queue;
			restoreWalletRpc();
		}
	};
}
