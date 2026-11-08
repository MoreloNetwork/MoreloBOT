CREATE TABLE IF NOT EXISTS casino_wagers (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	game TEXT NOT NULL,
	selection TEXT NOT NULL,
	stake TEXT NOT NULL,
	payout TEXT NOT NULL,
	outcome JSONB NOT NULL,
	won BOOLEAN NOT NULL,
	status TEXT NOT NULL,
	stake_tx_hash TEXT,
	payout_tx_hash TEXT,
	failure_stage TEXT,
	failure_message TEXT,
	resolution TEXT,
	resolution_proof TEXT,
	resolved_by TEXT,
	resolved_at BIGINT,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS casino_wagers_user_created_idx ON casino_wagers (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS casino_wagers_status_idx ON casino_wagers (status);
CREATE INDEX IF NOT EXISTS casino_wagers_created_idx ON casino_wagers (created_at DESC);

CREATE TABLE IF NOT EXISTS casino_wager_transfers (
	id BIGSERIAL PRIMARY KEY,
	wager_id TEXT NOT NULL REFERENCES casino_wagers(id) ON DELETE CASCADE,
	transfer_type TEXT NOT NULL,
	status TEXT NOT NULL,
	account_index BIGINT,
	address TEXT,
	amount TEXT,
	tx_hash TEXT,
	error_message TEXT,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS casino_wager_transfers_wager_idx ON casino_wager_transfers (wager_id, created_at);
CREATE INDEX IF NOT EXISTS casino_wager_transfers_status_idx ON casino_wager_transfers (status);

CREATE TABLE IF NOT EXISTS casino_wager_audit_log (
	id BIGSERIAL PRIMARY KEY,
	wager_id TEXT NOT NULL REFERENCES casino_wagers(id) ON DELETE CASCADE,
	admin_user_id TEXT NOT NULL,
	action TEXT NOT NULL,
	proof TEXT,
	payload JSONB,
	created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS casino_wager_audit_log_wager_idx ON casino_wager_audit_log (wager_id, created_at);
