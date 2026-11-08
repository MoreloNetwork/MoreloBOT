import assert from "node:assert/strict";
import test from "node:test";
import CasinoBlockPostgresStore from "../casino/casino-block-postgres-store.js";

class FakeBlockDatabase {
	constructor() {
		this.bets = new Map();
		this.blocks = new Map();
		this.rounds = new Map();
	}

	async query(sql, params = []) {
		if(sql.startsWith("INSERT INTO casino_block_bets")) {
			const [ id, userId, game, guess, selection, targetHeight, stake, payout, feeReserve, won, status, stakeTxHash, payoutTxHash, blockHash, failureStage, failureMessage, resolution, resolutionProof, resolvedBy, resolvedAt, settledAt, createdAt, updatedAt ] = params;
			this.bets.set(String(id), {
				id: String(id),
				user_id: String(userId),
				game,
				guess,
				selection,
				target_height: Number(targetHeight),
				stake: String(stake),
				payout: String(payout),
				fee_reserve: feeReserve,
				won,
				status: String(status),
				stake_tx_hash: stakeTxHash,
				payout_tx_hash: payoutTxHash,
				block_hash: blockHash,
				failure_stage: failureStage,
				failure_message: failureMessage,
				resolution: resolution,
				resolution_proof: resolutionProof,
				resolved_by: resolvedBy,
				resolved_at: resolvedAt,
				settled_at: settledAt,
				created_at: createdAt,
				updated_at: updatedAt
			});
			return { rows: [] };
		}
		if(sql.startsWith("SELECT * FROM casino_block_bets WHERE id = $1")) {
			const row = this.bets.get(String(params[0]));
			return { rows: row ? [ row ] : [] };
		}
		if(sql.startsWith("UPDATE casino_block_bets SET")) {
			const row = this.bets.get(String(params[0]));
			Object.assign(row, {
				user_id: String(params[1]),
				game: params[2],
				guess: params[3],
				selection: params[4],
				target_height: Number(params[5]),
				stake: String(params[6]),
				payout: String(params[7]),
				fee_reserve: params[8],
				won: params[9],
				status: String(params[10]),
				stake_tx_hash: params[11],
				payout_tx_hash: params[12],
				block_hash: params[13],
				failure_stage: params[14],
				failure_message: params[15],
				resolution: params[16],
				resolution_proof: params[17],
				resolved_by: params[18],
				resolved_at: params[19],
				settled_at: params[20],
				updated_at: params[21]
			});
			return { rows: [] };
		}
		if(sql.startsWith("SELECT * FROM casino_block_bets WHERE target_height = $1 AND user_id = $2")) {
			const [ height, userId ] = params;
			const rows = Array.from(this.bets.values()).filter(row => row.target_height === Number(height) && row.user_id === String(userId));
			rows.sort((a, b) => a.created_at - b.created_at);
			return { rows: rows.slice(0, 1) };
		}
		if(sql.startsWith("SELECT * FROM casino_block_bets WHERE target_height = $1 ORDER BY created_at")) {
			const height = Number(params[0]);
			const rows = Array.from(this.bets.values()).filter(row => row.target_height === height);
			rows.sort((a, b) => a.created_at - b.created_at);
			return { rows };
		}
		if(sql.startsWith("SELECT * FROM casino_block_bets WHERE status = ANY")) {
			const statuses = params[0];
			const rows = Array.from(this.bets.values()).filter(row => statuses.includes(row.status));
			rows.sort((a, b) => a.created_at - b.created_at);
			return { rows };
		}
		if(sql.startsWith("SELECT * FROM casino_block_bets WHERE status = $1")) {
			const rows = Array.from(this.bets.values()).filter(row => row.status === String(params[0]));
			rows.sort((a, b) => b.created_at - a.created_at);
			return { rows };
		}
		if(sql.startsWith("SELECT payout, fee_reserve FROM casino_block_bets WHERE status = ANY")) {
			const statuses = params[0];
			const rows = Array.from(this.bets.values())
				.filter(row => statuses.includes(row.status))
				.map(row => ({ payout: row.payout, fee_reserve: row.fee_reserve }));
			return { rows };
		}
		if(sql.startsWith("INSERT INTO casino_blocks")) {
			const [ height, hash, status, recordedAt, settledAt, announcedAt ] = params;
			this.blocks.set(Number(height), {
				height: Number(height),
				hash,
				status,
				recorded_at: recordedAt,
				settled_at: settledAt,
				announced_at: announcedAt
			});
			return { rows: [] };
		}
		if(sql.startsWith("SELECT * FROM casino_blocks WHERE height = $1")) {
			const row = this.blocks.get(Number(params[0]));
			return { rows: row ? [ row ] : [] };
		}
		if(sql.startsWith("UPDATE casino_blocks SET")) {
			const [ height, hash, status, recordedAt, settledAt, announcedAt ] = params;
			this.blocks.set(Number(height), {
				height: Number(height),
				hash,
				status,
				recorded_at: recordedAt,
				settled_at: settledAt,
				announced_at: announcedAt
			});
			return { rows: [] };
		}
		if(sql.startsWith("SELECT * FROM casino_blocks WHERE status = $1 AND announced_at IS NULL")) {
			const rows = Array.from(this.blocks.values()).filter(row => row.status === String(params[0]) && !row.announced_at);
			rows.sort((a, b) => a.height - b.height);
			return { rows };
		}
		if(sql.startsWith("SELECT MAX(height) AS max_height FROM casino_rounds")) {
			const heights = Array.from(this.rounds.keys());
			return { rows: [ { max_height: heights.length ? Math.max(...heights) : null } ] };
		}
		if(sql.startsWith("SELECT MAX(target_height) AS max_height FROM casino_block_bets")) {
			const heights = Array.from(this.bets.values()).map(row => row.target_height);
			return { rows: [ { max_height: heights.length ? Math.max(...heights) : null } ] };
		}
		if(sql.startsWith("SELECT MAX(height) AS max_height FROM casino_blocks")) {
			const heights = Array.from(this.blocks.keys());
			return { rows: [ { max_height: heights.length ? Math.max(...heights) : null } ] };
		}
		if(sql.startsWith("SELECT * FROM casino_rounds WHERE height = $1")) {
			const row = this.rounds.get(Number(params[0]));
			return { rows: row ? [ row ] : [] };
		}
		if(sql.startsWith("INSERT INTO casino_rounds(height, status, announced_at)")) {
			const [ height, status, announcedAt ] = params;
			this.rounds.set(Number(height), { height: Number(height), status, announced_at: announcedAt });
			return { rows: [] };
		}
		throw new Error("Unsupported SQL in FakeBlockDatabase: " + sql);
	}
}

test("postgres block store persists bets and block/round lifecycle", async () => {
	const database = new FakeBlockDatabase();
	const store = new CasinoBlockPostgresStore(database);

	await store.createBet({
		id: "bet-1",
		userId: "user-1",
		guess: "cdef",
		targetHeight: 10,
		stake: "100",
		payout: "200",
		feeReserve: "10",
		status: "open",
		createdAt: 1
	});
	await store.updateBet("bet-1", { status: "settled", won: true, blockHash: "abcd" });
	const saved = await store.getBet("bet-1");
	assert.equal(saved.status, "settled");
	assert.equal(saved.won, true);
	assert.equal(saved.blockHash, "abcd");

	assert.equal((await store.getRoundBets(10)).length, 1);
	assert.equal((await store.getUserRoundBet(10, "user-1")).id, "bet-1");
	assert.equal((await store.getSettledBets()).length, 1);
	assert.equal(await store.getLiability(), 0n);

	await store.recordBlock(10, "hash-10");
	await store.updateBlock(10, { status: "settled" });
	assert.equal((await store.getUnannouncedSettledBlocks()).length, 1);
	await store.markBlockAnnounced(10);
	assert.equal((await store.getUnannouncedSettledBlocks()).length, 0);

	await store.markRoundAnnouncing(11);
	await store.markRoundAnnounced(11);
	assert.equal((await store.getRound(11)).status, "announced");
	assert.equal(await store.getLastAnnouncedRound(), 11);
});
