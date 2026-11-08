CREATE TABLE IF NOT EXISTS casino_block_bets (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	game TEXT,
	guess TEXT,
	selection TEXT,
	target_height BIGINT NOT NULL,
	stake TEXT NOT NULL,
	payout TEXT NOT NULL,
	fee_reserve TEXT,
	won BOOLEAN,
	status TEXT NOT NULL,
	stake_tx_hash TEXT,
	payout_tx_hash TEXT,
	block_hash TEXT,
	failure_stage TEXT,
	failure_message TEXT,
	resolution TEXT,
	resolution_proof TEXT,
	resolved_by TEXT,
	resolved_at BIGINT,
	settled_at BIGINT,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS casino_block_bets_target_height_idx ON casino_block_bets (target_height, created_at);
CREATE INDEX IF NOT EXISTS casino_block_bets_status_idx ON casino_block_bets (status);
CREATE INDEX IF NOT EXISTS casino_block_bets_user_idx ON casino_block_bets (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS casino_blocks (
	height BIGINT PRIMARY KEY,
	hash TEXT NOT NULL,
	status TEXT NOT NULL,
	recorded_at BIGINT,
	settled_at BIGINT,
	announced_at BIGINT
);

CREATE INDEX IF NOT EXISTS casino_blocks_status_idx ON casino_blocks (status, height);

CREATE TABLE IF NOT EXISTS casino_rounds (
	height BIGINT PRIMARY KEY,
	status TEXT NOT NULL,
	announced_at BIGINT
);

CREATE TABLE IF NOT EXISTS casino_sandbox_balances (
	user_id TEXT PRIMARY KEY,
	balance TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS casino_sandbox_bets (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	game TEXT,
	selection TEXT,
	outcome JSONB,
	guess TEXT,
	target_height BIGINT,
	stake TEXT NOT NULL,
	payout TEXT NOT NULL,
	fee_reserve TEXT,
	won BOOLEAN,
	status TEXT NOT NULL,
	block_hash TEXT,
	failure_stage TEXT,
	failure_message TEXT,
	resolution TEXT,
	resolution_proof TEXT,
	resolved_by TEXT,
	resolved_at BIGINT,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS casino_sandbox_bets_user_idx ON casino_sandbox_bets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS casino_sandbox_bets_target_height_idx ON casino_sandbox_bets (target_height, created_at);
CREATE INDEX IF NOT EXISTS casino_sandbox_bets_status_idx ON casino_sandbox_bets (status);

CREATE TABLE IF NOT EXISTS casino_sandbox_blackjack (
	user_id TEXT PRIMARY KEY,
	hand JSONB NOT NULL,
	updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS casino_sandbox_block_bets (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	game TEXT,
	guess TEXT,
	selection TEXT,
	target_height BIGINT NOT NULL,
	stake TEXT NOT NULL,
	payout TEXT NOT NULL,
	fee_reserve TEXT,
	won BOOLEAN,
	status TEXT NOT NULL,
	stake_tx_hash TEXT,
	payout_tx_hash TEXT,
	block_hash TEXT,
	failure_stage TEXT,
	failure_message TEXT,
	resolution TEXT,
	resolution_proof TEXT,
	resolved_by TEXT,
	resolved_at BIGINT,
	settled_at BIGINT,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS casino_sandbox_block_bets_target_height_idx ON casino_sandbox_block_bets (target_height, created_at);
CREATE INDEX IF NOT EXISTS casino_sandbox_block_bets_status_idx ON casino_sandbox_block_bets (status);
CREATE INDEX IF NOT EXISTS casino_sandbox_block_bets_user_idx ON casino_sandbox_block_bets (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS casino_sandbox_blocks (
	height BIGINT PRIMARY KEY,
	hash TEXT NOT NULL,
	status TEXT NOT NULL,
	recorded_at BIGINT,
	settled_at BIGINT,
	announced_at BIGINT
);

CREATE INDEX IF NOT EXISTS casino_sandbox_blocks_status_idx ON casino_sandbox_blocks (status, height);

CREATE TABLE IF NOT EXISTS casino_sandbox_rounds (
	height BIGINT PRIMARY KEY,
	status TEXT NOT NULL,
	announced_at BIGINT
);

CREATE TABLE IF NOT EXISTS wallet_notification_state (
	id SMALLINT PRIMARY KEY DEFAULT 1,
	state JSONB NOT NULL,
	updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS casino_guide_message_ids (
	key TEXT PRIMARY KEY,
	message_id TEXT NOT NULL,
	updated_at BIGINT NOT NULL
);
