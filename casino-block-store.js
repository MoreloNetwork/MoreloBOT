import fs from "node:fs/promises";
import path from "node:path";

const initial = () => ({ version: 1, bets: [], blocks: [] });
const copy = value => JSON.parse(JSON.stringify(value));

export default class CasinoBlockStore {
	constructor(filePath = "wallets/casino-block-bets.json") {
		this.filePath = filePath;
		this.tempPath = filePath + "." + process.pid + ".tmp";
		this.state = initial();
		this.loadPromise = undefined;
		this.saveQueue = Promise.resolve();
	}

	async load() {
		if(!this.loadPromise) {
			this.loadPromise = (async () => {
				try {
					const saved = JSON.parse(await fs.readFile(this.filePath, "utf8"));
					if(saved?.version !== 1 || !Array.isArray(saved.bets) || !Array.isArray(saved.blocks)) throw new Error("Unsupported casino block store format.");
					this.state = { version: 1, bets: saved.bets, blocks: saved.blocks };
				} catch(ex) {
					if(ex.code !== "ENOENT") throw ex;
					this.state = initial();
				}
				return this.state;
			})().catch(ex => { this.loadPromise = undefined; throw ex; });
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

	async createBet(bet) {
		await this.load();
		if(this.state.bets.some(item => item.id === bet.id)) throw new Error("Casino block bet ID already exists.");
		this.state.bets.push({ ...bet });
		await this.save();
		return copy(bet);
	}

	async updateBet(id, changes) {
		await this.load();
		const bet = this.state.bets.find(item => item.id === id);
		if(!bet) throw new Error("Casino block bet was not found.");
		Object.assign(bet, changes);
		await this.save();
		return copy(bet);
	}

	async getBet(id) {
		await this.load();
		const bet = this.state.bets.find(item => item.id === id);
		return bet ? copy(bet) : undefined;
	}

	async getRoundBets(height) {
		await this.load();
		return this.state.bets.filter(bet => bet.targetHeight === height).map(copy);
	}

	async getUserRoundBet(height, userId) {
		await this.load();
		const bet = this.state.bets.find(item => item.targetHeight === height && item.userId === String(userId));
		return bet ? copy(bet) : undefined;
	}

	async getOpenBets() {
		await this.load();
		return this.state.bets.filter(bet => ["stake_submitting", "open", "payout_submitting", "needs_review"].includes(bet.status)).map(copy);
	}

	async getLiability() {
		await this.load();
		return this.state.bets.filter(bet => ["open", "payout_submitting", "needs_review"].includes(bet.status))
			.reduce((sum, bet) => sum + BigInt(bet.payout) + BigInt(bet.feeReserve || "0"), 0n);
	}

	async recordBlock(height, hash) {
		await this.load();
		const existing = this.state.blocks.find(block => block.height === height);
		if(existing) {
			if(existing.hash !== hash) throw new Error("Casino block height already recorded with a different hash.");
			return copy(existing);
		}
		const block = { height, hash, status: "settling", recordedAt: Date.now() };
		this.state.blocks.push(block);
		await this.save();
		return copy(block);
	}

	async updateBlock(height, changes) {
		await this.load();
		const block = this.state.blocks.find(item => item.height === height);
		if(!block) throw new Error("Casino block was not found.");
		Object.assign(block, changes);
		await this.save();
		return copy(block);
	}

	async getBlock(height) {
		await this.load();
		const block = this.state.blocks.find(item => item.height === height);
		return block ? copy(block) : undefined;
	}

	async getUnannouncedSettledBlocks() {
		await this.load();
		return this.state.blocks.filter(block => block.status === "settled" && !block.announcedAt).map(copy);
	}

	async markBlockAnnounced(height) {
		return this.updateBlock(height, { announcedAt: Date.now() });
	}
}
