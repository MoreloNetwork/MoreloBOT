const openStatuses = [ "stake_submitting", "open", "payout_submitting", "needs_review" ];

const clone = value => JSON.parse(JSON.stringify(value));

function mapBet(row) {
	if(!row) return undefined;
	const bet = {
		id: row.id,
		userId: row.user_id,
		guess: row.guess,
		targetHeight: Number(row.target_height),
		stake: row.stake,
		payout: row.payout,
		feeReserve: row.fee_reserve || "0",
		status: row.status,
		createdAt: Number(row.created_at)
	};
	if(row.game != null) bet.game = row.game;
	if(row.selection != null) bet.selection = row.selection;
	if(row.won != null) bet.won = row.won;
	if(row.stake_tx_hash) bet.stakeTxHash = row.stake_tx_hash;
	if(row.payout_tx_hash) bet.payoutTxHash = row.payout_tx_hash;
	if(row.block_hash) bet.blockHash = row.block_hash;
	if(row.failure_stage) bet.failureStage = row.failure_stage;
	if(row.failure_message) bet.failureMessage = row.failure_message;
	if(row.resolution) bet.resolution = row.resolution;
	if(row.resolution_proof) bet.resolutionProof = row.resolution_proof;
	if(row.resolved_by) bet.resolvedBy = row.resolved_by;
	if(row.resolved_at != null) bet.resolvedAt = Number(row.resolved_at);
	if(row.settled_at != null) bet.settledAt = Number(row.settled_at);
	return bet;
}

function mapBlock(row) {
	if(!row) return undefined;
	return {
		height: Number(row.height),
		hash: row.hash,
		status: row.status,
		recordedAt: row.recorded_at != null ? Number(row.recorded_at) : undefined,
		settledAt: row.settled_at != null ? Number(row.settled_at) : undefined,
		announcedAt: row.announced_at != null ? Number(row.announced_at) : undefined
	};
}

function mapRound(row) {
	if(!row) return undefined;
	return {
		height: Number(row.height),
		status: row.status,
		announcedAt: row.announced_at != null ? Number(row.announced_at) : null
	};
}

export default class CasinoBlockPostgresStore {
	constructor(database, options = {}) {
		this.database = database;
		const sandbox = options.sandbox === true;
		this.betsTable = sandbox ? "casino_sandbox_block_bets" : "casino_block_bets";
		this.blocksTable = sandbox ? "casino_sandbox_blocks" : "casino_blocks";
		this.roundsTable = sandbox ? "casino_sandbox_rounds" : "casino_rounds";
	}

	async createBet(bet) {
		const now = Number(bet.createdAt || Date.now());
		await this.database.query(
			`INSERT INTO ${this.betsTable} (
				id, user_id, game, guess, selection, target_height, stake, payout, fee_reserve,
				won, status, stake_tx_hash, payout_tx_hash, block_hash, failure_stage, failure_message,
				resolution, resolution_proof, resolved_by, resolved_at, settled_at, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9,
				$10, $11, $12, $13, $14, $15, $16,
				$17, $18, $19, $20, $21, $22, $23
			)`,
			[
				String(bet.id),
				String(bet.userId),
				bet.game ?? null,
				bet.guess ?? null,
				bet.selection ?? null,
				Number(bet.targetHeight),
				String(bet.stake),
				String(bet.payout),
				bet.feeReserve ?? "0",
				bet.won ?? null,
				String(bet.status),
				bet.stakeTxHash ?? null,
				bet.payoutTxHash ?? null,
				bet.blockHash ?? null,
				bet.failureStage ?? null,
				bet.failureMessage ?? null,
				bet.resolution ?? null,
				bet.resolutionProof ?? null,
				bet.resolvedBy ?? null,
				bet.resolvedAt ?? null,
				bet.settledAt ?? null,
				now,
				now
			]
		);
		return clone({ ...bet, createdAt: now });
	}

	async updateBet(id, changes) {
		const existing = await this.getBet(id);
		if(!existing) {
			throw new Error("Casino block bet was not found.");
		}
		const merged = { ...existing, ...changes };
		const now = Date.now();
		await this.database.query(
			`UPDATE ${this.betsTable} SET
				user_id = $2,
				game = $3,
				guess = $4,
				selection = $5,
				target_height = $6,
				stake = $7,
				payout = $8,
				fee_reserve = $9,
				won = $10,
				status = $11,
				stake_tx_hash = $12,
				payout_tx_hash = $13,
				block_hash = $14,
				failure_stage = $15,
				failure_message = $16,
				resolution = $17,
				resolution_proof = $18,
				resolved_by = $19,
				resolved_at = $20,
				settled_at = $21,
				updated_at = $22
			WHERE id = $1`,
			[
				String(id),
				String(merged.userId),
				merged.game ?? null,
				merged.guess ?? null,
				merged.selection ?? null,
				Number(merged.targetHeight),
				String(merged.stake),
				String(merged.payout),
				merged.feeReserve ?? "0",
				merged.won ?? null,
				String(merged.status),
				merged.stakeTxHash ?? null,
				merged.payoutTxHash ?? null,
				merged.blockHash ?? null,
				merged.failureStage ?? null,
				merged.failureMessage ?? null,
				merged.resolution ?? null,
				merged.resolutionProof ?? null,
				merged.resolvedBy ?? null,
				merged.resolvedAt ?? null,
				merged.settledAt ?? null,
				now
			]
		);
		return this.getBet(id);
	}

	async getBet(id) {
		const result = await this.database.query(`SELECT * FROM ${this.betsTable} WHERE id = $1`, [ String(id) ]);
		return mapBet(result.rows[0]);
	}

	async getRoundBets(height) {
		const result = await this.database.query(
			`SELECT * FROM ${this.betsTable} WHERE target_height = $1 ORDER BY created_at`,
			[ Number(height) ]
		);
		return result.rows.map(mapBet);
	}

	async getSettledBets() {
		const result = await this.database.query(
			`SELECT * FROM ${this.betsTable} WHERE status = $1 ORDER BY created_at DESC`,
			[ "settled" ]
		);
		return result.rows.map(mapBet);
	}

	async getUserRoundBet(height, userId) {
		const result = await this.database.query(
			`SELECT * FROM ${this.betsTable} WHERE target_height = $1 AND user_id = $2 ORDER BY created_at LIMIT 1`,
			[ Number(height), String(userId) ]
		);
		return mapBet(result.rows[0]);
	}

	async getOpenBets() {
		const result = await this.database.query(
			`SELECT * FROM ${this.betsTable} WHERE status = ANY($1::text[]) ORDER BY created_at`,
			[ openStatuses ]
		);
		return result.rows.map(mapBet);
	}

	async getLiability() {
		const result = await this.database.query(
			`SELECT payout, fee_reserve FROM ${this.betsTable} WHERE status = ANY($1::text[])`,
			[ [ "open", "payout_submitting", "needs_review" ] ]
		);
		return result.rows.reduce((sum, row) => sum + BigInt(row.payout) + BigInt(row.fee_reserve || "0"), 0n);
	}

	async recordBlock(height, hash) {
		const existing = await this.getBlock(height);
		if(existing) {
			if(existing.hash !== hash) throw new Error("Casino block height already recorded with a different hash.");
			return existing;
		}
		const block = { height: Number(height), hash, status: "settling", recordedAt: Date.now() };
		await this.database.query(
			`INSERT INTO ${this.blocksTable}(height, hash, status, recorded_at, settled_at, announced_at)
			 VALUES($1, $2, $3, $4, $5, $6)`,
			[ block.height, block.hash, block.status, block.recordedAt, null, null ]
		);
		return clone(block);
	}

	async updateBlock(height, changes) {
		const existing = await this.getBlock(height);
		if(!existing) throw new Error("Casino block was not found.");
		const merged = { ...existing, ...changes };
		await this.database.query(
			`UPDATE ${this.blocksTable} SET hash = $2, status = $3, recorded_at = $4, settled_at = $5, announced_at = $6 WHERE height = $1`,
			[
				Number(height),
				merged.hash,
				merged.status,
				merged.recordedAt ?? null,
				merged.settledAt ?? null,
				merged.announcedAt ?? null
			]
		);
		return this.getBlock(height);
	}

	async getBlock(height) {
		const result = await this.database.query(`SELECT * FROM ${this.blocksTable} WHERE height = $1`, [ Number(height) ]);
		return mapBlock(result.rows[0]);
	}

	async getUnannouncedSettledBlocks() {
		const result = await this.database.query(
			`SELECT * FROM ${this.blocksTable} WHERE status = $1 AND announced_at IS NULL ORDER BY height`,
			[ "settled" ]
		);
		return result.rows.map(mapBlock);
	}

	async markBlockAnnounced(height) {
		return this.updateBlock(height, { announcedAt: Date.now() });
	}

	async getLastAnnouncedRound() {
		const [ rounds, bets, blocks ] = await Promise.all([
			this.database.query(`SELECT MAX(height) AS max_height FROM ${this.roundsTable}`),
			this.database.query(`SELECT MAX(target_height) AS max_height FROM ${this.betsTable}`),
			this.database.query(`SELECT MAX(height) AS max_height FROM ${this.blocksTable}`)
		]);
		const values = [ rounds, bets, blocks ]
			.map(result => Number(result.rows[0]?.max_height || 0))
			.filter(Number.isFinite);
		return values.length ? Math.max(...values) : 0;
	}

	async getRound(height) {
		const result = await this.database.query(`SELECT * FROM ${this.roundsTable} WHERE height = $1`, [ Number(height) ]);
		return mapRound(result.rows[0]);
	}

	async markRoundAnnouncing(height) {
		await this.database.query(
			`INSERT INTO ${this.roundsTable}(height, status, announced_at)
			 VALUES($1, $2, NULL)
			 ON CONFLICT(height) DO UPDATE SET status = EXCLUDED.status`,
			[ Number(height), "announcing" ]
		);
		return Number(height);
	}

	async markRoundAnnounced(height) {
		const now = Date.now();
		await this.database.query(
			`INSERT INTO ${this.roundsTable}(height, status, announced_at)
			 VALUES($1, $2, $3)
			 ON CONFLICT(height) DO UPDATE SET status = EXCLUDED.status, announced_at = EXCLUDED.announced_at`,
			[ Number(height), "announced", now ]
		);
		return Number(height);
	}
}
