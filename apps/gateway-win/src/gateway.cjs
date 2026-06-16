const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { executeCommand } = require("./commands/router.cjs");

const VERSION = "0.4.3";
const home = process.env.PROGRAMDATA
  ? path.join(process.env.PROGRAMDATA, "CondoAccessGateway")
  : path.join(os.homedir(), ".condo-access-gateway");
const configPath = process.env.CONDO_GATEWAY_CONFIG || path.join(home, "config.json");
const logPath = path.join(home, "gateway.log");

fs.mkdirSync(home, { recursive: true });

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  fs.appendFileSync(logPath, `${line}\n`, "utf8");
}

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuracao nao encontrada em ${configPath}. Execute o instalador novamente.`);
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
  if (!config.apiUrl || !config.tenantId || !config.activationCode) {
    throw new Error("Configuracao incompleta. Informe apiUrl, tenantId e activationCode.");
  }
  return {
    pollMs: 3000,
    gatewayId: os.hostname(),
    ...config,
    apiUrl: String(config.apiUrl).replace(/\/+$/, "")
  };
}

const config = loadConfig();

async function cloud(pathName, options = {}) {
  const response = await fetch(`${config.apiUrl}${pathName}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-gateway-token": config.activationCode,
      "x-tenant-id": config.tenantId,
      "x-gateway-id": config.gatewayId,
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(25000)
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }
  if (!response.ok) throw new Error(body.message || `API respondeu ${response.status}`);
  return body;
}

async function cycle() {
  await cloud("/gateways/heartbeat", {
    method: "POST",
    body: JSON.stringify({ hostname: os.hostname(), platform: os.platform(), version: VERSION })
  });
  const commands = await cloud("/gateways/commands");
  for (const command of commands.items || []) {
    try {
      const result = await executeCommand(command);
      await cloud(`/gateways/commands/${encodeURIComponent(command.id)}/result`, {
        method: "POST",
        body: JSON.stringify({ ok: result.ok !== false, ...result })
      });
      log(`Comando ${command.id} concluido: ${result.message || "OK"}`);
    } catch (error) {
      await cloud(`/gateways/commands/${encodeURIComponent(command.id)}/result`, {
        method: "POST",
        body: JSON.stringify({ ok: false, message: error.message })
      }).catch(() => undefined);
      log(`Comando ${command.id} falhou: ${error.message}`);
    }
  }
}

let cycling = false;
async function guardedCycle() {
  if (cycling) return;
  cycling = true;
  try {
    await cycle();
  } finally {
    cycling = false;
  }
}

http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      tenantId: config.tenantId,
      gatewayId: config.gatewayId,
      version: VERSION
    }));
    return;
  }
  response.writeHead(404);
  response.end();
}).listen(Number(config.localPort || 4040), "127.0.0.1");

log(`Gateway iniciado tenant=${config.tenantId} gateway=${config.gatewayId} version=${VERSION}`);
guardedCycle().catch((error) => log(`Falha inicial: ${error.message}`));
setInterval(
  () => guardedCycle().catch((error) => log(`Falha de comunicacao: ${error.message}`)),
  Number(config.pollMs || 3000)
);
