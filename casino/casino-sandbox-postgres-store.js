const clone = value => JSON.parse(JSON.stringify(value));

function mapBet(row) {
	if(!row) return undefined;
	const bet = {
		id: row.id,
		userId: row.user_id,
		stake: row.stake,
		payout: row.payout,
		status: row.status,
		createdAt: Number(row.created_at),
		updatedAt: Number(row.updated_at)
	};
	if(row.game != null) bet.game = row.game;
	if(row.selection != null) bet.selection = row.selection;
	if(row.outcome != null) bet.outcome = row.outcome;
	if(row.guess != null) bet.guess = row.guess;
	if(row.target_height != null) bet.targetHeight = Number(row.target_height);
	if(row.fee_reserve != null) bet.feeReserve = row.fee_reserve;
	if(row.won != null) bet.won = row.won;
	if(row.block_hash != null) bet.blockHash = row.block_hash;
	if(row.failure_stage != null) bet.failureStage = row.failure_stage;
	if(row.failure_message != null) bet.failureMessage = row.failure_message;
	if(row.resolution != null) bet.resolution = row.resolution;
	if(row.resolution_proof != null) bet.resolutionProof = row.resolution_proof;
	if(row.resolved_by != null) bet.resolvedBy = row.resolved_by;
	if(row.resolved_at != null) bet.resolvedAt = Number(row.resolved_at);
	return bet;
}

export default class CasinoSandboxPostgresStore {
	constructor(database, initialBalance = "1000000000000") {
		this.database = database;
		this.initialBalance = String(initialBalance);
	}

	async getBalance(userId) {
		const key = String(userId);
		const result = await this.database.query("SELECT balance FROM casino_sandbox_balances WHERE user_id = $1", [ key ]);
		if(result.rows.length) {
			return BigInt(result.rows[0].balance);
		}
		await this.database.query(
			"INSERT INTO casino_sandbox_balances(user_id, balance) VALUES ($1, $2) ON CONFLICT(user_id) DO NOTHING",
			[ key, this.initialBalance ]
		);
		return BigInt(this.initialBalance);
	}

	async setBalance(userId, balance) {
		await this.database.query(
			`INSERT INTO casino_sandbox_balances(user_id, balance) VALUES($1, $2)
			 ON CONFLICT(user_id) DO UPDATE SET balance = EXCLUDED.balance`,
			[ String(userId), String(balance) ]
		);
	}

	async createBet(bet) {
		const now = Number(bet.createdAt || Date.now());
		await this.database.query(
			`INSERT INTO casino_sandbox_bets(
				id, user_id, game, selection, outcome, guess, target_height, stake, payout,
				fee_reserve, won, status, block_hash, failure_stage, failure_message, resolution,
				resolution_proof, resolved_by, resolved_at, created_at, updated_at
			) VALUES(
				$1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9,
				$10, $11, $12, $13, $14, $15, $16,
				$17, $18, $19, $20, $21
			)`,
			[
				String(bet.id),
				String(bet.userId),
				bet.game ?? null,
				bet.selection ?? null,
				bet.outcome ? JSON.stringify(bet.outcome) : null,
				bet.guess ?? null,
				bet.targetHeight ?? null,
				String(bet.stake),
				String(bet.payout),
				bet.feeReserve ?? null,
				bet.won ?? null,
				String(bet.status),
				bet.blockHash ?? null,
				bet.failureStage ?? null,
				bet.failureMessage ?? null,
				bet.resolution ?? null,
				bet.resolutionProof ?? null,
				bet.resolvedBy ?? null,
				bet.resolvedAt ?? null,
				now,
				now
			]
		);
		return clone({ ...bet, createdAt: now, updatedAt: now });
	}

	async getBet(id) {
		const result = await this.database.query("SELECT * FROM casino_sandbox_bets WHERE id = $1", [ String(id) ]);
		return mapBet(result.rows[0]);
	}

	async getOpenBets() {
		const result = await this.database.query(
			"SELECT * FROM casino_sandbox_bets WHERE status = ANY($1::text[]) ORDER BY created_at",
			[ [ "stake_submitting", "needs_review" ] ]
		);
		return result.rows.map(mapBet);
	}

	async updateBet(id, changes) {
		const existing = await this.getBet(id);
		if(!existing) {
			throw new Error("Casino sandbox bet was not found.");
		}
		const merged = { ...existing, ...changes };
		const now = Date.now();
		await this.database.query(
			`UPDATE casino_sandbox_bets SET
				user_id = $2,
				game = $3,
				selection = $4,
				outcome = $5::jsonb,
				guess = $6,
				target_height = $7,
				stake = $8,
				payout = $9,
				fee_reserve = $10,
				won = $11,
				status = $12,
				block_hash = $13,
				failure_stage = $14,
				failure_message = $15,
				resolution = $16,
				resolution_proof = $17,
				resolved_by = $18,
				resolved_at = $19,
				updated_at = $20
			WHERE id = $1`,
			[
				String(id),
				String(merged.userId),
				merged.game ?? null,
				merged.selection ?? null,
				merged.outcome ? JSON.stringify(merged.outcome) : null,
				merged.guess ?? null,
				merged.targetHeight ?? null,
				String(merged.stake),
				String(merged.payout),
				merged.feeReserve ?? null,
				merged.won ?? null,
				String(merged.status),
				merged.blockHash ?? null,
				merged.failureStage ?? null,
				merged.failureMessage ?? null,
				merged.resolution ?? null,
				merged.resolutionProof ?? null,
				merged.resolvedBy ?? null,
				merged.resolvedAt ?? null,
				now
			]
		);
		return this.getBet(id);
	}

	async getRoundBets(height) {
		const result = await this.database.query(
			"SELECT * FROM casino_sandbox_bets WHERE target_height = $1 ORDER BY created_at",
			[ Number(height) ]
		);
		return result.rows.map(mapBet);
	}

	async getUserRoundBet(height, userId) {
		const result = await this.database.query(
			"SELECT * FROM casino_sandbox_bets WHERE target_height = $1 AND user_id = $2 ORDER BY created_at LIMIT 1",
			[ Number(height), String(userId) ]
		);
		return mapBet(result.rows[0]);
	}

	async getHistory(userId, limit = 10) {
		const result = await this.database.query(
			"SELECT * FROM casino_sandbox_bets WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
			[ String(userId), Number(limit) ]
		);
		return result.rows.map(mapBet);
	}

	async getBlackjack(userId) {
		const result = await this.database.query(
			"SELECT hand FROM casino_sandbox_blackjack WHERE user_id = $1",
			[ String(userId) ]
		);
		return result.rows.length ? clone(result.rows[0].hand) : undefined;
	}

	async setBlackjack(userId, hand) {
		const key = String(userId);
		if(hand) {
			await this.database.query(
				`INSERT INTO casino_sandbox_blackjack(user_id, hand, updated_at) VALUES($1, $2::jsonb, $3)
				 ON CONFLICT(user_id) DO UPDATE SET hand = EXCLUDED.hand, updated_at = EXCLUDED.updated_at`,
				[ key, JSON.stringify(hand), Date.now() ]
			);
			return clone(hand);
		}
		await this.database.query("DELETE FROM casino_sandbox_blackjack WHERE user_id = $1", [ key ]);
		return undefined;
	}
}
