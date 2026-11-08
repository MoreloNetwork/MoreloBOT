import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

function formatTimestamp(date = new Date()) {
    const pad = value => String(value).padStart(2, "0");
    return date.getUTCFullYear()
        + pad(date.getUTCMonth() + 1)
        + pad(date.getUTCDate())
        + "-"
        + pad(date.getUTCHours())
        + pad(date.getUTCMinutes())
        + pad(date.getUTCSeconds());
}

function parseConnection(connectionString) {
    const parsed = new URL(connectionString);
    return {
        host: parsed.hostname || "localhost",
        port: parsed.port || "5432",
        user: decodeURIComponent(parsed.username || "postgres"),
        password: decodeURIComponent(parsed.password || ""),
        database: decodeURIComponent(parsed.pathname.replace(/^\//u, "") || "postgres")
    };
}

async function pruneOldBackups(backupDir, retentionDays, logger) {
    if(!Number.isFinite(retentionDays) || retentionDays <= 0) {
        return;
    }
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const entries = await fs.readdir(backupDir, { withFileTypes: true }).catch(() => []);
    for(const entry of entries) {
        if(!entry.isFile() || !entry.name.startsWith("casino-postgres-") || !entry.name.endsWith(".sql")) {
            continue;
        }
        const fullPath = path.join(backupDir, entry.name);
        const stat = await fs.stat(fullPath).catch(() => undefined);
        if(!stat || stat.mtimeMs >= cutoff) {
            continue;
        }
        await fs.rm(fullPath, { force: true }).catch(ex => {
            logger?.warn?.("PostgreSQL backup prune failed (%s): %s", fullPath, ex.message);
        });
    }
}

export async function runPostgresBackup({ connectionString, backupDir, pgDumpPath = "pg_dump", retentionDays = 14, logger }) {
    if(typeof connectionString !== "string" || !connectionString.trim()) {
        throw new Error("PostgreSQL backup requires a connection string.");
    }
    const connection = parseConnection(connectionString.trim());
    await fs.mkdir(backupDir, { recursive: true });
    const filePath = path.join(backupDir, "casino-postgres-" + formatTimestamp() + ".sql");
    const args = [
        "--format=plain",
        "--encoding=UTF8",
        "--no-owner",
        "--no-privileges",
        "--file", filePath,
        "--host", connection.host,
        "--port", connection.port,
        "--username", connection.user,
        connection.database
    ];

    await new Promise((resolve, reject) => {
        const env = { ...process.env };
        if(connection.password) {
            env.PGPASSWORD = connection.password;
        }
        const child = spawn(pgDumpPath, args, {
            env,
            stdio: [ "ignore", "ignore", "pipe" ]
        });
        let errorOutput = "";
        child.stderr.on("data", chunk => {
            errorOutput += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", code => {
            if(code === 0) {
                resolve();
                return;
            }
            reject(new Error("pg_dump exited with code " + code + (errorOutput ? ": " + errorOutput.trim() : "")));
        });
    });

    await pruneOldBackups(backupDir, Number(retentionDays), logger);
    logger?.log?.("PostgreSQL backup created: %s", filePath);
    return filePath;
}

export function startPostgresBackupScheduler({
    enabled = true,
    connectionString,
    backupDir,
    intervalMs = 24 * 60 * 60 * 1000,
    retentionDays = 14,
    pgDumpPath = "pg_dump",
    logger
}) {
    if(!enabled) {
        return { stop() {} };
    }
    if(typeof connectionString !== "string" || !connectionString.trim()) {
        logger?.warn?.("PostgreSQL backup disabled: missing connection string.");
        return { stop() {} };
    }
    let running = false;
    const run = async () => {
        if(running) {
            return;
        }
        running = true;
        try {
            await runPostgresBackup({ connectionString, backupDir, pgDumpPath, retentionDays, logger });
        } catch(ex) {
            logger?.err?.("PostgreSQL backup failed:", ex);
        } finally {
            running = false;
        }
    };

    void run();
    const timer = setInterval(() => {
        void run();
    }, Math.max(60_000, Number(intervalMs) || 24 * 60 * 60 * 1000));

    return {
        stop() {
            clearInterval(timer);
        }
    };
}