import assert from "node:assert/strict";
import test from "node:test";
import CasinoSandboxPostgresStore from "../casino/casino-sandbox-postgres-store.js";

class FakeSandboxDatabase {
	constructor() {
		this.balances = new Map();
		this.bets = new Map();
		this.blackjack = new Map();
	}

	async query(sql, params = []) {
		if(sql.startsWith("SELECT balance FROM casino_sandbox_balances")) {
			const userId = params[0];
			return { rows: this.balances.has(userId) ? [ { balance: this.balances.get(userId) } ] : [] };
		}
		if(sql.includes("ON CONFLICT(user_id) DO UPDATE SET balance = EXCLUDED.balance")) {
			const [ userId, balance ] = params;
			this.balances.set(userId, String(balance));
			return { rows: [] };
		}
		if(sql.startsWith("INSERT INTO casino_sandbox_balances")) {
			const [ userId, balance ] = params;
			if(!this.balances.has(userId)) this.balances.set(userId, String(balance));
			return { rows: [] };
		}
		if(sql.startsWith("INSERT INTO casino_sandbox_bets")) {
			const [ id, userId, game, selection, outcome, guess, targetHeight, stake, payout, feeReserve, won, status, blockHash, failureStage, failureMessage, resolution, resolutionProof, resolvedBy, resolvedAt, createdAt, updatedAt ] = params;
			this.bets.set(String(id), {
				id: String(id),
				user_id: String(userId),
				game,
				selection,
				outcome: outcome ? JSON.parse(outcome) : null,
				guess,
				target_height: targetHeight,
				stake: String(stake),
				payout: String(payout),
				fee_reserve: feeReserve,
				won,
				status: String(status),
				block_hash: blockHash,
				failure_stage: failureStage,
				failure_message: failureMessage,
				resolution,
				resolution_proof: resolutionProof,
				resolved_by: resolvedBy,
				resolved_at: resolvedAt,
				created_at: createdAt,
				updated_at: updatedAt
			});
			return { rows: [] };
		}
		if(sql.startsWith("SELECT * FROM casino_sandbox_bets WHERE id = $1")) {
			const row = this.bets.get(String(params[0]));
			return { rows: row ? [ row ] : [] };
		}
		if(sql.startsWith("UPDATE casino_sandbox_bets SET")) {
			const id = String(params[0]);
			const row = this.bets.get(id);
			if(!row) return { rows: [] };
			Object.assign(row, {
				user_id: String(params[1]),
				game: params[2],
				selection: params[3],
				outcome: params[4] ? JSON.parse(params[4]) : null,
				guess: params[5],
				target_height: params[6],
				stake: String(params[7]),
				payout: String(params[8]),
				fee_reserve: params[9],
				won: params[10],
				status: String(params[11]),
				block_hash: params[12],
				failure_stage: params[13],
				failure_message: params[14],
				resolution: params[15],
				resolution_proof: params[16],
				resolved_by: params[17],
				resolved_at: params[18],
				updated_at: params[19]
			});
			return { rows: [] };
		}
		if(sql.startsWith("SELECT * FROM casino_sandbox_bets WHERE target_height = $1 AND user_id = $2")) {
			const [ height, userId ] = params;
			const rows = Array.from(this.bets.values()).filter(row => row.target_height === Number(height) && row.user_id === String(userId));
			rows.sort((a, b) => a.created_at - b.created_at);
			return { rows: rows.slice(0, 1) };
		}
		if(sql.startsWith("SELECT * FROM casino_sandbox_bets WHERE target_height = $1 ORDER BY created_at")) {
			const height = Number(params[0]);
			const rows = Array.from(this.bets.values()).filter(row => row.target_height === height);
			rows.sort((a, b) => a.created_at - b.created_at);
			return { rows };
		}
		if(sql.startsWith("SELECT * FROM casino_sandbox_bets WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2")) {
			const [ userId, limit ] = params;
			const rows = Array.from(this.bets.values()).filter(row => row.user_id === String(userId));
			rows.sort((a, b) => b.created_at - a.created_at);
			return { rows: rows.slice(0, Number(limit)) };
		}
		if(sql.startsWith("SELECT * FROM casino_sandbox_bets WHERE status = ANY")) {
			const statuses = params[0];
			const rows = Array.from(this.bets.values()).filter(row => statuses.includes(row.status));
			rows.sort((a, b) => a.created_at - b.created_at);
			return { rows };
		}
		if(sql.startsWith("SELECT hand FROM casino_sandbox_blackjack WHERE user_id = $1")) {
			const key = String(params[0]);
			return { rows: this.blackjack.has(key) ? [ { hand: this.blackjack.get(key) } ] : [] };
		}
		if(sql.startsWith("INSERT INTO casino_sandbox_blackjack")) {
			const [ userId, hand ] = params;
			this.blackjack.set(String(userId), JSON.parse(hand));
			return { rows: [] };
		}
		if(sql.startsWith("DELETE FROM casino_sandbox_blackjack WHERE user_id = $1")) {
			this.blackjack.delete(String(params[0]));
			return { rows: [] };
		}
		throw new Error("Unsupported SQL in FakeSandboxDatabase: " + sql);
	}
}

test("postgres sandbox store keeps balances, bets and blackjack state", async () => {
	const database = new FakeSandboxDatabase();
	const store = new CasinoSandboxPostgresStore(database, "1000");

	assert.equal(await store.getBalance("user-1"), 1000n);
	await store.setBalance("user-1", 2500n);
	assert.equal(await store.getBalance("user-1"), 2500n);

	await store.createBet({
		id: "bet-1",
		userId: "user-1",
		game: "coinflip",
		selection: "heads",
		stake: "100",
		payout: "200",
		status: "stake_submitting",
		createdAt: 10
	});
	await store.updateBet("bet-1", { status: "needs_review", failureStage: "stake" });
	const bet = await store.getBet("bet-1");
	assert.equal(bet.status, "needs_review");
	assert.equal(bet.failureStage, "stake");

	assert.equal((await store.getOpenBets()).length, 1);
	assert.equal((await store.getHistory("user-1", 10)).length, 1);

	await store.setBlackjack("user-1", { stake: "100", player: [ "A" ], dealer: [ "K" ] });
	assert.deepEqual(await store.getBlackjack("user-1"), { stake: "100", player: [ "A" ], dealer: [ "K" ] });
	await store.setBlackjack("user-1", undefined);
	assert.equal(await store.getBlackjack("user-1"), undefined);
});
