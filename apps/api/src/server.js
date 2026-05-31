import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";

function loadLocalEnv() {
  const envCandidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), "apps", "api", ".env.local"),
    path.resolve("apps", "api", ".env.local")
  ];
  const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
  if (!envPath) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnv();

const port = Number(process.env.PORT || 3333);
const now = () => new Date().toISOString();
const ffmpegPath = process.env.FFMPEG_PATH || "C:\\Program Files (x86)\\Wondershare\\Dr.Fone\\ffmpeg.exe";
const streamRoot = path.join(os.tmpdir(), "condo-access-hls");
const streamSessions = new Map();
const asteriskHost = process.env.ASTERISK_PUBLIC_HOST || process.env.SIP_DOMAIN || "192.168.3.27";
const asteriskWebSocketUrl = process.env.ASTERISK_WS_URL || `ws://${asteriskHost}:8088/ws`;

const tenant = {
  id: "tenant-agp",
  name: "AGP Sistemas Corp",
  document: "",
  status: "ACTIVE",
  telephonyEnabled: true,
  telephonyProvider: "DIRECT_SIP",
  sipDomain: asteriskHost,
  sipWebSocketUrl: asteriskWebSocketUrl,
  sipOutboundProxy: "",
  sipPorterExtension: "9000",
  sipPorterPassword: "change-me-9000",
  sipAccountPrefix: "",
  sipExtensionGroupName: "AGP Sistemas Corp",
  sipExtensionStart: "9000",
  sipExtensionEnd: "9999",
  updatedAt: now()
};

const showroomTenant = {
  id: "tenant-showroom",
  name: "Condominio Dinamus",
  document: "",
  status: "ACTIVE",
  telephonyEnabled: true,
  telephonyProvider: "DIRECT_SIP",
  sipDomain: asteriskHost,
  sipWebSocketUrl: asteriskWebSocketUrl,
  sipOutboundProxy: "",
  sipPorterExtension: "9000",
  sipPorterPassword: "change-me-9000",
  sipAccountPrefix: "DIN",
  sipExtensionGroupName: "Condominio Dinamus",
  sipExtensionStart: "9100",
  sipExtensionEnd: "9199",
  updatedAt: now()
};

const units = new Map();

const residents = [];

const devices = [];

const cameras = [];

const deviceCategories = [
  {
    id: "access-control",
    name: "Controle de Acesso",
    manufacturers: ["Control iD", "Linear HCS", "Bravas", "Hikvision", "Intelbras"],
    deviceTypes: ["Facial", "Controladora", "Leitora", "Video porteiro", "ATA VoIP", "Telefone IP"]
  },
  {
    id: "cameras",
    name: "Cameras",
    manufacturers: ["Hikvision", "Intelbras", "ONVIF", "RTSP Generico"],
    deviceTypes: ["Camera IP", "DVR multicanal", "NVR multicanal", "LPR", "Video porteiro"]
  },
  {
    id: "iot",
    name: "IoT e Acionamentos",
    manufacturers: ["Bravas", "Moni Software", "Nice Guarita", "Linear HCS", "Generico"],
    deviceTypes: ["Rele", "Gateway", "Modulo porta", "Modulo RF", "Locker"]
  },
  {
    id: "telephony",
    name: "Telefonia",
    manufacturers: ["Issabel/Asterisk", "Intelbras", "Hikvision", "SIP Generico"],
    deviceTypes: ["PABX", "Telefone IP", "ATA VoIP", "Video porteiro SIP"]
  }
];

const manufacturerProfiles = [
  {
    id: "hikvision",
    name: "Hikvision",
    families: ["Camera IP", "DVR multicanal", "NVR multicanal", "Facial", "Video porteiro"],
    protocols: ["RTSP", "HTTP/ISAPI", "SIP"],
    defaultPorts: ["554", "80", "8000", "5060"],
    credentialTypes: ["FACE", "QR", "RFID", "PIN"],
    syncModes: ["Eventos", "Fotos faciais", "Canais de camera", "Abertura remota"],
    notes: "Usar RTSP para video, ISAPI para eventos/face e ramal SIP quando o equipamento suportar chamada."
  },
  {
    id: "control-id",
    name: "Control iD",
    families: ["Facial", "Controlador de acesso", "Relogio de ponto"],
    protocols: ["HTTP API", "SDK", "Eventos por polling"],
    defaultPorts: ["80", "443"],
    credentialTypes: ["FACE", "RFID", "PIN", "BIOMETRIA"],
    syncModes: ["Pessoas", "Templates faciais", "Eventos", "Portas"],
    notes: "Integracao pede sessao/token e fila de sincronismo para evitar travar equipamento em carga alta."
  },
  {
    id: "linear-hcs",
    name: "Linear HCS",
    families: ["Controladora", "Receptor veicular", "Gateway"],
    protocols: ["Gateway local", "Serial/SDK", "HTTP quando disponivel"],
    defaultPorts: ["80", "5000"],
    credentialTypes: ["RFID", "CONTROLE_REMOTO", "PLACA"],
    syncModes: ["Credenciais", "Eventos", "Rotas de acesso"],
    notes: "Ideal isolar via agente local quando o controlador nao oferece API web direta."
  },
  {
    id: "bravas",
    name: "Bravas",
    families: ["Controladora", "Modulo de acionamento", "Portaria"],
    protocols: ["HTTP/API", "Gateway local", "Reles"],
    defaultPorts: ["80", "8080"],
    credentialTypes: ["RFID", "QR", "APP"],
    syncModes: ["Abertura remota", "Eventos", "Permissoes"],
    notes: "Mapear modelo exato para definir se a comunicacao sera API direta ou gateway."
  },
  {
    id: "intelbras",
    name: "Intelbras",
    families: ["Camera IP", "DVR multicanal", "NVR multicanal", "Facial", "Video porteiro"],
    protocols: ["RTSP", "HTTP", "SDK", "SIP"],
    defaultPorts: ["554", "80", "37777", "5060"],
    credentialTypes: ["FACE", "QR", "RFID", "PIN"],
    syncModes: ["Cameras", "Eventos", "Credenciais", "Chamada SIP"],
    notes: "Separar video RTSP de comando/eventos para nao gravar imagem pesada dentro da API."
  },
  {
    id: "moni-software",
    name: "Moni Software",
    families: ["Acionamento", "Gateway"],
    protocols: ["HTTP/API", "Webhook"],
    defaultPorts: ["80", "443"],
    credentialTypes: ["APP", "QR"],
    syncModes: ["Acionamentos", "Historico", "Eventos"],
    notes: "Usado como perfil generico para botoes de abertura remota."
  }
];


const actions = [];

const credentials = [];

const credentialSyncJobs = [];

const unitLogins = [];

const unitInvites = [];

const accessRoutes = [];

const permissionProfiles = [];

const licenses = [];

const resources = [
  { id: "actions", name: "Acionamentos", enabled: false, group: "Essenciais", configurable: true, description: "Envie acionamentos remotos via App ou Web e cadastre leitoras para eventos de acesso." },
  { id: "cameras", name: "Cameras", enabled: true, group: "Essenciais", configurable: true, description: "Visualize as cameras do local em tempo real via aplicativo." },
  { id: "voicy", name: "Voicy", enabled: true, group: "Essenciais", configurable: true, description: "PABX em nuvem para dispositivos SIP com autoatendimento VOIP integrado ao app." },
  { id: "clickApprove", name: "ClickAprova", enabled: true, group: "Controle de acesso", configurable: true, description: "Aprove acessos pelo app com visualizacao das cameras em tempo real." },
  { id: "temporaryFace", name: "Face Temporaria", enabled: false, group: "Controle de acesso", configurable: true, description: "Acesso facial com validade limitada e exclusao automatica no equipamento." },
  { id: "qrScanner", name: "QR Scanner", enabled: true, group: "Controle de acesso", configurable: true, description: "Leitura de QR Code pelo app ou convite para abertura e notificacao." },
  { id: "deliveries", name: "Entregas", enabled: true, group: "Digitalizacao dos processos", configurable: true, description: "Controle de encomendas com fotos e informacoes adicionais." },
  { id: "shiftLog", name: "Registro de turno", enabled: true, group: "Digitalizacao dos processos", configurable: false, description: "Registro digital das atividades da portaria e troca de turno." },
  { id: "nomenclatures", name: "Nomenclaturas", enabled: true, group: "Personalizacoes", configurable: true, description: "Nomes de agentes e unidades para ambientes residenciais, corporativos e educacionais." }
];

const accessLogs = [];

const intercomCalls = [];
const extraTenants = [];
const deletedTenantIds = new Set();

function unitList() {
  return Array.from(units.values());
}

function extensionStatus(tenantId = "") {
  const targetTenant = tenantId ? findTenant(tenantId) : allTenants()[0];
  if (!targetTenant) return [];
  const start = Number(targetTenant.sipExtensionStart || 9000);
  const max = Math.min(Number(targetTenant.sipExtensionEnd || start + 5), start + 9);
  const used = new Map(unitList()
    .filter((unit) => unit.tenantId === targetTenant.id)
    .map((unit) => [unit.telephony.extension, unit]));
  const intercomByExtension = new Map(devices
    .filter((device) => device.tenantId === targetTenant.id && device.intercomEnabled && device.intercomExtension)
    .map((device) => [String(device.intercomExtension), device]));
  return Array.from({ length: Math.max(0, max - start + 1) }, (_, index) => {
    const extension = String(start + index);
    const unit = used.get(extension);
    const device = intercomByExtension.get(extension);
    const isPorter = extension === targetTenant.sipPorterExtension;
    return {
      extension,
      label: isPorter ? "Portaria" : unit ? `Unidade ${unit.unitNumber}` : device ? device.name : "Livre",
      type: isPorter ? "PORTER" : unit ? "UNIT" : device ? device.intercomType || "DEVICE" : "FREE",
      status: unit || device || isPorter ? "Configurado" : "Livre",
      tenantId: unit?.tenantId || device?.tenantId || targetTenant.id,
      deviceId: device?.id || "",
      unitId: unit?.unitId || "",
      updatedAt: now()
    };
  });
}

function publicCamera(camera) {
  const { password: _password, ...safeCamera } = camera;
  return safeCamera;
}

function publicDevice(device) {
  const { password: _password, ...safeDevice } = device;
  return {
    ...safeDevice,
    passwordSet: Boolean(device.password || device.passwordSet)
  };
}

function bootstrap() {
  return {
    generatedAt: now(),
    session: {
      user: {
        id: "user-master",
        name: "Master Administrador",
        email: "agpsistemascorp@gmail.com",
        role: "SUPER_ADMIN"
      }
    },
    condominiums: allTenants(),
    units: unitList(),
    residents,
    devices: devices.map(publicDevice),
    cameras: cameras.map(publicCamera),
    actions,
    credentials,
    credentialSyncJobs,
    unitLogins,
    unitInvites,
    manufacturerProfiles,
    deviceCategories,
    permissionProfiles,
    accessRoutes,
    licenses,
    resources,
    accessLogs,
    intercomCalls,
    extensionStatus: extensionStatus()
  };
}

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS"
  });
  response.end(JSON.stringify(body));
}

function sendText(response, statusCode, contentType, body, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
    ...extraHeaders
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function withTimeout(ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function deviceBaseUrl(device) {
  const host = device.apiHost || device.ipAddress || device.host;
  const portPart = device.apiPort ? `:${device.apiPort}` : "";
  return `${device.apiProtocol || "http"}://${host}${portPart}`;
}

async function digestAuthHeader(targetUrl, method, username, password) {
  const firstAttempt = withTimeout(5000);
  try {
    const first = await fetch(targetUrl, { method, signal: firstAttempt.signal });
    const authenticate = first.headers.get("www-authenticate") || "";
    if (!authenticate.toLowerCase().includes("digest")) {
      return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
    }

    const params = Object.fromEntries(
      [...authenticate.matchAll(/(\w+)="?([^",]+)"?/g)].map((match) => [match[1], match[2]])
    );
    const realm = params.realm || "";
    const nonce = params.nonce || "";
    const qop = params.qop?.split(",")[0];
    const opaque = params.opaque;
    const uri = new URL(targetUrl).pathname;
    const nc = "00000001";
    const cnonce = randomBytes(8).toString("hex");
    const ha1 = createHash("md5").update(`${username}:${realm}:${password}`).digest("hex");
    const ha2 = createHash("md5").update(`${method}:${uri}`).digest("hex");
    const response = qop
      ? createHash("md5").update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest("hex")
      : createHash("md5").update(`${ha1}:${nonce}:${ha2}`).digest("hex");
    const parts = [
      `username="${username}"`,
      `realm="${realm}"`,
      `nonce="${nonce}"`,
      `uri="${uri}"`,
      `response="${response}"`,
      qop ? `qop=${qop}` : "",
      qop ? `nc=${nc}` : "",
      qop ? `cnonce="${cnonce}"` : "",
      opaque ? `opaque="${opaque}"` : ""
    ].filter(Boolean);

    return { Authorization: `Digest ${parts.join(", ")}` };
  } finally {
    firstAttempt.done();
  }
}

async function hikvisionAuthHeaders(device, targetUrl, method) {
  const username = device.username || "admin";
  const password = device.password || "";
  if ((device.authMode || "DIGEST").toUpperCase() === "BASIC") {
    return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
  }
  return digestAuthHeader(targetUrl, method, username, password);
}

async function hikvisionRequest(device, targetPath, { method = "GET", body = undefined, contentType = "application/xml" } = {}) {
  if (!device.password) {
    throw new Error("Senha Hikvision nao cadastrada para este equipamento");
  }

  const targetUrl = `${deviceBaseUrl(device)}${targetPath}`;
  const headers = await hikvisionAuthHeaders(device, targetUrl, method);
  const request = withTimeout(7000);
  try {
    const response = await fetch(targetUrl, {
      method,
      headers: body ? { ...headers, "Content-Type": contentType } : headers,
      body,
      signal: request.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Hikvision respondeu ${response.status}: ${text.slice(0, 240)}`);
    }
    return { ok: true, status: response.status, body: text };
  } finally {
    request.done();
  }
}

async function testHikvisionDevice(device) {
  return hikvisionRequest(device, "/ISAPI/System/deviceInfo", { method: "GET" });
}

async function openHikvisionDoor(device, relay = 1) {
  const body = "<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>";
  return hikvisionRequest(device, `/ISAPI/AccessControl/RemoteControl/door/${relay}`, {
    method: "PUT",
    body
  });
}

function invitePublicPath(code) {
  return `/api/condominiums/invites/public/${encodeURIComponent(code)}`;
}

function invitePublicUrl(origin, code) {
  return `${origin}${invitePublicPath(code)}`;
}

function toMobileInvite(invite, origin) {
  return {
    id: invite.id,
    code: invite.code || invite.id,
    guestName: invite.guest || invite.guestName,
    guestPhone: invite.guestPhone || "",
    status: invite.status,
    validFrom: invite.validFrom,
    validUntil: invite.validUntil,
    door: invite.door || { id: invite.doorId || "action-entrada", name: invite.doorName || "Porta Entrada" },
    unit: {
      id: invite.unitId,
      tenant: { id: invite.tenantId || tenant.id, name: invite.tenantId === showroomTenant.id ? showroomTenant.name : tenant.name }
    },
    link: invitePublicUrl(origin, invite.code || invite.id),
    qrCodeUrl: `${invitePublicUrl(origin, invite.code || invite.id)}/qr.png`
  };
}

function allTenants() {
  return extraTenants.filter((item) => !deletedTenantIds.has(item.id));
}

function findTenant(tenantId = tenant.id) {
  return allTenants().find((item) => item.id === tenantId) || tenant;
}

function syncTenantTelephony(body, targetTenant = tenant) {
  Object.assign(targetTenant, {
    telephonyEnabled: body.telephonyEnabled ?? targetTenant.telephonyEnabled,
    telephonyProvider: body.telephonyProvider ?? targetTenant.telephonyProvider,
    sipDomain: body.sipDomain ?? targetTenant.sipDomain,
    sipWebSocketUrl: body.sipWebSocketUrl ?? targetTenant.sipWebSocketUrl,
    sipOutboundProxy: body.sipOutboundProxy ?? targetTenant.sipOutboundProxy,
    sipPorterExtension: body.sipPorterExtension ?? targetTenant.sipPorterExtension,
    sipPorterPassword: body.sipPorterPassword || targetTenant.sipPorterPassword,
    sipAccountPrefix: body.sipAccountPrefix ?? targetTenant.sipAccountPrefix,
    sipExtensionGroupName: body.sipExtensionGroupName ?? targetTenant.sipExtensionGroupName,
    sipExtensionStart: body.sipExtensionStart ?? targetTenant.sipExtensionStart,
    sipExtensionEnd: body.sipExtensionEnd ?? targetTenant.sipExtensionEnd,
    updatedAt: now()
  });
  unitList().filter((unit) => unit.tenantId === targetTenant.id).forEach((unit) => {
    unit.telephony = {
      ...unit.telephony,
      provider: body.telephonyProvider ?? unit.telephony?.provider ?? targetTenant.telephonyProvider,
      sipDomain: targetTenant.sipDomain,
      sipWebSocketUrl: targetTenant.sipWebSocketUrl,
      porterExtension: targetTenant.sipPorterExtension
    };
  });
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function updateById(collection, id, body) {
  const index = collection.findIndex((item) => item.id === id);
  if (index === -1) return null;
  collection[index] = { ...collection[index], ...body, id };
  return collection[index];
}

function requestOrigin(request) {
  const proto = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers["x-forwarded-host"] || request.headers.host || `localhost:${port}`;
  return `${proto}://${host}`;
}

function toMobileUnit(unit) {
  const tenantData = unit.tenantId === showroomTenant.id ? showroomTenant : tenant;
  return {
    id: unit.unitId,
    number: unit.unitNumber,
    ownerName: unit.responsibleName || unit.residentName,
    ownerDocument: "",
    extension: unit.telephony?.extension || unit.extension,
    extensionPassword: unit.telephony?.extensionPassword,
    documents: "",
    tenant: {
      id: tenantData.id,
      name: tenantData.name,
      sipDomain: tenantData.sipDomain,
      sipWebSocketUrl: tenantData.sipWebSocketUrl,
      sipOutboundProxy: tenantData.sipOutboundProxy,
      telephonyProvider: unit.telephony?.provider || tenantData.telephonyProvider || "DIRECT_SIP"
    },
    block: { name: unit.blockName || "Bloco unico" }
  };
}

function toMobileResident(person) {
  const unit = units.get(person.unitId);
  return {
    id: person.id,
    userId: person.email || person.id,
    document: person.cpf || "",
    cpf: person.cpf || "",
    rg: person.rg || "",
    birthDate: person.birthDate || "",
    photoUrl: person.photoUrl || "",
    relation: person.relation || "",
    user: {
      id: person.email || person.id,
      name: person.name,
      email: person.email || "",
      phone: person.phone || ""
    },
    unit: unit ? toMobileUnit(unit) : undefined
  };
}

function toMobileDevice(device) {
  const deviceActions = actions.filter((action) => action.deviceId === device.id);
  return {
    id: device.id,
    tenantId: device.tenantId,
    name: device.name,
    manufacturer: device.manufacturer,
    model: device.model,
    ipAddress: device.ipAddress,
    username: device.username,
    passwordSet: Boolean(device.password || device.passwordSet),
    apiPort: device.apiPort,
    category: device.category,
    intercomEnabled: device.intercomEnabled,
    intercomType: device.intercomType,
    intercomExtension: device.intercomExtension,
    status: device.status,
    latencyMs: device.latencyMs,
    lastCheckedAt: device.lastCheckedAt,
    lastSeenAt: device.lastSeenAt,
    statusReason: device.statusReason,
    doors: [
      ...(device.doors || []),
      ...deviceActions.map((action) => ({ id: action.id, name: action.name, relay: action.relay || 1 }))
    ]
  };
}

function checkTcpDevice(device, timeoutMs = 2500) {
  const host = device.apiHost || device.ipAddress;
  const port = Number(device.apiPort || device.httpPort || 80);
  if (!host || !port) return Promise.resolve({ online: false, latencyMs: null, reason: "Host/porta nao configurados" });

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = net.createConnection({ host, port });
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    }

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ online: true, latencyMs: Date.now() - startedAt, reason: "Conectado" }));
    socket.once("timeout", () => finish({ online: false, latencyMs: null, reason: "Timeout" }));
    socket.once("error", (error) => finish({ online: false, latencyMs: null, reason: error.code || error.message || "Falha de conexao" }));
  });
}

async function refreshDeviceStatuses(tenantId) {
  const targetDevices = devices.filter((device) => !tenantId || device.tenantId === tenantId);
  await Promise.all(targetDevices.map(async (device) => {
    const result = await checkTcpDevice(device);
    device.status = result.online ? "ONLINE" : "OFFLINE";
    device.latencyMs = result.latencyMs;
    device.lastCheckedAt = now();
    device.statusReason = result.reason;
    if (result.online) device.lastSeenAt = device.lastCheckedAt;
  }));
  return targetDevices;
}

function cameraRtspPath(camera) {
  const channel = Number(camera.channel || camera.activeChannels?.[0]?.channel || 1);
  const stream = String(camera.stream || "MAIN").toUpperCase() === "SUB" ? 2 : 1;
  return `/Streaming/channels/${channel}0${stream}`;
}

function cameraRtspUrl(camera, { maskPassword = false } = {}) {
  const username = encodeURIComponent(camera.username || "admin");
  const password = camera.password ? encodeURIComponent(camera.password) : "";
  const auth = password ? `${username}:${maskPassword ? "******" : password}@` : `${username}@`;
  return `rtsp://${auth}${camera.host}:${camera.rtspPort}${cameraRtspPath(camera)}`;
}

function streamDir(cameraId) {
  return path.join(streamRoot, cameraId.replace(/[^a-z0-9_-]/gi, "_"));
}

function hlsContentType(filename) {
  if (filename.endsWith(".m3u8")) return "application/vnd.apple.mpegurl; charset=utf-8";
  if (filename.endsWith(".ts")) return "video/mp2t";
  return "application/octet-stream";
}

function stopStream(cameraId) {
  const session = streamSessions.get(cameraId);
  if (session?.process && !session.process.killed) session.process.kill("SIGTERM");
  streamSessions.delete(cameraId);
}

function ensureStream(camera) {
  const existing = streamSessions.get(camera.id);
  if (existing?.process && !existing.process.killed) {
    existing.lastAccessAt = Date.now();
    return existing;
  }

  if (!fs.existsSync(ffmpegPath)) {
    throw new Error(`FFmpeg nao encontrado em ${ffmpegPath}`);
  }

  if (!camera.password) {
    throw new Error("Senha RTSP nao cadastrada para esta camera");
  }

  const dir = streamDir(camera.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith(".m3u8") || file.endsWith(".ts")) fs.rmSync(path.join(dir, file), { force: true });
  }

  const output = path.join(dir, "index.m3u8");
  const args = [
    "-hide_banner",
    "-loglevel", "warning",
    "-rtsp_transport", "tcp",
    "-analyzeduration", "1000000",
    "-probesize", "1000000",
    "-fflags", "+genpts",
    "-use_wallclock_as_timestamps", "1",
    "-i", cameraRtspUrl(camera),
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    "-profile:v", "baseline",
    "-level", "4.2",
    "-pix_fmt", "yuv420p",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-f", "hls",
    "-hls_time", "1",
    "-hls_list_size", "8",
    "-hls_delete_threshold", "4",
    "-hls_allow_cache", "0",
    "-hls_flags", "delete_segments+independent_segments+omit_endlist",
    "-hls_segment_filename", path.join(dir, "segment_%03d.ts"),
    output
  ];

  const child = spawn(ffmpegPath, args, { windowsHide: true });
  const session = {
    cameraId: camera.id,
    directory: dir,
    process: child,
    startedAt: Date.now(),
    lastAccessAt: Date.now(),
    lastError: ""
  };

  child.stderr.on("data", (chunk) => {
    session.lastError = chunk.toString("utf8").trim().slice(-1000);
  });
  child.on("exit", () => {
    if (streamSessions.get(camera.id) === session) streamSessions.delete(camera.id);
  });

  streamSessions.set(camera.id, session);
  return session;
}

async function waitForFile(filePath, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function toMobileCamera(camera, origin) {
  const device = devices.find((item) => item.id === camera.deviceId);
  const channel = Number(camera.channel || camera.activeChannels?.[0]?.channel || 1);
  const hlsUrl = `${origin}/streams/${camera.id}/index.m3u8`;
  const exposeDirectRtsp = process.env.EXPOSE_CAMERA_RTSP === "true";
  const directRtspUrl = exposeDirectRtsp && camera.password ? cameraRtspUrl(camera) : "";
  return {
    id: camera.id,
    tenantId: camera.tenantId,
    groupId: camera.groupId,
    groupName: camera.groupName,
    name: camera.name || camera.description || `Camera ${channel}`,
    description: camera.description || "",
    location: camera.description || "",
    manufacturer: camera.manufacturer,
    model: camera.model || camera.type,
    host: camera.host,
    ipAddress: camera.ipAddress || camera.host,
    channel,
    activeChannels: camera.activeChannels || [{ channel, description: camera.description || `Canal ${channel}` }],
    status: camera.status || "ONLINE",
    rtspUrl: hlsUrl,
    streamUrl: hlsUrl,
    directRtspUrl,
    playbackMode: directRtspUrl ? "RTSP_NATIVE" : "HLS_GATEWAY",
    deviceType: camera.deviceType || camera.type,
    deviceId: camera.deviceId,
    device: device ? {
      id: device.id,
      name: device.name,
      ipAddress: device.ipAddress,
      manufacturer: device.manufacturer,
      model: device.model,
      status: device.status
    } : undefined
  };
}

function mobileTelephonyConfig(unit = units.get("unit-101")) {
  const unitData = unit || units.get("unit-101");
  const tenantData = unitData?.tenantId === showroomTenant.id ? showroomTenant : tenant;
  const provider = unitData?.telephony?.provider || tenantData.telephonyProvider || "DIRECT_SIP";
  return {
    enabled: true,
    provider,
    gateway: { type: provider },
    sip: {
      domain: unitData?.telephony?.sipDomain || tenantData.sipDomain,
      webSocketUrl: unitData?.telephony?.sipWebSocketUrl || tenantData.sipWebSocketUrl,
      outboundProxy: tenantData.sipOutboundProxy,
      accountPrefix: tenantData.sipAccountPrefix,
      porterExtension: unitData?.telephony?.porterExtension || tenantData.sipPorterExtension
    },
    account: {
      extension: unitData?.telephony?.extension || "9001",
      password: unitData?.telephony?.extensionPassword || "change-me-9001",
      displayName: `Unidade ${unitData?.unitNumber || "101"}`
    },
    callTargets: [
      { type: "PORTER", id: "porter", label: "Portaria", extension: tenantData.sipPorterExtension, available: true },
      ...devices
        .filter((device) => device.intercomEnabled && device.intercomExtension)
        .map((device) => ({ type: "FACIAL", id: device.id, label: device.name, extension: device.intercomExtension, available: true, device: toMobileDevice(device) }))
    ]
  };
}

setInterval(() => {
  const maxIdleMs = 5 * 60 * 1000;
  for (const [cameraId, session] of streamSessions.entries()) {
    if (Date.now() - session.lastAccessAt > maxIdleMs) stopStream(cameraId);
  }
}, 60 * 1000).unref();

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") return json(response, 204, {});

  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, { ok: true, service: "condo-access-clean-api" });
  }

  if (request.method === "GET" && url.pathname === "/api/bootstrap") {
    return json(response, 200, bootstrap());
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(request);
    return json(response, 200, {
      accessToken: "local-demo-token",
      refreshToken: "local-demo-refresh",
      user: {
        id: "user-master",
        name: "Master Administrador",
        email: body.email || "agpsistemascorp@gmail.com",
        role: "SUPER_ADMIN",
        tenantId: tenant.id
      }
    });
  }

  if (request.method === "GET" && url.pathname === "/api/condominiums") {
    return json(response, 200, allTenants());
  }

  if (request.method === "GET" && url.pathname === "/api/condominiums/residents") {
    return json(response, 200, residents.filter((person) => person.kind === "RESIDENT").map(toMobileResident));
  }

  if (request.method === "GET" && url.pathname === "/api/devices") {
    return json(response, 200, devices.map(toMobileDevice));
  }

  if (request.method === "POST" && url.pathname === "/api/devices/status") {
    const tenantId = url.searchParams.get("tenantId") || "";
    const updated = await refreshDeviceStatuses(tenantId);
    return json(response, 200, {
      ok: true,
      checkedAt: now(),
      devices: updated.map(toMobileDevice),
      offline: updated.filter((device) => device.status !== "ONLINE").map(toMobileDevice)
    });
  }

  const deviceTestMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/test$/);
  if (request.method === "GET" && deviceTestMatch) {
    const device = devices.find((item) => item.id === deviceTestMatch[1]);
    if (!device) return json(response, 404, { message: "Equipamento nao encontrado" });
    if (!device.manufacturer?.toLowerCase().includes("hikvision")) {
      return json(response, 200, { ok: true, deviceId: device.id, adapter: "GENERIC", message: "Sem teste especifico para este fabricante" });
    }

    try {
      const result = await testHikvisionDevice(device);
      return json(response, 200, {
        ok: true,
        deviceId: device.id,
        adapter: "HIKVISION_ISAPI",
        baseUrl: deviceBaseUrl(device),
        status: result.status,
        message: "Conexao Hikvision ISAPI OK"
      });
    } catch (error) {
      return json(response, 502, {
        ok: false,
        deviceId: device.id,
        adapter: "HIKVISION_ISAPI",
        baseUrl: deviceBaseUrl(device),
        message: error instanceof Error ? error.message : "Falha ao testar Hikvision"
      });
    }
  }

  if (request.method === "GET" && url.pathname === "/api/devices/cameras") {
    const origin = requestOrigin(request);
    return json(response, 200, cameras.map((camera) => toMobileCamera(camera, origin)));
  }

  if (request.method === "GET" && url.pathname === "/api/access/logs") {
    const tenantId = url.searchParams.get("tenantId");
    const limit = Number(url.searchParams.get("limit") || 50);
    const filtered = tenantId ? accessLogs.filter((log) => log.tenantId === tenantId) : accessLogs;
    return json(response, 200, filtered.slice(0, limit));
  }

  if (request.method === "POST" && url.pathname === "/api/access/open-door") {
    const body = await readBody(request);
    const action = actions.find((item) => item.id === body.doorId) || actions[0];
    const device = devices.find((item) => item.id === action?.deviceId);
    let delivered = false;
    let queued = false;
    let gatewayMessage = "";

    if (device?.manufacturer?.toLowerCase().includes("hikvision") && action?.status !== "DISABLED") {
      try {
        const result = await openHikvisionDoor(device, action.relay || device.doorRelay || 1);
        delivered = true;
        gatewayMessage = `Hikvision respondeu ${result.status}`;
      } catch (error) {
        queued = true;
        gatewayMessage = error instanceof Error ? error.message : "Falha no acionamento Hikvision";
      }
    } else {
      queued = action?.status === "DISABLED";
      delivered = !queued;
      gatewayMessage = action?.status === "DISABLED" ? "Acionamento desativado: comando ficou apenas registrado" : "Acionamento registrado";
    }

    const log = {
      id: makeId("access"),
      tenantId: action?.tenantId || tenant.id,
      unitId: body.unitId || "unit-101",
      decision: delivered ? "ALLOW" : queued ? "PENDING" : "DENY",
      reason: body.reason || "Acionamento remoto",
      createdAt: now(),
      user: { name: body.userName || "App Condo Access" },
      door: { id: action?.id || body.doorId, name: action?.name || "Porta", deviceId: device?.id, manufacturer: device?.manufacturer },
      rawEvent: { gatewayMessage }
    };
    accessLogs.unshift(log);
    return json(response, 200, { delivered, queued, message: gatewayMessage, log });
  }

  if (request.method === "GET" && url.pathname === "/api/condominiums/invites") {
    const origin = requestOrigin(request);
    return json(response, 200, unitInvites.map((invite) => toMobileInvite(invite, origin)));
  }

  if (request.method === "POST" && url.pathname === "/api/condominiums/invites") {
    const body = await readBody(request);
    const unit = units.get(body.unitId || "unit-101") || units.get("unit-101");
    const action = actions.find((item) => item.id === body.doorId) || actions[0];
    const code = `CA${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const invite = {
      id: makeId("invite"),
      code,
      tenantId: unit?.tenantId || tenant.id,
      unitId: unit?.unitId || "unit-101",
      guest: body.guestName || "Convidado",
      guestName: body.guestName || "Convidado",
      guestPhone: body.guestPhone || "",
      invitedBy: body.invitedBy || "App Condo Access",
      status: "Ativo",
      type: "QR_CODE",
      identification: "QR Code",
      doorId: action?.id || body.doorId || "",
      doorName: action?.name || "Porta Entrada",
      validFrom: body.validFrom || now(),
      validUntil: body.validUntil || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      createdAt: now()
    };
    unitInvites.unshift(invite);
    return json(response, 201, toMobileInvite(invite, requestOrigin(request)));
  }

  const publicInviteQrMatch = url.pathname.match(/^\/api\/condominiums\/invites\/public\/([^/]+)\/qr\.png$/);
  if (request.method === "GET" && publicInviteQrMatch) {
    const code = decodeURIComponent(publicInviteQrMatch[1]);
    const invite = unitInvites.find((item) => (item.code || item.id) === code);
    if (!invite) return sendText(response, 404, "text/plain; charset=utf-8", "Convite nao encontrado");
    const buffer = await QRCode.toBuffer(invitePublicUrl(requestOrigin(request), code), {
      type: "png",
      width: 512,
      margin: 1,
      errorCorrectionLevel: "M"
    });
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    return response.end(buffer);
  }

  const publicInviteMatch = url.pathname.match(/^\/api\/condominiums\/invites\/public\/([^/]+)$/);
  if (request.method === "GET" && publicInviteMatch) {
    const code = decodeURIComponent(publicInviteMatch[1]);
    const invite = unitInvites.find((item) => (item.code || item.id) === code);
    if (!invite) return json(response, 404, { message: "Convite nao encontrado" });
    return json(response, 200, toMobileInvite(invite, requestOrigin(request)));
  }

  if (request.method === "GET" && url.pathname === "/api/condominiums/notices") {
    return json(response, 200, []);
  }

  if (request.method === "GET" && url.pathname === "/api/condominiums/maintenance") {
    return json(response, 200, []);
  }

  if (request.method === "GET" && url.pathname === "/api/telephony/config") {
    return json(response, 200, mobileTelephonyConfig(units.get("unit-101")));
  }

  if (request.method === "GET" && url.pathname === "/api/telephony/calls") {
    const tenantId = url.searchParams.get("tenantId");
    return json(response, 200, tenantId ? intercomCalls.filter((call) => call.tenantId === tenantId) : intercomCalls);
  }

  if (request.method === "POST" && url.pathname === "/api/telephony/mobile-call") {
    const body = await readBody(request);
    const unit = units.get(body.unitId || "unit-101") || units.get("unit-101");
    const targetDevice = body.deviceId ? devices.find((device) => device.id === body.deviceId) : null;
    const call = {
      id: makeId("call"),
      tenantId: unit?.tenantId || tenant.id,
      unitId: unit?.unitId || "unit-101",
      unitNumber: unit?.unitNumber || "101",
      targetType: body.targetType || "PORTER",
      deviceId: body.deviceId || "",
      targetExtension: body.targetExtension || (body.targetType === "FACIAL" ? targetDevice?.intercomExtension : tenant.sipPorterExtension),
      targetLabel: body.targetLabel || (body.targetType === "FACIAL" ? targetDevice?.name : "Portaria"),
      sourceExtension: unit?.telephony?.extension || unit?.extension || "",
      sourceDevice: targetDevice ? toMobileDevice(targetDevice) : undefined,
      visitorLabel: body.visitorLabel || `App ${unit?.unitNumber || "morador"}`,
      status: "RINGING",
      sipHandled: Boolean(body.sipHandled),
      createdAt: now(),
      answeredAt: "",
      endedAt: ""
    };
    intercomCalls.unshift(call);
    accessLogs.unshift({
      id: makeId("access"),
      tenantId: call.tenantId,
      unitId: call.unitId,
      decision: "ALLOW",
      reason: `Chamada ${call.targetType}`,
      createdAt: call.createdAt,
      user: { name: call.visitorLabel },
      door: { name: call.targetType === "FACIAL" ? "Facial/Interfone" : "Portaria" }
    });
    return json(response, 201, call);
  }

  const callAnswerMatch = url.pathname.match(/^\/api\/telephony\/calls\/([^/]+)\/answer$/);
  if (request.method === "POST" && callAnswerMatch) {
    const call = intercomCalls.find((item) => item.id === callAnswerMatch[1]);
    if (!call) return json(response, 404, { message: "Chamada nao encontrada" });
    call.status = "ANSWERED";
    call.answeredAt = now();
    accessLogs.unshift({
      id: makeId("access"),
      tenantId: call.tenantId,
      unitId: call.unitId,
      decision: "INFO",
      reason: "Chamada atendida na portaria remota",
      createdAt: call.answeredAt,
      user: { name: "Portaria Remota" },
      door: { name: call.targetType === "FACIAL" ? "Facial/Interfone" : "Portaria" }
    });
    return json(response, 200, call);
  }

  const callEndMatch = url.pathname.match(/^\/api\/telephony\/calls\/([^/]+)\/end$/);
  if (request.method === "POST" && callEndMatch) {
    const call = intercomCalls.find((item) => item.id === callEndMatch[1]);
    if (!call) return json(response, 404, { message: "Chamada nao encontrada" });
    call.status = "ENDED";
    call.endedAt = now();
    return json(response, 200, call);
  }

  if (request.method === "GET" && url.pathname === "/api/mobile/releases/latest") {
    return json(response, 200, null);
  }

  const vlcPlaylistMatch = url.pathname.match(/^\/api\/cameras\/([^/]+)\/vlc\.m3u$/);
  if (request.method === "GET" && vlcPlaylistMatch) {
    const camera = cameras.find((item) => item.id === vlcPlaylistMatch[1]);
    if (!camera) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      return response.end("Camera nao encontrada");
    }

    if (!camera.password) {
      response.writeHead(409, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      return response.end("Senha RTSP nao cadastrada para abrir no VLC");
    }

    const safeName = String(camera.description || camera.name || camera.id).replace(/[^\w.-]+/g, "_");
    const playlist = `#EXTM3U\n#EXTINF:-1,${camera.description || camera.name || "Camera Condo Access"}\n${cameraRtspUrl(camera)}\n`;
    response.writeHead(200, {
      "Content-Type": "audio/x-mpegurl; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}.m3u"`,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    return response.end(playlist);
  }

  const streamMatch = url.pathname.match(/^\/streams\/([^/]+)\/([^/]+)$/);
  if (request.method === "GET" && streamMatch) {
    const streamKey = streamMatch[1];
    const channelMatch = streamKey.match(/^(.*)--ch-(\d+)$/);
    const cameraId = channelMatch ? channelMatch[1] : streamKey;
    const requestedChannel = channelMatch ? Number(channelMatch[2]) : 0;
    const camera = cameras.find((item) => item.id === cameraId);
    if (!camera) {
      response.writeHead(404, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
      return response.end("Camera nao encontrada");
    }
    const streamCamera = requestedChannel > 0
      ? { ...camera, id: streamKey, channel: requestedChannel }
      : camera;

    const filename = streamMatch[2];
    if (!/^(index\.m3u8|segment_\d+\.ts)$/.test(filename)) {
      response.writeHead(404, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
      return response.end("Segmento nao encontrado");
    }

    try {
      const session = ensureStream(streamCamera);
      const filePath = path.join(session.directory, filename);
      const ready = filename === "index.m3u8" ? await waitForFile(filePath) : fs.existsSync(filePath);
      if (!ready) {
        const status = session.lastError ? 502 : 202;
        response.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "X-Condo-Access-RTSP": cameraRtspUrl(streamCamera, { maskPassword: true })
        });
        return response.end(JSON.stringify({
          message: status === 202 ? "Stream ainda inicializando" : "FFmpeg nao conseguiu abrir o RTSP",
          cameraId: streamCamera.id,
          rtsp: cameraRtspUrl(streamCamera, { maskPassword: true }),
          ffmpeg: session.lastError
        }));
      }

      session.lastAccessAt = Date.now();
      response.writeHead(200, {
        "Content-Type": hlsContentType(filename),
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "X-Condo-Access-RTSP": cameraRtspUrl(streamCamera, { maskPassword: true })
      });
      return fs.createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(503, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "X-Condo-Access-RTSP": cameraRtspUrl(streamCamera, { maskPassword: true })
      });
      return response.end(JSON.stringify({
        message: error.message,
        cameraId: streamCamera.id,
        rtsp: cameraRtspUrl(streamCamera, { maskPassword: true }),
        ffmpegPath
      }));
    }
  }

  const tenantTelephonyMatch = url.pathname.match(/^\/api\/condominiums\/([^/]+)\/telephony$/);
  if (request.method === "PUT" && tenantTelephonyMatch) {
    const body = await readBody(request);
    const targetTenant = findTenant(tenantTelephonyMatch[1]);
    syncTenantTelephony(body, targetTenant);
    return json(response, 200, targetTenant);
  }

  if (request.method === "POST" && url.pathname === "/api/condominiums") {
    const body = await readBody(request);
    const isNewTenant = !body.id && !body.tenantId;
    const targetTenant = isNewTenant ? {
      id: makeId("tenant"),
      name: body.name || "Novo condominio",
      document: body.document || "",
      status: body.status || "ACTIVE",
      telephonyEnabled: true,
      telephonyProvider: body.telephonyProvider || "DIRECT_SIP",
      sipDomain: body.sipDomain || asteriskHost,
      sipWebSocketUrl: body.sipWebSocketUrl || asteriskWebSocketUrl,
      sipOutboundProxy: "",
      sipPorterExtension: body.sipPorterExtension || "9000",
      sipPorterPassword: body.sipPorterPassword || "change-me-9000",
      sipAccountPrefix: "",
      sipExtensionGroupName: body.name || "Novo condominio",
      sipExtensionStart: body.sipExtensionStart || "9000",
      sipExtensionEnd: body.sipExtensionEnd || "9999",
      updatedAt: now()
    } : findTenant(body.id || body.tenantId || tenant.id);
    targetTenant.name = body.name || targetTenant.name;
    targetTenant.document = body.document ?? targetTenant.document;
    targetTenant.status = body.status || targetTenant.status;
    syncTenantTelephony(body, targetTenant);
    targetTenant.updatedAt = now();
    if (isNewTenant) extraTenants.unshift(targetTenant);
    return json(response, 201, targetTenant);
  }

  const deleteTenantMatch = url.pathname.match(/^\/api\/condominiums\/([^/]+)$/);
  if (request.method === "DELETE" && deleteTenantMatch) {
    const tenantId = deleteTenantMatch[1];
    const index = extraTenants.findIndex((item) => item.id === tenantId);
    const [removed] = index >= 0 ? extraTenants.splice(index, 1) : [findTenant(tenantId)];
    if (!removed) return json(response, 404, { message: "Condominio nao encontrado" });
    if (index === -1) deletedTenantIds.add(tenantId);
    return json(response, 200, { ok: true, removed });
  }

  if (request.method === "GET" && url.pathname === "/api/licenses") {
    return json(response, 200, licenses);
  }

  if (request.method === "GET" && url.pathname === "/api/manufacturers") {
    return json(response, 200, manufacturerProfiles);
  }

  if (request.method === "GET" && url.pathname === "/api/credentials") {
    return json(response, 200, credentials);
  }

  if (request.method === "GET" && url.pathname === "/api/permissions") {
    return json(response, 200, permissionProfiles);
  }

  if (request.method === "GET" && url.pathname === "/api/credential-sync") {
    return json(response, 200, credentialSyncJobs);
  }

  if (request.method === "POST" && url.pathname === "/api/credential-sync") {
    const body = await readBody(request);
    const job = {
      id: body.id || makeId("sync"),
      tenantId: body.tenantId || tenant.id,
      manufacturer: body.manufacturer || "Generico",
      target: body.target || "Fila manual",
      direction: body.direction || "SEND",
      credentialType: body.credentialType || "FACE",
      status: "PENDING",
      total: Number(body.total || 0),
      synced: 0,
      errors: 0,
      lastRunAt: now()
    };
    credentialSyncJobs.unshift(job);
    return json(response, 201, job);
  }

  if (request.method === "POST" && url.pathname === "/api/licenses") {
    const body = await readBody(request);
    const license = {
      id: body.id || makeId("license"),
      code: body.code || String(Math.floor(10000 + Math.random() * 80000)),
      tenantId: body.tenantId || tenant.id,
      name: body.name || "Nova licenca",
      type: body.type || "Condominio",
      city: body.city || "",
      plan: body.plan || body.attendance || "Full",
      residents: Number(body.residents || 0),
      contractor: body.contractor || body.contract || "",
      visible: body.visible ?? true,
      active: body.active ?? true
    };
    const updated = body.id ? updateById(licenses, body.id, license) : null;
    if (!updated) licenses.unshift(license);
    return json(response, body.id ? 200 : 201, updated || license);
  }

  if (request.method === "POST" && url.pathname === "/api/devices") {
    const body = await readBody(request);
    const existingDevice = body.id ? devices.find((item) => item.id === body.id) : null;
    const device = {
      id: body.id || makeId("device"),
      tenantId: body.tenantId || tenant.id,
      name: body.name || body.description || "Novo equipamento",
      category: body.category || "access-control",
      manufacturer: body.manufacturer || "Generico",
      model: body.model || "",
      ipAddress: body.ipAddress || body.host || "",
      apiHost: body.apiHost || body.ipAddress || body.host || "",
      apiPort: Number(body.apiPort || 80),
      username: body.username || existingDevice?.username || "admin",
      password: body.password || existingDevice?.password || "",
      passwordSet: Boolean(body.password || existingDevice?.password || body.passwordSet),
      authMode: body.authMode || existingDevice?.authMode || "DIGEST",
      intercomEnabled: Boolean(body.intercomEnabled),
      intercomType: body.intercomType || "FACIAL",
      intercomExtension: body.intercomExtension || "",
      status: body.status || "OFFLINE"
    };
    const updated = body.id ? updateById(devices, body.id, device) : null;
    if (!updated) devices.unshift(device);
    return json(response, body.id ? 200 : 201, publicDevice(updated || device));
  }

  if (request.method === "POST" && url.pathname === "/api/cameras") {
    const body = await readBody(request);
    const existingCamera = body.id ? cameras.find((item) => item.id === body.id) : null;
    const type = body.type || body.deviceType || "NVR";
    const startChannel = Math.max(1, Number(body.channel || 1));
    const channelCount = !["DVR", "NVR"].includes(type)
      ? 1
      : Math.min(Math.max(Number(body.channelCount || 1), 1), 64);
    const baseDescription = body.channelDescription || body.description || type;
    const cameraGroupId = body.groupId || (channelCount > 1 ? makeId("camera-group") : existingCamera?.groupId || "");
    const makeCamera = (channel) => {
      const channelDescription = channelCount > 1
        ? `Canal ${channel} - ${type} (${baseDescription})`
        : body.description || `Canal ${channel} - ${type}`;
      return {
        id: body.id || makeId("camera"),
        tenantId: body.tenantId || tenant.id,
        deviceId: body.deviceId || "",
        groupId: cameraGroupId,
        groupName: baseDescription,
        name: body.name || channelDescription,
        description: channelDescription,
        type,
        deviceType: body.deviceType || type,
        manufacturer: body.manufacturer || "Hikvision",
        model: body.model || type,
        protocol: body.protocol || "64",
        stream: body.stream || "MAIN",
        host: body.host || "",
        ipAddress: body.ipAddress || body.host || "",
        rtspPort: Number(body.rtspPort || 554),
        httpPort: Number(body.httpPort || 80),
        username: body.username || "admin",
        password: body.password || existingCamera?.password || "",
        passwordSet: Boolean(body.password || existingCamera?.password || body.passwordSet),
        aspectRatio: body.aspectRatio || "WIDESCREEN",
        loadMethod: body.loadMethod || "HLS_GATEWAY",
        photoCaptureEnabled: Boolean(body.photoCaptureEnabled),
        channel,
        status: body.status || "ONLINE",
        activeChannels: [{ channel, description: channelDescription }]
      };
    };
    const created = Array.from({ length: channelCount }, (_, index) => makeCamera(startChannel + index));
    if (body.id) {
      const updated = updateById(cameras, body.id, created[0]);
      stopStream(body.id);
      return json(response, 200, publicCamera(updated || created[0]));
    }
    cameras.unshift(...created);
    return json(response, 201, created.map(publicCamera));
  }

  const cameraDeleteMatch = url.pathname.match(/^\/api\/cameras\/([^/]+)$/);
  if (request.method === "DELETE" && cameraDeleteMatch) {
    const target = cameras.find((item) => item.id === cameraDeleteMatch[1]);
    if (!target) return json(response, 404, { message: "Camera nao encontrada" });
    const removed = [];
    for (let index = cameras.length - 1; index >= 0; index -= 1) {
      const item = cameras[index];
      if (item.id === target.id || (target.groupId && item.groupId === target.groupId)) {
        removed.unshift(...cameras.splice(index, 1));
        stopStream(item.id);
      }
    }
    return json(response, 200, { ok: true, removed: removed.map(publicCamera) });
  }

  const cameraGroupDeleteMatch = url.pathname.match(/^\/api\/camera-groups\/([^/]+)$/);
  if (request.method === "DELETE" && cameraGroupDeleteMatch) {
    const groupId = cameraGroupDeleteMatch[1];
    const removed = [];
    for (let index = cameras.length - 1; index >= 0; index -= 1) {
      if (cameras[index].groupId === groupId) {
        const [camera] = cameras.splice(index, 1);
        removed.unshift(camera);
        stopStream(camera.id);
      }
    }
    if (!removed.length) return json(response, 404, { message: "Grupo de cameras nao encontrado" });
    return json(response, 200, { ok: true, removed: removed.map(publicCamera) });
  }

  if (request.method === "POST" && url.pathname === "/api/actions") {
    const body = await readBody(request);
    const device = body.deviceId ? devices.find((item) => item.id === body.deviceId) : null;
    const action = {
      id: body.id || makeId("action"),
      tenantId: body.tenantId || device?.tenantId || tenant.id,
      name: body.name || "Novo acionamento",
      manufacturer: body.manufacturer || device?.manufacturer || "Generico",
      deviceId: device?.id || body.deviceId || "",
      relay: Number(body.relay || 1),
      status: body.status || "ACTIVE",
      route: body.route || ""
    };
    const updated = body.id ? updateById(actions, body.id, action) : null;
    if (!updated) actions.unshift(action);
    return json(response, body.id ? 200 : 201, updated || action);
  }

  const deleteActionMatch = url.pathname.match(/^\/api\/actions\/([^/]+)$/);
  if (request.method === "DELETE" && deleteActionMatch) {
    const index = actions.findIndex((item) => item.id === deleteActionMatch[1]);
    if (index === -1) return json(response, 404, { message: "Acionamento nao encontrado" });
    const [removed] = actions.splice(index, 1);
    return json(response, 200, { ok: true, removed });
  }

  const triggerActionMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/trigger$/);
  if (request.method === "POST" && triggerActionMatch) {
    const action = actions.find((item) => item.id === triggerActionMatch[1]);
    if (!action) return json(response, 404, { message: "Acionamento nao encontrado" });
    const device = devices.find((item) => item.id === action.deviceId);
    if (device?.manufacturer?.toLowerCase().includes("hikvision")) {
      try {
        const result = await openHikvisionDoor(device, action.relay || device.doorRelay || 1);
        return json(response, 200, {
          ok: true,
          delivered: true,
          adapter: "HIKVISION_ISAPI",
          actionId: action.id,
          actionName: action.name,
          status: result.status,
          message: `Acionamento ${action.name} enviado via Hikvision ISAPI`,
          at: now()
        });
      } catch (error) {
        return json(response, 502, {
          ok: false,
          delivered: false,
          queued: true,
          adapter: "HIKVISION_ISAPI",
          actionId: action.id,
          actionName: action.name,
          message: error instanceof Error ? error.message : "Falha ao acionar Hikvision",
          at: now()
        });
      }
    }

    return json(response, 200, {
      ok: true,
      delivered: action.status !== "DISABLED",
      queued: action.status === "DISABLED",
      actionId: action.id,
      actionName: action.name,
      message: action.status === "DISABLED" ? "Acionamento desativado" : `Acionamento ${action.name} enviado para o gateway local`,
      at: now()
    });
  }

  const resourceMatch = url.pathname.match(/^\/api\/resources\/([^/]+)$/);
  if (request.method === "PATCH" && resourceMatch) {
    const body = await readBody(request);
    const resource = updateById(resources, resourceMatch[1], body);
    if (!resource) return json(response, 404, { message: "Recurso nao encontrado" });
    return json(response, 200, resource);
  }

  if (request.method === "GET" && url.pathname === "/api/units") {
    return json(response, 200, unitList());
  }

  if (request.method === "POST" && url.pathname === "/api/units") {
    const body = await readBody(request);
    const unitId = body.unitId || body.id || makeId("unit");
    const targetTenant = findTenant(body.tenantId || tenant.id);
    const existing = units.get(unitId);
    const currentTelephony = existing?.telephony || {};
    const nextUnit = {
      tenantId: targetTenant.id,
      unitId,
      unitNumber: body.unitNumber || existing?.unitNumber || "Nova",
      blockName: body.blockName || existing?.blockName || "Bloco unico",
      residentName: body.residentName || existing?.residentName || "",
      responsibleName: body.responsibleName || existing?.responsibleName || body.residentName || "",
      extension: body.extension || existing?.extension || "",
      telephony: {
        enabled: true,
        provider: body.provider || currentTelephony.provider || targetTenant.telephonyProvider,
        sipDomain: body.sipDomain || currentTelephony.sipDomain || targetTenant.sipDomain,
        sipWebSocketUrl: body.sipWebSocketUrl || currentTelephony.sipWebSocketUrl || targetTenant.sipWebSocketUrl,
        sipTransport: body.sipTransport || currentTelephony.sipTransport || "UDP",
        extension: body.extension || currentTelephony.extension || "",
        extensionPassword: body.extensionPassword || currentTelephony.extensionPassword || (body.extension ? `change-me-${body.extension}` : ""),
        porterExtension: body.porterExtension || currentTelephony.porterExtension || targetTenant.sipPorterExtension
      }
    };
    units.set(unitId, nextUnit);
    return json(response, existing ? 200 : 201, nextUnit);
  }

  const deleteUnitMatch = url.pathname.match(/^\/api\/units\/([^/]+)$/);
  if (request.method === "DELETE" && deleteUnitMatch) {
    const unitId = deleteUnitMatch[1];
    const unit = units.get(unitId);
    if (!unit) return json(response, 404, { message: "Unidade nao encontrada" });
    units.delete(unitId);
    return json(response, 200, { ok: true, removed: unit });
  }

  const unitPeopleMatch = url.pathname.match(/^\/api\/units\/([^/]+)\/people$/);
  if (request.method === "GET" && unitPeopleMatch) {
    return json(response, 200, residents.filter((person) => person.unitId === unitPeopleMatch[1]));
  }

  if (request.method === "POST" && url.pathname === "/api/people") {
    const body = await readBody(request);
    const id = body.id || makeId("person");
    const unit = units.get(body.unitId) || units.get("unit-101");
    const person = {
      id,
      tenantId: body.tenantId || unit?.tenantId || tenant.id,
      unitId: body.unitId || unit?.unitId || "unit-101",
      name: body.name || "Nova pessoa",
      email: body.email || "",
      cpf: body.cpf || "",
      rg: body.rg || "",
      phone: body.phone || "",
      role: body.role || (body.kind === "RESIDENT" ? "RESIDENT" : body.kind || "VISITOR"),
      relation: body.relation || body.accessReason || "",
      kind: body.kind || "RESIDENT",
      isSyndic: Boolean(body.isSyndic),
      authorizedBy: body.authorizedBy || "",
      company: body.company || "",
      cnpj: body.cnpj || "",
      serviceType: body.serviceType || "",
      vehiclePlate: body.vehiclePlate || "",
      accessReason: body.accessReason || "",
      credentialType: body.credentialType || "APP",
      allowedDays: body.allowedDays || "",
      allowedHours: body.allowedHours || "",
      createdAt: now()
    };
    const updated = updateById(residents, id, person);
    if (!updated) residents.unshift(person);
    return json(response, updated ? 200 : 201, updated || person);
  }

  const deletePersonMatch = url.pathname.match(/^\/api\/people\/([^/]+)$/);
  if (request.method === "DELETE" && deletePersonMatch) {
    const index = residents.findIndex((person) => person.id === deletePersonMatch[1]);
    if (index === -1) return json(response, 404, { message: "Pessoa nao encontrada" });
    const [removed] = residents.splice(index, 1);
    return json(response, 200, { ok: true, removed });
  }

  const unitLoginsMatch = url.pathname.match(/^\/api\/units\/([^/]+)\/logins$/);
  if (request.method === "GET" && unitLoginsMatch) {
    return json(response, 200, unitLogins.filter((login) => login.unitId === unitLoginsMatch[1]));
  }

  const unitInvitesMatch = url.pathname.match(/^\/api\/units\/([^/]+)\/invites$/);
  if (request.method === "GET" && unitInvitesMatch) {
    return json(response, 200, unitInvites.filter((invite) => invite.unitId === unitInvitesMatch[1]));
  }

  const telephonyMatch = url.pathname.match(/^\/api\/units\/([^/]+)\/telephony$/);
  if (telephonyMatch) {
    const unitId = telephonyMatch[1];
    const unit = units.get(unitId);
    if (!unit) return json(response, 404, { message: "Unidade nao encontrada" });

    if (request.method === "GET") {
      return json(response, 200, {
        tenantId: unit.tenantId,
        unitId: unit.unitId,
        unitNumber: unit.unitNumber,
        residentName: unit.residentName,
        telephony: unit.telephony
      });
    }

    if (request.method === "PUT") {
      const body = await readBody(request);
      unit.telephony = {
        ...unit.telephony,
        ...body,
        extensionPassword: body.extensionPassword || unit.telephony.extensionPassword
      };
      unit.extension = unit.telephony.extension;
      units.set(unitId, unit);
      return json(response, 200, unit);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/extensions/status") {
    const tenantId = url.searchParams.get("tenantId");
    const statuses = extensionStatus(tenantId || "");
    return json(response, 200, { generatedAt: now(), extensions: statuses });
  }

  if (request.method === "GET" && url.pathname === "/api/mobile/me/telephony") {
    return json(response, 200, unitList().map((unit) => ({
      tenantId: unit.tenantId,
      unitId: unit.unitId,
      unitNumber: unit.unitNumber,
      telephony: unit.telephony
    })));
  }

  return json(response, 404, { message: "Rota nao encontrada" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Condo Access Clean API em http://localhost:${port}`);
});
