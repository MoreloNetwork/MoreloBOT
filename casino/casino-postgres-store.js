const openStatuses = [ "stake_submitting", "stake_sent", "payout_submitting", "needs_review" ];

function mapWager(row) {
	if(!row) {
		return undefined;
	}
	const wager = {
		id: row.id,
		userId: row.user_id,
		game: row.game,
		selection: row.selection,
		stake: row.stake,
		payout: row.payout,
		outcome: row.outcome,
		won: row.won,
		status: row.status,
		createdAt: Number(row.created_at)
	};
	if(row.stake_tx_hash) wager.stakeTxHash = row.stake_tx_hash;
	if(row.payout_tx_hash) wager.payoutTxHash = row.payout_tx_hash;
	if(row.failure_stage) wager.failureStage = row.failure_stage;
	if(row.failure_message) wager.failureMessage = row.failure_message;
	if(row.resolution) wager.resolution = row.resolution;
	if(row.resolution_proof) wager.resolutionProof = row.resolution_proof;
	if(row.resolved_by) wager.resolvedBy = row.resolved_by;
	if(row.resolved_at) wager.resolvedAt = Number(row.resolved_at);
	return wager;
}

function getTransferType(status, failureStage) {
	if(failureStage === "stake" || status === "stake_submitting" || status === "stake_sent") {
		return "stake";
	}
	if(failureStage === "payout" || status === "payout_submitting") {
		return "payout";
	}
	return "state";
}

function getTransferStatus(changes) {
	if(changes.failureStage) {
		return "failed";
	}
	if(changes.stakeTxHash || changes.payoutTxHash) {
		return "sent";
	}
	return changes.status || "updated";
}

export default class CasinoPostgresStore {
	constructor(database) {
		this.database = database;
	}

	async createWager(wager) {
		const now = Number(wager.createdAt || Date.now());
		await this.database.query(
			`INSERT INTO casino_wagers (
				id, user_id, game, selection, stake, payout, outcome, won, status,
				stake_tx_hash, payout_tx_hash, failure_stage, failure_message,
				resolution, resolution_proof, resolved_by, resolved_at, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
				$10, $11, $12, $13,
				$14, $15, $16, $17, $18, $19
			)`,
			[
				String(wager.id),
				String(wager.userId),
				String(wager.game),
				String(wager.selection),
				String(wager.stake),
				String(wager.payout),
				JSON.stringify(wager.outcome),
				Boolean(wager.won),
				String(wager.status),
				wager.stakeTxHash ?? null,
				wager.payoutTxHash ?? null,
				wager.failureStage ?? null,
				wager.failureMessage ?? null,
				wager.resolution ?? null,
				wager.resolutionProof ?? null,
				wager.resolvedBy ?? null,
				wager.resolvedAt ?? null,
				now,
				now
			]
		);
		await this.database.query(
			`INSERT INTO casino_wager_transfers (wager_id, transfer_type, status, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5)`,
			[ String(wager.id), getTransferType(wager.status), wager.status, now, now ]
		);
		return { ...wager, createdAt: now };
	}

	async updateWager(id, changes) {
		return this.database.withClient(async client => {
			await client.query("BEGIN");
			try {
				const existingResult = await client.query("SELECT * FROM casino_wagers WHERE id = $1", [ String(id) ]);
				if(!existingResult.rows.length) {
					throw new Error("Casino wager was not found.");
				}
				const existing = mapWager(existingResult.rows[0]);
				const merged = { ...existing, ...changes, updatedAt: Date.now() };
				await client.query(
					`UPDATE casino_wagers SET
						user_id = $2,
						game = $3,
						selection = $4,
						stake = $5,
						payout = $6,
						outcome = $7::jsonb,
						won = $8,
						status = $9,
						stake_tx_hash = $10,
						payout_tx_hash = $11,
						failure_stage = $12,
						failure_message = $13,
						resolution = $14,
						resolution_proof = $15,
						resolved_by = $16,
						resolved_at = $17,
						updated_at = $18
					WHERE id = $1`,
					[
						String(id),
						String(merged.userId),
						String(merged.game),
						String(merged.selection),
						String(merged.stake),
						String(merged.payout),
						JSON.stringify(merged.outcome),
						Boolean(merged.won),
						String(merged.status),
						merged.stakeTxHash ?? null,
						merged.payoutTxHash ?? null,
						merged.failureStage ?? null,
						merged.failureMessage ?? null,
						merged.resolution ?? null,
						merged.resolutionProof ?? null,
						merged.resolvedBy ?? null,
						merged.resolvedAt ?? null,
						merged.updatedAt
					]
				);

				const changeKeys = Object.keys(changes);
				if(changeKeys.length) {
					const transferType = getTransferType(changes.status, changes.failureStage);
					await client.query(
						`INSERT INTO casino_wager_transfers (
							wager_id, transfer_type, status, tx_hash, error_message, created_at, updated_at
						) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
						[
							String(id),
							transferType,
							getTransferStatus(changes),
							changes.payoutTxHash ?? changes.stakeTxHash ?? null,
							changes.failureMessage ?? null,
							merged.updatedAt,
							merged.updatedAt
						]
					);
				}

				if(changes.resolvedBy) {
					await client.query(
						`INSERT INTO casino_wager_audit_log (wager_id, admin_user_id, action, proof, payload, created_at)
						 VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
						[
							String(id),
							String(changes.resolvedBy),
							changes.resolution ? "resolve_" + changes.resolution : "update",
							changes.resolutionProof ?? null,
							JSON.stringify(changes),
							merged.updatedAt
						]
					);
				}

				await client.query("COMMIT");
				return this.getWager(id);
			} catch(ex) {
				await client.query("ROLLBACK");
				throw ex;
			}
		});
	}

	async getWager(id) {
		const result = await this.database.query("SELECT * FROM casino_wagers WHERE id = $1", [ String(id) ]);
		return mapWager(result.rows[0]);
	}

	async getOpenWager(userId) {
		const result = await this.database.query(
			`SELECT * FROM casino_wagers
			 WHERE user_id = $1 AND status = ANY($2::text[])
			 ORDER BY created_at DESC
			 LIMIT 1`,
			[ String(userId), openStatuses ]
		);
		return mapWager(result.rows[0]);
	}

	async getUserWagers(userId, limit = 10) {
		const result = await this.database.query(
			`SELECT * FROM casino_wagers
			 WHERE user_id = $1
			 ORDER BY created_at DESC
			 LIMIT $2`,
			[ String(userId), Number(limit) ]
		);
		return result.rows.map(mapWager);
	}

	async getOpenWagers() {
		const result = await this.database.query(
			`SELECT * FROM casino_wagers
			 WHERE status = ANY($1::text[])
			 ORDER BY created_at DESC`,
			[ openStatuses ]
		);
		return result.rows.map(mapWager);
	}

	async getSettledWagers() {
		const result = await this.database.query(
			`SELECT * FROM casino_wagers
			 WHERE status = $1
			 ORDER BY created_at DESC`,
			[ "settled" ]
		);
		return result.rows.map(mapWager);
	}
}
