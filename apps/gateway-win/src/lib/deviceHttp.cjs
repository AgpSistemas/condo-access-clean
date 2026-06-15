const crypto = require("node:crypto");
const net = require("node:net");

function deviceBaseUrl(device = {}) {
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

  const params = Object.fromEntries(
    [...challenge.matchAll(/(\w+)="?([^",]+)"?/g)].map((match) => [match[1], match[2]])
  );
  const parsedUrl = new URL(url);
  const uri = `${parsedUrl.pathname}${parsedUrl.search}`;
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const qop = params.qop?.split(",")[0];
  const md5 = (value) => crypto.createHash("md5").update(value).digest("hex");
  const ha1 = md5(`${username}:${params.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${params.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${params.nonce}:${ha2}`);
  const parts = [
    `username="${username}"`,
    `realm="${params.realm}"`,
    `nonce="${params.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    qop ? `qop=${qop}` : "",
    qop ? `nc=${nc}` : "",
    qop ? `cnonce="${cnonce}"` : "",
    params.opaque ? `opaque="${params.opaque}"` : ""
  ].filter(Boolean);
  return { Authorization: `Digest ${parts.join(", ")}` };
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

async function deviceHttp(command) {
  const device = command.device || {};
  const request = command.request || {};
  const method = String(request.method || "GET").toUpperCase();
  const targetUrl = `${deviceBaseUrl(device)}${String(request.path || "/")}`;
  const headers = await digestHeader(targetUrl, method, device.username || "admin", device.password || "");
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
  if (!host || !port) {
    return Promise.resolve({ ok: false, latencyMs: null, message: "IP ou porta nao configurados" });
  }

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

module.exports = { deviceBaseUrl, digestHeader, postJson, deviceHttp, testDeviceTcp };
