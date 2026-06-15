import { controlIdActionParameters } from "./profiles.js";

const DEFAULT_SNAPSHOT_OBJECTS = [
  { object: "users", label: "Control iD usuarios", required: true },
  { object: "cards", label: "Control iD cards/tags" },
  { object: "uhf_tags", label: "Control iD UHF tags" },
  { object: "qrcodes", label: "Control iD QR Codes" },
  { object: "pins", label: "Control iD PINs" },
  { object: "time_zones", label: "Control iD horarios" },
  { object: "time_spans", label: "Control iD intervalos" },
  { object: "access_logs", label: "Control iD eventos", limit: 80 },
  { object: "face_templates", label: "Control iD faces", optional: true }
];

function controlIdBaseUrl(device = {}) {
  const host = device.apiHost || device.ipAddress || device.host;
  if (!host) throw new Error("Endereco IP/host do equipamento Control iD nao informado");
  const protocol = device.apiProtocol || "http";
  const portPart = device.apiPort ? `:${device.apiPort}` : "";
  return `${protocol}://${host}${portPart}`;
}

function parseJson(text = "") {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function timeoutRequest(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function errorDetails(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function createControlIdClient({
  fetchImpl = globalThis.fetch,
  baseUrl = controlIdBaseUrl,
  createTimeout = timeoutRequest
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Cliente HTTP indisponivel para a integracao Control iD");
  }

  async function request(device, pathName, {
    session = "",
    method = "POST",
    body,
    contentType = "application/json; charset=utf-8",
    timeoutMs = 9000
  } = {}) {
    const separator = pathName.includes("?") ? "&" : "?";
    const targetPath = session
      ? `${pathName}${separator}session=${encodeURIComponent(session)}`
      : pathName;
    const timeout = createTimeout(timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl(device)}${targetPath}`, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": contentType },
        body: body === undefined || contentType !== "application/json; charset=utf-8"
          ? body
          : JSON.stringify(body),
        signal: timeout.signal
      });
      const text = await response.text();
      const payload = parseJson(text);
      if (!response.ok || payload?.success === false || payload?.error) {
        const detail = errorDetails(text);
        throw new Error(`Control iD ${pathName} respondeu ${response.status}${detail ? `: ${detail}` : ""}`);
      }
      return { ok: true, status: response.status, body: text, payload: payload || {} };
    } finally {
      timeout.done();
    }
  }

  async function login(device, { timeoutMs = 9000 } = {}) {
    if (!device.password) {
      throw new Error("Senha Control iD nao cadastrada para este equipamento");
    }
    const result = await request(device, "/login.fcgi", {
      body: {
        login: device.username || "admin",
        password: device.password
      },
      timeoutMs
    });
    if (!result.payload.session) {
      throw new Error(`Control iD login nao retornou uma sessao valida (${result.status})`);
    }
    return result.payload.session;
  }

  function post(device, session, pathName, body = {}, options = {}) {
    return request(device, pathName, { ...options, session, body });
  }

  function binaryRequest(device, session, pathName, {
    method = "POST",
    body,
    contentType = "application/octet-stream",
    timeoutMs = 15000
  } = {}) {
    return request(device, pathName, { session, method, body, contentType, timeoutMs });
  }

  async function logout(device, session) {
    if (!session) return;
    try {
      await post(device, session, "/logout.fcgi", {});
    } catch {
      // Logout is best-effort; an expired session must not hide the original result.
    }
  }

  async function loadObjects(device, session, object, {
    limit = 500,
    timeoutMs = 9000,
    maxPages = 50,
    ...query
  } = {}) {
    const records = [];
    const seen = new Set();
    let offset = Number(query.offset || 0);

    for (let page = 0; page < maxPages; page += 1) {
      const result = await post(device, session, "/load_objects.fcgi", {
        ...query,
        object,
        limit,
        offset
      }, { timeoutMs });
      const pageRecords = Array.isArray(result.payload?.[object]) ? result.payload[object] : [];
      const firstKey = pageRecords[0]
        ? JSON.stringify([pageRecords[0].id, pageRecords[0].user_id, pageRecords[0].registration])
        : "";
      if (firstKey && seen.has(firstKey)) break;
      if (firstKey) seen.add(firstKey);
      records.push(...pageRecords);
      if (pageRecords.length < limit) break;
      offset += pageRecords.length;
    }

    return records;
  }

  async function readSnapshot(device, { includeOptional = true } = {}) {
    const session = await login(device);
    const specs = DEFAULT_SNAPSHOT_OBJECTS.filter((spec) => includeOptional || !spec.optional);
    const objects = {};
    const attempts = [];

    for (const spec of specs) {
      try {
        const records = await loadObjects(device, session, spec.object, { limit: spec.limit || 1000 });
        objects[spec.object] = records;
        attempts.push({
          label: spec.label,
          path: `/load_objects.fcgi:${spec.object}`,
          ok: true,
          records: records.length
        });
      } catch (error) {
        attempts.push({
          label: spec.label,
          path: `/load_objects.fcgi:${spec.object}`,
          ok: false,
          optional: !spec.required,
          error: error instanceof Error ? error.message : "Falha ao ler objeto Control iD"
        });
        if (spec.required) throw error;
        objects[spec.object] = [];
      }
    }

    objects.user_images = [];
    for (const pathName of ["/user_list_images.fcgi?get_timestamp=1", "/user_list_images?get_timestamp=1"]) {
      try {
        const result = await request(device, pathName, { session, method: "GET" });
        const imageInfo = Array.isArray(result.payload?.image_info)
          ? result.payload.image_info
          : Array.isArray(result.payload?.user_ids)
            ? result.payload.user_ids.map((userId) => ({ user_id: userId }))
            : [];
        objects.user_images = imageInfo;
        attempts.push({
          label: "Control iD lista de fotos faciais",
          path: pathName.split("?")[0],
          ok: true,
          records: imageInfo.length
        });
        break;
      } catch (error) {
        attempts.push({
          label: "Control iD lista de fotos faciais",
          path: pathName.split("?")[0],
          ok: false,
          optional: true,
          error: error instanceof Error ? error.message : "Falha ao listar fotos Control iD"
        });
      }
    }

    return { session, objects, attempts };
  }

  async function openDoor(device, relay = 1) {
    const session = await login(device);
    const action = controlIdActionParameters(device, relay);
    return post(device, session, "/execute_actions.fcgi", { actions: [action] });
  }

  async function testConnection(device) {
    const session = await login(device);
    try {
      const [system, users] = await Promise.all([
        post(device, session, "/system_information.fcgi", {}),
        loadObjects(device, session, "users", { limit: 1 })
      ]);
      return {
        ok: true,
        status: system.status,
        system: system.payload,
        usersSample: users.length,
        matchedEndpoint: "/login.fcgi + /system_information.fcgi + /load_objects.fcgi:users"
      };
    } finally {
      await logout(device, session);
    }
  }

  return {
    binaryRequest,
    loadObjects,
    login,
    logout,
    openDoor,
    post,
    readSnapshot,
    request,
    testConnection
  };
}

export {
  DEFAULT_SNAPSHOT_OBJECTS,
  controlIdBaseUrl,
  createControlIdClient
};
