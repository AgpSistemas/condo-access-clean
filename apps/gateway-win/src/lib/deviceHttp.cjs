const crypto = require("node:crypto");
const net = require("node:net");

function deviceBaseUrl(device = {}) {
  const address = String(device.apiHost || device.ipAddress || "").replace(/\/+$/, "");
  if (/^https?:\/\//i.test(address)) return new URL(address).origin;
  return `${device.apiProtocol || "http"}://${address}:${Number(device.apiPort || 80)}`;
}

function basicHeader(username, password) {
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

function parseDigestChallenge(challenge = "") {
  const digest = String(challenge || "").replace(/^Digest\s+/i, "");
  const params = {};
  const pattern = /([a-z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/gi;
  let match;
  while ((match = pattern.exec(digest))) {
    params[match[1]] = match[2] ?? match[3] ?? "";
  }
  return params;
}

function digestAuthorization(url, method, username, password, challenge = "") {
  const params = parseDigestChallenge(challenge);
  if (!params.realm || !params.nonce) return basicHeader(username, password);
  const parsedUrl = new URL(url);
  const uri = `${parsedUrl.pathname}${parsedUrl.search}`;
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const qop = params.qop?.split(",").map((item) => item.trim()).find((item) => item === "auth") ||
    params.qop?.split(",").map((item) => item.trim()).filter(Boolean)[0];
  const algorithm = String(params.algorithm || "MD5").toUpperCase();
  const md5 = (value) => crypto.createHash("md5").update(value).digest("hex");
  const ha1 = algorithm === "MD5-SESS"
    ? md5(`${md5(`${username}:${params.realm}:${password}`)}:${params.nonce}:${cnonce}`)
    : md5(`${username}:${params.realm}:${password}`);
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
    params.algorithm ? `algorithm=${params.algorithm}` : "",
    qop ? `qop=${qop}` : "",
    qop ? `nc=${nc}` : "",
    qop ? `cnonce="${cnonce}"` : "",
    params.opaque ? `opaque="${params.opaque}"` : ""
  ].filter(Boolean);
  return { Authorization: `Digest ${parts.join(", ")}` };
}

async function authHeader(url, method, username, password) {
  const probe = await fetch(url, { method, signal: AbortSignal.timeout(8000) });
  const challenge = probe.headers.get("www-authenticate") || "";
  if (!challenge.toLowerCase().includes("digest")) {
    return { headers: basicHeader(username, password), challenge, mode: "basic" };
  }
  return { headers: digestAuthorization(url, method, username, password, challenge), challenge, mode: "digest" };
}

async function fetchDevice(url, { method, headers, body, timeoutMs }) {
  return fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(Number(timeoutMs || 12000))
  });
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
  const username = device.username || "admin";
  const password = device.password || "";
  const auth = await authHeader(targetUrl, method, username, password);
  const headers = { ...auth.headers };
  const requestBody = request.bodyBase64
    ? Buffer.from(String(request.bodyBase64), "base64")
    : request.body;
  if (requestBody !== undefined && requestBody !== null) {
    headers["Content-Type"] = request.contentType || "application/json";
  }
  let response = await fetchDevice(targetUrl, {
    method,
    headers,
    body: requestBody === undefined || requestBody === null ? undefined : requestBody,
    timeoutMs: request.timeoutMs
  });
  let authMode = auth.mode;
  if (response.status === 401 && auth.mode === "digest") {
    response = await fetchDevice(targetUrl, {
      method,
      headers: {
        ...headers,
        ...basicHeader(username, password)
      },
      body: requestBody === undefined || requestBody === null ? undefined : requestBody,
      timeoutMs: request.timeoutMs
    });
    authMode = "digest-basic-fallback";
  }
  const contentType = response.headers.get("content-type") || "";
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = request.responseType === "base64" ? "" : buffer.toString("utf8");
  if (!response.ok) {
    throw new Error(`Equipamento respondeu ${response.status} (${authMode}): ${text.slice(0, 300)}`);
  }
  return {
    ok: true,
    status: response.status,
    body: text,
    bodyBase64: request.responseType === "base64" ? buffer.toString("base64") : "",
    contentType,
    message: `Requisicao local concluida (${response.status}, ${authMode})`
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

module.exports = { deviceBaseUrl, authHeader, digestAuthorization, postJson, deviceHttp, testDeviceTcp };
