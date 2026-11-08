import fs from "node:fs/promises";
import path from "node:path";

async function readJsonIfExists(filePath) {
	try {
		const content = await fs.readFile(filePath, "utf8");
		return JSON.parse(content);
	} catch(ex) {
		if(ex?.code === "ENOENT") {
			return undefined;
		}
		throw ex;
	}
}

async function isTableEmpty(database, tableName) {
	const result = await database.query(`SELECT COUNT(*)::bigint AS count FROM ${tableName}`);
	return BigInt(result.rows[0].count || 0) === 0n;
}

function toNullableNumber(value) {
	return value == null ? null : Number(value);
}

async function migrateCasinoWagers(database, filePath, logger) {
	if(!(await isTableEmpty(database, "casino_wagers"))) return;
	const saved = await readJsonIfExists(filePath);
	const wagers = Array.isArray(saved?.wagers) ? saved.wagers : [];
	if(!wagers.length) return;
	for(const wager of wagers) {
		const now = Number(wager.createdAt || Date.now());
		await database.query(
			`INSERT INTO casino_wagers (
				id, user_id, game, selection, stake, payout, outcome, won, status,
				stake_tx_hash, payout_tx_hash, failure_stage, failure_message,
				resolution, resolution_proof, resolved_by, resolved_at, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
				$10, $11, $12, $13,
				$14, $15, $16, $17, $18, $19
			)
			ON CONFLICT (id) DO NOTHING`,
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
	}
	logger?.log?.("Migrated casino wagers from JSON (%s rows).", wagers.length);
}

async function migrateBlockStore(database, filePath, options, logger) {
	const betsTable = options.sandbox ? "casino_sandbox_block_bets" : "casino_block_bets";
	const blocksTable = options.sandbox ? "casino_sandbox_blocks" : "casino_blocks";
	const roundsTable = options.sandbox ? "casino_sandbox_rounds" : "casino_rounds";
	if(!(await isTableEmpty(database, betsTable)) || !(await isTableEmpty(database, blocksTable)) || !(await isTableEmpty(database, roundsTable))) {
		return;
	}
	const saved = await readJsonIfExists(filePath);
	const bets = Array.isArray(saved?.bets) ? saved.bets : [];
	const blocks = Array.isArray(saved?.blocks) ? saved.blocks : [];
	const rounds = Array.isArray(saved?.rounds) ? saved.rounds : [];

	for(const bet of bets) {
		const now = Number(bet.createdAt || Date.now());
		await database.query(
			`INSERT INTO ${betsTable} (
				id, user_id, game, guess, selection, target_height, stake, payout, fee_reserve,
				won, status, stake_tx_hash, payout_tx_hash, block_hash, failure_stage, failure_message,
				resolution, resolution_proof, resolved_by, resolved_at, settled_at, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9,
				$10, $11, $12, $13, $14, $15, $16,
				$17, $18, $19, $20, $21, $22, $23
			)
			ON CONFLICT (id) DO NOTHING`,
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
				toNullableNumber(bet.resolvedAt),
				toNullableNumber(bet.settledAt),
				now,
				now
			]
		);
	}

	for(const block of blocks) {
		await database.query(
			`INSERT INTO ${blocksTable}(height, hash, status, recorded_at, settled_at, announced_at)
			 VALUES($1, $2, $3, $4, $5, $6)
			 ON CONFLICT(height) DO NOTHING`,
			[
				Number(block.height),
				String(block.hash),
				String(block.status || "settling"),
				toNullableNumber(block.recordedAt),
				toNullableNumber(block.settledAt),
				toNullableNumber(block.announcedAt)
			]
		);
	}

	for(const round of rounds) {
		await database.query(
			`INSERT INTO ${roundsTable}(height, status, announced_at)
			 VALUES($1, $2, $3)
			 ON CONFLICT(height) DO NOTHING`,
			[ Number(round.height), String(round.status || "announced"), toNullableNumber(round.announcedAt) ]
		);
	}

	if(bets.length || blocks.length || rounds.length) {
		logger?.log?.("Migrated %s from JSON (bets: %s, blocks: %s, rounds: %s).", betsTable, bets.length, blocks.length, rounds.length);
	}
}

async function migrateSandboxStore(database, filePath, logger) {
	if(!(await isTableEmpty(database, "casino_sandbox_balances"))
		|| !(await isTableEmpty(database, "casino_sandbox_bets"))
		|| !(await isTableEmpty(database, "casino_sandbox_blackjack"))) {
		return;
	}
	const saved = await readJsonIfExists(filePath);
	const balances = saved?.balances && typeof saved.balances === "object" ? saved.balances : {};
	const bets = Array.isArray(saved?.bets) ? saved.bets : [];
	const blackjack = saved?.blackjack && typeof saved.blackjack === "object" ? saved.blackjack : {};

	for(const [ userId, balance ] of Object.entries(balances)) {
		await database.query(
			"INSERT INTO casino_sandbox_balances(user_id, balance) VALUES($1, $2) ON CONFLICT(user_id) DO NOTHING",
			[ String(userId), String(balance) ]
		);
	}

	for(const bet of bets) {
		const now = Number(bet.createdAt || Date.now());
		await database.query(
			`INSERT INTO casino_sandbox_bets(
				id, user_id, game, selection, outcome, guess, target_height, stake, payout,
				fee_reserve, won, status, block_hash, failure_stage, failure_message, resolution,
				resolution_proof, resolved_by, resolved_at, created_at, updated_at
			) VALUES(
				$1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9,
				$10, $11, $12, $13, $14, $15, $16,
				$17, $18, $19, $20, $21
			)
			ON CONFLICT(id) DO NOTHING`,
			[
				String(bet.id),
				String(bet.userId),
				bet.game ?? null,
				bet.selection ?? null,
				bet.outcome != null ? JSON.stringify(bet.outcome) : null,
				bet.guess ?? null,
				bet.targetHeight != null ? Number(bet.targetHeight) : null,
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
				toNullableNumber(bet.resolvedAt),
				now,
				now
			]
		);
	}

	for(const [ userId, hand ] of Object.entries(blackjack)) {
		await database.query(
			"INSERT INTO casino_sandbox_blackjack(user_id, hand, updated_at) VALUES($1, $2::jsonb, $3) ON CONFLICT(user_id) DO NOTHING",
			[ String(userId), JSON.stringify(hand), Date.now() ]
		);
	}

	if(Object.keys(balances).length || bets.length || Object.keys(blackjack).length) {
		logger?.log?.(
			"Migrated sandbox data from JSON (balances: %s, bets: %s, blackjack: %s).",
			Object.keys(balances).length,
			bets.length,
			Object.keys(blackjack).length
		);
	}
}

async function migrateWalletNotifications(database, filePath, logger) {
	if(!(await isTableEmpty(database, "wallet_notification_state"))) return;
	const saved = await readJsonIfExists(filePath);
	if(!saved || typeof saved !== "object") return;
	await database.query(
		"INSERT INTO wallet_notification_state(id, state, updated_at) VALUES(1, $1::jsonb, $2) ON CONFLICT(id) DO NOTHING",
		[ JSON.stringify(saved), Date.now() ]
	);
	logger?.log?.("Migrated wallet notifications state from JSON.");
}

async function migrateGuideIds(database, filePath, logger) {
	if(!(await isTableEmpty(database, "casino_guide_message_ids"))) return;
	const saved = await readJsonIfExists(filePath);
	if(!saved || typeof saved !== "object" || Array.isArray(saved)) return;
	const entries = Object.entries(saved);
	for(const [ key, messageId ] of entries) {
		await database.query(
			"INSERT INTO casino_guide_message_ids(key, message_id, updated_at) VALUES($1, $2, $3) ON CONFLICT(key) DO NOTHING",
			[ String(key), String(messageId), Date.now() ]
		);
	}
	if(entries.length) {
		logger?.log?.("Migrated casino guide IDs from JSON (%s rows).", entries.length);
	}
}

export async function migrateJsonStoresToPostgres(database, config, logger) {
	const walletsRoot = config.walletsPath || "wallets";
	await migrateCasinoWagers(database, config.casinoWagersPath || "wallets/casino-wagers.json", logger);
	await migrateBlockStore(database, config.casinoBlockBetsPath || "wallets/casino-block-bets.json", { sandbox: false }, logger);
	await migrateSandboxStore(database, config.casinoSandboxPath || "wallets/casino-sandbox.json", logger);
	await migrateBlockStore(database, config.casinoSandboxBlockBetsPath || "wallets/casino-sandbox-block-bets.json", { sandbox: true }, logger);
	await migrateWalletNotifications(database, config.walletNotificationsPath || "wallets/notifications.json", logger);
	await migrateGuideIds(database, path.join(walletsRoot, "casino-guide-message-ids.json"), logger);
}
