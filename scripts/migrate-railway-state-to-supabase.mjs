import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const envPath = path.resolve("apps", "api", ".env.local");

function readLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([^#][^=]+)=(.*)$/))
      .filter(Boolean)
      .map((match) => [match[1].trim(), match[2].trim()])
  );
}

function sslModeFromConnectionString(connectionString) {
  try {
    return new URL(connectionString).searchParams.get("sslmode")?.toLowerCase() || "";
  } catch {
    return "";
  }
}

function normalizePostgresConnectionString(connectionString) {
  try {
    const parsed = new URL(connectionString);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("uselibpqcompat");
    return parsed.toString();
  } catch {
    return connectionString;
  }
}

function createPool(connectionString, fallbackSslMode = "") {
  const sslMode = fallbackSslMode || sslModeFromConnectionString(connectionString);
  return new pg.Pool({
    connectionString: normalizePostgresConnectionString(connectionString),
    ssl: sslMode === "require" ? { rejectUnauthorized: false } : undefined
  });
}

function stateSummary(state = {}) {
  return {
    extraTenants: Array.isArray(state.extraTenants) ? state.extraTenants.length : 0,
    units: Array.isArray(state.units) ? state.units.length : 0,
    residents: Array.isArray(state.residents) ? state.residents.length : 0,
    devices: Array.isArray(state.devices) ? state.devices.length : 0,
    cameras: Array.isArray(state.cameras) ? state.cameras.length : 0,
    credentials: Array.isArray(state.credentials) ? state.credentials.length : 0,
    accessLogs: Array.isArray(state.accessLogs) ? state.accessLogs.length : 0
  };
}

const localEnv = readLocalEnv(envPath);
const sourceDatabaseUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || "";
const targetDatabaseUrl = localEnv.DATABASE_URL || "";
const targetSslMode = localEnv.PGSSLMODE || sslModeFromConnectionString(targetDatabaseUrl);
const force = process.argv.includes("--force");

if (!sourceDatabaseUrl) {
  console.error(JSON.stringify({ ok: false, message: "DATABASE_URL antigo nao foi injetado pelo Railway" }));
  process.exit(1);
}

if (!targetDatabaseUrl) {
  console.error(JSON.stringify({ ok: false, message: "DATABASE_URL do Supabase nao encontrado em apps/api/.env.local" }));
  process.exit(1);
}

const sourcePool = createPool(sourceDatabaseUrl, process.env.PGSSLMODE || "");
const targetPool = createPool(targetDatabaseUrl, targetSslMode);

try {
  await targetPool.query(`
    create table if not exists condo_access_state (
      id text primary key,
      state jsonb not null,
      reason text not null default 'update',
      updated_at timestamptz not null default now()
    )
  `);

  const sourceResult = await sourcePool.query(
    "select state, reason, updated_at from condo_access_state where id = 'main'"
  );
  const sourceRow = sourceResult.rows[0];

  if (!sourceRow?.state) {
    console.error(JSON.stringify({ ok: false, message: "Estado main nao encontrado no Postgres antigo" }));
    process.exit(1);
  }

  const targetResult = await targetPool.query(
    "select updated_at from condo_access_state where id = 'main'"
  );
  const existingTarget = targetResult.rows[0];

  if (existingTarget && !force) {
    console.error(JSON.stringify({
      ok: false,
      message: "Supabase ja possui estado main; rode novamente com --force para sobrescrever",
      targetUpdatedAt: existingTarget.updated_at
    }));
    process.exit(1);
  }

  const migrationReason = "migrated-from-railway-postgres";
  await targetPool.query(
    `
      insert into condo_access_state (id, state, reason, updated_at)
      values ('main', $1::jsonb, $2, now())
      on conflict (id) do update set
        state = excluded.state,
        reason = excluded.reason,
        updated_at = excluded.updated_at
    `,
    [JSON.stringify({ ...sourceRow.state, reason: migrationReason }), migrationReason]
  );

  console.log(JSON.stringify({
    ok: true,
    migrated: true,
    sourceUpdatedAt: sourceRow.updated_at,
    summary: stateSummary(sourceRow.state)
  }));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code,
    message: error instanceof Error ? error.message : "Falha ao migrar estado"
  }));
  process.exitCode = 1;
} finally {
  await sourcePool.end();
  await targetPool.end();
}
