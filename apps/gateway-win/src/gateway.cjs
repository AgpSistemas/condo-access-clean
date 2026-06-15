const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

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
    signal: AbortSignal.timeout(20000)
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

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Equipamento respondeu ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

function deviceBaseUrl(device) {
  const address = String(device.apiHost || device.ipAddress || "").replace(/\/+$/, "");
  if (/^https?:\/\//i.test(address)) return new URL(address).origin;
  return `${device.apiProtocol || "http"}://${address}:${Number(device.apiPort || 80)}`;
}

async function digestHeader(url, method, username, password) {
  const probe = await fetch(url, { method, signal: AbortSignal.timeout(8000) });
  const challenge = probe.headers.get("www-authenticate") || "";
  if (!challenge.toLowerCase().includes("digest")) {
    return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
  }
  const params = Object.fromEntries([...challenge.matchAll(/(\w+)="?([^",]+)"?/g)].map((match) => [match[1], match[2]]));
  const parsedUrl = new URL(url);
  const uri = `${parsedUrl.pathname}${parsedUrl.search}`;
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const qop = params.qop?.split(",")[0];
  const md5 = (value) => crypto.createHash("md5").update(value).digest("hex");
  const ha1 = md5(`${username}:${params.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop ? md5(`${ha1}:${params.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${params.nonce}:${ha2}`);
  const parts = [
    `username="${username}"`, `realm="${params.realm}"`, `nonce="${params.nonce}"`,
    `uri="${uri}"`, `response="${response}"`, qop ? `qop=${qop}` : "",
    qop ? `nc=${nc}` : "", qop ? `cnonce="${cnonce}"` : "", params.opaque ? `opaque="${params.opaque}"` : ""
  ].filter(Boolean);
  return { Authorization: `Digest ${parts.join(", ")}` };
}

async function openDoor(command) {
  const device = command.device || {};
  const manufacturer = String(device.manufacturer || "").toLowerCase();
  const relay = Number(command.relay || device.doorRelay || 1);
  const baseUrl = deviceBaseUrl(device);

  if (manufacturer.includes("control")) {
    const login = await postJson(`${baseUrl}/login.fcgi`, {
      login: device.username || "admin",
      password: device.password || "admin"
    });
    const action = device.controlIdAction || device.openDoorAction || "door";
    const parameters = action === "sec_box"
      ? `id=${device.controlIdSecBoxId || 65792 + relay}, reason=3`
      : `door=${relay}`;
    await postJson(`${baseUrl}/execute_actions.fcgi?session=${encodeURIComponent(String(login.session))}`, {
      actions: [{ action, parameters }]
    });
    return { ok: true, message: `Control iD acionado no rele ${relay}` };
  }

  if (manufacturer.includes("hikvision")) {
    const url = `${baseUrl}/ISAPI/AccessControl/RemoteControl/door/${relay}`;
    const headers = await digestHeader(url, "PUT", device.username || "admin", device.password || "");
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/xml", ...headers },
      body: "<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>",
      signal: AbortSignal.timeout(12000)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Hikvision respondeu ${response.status}: ${text.slice(0, 300)}`);
    return { ok: true, message: `Hikvision acionada no rele ${relay}` };
  }

  throw new Error(`Fabricante ${device.manufacturer || "desconhecido"} ainda nao suportado pelo Gateway`);
}

async function deviceHttp(command) {
  const device = command.device || {};
  const request = command.request || {};
  const method = String(request.method || "GET").toUpperCase();
  const targetUrl = `${deviceBaseUrl(device)}${String(request.path || "/")}`;
  const headers = await digestHeader(
    targetUrl,
    method,
    device.username || "admin",
    device.password || ""
  );
  if (request.body !== undefined && request.body !== null) {
    headers["Content-Type"] = request.contentType || "application/json";
  }
  const response = await fetch(targetUrl, {
    method,
    headers,
    body: request.body === undefined || request.body === null ? undefined : request.body,
    signal: AbortSignal.timeout(Number(request.timeoutMs || 12000))
  });
  const contentType = response.headers.get("content-type") || "";
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = request.responseType === "base64" ? "" : buffer.toString("utf8");
  if (!response.ok) {
    throw new Error(`Equipamento respondeu ${response.status}: ${text.slice(0, 300)}`);
  }
  return {
    ok: true,
    status: response.status,
    body: text,
    bodyBase64: request.responseType === "base64" ? buffer.toString("base64") : "",
    contentType,
    message: `Requisicao local concluida (${response.status})`
  };
}

function testDeviceTcp(device, timeoutMs = 8000) {
  const host = String(device.apiHost || device.ipAddress || "").replace(/^https?:\/\//i, "").split(/[/:]/)[0];
  const port = Number(device.apiPort || device.httpPort || 80);
  if (!host || !port) return Promise.resolve({ ok: false, latencyMs: null, message: "IP ou porta nao configurados" });

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({
      ok: true,
      latencyMs: Date.now() - startedAt,
      message: `Conectado a ${host}:${port} pelo Gateway local`
    }));
    socket.once("timeout", () => finish({ ok: false, latencyMs: null, message: `Timeout ao conectar em ${host}:${port}` }));
    socket.once("error", (error) => finish({
      ok: false,
      latencyMs: null,
      message: `Falha ao conectar em ${host}:${port}: ${error.code || error.message}`
    }));
  });
}

async function execute(command) {
  if (command.type === "OPEN_DOOR") return openDoor(command);
  if (command.type === "TEST_DEVICE") return testDeviceTcp(command.device);
  if (command.type === "DEVICE_HTTP") return deviceHttp(command);
  throw new Error(`Comando ${command.type} ainda nao suportado`);
}

async function cycle() {
  await cloud("/gateways/heartbeat", {
    method: "POST",
    body: JSON.stringify({ hostname: os.hostname(), platform: os.platform(), version: "0.3.0" })
  });
  const commands = await cloud("/gateways/commands");
  for (const command of commands.items || []) {
    try {
      const result = await execute(command);
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
    response.end(JSON.stringify({ ok: true, tenantId: config.tenantId, gatewayId: config.gatewayId }));
    return;
  }
  response.writeHead(404);
  response.end();
}).listen(Number(config.localPort || 4040), "127.0.0.1");

log(`Gateway iniciado tenant=${config.tenantId} gateway=${config.gatewayId}`);
guardedCycle().catch((error) => log(`Falha inicial: ${error.message}`));
setInterval(() => guardedCycle().catch((error) => log(`Falha de comunicacao: ${error.message}`)), Number(config.pollMs || 3000));
