import fs from "node:fs/promises";
import path from "node:path";

const initialState = () => ({ version: 1, wagers: [] });
const openStatuses = new Set([ "stake_submitting", "stake_sent", "payout_submitting", "needs_review" ]);

function copy(value) {
	return JSON.parse(JSON.stringify(value));
}

export default class CasinoStore {
	constructor(filePath = "wallets/casino-wagers.json") {
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
					if(saved?.version !== 1 || !Array.isArray(saved.wagers)) {
						throw new Error("Unsupported casino wager store format.");
					}
					this.state = { version: 1, wagers: saved.wagers };
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

	async createWager(wager) {
		await this.load();
		if(this.state.wagers.some(existing => existing.id === wager.id)) {
			throw new Error("Casino wager ID already exists.");
		}
		this.state.wagers.push({ ...wager });
		await this.save();
		return { ...wager };
	}

	async updateWager(id, changes) {
		await this.load();
		const wager = this.state.wagers.find(entry => entry.id === id);
		if(!wager) {
			throw new Error("Casino wager was not found.");
		}
		Object.assign(wager, changes);
		await this.save();
		return { ...wager };
	}

	async getWager(id) {
		await this.load();
		const wager = this.state.wagers.find(entry => entry.id === id);
		return wager ? { ...wager } : undefined;
	}

	async getOpenWager(userId) {
		await this.load();
		const wager = this.state.wagers.find(entry => entry.userId === String(userId) && openStatuses.has(entry.status));
		return wager ? { ...wager } : undefined;
	}

	async getUserWagers(userId, limit = 10) {
		await this.load();
		return this.state.wagers
			.filter(wager => wager.userId === String(userId))
			.sort((left, right) => right.createdAt - left.createdAt)
			.slice(0, limit)
			.map(copy);
	}

	async getOpenWagers() {
		await this.load();
		return this.state.wagers.filter(wager => openStatuses.has(wager.status)).map(copy);
	}
}
