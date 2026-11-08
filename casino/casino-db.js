import fs from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

function normalize(value) {
	return typeof value === "string" ? value.trim() : "";
}

export function hasCasinoPostgres(config) {
	return Boolean(normalize(config?.casinoPostgresUrl));
}

async function ensureMigrationsTable(client) {
	await client.query(`
		CREATE TABLE IF NOT EXISTS casino_schema_migrations (
			id BIGSERIAL PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`);
}

function migrationFileName(entry) {
	return entry.name;
}

async function loadMigrationFiles(migrationsDir) {
	const entries = await fs.readdir(migrationsDir, { withFileTypes: true }).catch(ex => {
		if(ex.code === "ENOENT") {
			return [];
		}
		throw ex;
	});
	return entries
		.filter(entry => entry.isFile() && entry.name.endsWith(".sql"))
		.map(entry => ({ name: migrationFileName(entry), filePath: path.join(migrationsDir, entry.name) }))
		.sort((left, right) => left.name.localeCompare(right.name));
}

export default class CasinoDatabase {
	constructor({ connectionString, migrationsDir = path.join(process.cwd(), "migrations", "casino") }) {
		this.connectionString = normalize(connectionString);
		this.migrationsDir = migrationsDir;
		this.pool = new Pool({ connectionString: this.connectionString });
	}

	async close() {
		await this.pool.end();
	}

	async query(text, params) {
		return this.pool.query(text, params);
	}

	async withClient(action) {
		const client = await this.pool.connect();
		try {
			return await action(client);
		} finally {
			client.release();
		}
	}

	async runMigrations(logger) {
		const migrations = await loadMigrationFiles(this.migrationsDir);
		if(!migrations.length) {
			return 0;
		}

		return this.withClient(async client => {
			await client.query("BEGIN");
			try {
				await ensureMigrationsTable(client);
				const appliedResult = await client.query("SELECT name FROM casino_schema_migrations");
				const applied = new Set(appliedResult.rows.map(row => row.name));
				let appliedCount = 0;
				for(const migration of migrations) {
					if(applied.has(migration.name)) {
						continue;
					}
					const sql = await fs.readFile(migration.filePath, "utf8");
					await client.query(sql);
					await client.query("INSERT INTO casino_schema_migrations(name) VALUES ($1)", [ migration.name ]);
					appliedCount += 1;
					logger?.log?.("Casino migration applied: %s", migration.name);
				}
				await client.query("COMMIT");
				return appliedCount;
			} catch(ex) {
				await client.query("ROLLBACK");
				throw ex;
			}
		});
	}
}
