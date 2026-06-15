export const SUPREMA_BIOSTAR_REST_ADAPTER = "SUPREMA_BIOSTAR_REST";

export function matchesSupremaBiostar(device = {}) {
  const value = `${device.manufacturer || ""} ${device.model || ""}`.toLowerCase();
  return value.includes("suprema") || value.includes("biostar");
}

async function biostarLogin(device, { baseUrl, timeout }) {
  if (!device.password) throw new Error("Senha do servidor BioStar nao cadastrada");
  const request = timeout(12000);
  try {
    const response = await fetch(`${baseUrl(device)}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ User: { login_id: device.username || "admin", password: device.password } }),
      signal: request.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`BioStar login respondeu ${response.status}: ${text.slice(0, 200)}`);
    const sessionId = response.headers.get("bs-session-id");
    if (!sessionId) throw new Error("BioStar autenticou sem retornar bs-session-id");
    return sessionId;
  } finally {
    request.done();
  }
}

export async function biostarRequest(device, path, options, helpers) {
  const sessionId = await biostarLogin(device, helpers);
  const request = helpers.timeout(options?.timeoutMs || 15000);
  try {
    const response = await fetch(`${helpers.baseUrl(device)}${path}`, {
      method: options?.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "bs-session-id": sessionId
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: request.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`BioStar respondeu ${response.status}: ${text.slice(0, 240)}`);
    return { ok: true, status: response.status, body: text };
  } finally {
    request.done();
  }
}

export async function testSupremaBiostar(device, helpers) {
  const result = await biostarRequest(device, "/api/doors/status", {
    method: "POST",
    body: { monitoring_permission: true }
  }, helpers);
  return { ...result, matchedEndpoint: "/api/login + /api/doors/status" };
}

