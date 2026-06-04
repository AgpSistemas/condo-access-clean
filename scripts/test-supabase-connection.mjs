import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const envPath = path.resolve("apps", "api", ".env.local");

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([^#][^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

if (!process.env.DATABASE_URL) {
  console.error(JSON.stringify({ ok: false, message: "DATABASE_URL nao definido" }));
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: normalizePostgresConnectionString(process.env.DATABASE_URL),
  ssl: { rejectUnauthorized: false }
});

try {
  const databaseResult = await pool.query(
    "select current_database() as database, current_user as user, now() as now"
  );

  await pool.query(`
    create table if not exists condo_access_state (
      id text primary key,
      state jsonb not null,
      reason text not null default 'update',
      updated_at timestamptz not null default now()
    )
  `);

  const tableResult = await pool.query("select to_regclass('public.condo_access_state') as table_name");
  const stateResult = await pool.query("select state, updated_at from condo_access_state where id = 'main'");
  const state = stateResult.rows[0]?.state || {};

  console.log(JSON.stringify({
    ok: true,
    database: databaseResult.rows[0].database,
    user: databaseResult.rows[0].user,
    table: tableResult.rows[0].table_name,
    updatedAt: stateResult.rows[0]?.updated_at || null,
    summary: {
      extraTenants: Array.isArray(state.extraTenants) ? state.extraTenants.length : 0,
      units: Array.isArray(state.units) ? state.units.length : 0,
      residents: Array.isArray(state.residents) ? state.residents.length : 0,
      devices: Array.isArray(state.devices) ? state.devices.length : 0,
      cameras: Array.isArray(state.cameras) ? state.cameras.length : 0,
      credentials: Array.isArray(state.credentials) ? state.credentials.length : 0,
      accessLogs: Array.isArray(state.accessLogs) ? state.accessLogs.length : 0
    }
  }));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code,
    message: error instanceof Error ? error.message : "Falha ao conectar no Supabase"
  }));
  process.exitCode = 1;
} finally {
  await pool.end();
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
