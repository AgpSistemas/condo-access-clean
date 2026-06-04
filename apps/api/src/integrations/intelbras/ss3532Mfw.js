export const INTELBRAS_SS_3532_MF_W_ADAPTER = "INTELBRAS_BIOT_CGI";

export function matchesSs3532Mfw(device = {}) {
  const manufacturer = String(device.manufacturer || "").toLowerCase();
  const model = String(device.model || device.deviceType || device.type || "").toLowerCase();
  return manufacturer.includes("intelbras") && (
    model.includes("ss 3532") ||
    model.includes("ss3532") ||
    model.includes("ss 3542") ||
    model.includes("ss3542") ||
    model.includes("bio-t") ||
    device.category === "access-control"
  );
}

export function ss3532MfwDefaults(body = {}, existingDevice = null) {
  return {
    category: body.category || existingDevice?.category || "access-control",
    model: body.model || existingDevice?.model || "SS 3532 MF W",
    apiPort: Number(body.apiPort || existingDevice?.apiPort || 80),
    rtspPort: Number(body.rtspPort || existingDevice?.rtspPort || 554),
    channelCount: Number(body.channelCount || existingDevice?.channelCount || 0),
    intercomEnabled: body.intercomEnabled === undefined ? true : Boolean(body.intercomEnabled),
    intercomType: body.intercomType || existingDevice?.intercomType || "FACIAL"
  };
}

export async function testSs3532Mfw(device, { tryHttpCandidates, checkTcpDevice }) {
  const candidates = [
    { label: "Hora atual", path: "/cgi-bin/global.cgi?action=getCurrentTime" },
    { label: "Tipo do dispositivo", path: "/cgi-bin/magicBox.cgi?action=getDeviceType" },
    { label: "Classe do dispositivo", path: "/cgi-bin/magicBox.cgi?action=getDeviceClass" },
    { label: "Versao de software", path: "/cgi-bin/magicBox.cgi?action=getSoftwareVersion" },
    { label: "Configuracao de rede", path: "/cgi-bin/configManager.cgi?action=getConfig&name=Network" }
  ];

  try {
    return await tryHttpCandidates(device, candidates);
  } catch (error) {
    const tcp = await checkTcpDevice(device);
    if (tcp.online) {
      return {
        ok: true,
        status: 200,
        partial: true,
        attempts: error?.attempts || [],
        body: `Conexao TCP OK. SS 3532/Bio-T respondeu na rede, mas CGI/API ainda precisa ser habilitado ou autenticado: ${error instanceof Error ? error.message : "falha desconhecida"}`
      };
    }
    throw error;
  }
}

export async function openSs3532MfwDoor(device, relay = 1, { requestDevice }) {
  return requestDevice(device, `/cgi-bin/accessControl.cgi?action=openDoor&channel=${Number(relay || 1)}`, {
    method: "GET",
    timeoutMs: 7000
  });
}

export function parseSs3532MfwEventPayload(raw, contentType = "") {
  if (!raw) return {};
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }

  const pairs = [...raw.matchAll(/(?:^|[\r\n&])([^=\r\n&]+)=([^\r\n&]*)/g)];
  if (pairs.length) {
    return Object.fromEntries(pairs.map((match) => [match[1].trim(), decodeURIComponent(match[2].trim())]));
  }

  return { raw };
}

function flattenEventValue(payload, keys, fallback = "") {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current?.[part], payload);
    if (value !== undefined && value !== null && String(value) !== "") return String(value);
  }
  return fallback;
}

export function ss3532MfwEventToAccessLog(device, payload = {}, { makeId, tenantId, now }) {
  const eventName = flattenEventValue(payload, ["event", "eventType", "Event", "Code", "Type", "method"], "Evento Bio-T");
  const personName = flattenEventValue(payload, ["name", "userName", "UserName", "CardName", "Info.UserName"], "Intelbras Bio-T");
  const userId = flattenEventValue(payload, ["userId", "UserID", "userid", "employeeNoString", "cardNo"], "");
  const doorName = flattenEventValue(payload, ["door", "doorName", "Door", "channel", "Channel"], device?.name || "Intelbras Bio-T");
  const decisionRaw = flattenEventValue(payload, ["decision", "Decision", "status", "Status", "result", "Result"], "INFO").toUpperCase();
  const decision = decisionRaw.includes("ALLOW") || decisionRaw.includes("OPEN") || decisionRaw.includes("SUCCESS")
    ? "ALLOW"
    : decisionRaw.includes("DENY") || decisionRaw.includes("FAIL")
      ? "DENY"
      : "INFO";

  return {
    id: makeId("access"),
    tenantId: device?.tenantId || tenantId,
    unitId: "",
    decision,
    reason: eventName,
    createdAt: now(),
    user: { id: userId, name: personName },
    door: {
      id: "",
      name: doorName,
      deviceId: device?.id || "",
      manufacturer: "Intelbras"
    },
    rawEvent: payload
  };
}

