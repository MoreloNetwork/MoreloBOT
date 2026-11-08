import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const initialState = () => ({ version: 1, balances: {}, bets: [], blackjack: {} });

function copy(value) {
	return JSON.parse(JSON.stringify(value));
}

export default class CasinoSandboxStore {
	constructor(filePath = "wallets/casino-sandbox.json", initialBalance = "1000000000000", dependencies = {}) {
		this.filePath = filePath;
		this.initialBalance = String(initialBalance);
		this.rename = dependencies.rename || fs.rename;
		this.wait = dependencies.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
		this.state = initialState();
		this.loadPromise = undefined;
		this.saveQueue = Promise.resolve();
	}

	async load() {
		if(!this.loadPromise) {
			this.loadPromise = (async () => {
				try {
					const saved = JSON.parse(await fs.readFile(this.filePath, "utf8"));
					if(saved?.version !== 1 || typeof saved.balances !== "object" || !Array.isArray(saved.bets)
						|| typeof saved.blackjack !== "object") {
						throw new Error("Unsupported casino sandbox store format.");
					}
					this.state = saved;
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
			const tempPath = this.filePath + "." + process.pid + "." + randomUUID() + ".tmp";
			await fs.writeFile(tempPath, JSON.stringify(this.state), { mode: 0o600 });
			try {
				for(let attempt = 0; ; attempt++) {
					try {
						await this.rename(tempPath, this.filePath);
						break;
					} catch(ex) {
						if(![ "EPERM", "EBUSY", "EACCES" ].includes(ex.code) || attempt >= 4) {
							throw ex;
						}
						await this.wait(50 * 2 ** attempt);
					}
				}
			} catch(ex) {
				await fs.rm(tempPath, { force: true }).catch(() => {});
				throw ex;
			}
		});
		this.saveQueue = operation;
		return operation;
	}

	async getBalance(userId) {
		await this.load();
		const key = String(userId);
		if(this.state.balances[key] == null) {
			this.state.balances[key] = this.initialBalance;
			await this.save();
		}
		return BigInt(this.state.balances[key]);
	}

	async setBalance(userId, balance) {
		await this.load();
		this.state.balances[String(userId)] = String(balance);
		await this.save();
	}

	async createBet(bet) {
		await this.load();
		if(this.state.bets.some(existing => existing.id === bet.id)) {
			throw new Error("Casino sandbox bet ID already exists.");
		}
		this.state.bets.push({ ...bet });
		await this.save();
		return copy(bet);
	}

	async getBet(id) {
		await this.load();
		const bet = this.state.bets.find(entry => entry.id === id);
		return bet ? copy(bet) : undefined;
	}

	async getOpenBets() {
		await this.load();
		return this.state.bets.filter(bet => [ "stake_submitting", "needs_review" ].includes(bet.status)).map(copy);
	}

	async updateBet(id, changes) {
		await this.load();
		const bet = this.state.bets.find(entry => entry.id === id);
		if(!bet) {
			throw new Error("Casino sandbox bet was not found.");
		}
		Object.assign(bet, changes);
		await this.save();
		return copy(bet);
	}

	async getRoundBets(height) {
		await this.load();
		return this.state.bets.filter(bet => bet.targetHeight === height).map(copy);
	}

	async getUserRoundBet(height, userId) {
		await this.load();
		const bet = this.state.bets.find(entry => entry.targetHeight === height && entry.userId === String(userId));
		return bet ? copy(bet) : undefined;
	}

	async getHistory(userId, limit = 10) {
		await this.load();
		return this.state.bets.filter(bet => bet.userId === String(userId))
			.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(copy);
	}

	async getBlackjack(userId) {
		await this.load();
		const hand = this.state.blackjack[String(userId)];
		return hand ? copy(hand) : undefined;
	}

	async setBlackjack(userId, hand) {
		await this.load();
		if(hand) {
			this.state.blackjack[String(userId)] = copy(hand);
		} else {
			delete this.state.blackjack[String(userId)];
		}
		await this.save();
		return hand ? copy(hand) : undefined;
	}
}
