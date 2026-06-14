const NICE_LINEAR_ADAPTER = "NICE_LINEAR_GATEWAY";
const NICE_LINEAR_DEVICE_TCP_MODE = "DEVICE_CONNECTS_TCP";
const NICE_LINEAR_HTTP_MODE = "HTTP_GATEWAY";

const NICE_LINEAR_MODELS = [
  "Modulo Guarita MG3000",
  "Modulo Guarita IP",
  "Controladora Ethernet II",
  "Controladora Ethernet III"
];

function normalized(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[\s/_-]+/g, "");
}

function isNiceLinearManufacturer(value = "") {
  const manufacturer = normalized(value);
  return manufacturer.includes("nice") || manufacturer.includes("linearhcs") || manufacturer === "linear";
}

function matchesNiceLinear(device = {}) {
  if (isNiceLinearManufacturer(device.manufacturer)) return true;
  const model = normalized(device.model);
  return model.includes("guarita") || model.includes("controladoraethernet");
}

function normalizeNiceLinearMode(value = NICE_LINEAR_DEVICE_TCP_MODE) {
  return String(value || NICE_LINEAR_DEVICE_TCP_MODE).trim().toUpperCase() === NICE_LINEAR_HTTP_MODE
    ? NICE_LINEAR_HTTP_MODE
    : NICE_LINEAR_DEVICE_TCP_MODE;
}

function normalizeGatewayPath(value, fallback) {
  const clean = String(value || fallback).trim();
  return clean.startsWith("/") ? clean : `/${clean}`;
}

function niceLinearDefaults(device = {}, existing = {}) {
  const model = NICE_LINEAR_MODELS.includes(device.model)
    ? device.model
    : NICE_LINEAR_MODELS.includes(existing.model)
      ? existing.model
      : NICE_LINEAR_MODELS[0];
  const mode = normalizeNiceLinearMode(device.niceConnectionMode || existing.niceConnectionMode);

  return {
    category: "access-control",
    manufacturer: device.manufacturer || existing.manufacturer || "Nice/Linear",
    model,
    apiProtocol: mode === NICE_LINEAR_HTTP_MODE
      ? device.apiProtocol || existing.apiProtocol || "http"
      : "tcp",
    apiPort: Number(device.apiPort || existing.apiPort || 0),
    rtspPort: 0,
    channelCount: 0,
    niceConnectionMode: mode,
    niceGatewayHealthPath: normalizeGatewayPath(
      device.niceGatewayHealthPath || existing.niceGatewayHealthPath,
      "/health"
    ),
    niceGatewayOpenPath: normalizeGatewayPath(
      device.niceGatewayOpenPath || existing.niceGatewayOpenPath,
      "/api/nice-linear/open"
    ),
    niceDeviceId: String(device.niceDeviceId ?? existing.niceDeviceId ?? "").trim(),
    intercomEnabled: false,
    intercomType: "GATEWAY"
  };
}

function validateNiceLinearConfiguration(device = {}) {
  const errors = [];
  const mode = normalizeNiceLinearMode(device.niceConnectionMode);
  const port = Number(device.apiPort);

  if (!NICE_LINEAR_MODELS.includes(device.model)) {
    errors.push("Selecione um modelo Nice/Linear suportado pelo perfil");
  }
  if (!device.ipAddress && !device.apiHost) {
    errors.push(mode === NICE_LINEAR_HTTP_MODE
      ? "Informe o IP ou host do gateway HTTP Nice/Linear"
      : "Informe o IP esperado do equipamento Nice/Linear que conectara ao servidor");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push("Informe uma porta TCP valida entre 1 e 65535");
  }
  if (mode === NICE_LINEAR_HTTP_MODE) {
    if (!device.password && !device.passwordSet) {
      errors.push("Cadastre um token no campo Senha para autenticar o gateway Nice/Linear");
    }
    if (!String(device.niceGatewayHealthPath || "").startsWith("/")) {
      errors.push("A rota de saude do gateway deve comecar com /");
    }
    if (!String(device.niceGatewayOpenPath || "").startsWith("/")) {
      errors.push("A rota de abertura do gateway deve comecar com /");
    }
  }

  return { ok: errors.length === 0, errors };
}

function gatewayBaseUrl(device = {}) {
  const host = device.apiHost || device.ipAddress || device.host;
  const port = Number(device.apiPort || 80);
  return `${device.apiProtocol || "http"}://${host}${port ? `:${port}` : ""}`;
}

function gatewayHeaders(device = {}, hasBody = false) {
  const headers = { Accept: "application/json" };
  if (hasBody) headers["Content-Type"] = "application/json";
  if (device.password) {
    headers.Authorization = `Bearer ${device.password}`;
    headers["X-API-Key"] = device.password;
  }
  return headers;
}

async function niceLinearGatewayRequest(device, pathName, {
  method = "GET",
  body,
  timeoutMs = 7000
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${gatewayBaseUrl(device)}${normalizeGatewayPath(pathName, "/")}`, {
      method,
      headers: gatewayHeaders(device, body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new Error(payload?.message || `Gateway Nice/Linear respondeu ${response.status}: ${text.slice(0, 180)}`);
    }
    return { ok: true, status: response.status, text, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function testNiceLinearIntegration(device, { checkTcpDevice, connectionStatus }) {
  const mode = normalizeNiceLinearMode(device.niceConnectionMode);
  if (mode === NICE_LINEAR_DEVICE_TCP_MODE) {
    const connection = connectionStatus(device);
    return {
      ok: connection.online,
      status: connection.online ? 200 : 502,
      connection,
      mode,
      message: connection.online
        ? "Equipamento Nice/Linear conectado ao listener TCP do Condo Access"
        : connection.reason
    };
  }

  const tcp = await checkTcpDevice(device);
  if (!tcp.online) {
    return { ok: false, status: 502, tcp, mode, message: tcp.reason };
  }
  const result = await niceLinearGatewayRequest(device, device.niceGatewayHealthPath || "/health");
  return {
    ok: true,
    status: result.status,
    tcp,
    mode,
    matchedEndpoint: device.niceGatewayHealthPath || "/health",
    message: "Gateway HTTP Nice/Linear conectado",
    payload: result.payload
  };
}

async function openNiceLinearDoor(device, relay = 1, action = {}) {
  if (normalizeNiceLinearMode(device.niceConnectionMode) !== NICE_LINEAR_HTTP_MODE) {
    throw new Error("Abertura Nice/Linear exige o modo Gateway HTTP; TCP direto esta disponivel somente para diagnostico");
  }
  const targetRelay = Math.max(1, Number(relay) || 1);
  const result = await niceLinearGatewayRequest(device, device.niceGatewayOpenPath || "/api/nice-linear/open", {
    method: "POST",
    body: {
      command: "OPEN",
      deviceId: device.niceDeviceId || device.id,
      systemDeviceId: device.id,
      model: device.model,
      relay: targetRelay,
      route: action.route || "",
      actionId: action.id || "",
      actionName: action.name || ""
    }
  });
  return {
    ...result,
    relay: targetRelay,
    message: result.payload?.message || `Abertura enviada ao gateway Nice/Linear no rele ${targetRelay}`
  };
}

function niceLinearEventToAccessLog(device = {}, payload = {}, { makeId, now, tenantId }) {
  const allowed = payload.allowed === true ||
    ["ALLOW", "ALLOWED", "GRANTED", "OPEN", "OPENED"].includes(String(payload.decision || payload.status || "").toUpperCase());
  const denied = payload.allowed === false ||
    ["DENY", "DENIED", "BLOCKED"].includes(String(payload.decision || payload.status || "").toUpperCase());
  const decision = allowed ? "ALLOW" : denied ? "DENY" : "PENDING";
  const occurredAt = payload.occurredAt || payload.timestamp || now();

  return {
    id: makeId("access"),
    tenantId: device.tenantId || tenantId,
    unitId: payload.unitId || "",
    decision,
    reason: payload.reason || payload.eventType || "Evento Nice/Linear",
    createdAt: occurredAt,
    occurredAt,
    user: {
      id: payload.personId || payload.userId || "",
      name: payload.personName || payload.userName || ""
    },
    credential: {
      type: payload.credentialType || payload.type || "",
      value: payload.credentialValue || payload.credential || payload.tag || ""
    },
    door: {
      id: payload.doorId || payload.relay || "",
      name: payload.doorName || payload.route || `Rele ${payload.relay || 1}`,
      deviceId: device.id,
      manufacturer: device.manufacturer
    },
    source: "NICE_LINEAR_GATEWAY",
    rawEvent: payload
  };
}

export {
  NICE_LINEAR_ADAPTER,
  NICE_LINEAR_DEVICE_TCP_MODE,
  NICE_LINEAR_HTTP_MODE,
  NICE_LINEAR_MODELS,
  isNiceLinearManufacturer,
  matchesNiceLinear,
  niceLinearDefaults,
  niceLinearEventToAccessLog,
  normalizeNiceLinearMode,
  openNiceLinearDoor,
  testNiceLinearIntegration,
  validateNiceLinearConfiguration
};
