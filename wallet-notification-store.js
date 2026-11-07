import fs from "node:fs/promises";
import path from "node:path";

const initialState = () => ({
	version: 1,
	historyInitialized: false,
	lastScannedHeight: 0,
	tips: {},
	notifications: {},
	preferences: {},
	messages: {}
});

export default class WalletNotificationStore {
	constructor(filePath = "wallets/notifications.json") {
		this.filePath = filePath;
		this.tempPath = filePath + "." + process.pid + ".tmp";
		this.state = initialState();
		this.loadPromise = undefined;
		this.saveQueue = Promise.resolve();
	}

	async load() {
		if(!this.loadPromise) {
			this.loadPromise = (async () => {
				try {
					const saved = JSON.parse(await fs.readFile(this.filePath, "utf8"));
					if(saved?.version !== 1 || typeof saved !== "object") {
						throw new Error("Unsupported wallet notification store format.");
					}
					this.state = {
						...initialState(),
						...saved,
						tips: saved.tips && typeof saved.tips === "object" ? saved.tips : {},
						notifications: saved.notifications && typeof saved.notifications === "object"
							? saved.notifications
							: {},
						preferences: saved.preferences && typeof saved.preferences === "object"
							? saved.preferences
							: {},
						messages: saved.messages && typeof saved.messages === "object"
							? saved.messages
							: {}
					};
				} catch(ex) {
					if(ex.code !== "ENOENT") {
						throw ex;
					}

					this.state = initialState();
				}
				return this.state;
			})().catch(ex => {
				this.loadPromise = undefined;
				throw ex;
			});
		}
		return this.loadPromise;
	}

	async save() {
		await this.load();
		const operation = this.saveQueue.catch(() => {}).then(async () => {
			await fs.mkdir(path.dirname(this.filePath), { recursive: true });
			await fs.writeFile(this.tempPath, JSON.stringify(this.state), { mode: 0o600 });
			await fs.rename(this.tempPath, this.filePath);
		});
		this.saveQueue = operation;
		return operation;
	}

	async recordTip(txHash, senderId, recipientId, amount) {
		if(typeof txHash !== "string" || !txHash) {
			throw new TypeError("A transaction hash is required to record a tip.");
		}
		await this.load();
		this.state.tips[txHash] = {
			senderId: String(senderId),
			recipientId: String(recipientId),
			amount: String(amount),
			recordedAt: Date.now()
		};
		await this.save();
	}

	async recordTips(txHash, senderId, recipients) {
		if(typeof txHash !== "string" || !txHash) {
			throw new TypeError("A transaction hash is required to record tips.");
		}
		if(!Array.isArray(recipients) || recipients.length === 0) {
			throw new TypeError("At least one tip recipient is required.");
		}
		await this.load();
		for(const recipient of recipients) {
			this.state.tips[txHash + ":" + String(recipient.recipientId)] = {
				senderId: String(senderId),
				recipientId: String(recipient.recipientId),
				amount: String(recipient.amount),
				txHash,
				recordedAt: Date.now()
			};
		}
		this.state.tips[txHash] = {
			senderId: String(senderId),
			recipients: recipients.map(recipient => ({
				recipientId: String(recipient.recipientId),
				amount: String(recipient.amount)
			})),
			recordedAt: Date.now()
		};
		await this.save();
	}

	async getTip(txHash) {
		await this.load();
		const tip = this.state.tips[txHash];
		return tip ? { ...tip } : undefined;
	}

	async getTipForRecipient(txHash, recipientId) {
		await this.load();
		const tip = this.state.tips[txHash + ":" + String(recipientId)] || this.state.tips[txHash];
		if(!tip) {
			return undefined;
		}
		if(Array.isArray(tip.recipients)) {
			const recipient = tip.recipients.find(entry => entry.recipientId === String(recipientId));
			return recipient ? { ...tip, ...recipient } : undefined;
		}
		return String(tip.recipientId) === String(recipientId) ? { ...tip } : undefined;
	}

	async getNotification(key) {
		await this.load();
		const notification = this.state.notifications[key];
		return notification ? { ...notification } : undefined;
	}

	async setNotification(key, notification) {
		await this.load();
		this.state.notifications[key] = { ...notification };
		await this.save();
	}

	async getNotifications() {
		await this.load();
		return Object.entries(this.state.notifications).map(([ key, value ]) => [ key, { ...value } ]);
	}

	async getNotificationPreferences(userId) {
		await this.load();
		return {
			tips: this.state.preferences[String(userId)]?.tips !== false,
			transfers: this.state.preferences[String(userId)]?.transfers !== false
		};
	}

	async getMessage(key) {
		await this.load();
		const message = this.state.messages[key];
		return message ? { ...message } : undefined;
	}

	async setMessage(key, message) {
		await this.load();
		this.state.messages[key] = { ...message };
		await this.save();
		return { ...this.state.messages[key] };
	}

	async setNotificationPreferences(userId, preferences) {
		await this.load();
		const key = String(userId);
		const current = await this.getNotificationPreferences(key);
		this.state.preferences[key] = {
			tips: typeof preferences.tips === "boolean" ? preferences.tips : current.tips,
			transfers: typeof preferences.transfers === "boolean" ? preferences.transfers : current.transfers
		};
		await this.save();
		return { ...this.state.preferences[key] };
	}

	async getHistoryProgress() {
		await this.load();
		return {
			initialized: this.state.historyInitialized,
			lastScannedHeight: this.state.lastScannedHeight
		};
	}

	async setHistoryProgress(height, initialized = true) {
		await this.load();
		this.state.lastScannedHeight = Math.max(this.state.lastScannedHeight || 0, Number(height) || 0);
		this.state.historyInitialized ||= initialized;
		await this.save();
	}
}
