import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import pg from "pg";
import QRCode from "qrcode";
import {
  INTELBRAS_MHDX_3116C_ADAPTER,
  matchesMhdx3116c,
  mhdx3116cDefaults,
  testMhdx3116c
} from "./integrations/intelbras/mhdx3116c.js";
import {
  INTELBRAS_SS_3532_MF_W_ADAPTER,
  matchesSs3532Mfw,
  openSs3532MfwDoor,
  parseSs3532MfwEventPayload,
  ss3532MfwDefaults,
  ss3532MfwEventToAccessLog,
  testSs3532Mfw
} from "./integrations/intelbras/ss3532Mfw.js";
import {
  applyCameraProfileDefaults,
  cameraRtspPathFromProfile,
  cameraStreamSettings,
  publicCameraProfiles,
  resolveCameraProfile
} from "./integrations/cameras/cameraProfiles.js";

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
const defaultFfmpegPath = process.platform === "win32"
  ? "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe"
  : "ffmpeg";
const ffmpegPath = process.env.FFMPEG_PATH || defaultFfmpegPath;
const streamRoot = path.join(os.tmpdir(), "condo-access-hls");
const defaultDataFilePath = process.env.RAILWAY_ENVIRONMENT
  ? "/data/condo-access-state.json"
  : path.join(process.cwd(), "data", "condo-access-state.json");
const dataFilePath = process.env.DATA_FILE || defaultDataFilePath;
const databaseUrl = process.env.DATABASE_URL || "";
const postgresSslMode = resolvePostgresSslMode(databaseUrl);
const postgresConnectionString = normalizePostgresConnectionString(databaseUrl);
const postgresPool = databaseUrl
  ? new pg.Pool({
    connectionString: postgresConnectionString,
    ssl: postgresSslMode === "require" ? { rejectUnauthorized: false } : undefined
  })
  : null;
let postgresStateReady = false;
let postgresSaveQueue = Promise.resolve();
const defaultMobileCameraStreamsFile = process.platform === "win32"
  ? "C:\\projetis\\BKPAccess\\condo-access-mobile-novo\\src\\cameras\\mobileCameraStreams.ts"
  : "";
const mobileCameraStreamsFile = process.env.MOBILE_CAMERA_STREAMS_FILE ?? defaultMobileCameraStreamsFile;
const mobileCameraSyncStart = "// AUTO-GENERATED WEB CAMERA REGISTRY START";
const mobileCameraSyncEnd = "// AUTO-GENERATED WEB CAMERA REGISTRY END";
const streamSessions = new Map();
const snapshotCache = new Map();
const recentFfmpegIssues = new Map();
const publicSipHost = "granportalresidency.ddns.net";
const standardSipPassword = process.env.SIP_DEFAULT_PASSWORD || "CondoAccess@2026";

function resolvePostgresSslMode(connectionString) {
  const explicitSslMode = String(process.env.PGSSLMODE || "").trim().toLowerCase();
  if (explicitSslMode) return explicitSslMode;

  try {
    return new URL(connectionString).searchParams.get("sslmode")?.toLowerCase() || "";
  } catch {
    return "";
  }
}

function normalizePostgresConnectionString(connectionString) {
  if (!connectionString) return "";

  try {
    const parsed = new URL(connectionString);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("uselibpqcompat");
    return parsed.toString();
  } catch {
    return connectionString;
  }
}

function normalizeSipDomain(value) {
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return publicSipHost;

  try {
    const parsed = new URL(cleanValue);
    return normalizeSipDomain(parsed.hostname);
  } catch {
    const host = cleanValue.replace(/^wss?:\/\//i, "").split(/[/:]/)[0];
    if (!host || ["192.168.3.27", "localhost", "127.0.0.1", "::1"].includes(host)) {
      return publicSipHost;
    }
    return host;
  }
}

function isLocalSipHost(host) {
  return /^(localhost|127\.0\.0\.1|::1)$/i.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

function normalizeSipWebSocketUrl(value, domain = publicSipHost) {
  const cleanDomain = normalizeSipDomain(domain);
  const cleanValue = String(value || "").trim();
  const shouldUseSecureWebSocket = !isLocalSipHost(cleanDomain);
  if (!cleanValue) {
    return shouldUseSecureWebSocket
      ? `wss://${cleanDomain}:8089/ws`
      : `ws://${cleanDomain}:8088/ws`;
  }

  try {
    const parsed = new URL(cleanValue);
    parsed.hostname = normalizeSipDomain(parsed.hostname);
    if (!isLocalSipHost(parsed.hostname)) {
      parsed.protocol = "wss:";
      parsed.port = "8089";
      if (!parsed.pathname || parsed.pathname === "/" || ["/wss", "/sw"].includes(parsed.pathname)) {
        parsed.pathname = "/ws";
      }
    } else {
      parsed.protocol = "ws:";
      parsed.port = "8088";
    }
    return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
  } catch {
    return shouldUseSecureWebSocket
      ? `wss://${cleanDomain}:8089/ws`
      : `ws://${cleanDomain}:8088/ws`;
  }
}

function normalizeSipPassword() {
  return standardSipPassword;
}

const asteriskHost = normalizeSipDomain(process.env.ASTERISK_PUBLIC_HOST || process.env.SIP_DOMAIN || publicSipHost);
const asteriskWebSocketUrl = normalizeSipWebSocketUrl(process.env.ASTERISK_WS_URL, asteriskHost);

function rememberFfmpegIssue(cameraId, issue) {
  recentFfmpegIssues.set(cameraId, {
    ...issue,
    recordedAt: now()
  });
  if (recentFfmpegIssues.size > 100) {
    const oldestKey = recentFfmpegIssues.keys().next().value;
    recentFfmpegIssues.delete(oldestKey);
  }
}

function executableAvailable(executablePath) {
  if (!executablePath) return false;
  if (path.isAbsolute(executablePath) || executablePath.includes("/") || executablePath.includes("\\")) {
    return fs.existsSync(executablePath);
  }
  const result = spawnSync(executablePath, ["-version"], { stdio: "ignore", windowsHide: true });
  return !result.error && result.status === 0;
}

function ffmpegAvailable() {
  return executableAvailable(ffmpegPath);
}

function isFfmpegFatalMessage(message) {
  const relevant = String(message || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/deprecated pixel format used/i.test(line));
  if (!relevant.length) return false;
  return /error|failed|invalid|could not|refused|timed out|401|403|404/i.test(relevant.join("\n"));
}

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
  sipPorterPassword: standardSipPassword,
  sipAccountPrefix: "",
  sipExtensionGroupName: "AGP Sistemas Corp",
  sipExtensionStart: "9100",
  sipExtensionEnd: "9199",
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
  sipPorterPassword: standardSipPassword,
  sipAccountPrefix: "DIN",
  sipExtensionGroupName: "Condominio Dinamus",
  sipExtensionStart: "9200",
  sipExtensionEnd: "9299",
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
    manufacturers: ["Hikvision", "Intelbras", "Uniview", "Tecvoz", "Motorola", "Anko", "Master Digital", "TRX", "ONVIF", "RTSP Generico"],
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
    manufacturers: ["Issabel/Asterisk", "Intelbras", "Hikvision", "Telefonia generica"],
    deviceTypes: ["PABX", "Telefone IP", "ATA VoIP", "Video porteiro"]
  }
];

const manufacturerProfiles = [
  {
    id: "hikvision",
    name: "Hikvision",
    families: ["Camera IP", "DVR multicanal", "NVR multicanal", "Facial", "Video porteiro"],
    protocols: ["RTSP", "HTTP/ISAPI", "Chamada"],
    defaultPorts: ["554", "80", "8000", "5060"],
    credentialTypes: ["FACE", "QR", "RFID", "PIN"],
    syncModes: ["Eventos", "Fotos faciais", "Canais de camera", "Abertura remota"],
    notes: "Usar RTSP para video, ISAPI para eventos/face e ramal quando o equipamento suportar chamada."
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
    protocols: ["RTSP", "HTTP", "SDK", "Chamada"],
    defaultPorts: ["554", "80", "37777", "5060"],
    credentialTypes: ["FACE", "QR", "RFID", "PIN"],
    syncModes: ["Cameras", "Eventos", "Credenciais", "Chamada"],
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
  { id: "voicy", name: "Voicy", enabled: true, group: "Essenciais", configurable: true, description: "Telefonia em nuvem com autoatendimento integrado ao app." },
  { id: "clickApprove", name: "ClickAprova", enabled: true, group: "Controle de acesso", configurable: true, description: "Aprove acessos pelo app com visualizacao das cameras em tempo real." },
  { id: "invites", name: "Convites", enabled: true, group: "Controle de acesso", configurable: true, description: "Envie convites e QR Codes para visitantes autorizados." },
  { id: "notices", name: "Mural", enabled: true, group: "Comunicacao", configurable: true, description: "Publique avisos do condominio para os moradores." },
  { id: "maintenance", name: "Manutencao", enabled: true, group: "Atendimento", configurable: true, description: "Abra e acompanhe solicitacoes de manutencao pelo app." },
  { id: "personalData", name: "Dados pessoais", enabled: true, group: "Cadastro", configurable: true, description: "Permita que moradores atualizem seus dados cadastrais." },
  { id: "unitData", name: "Dados da unidade", enabled: true, group: "Cadastro", configurable: true, description: "Permita consulta e atualizacao dos dados da unidade." },
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

const extensionRegistrationCache = {
  generatedAt: "",
  expiresAt: 0,
  source: "none",
  error: "",
  registrations: new Map()
};

function parseRegistrationRows(text = "") {
  const registrations = new Map();
  String(text).split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\d{2,8})(?:\/\S+)?\s+(\S+)\s+.*?\s(OK\s+\(\d+\s+ms\)|UNKNOWN|UNREACHABLE|Unmonitored|Lagged)/i);
    if (!match) return;
    const [, extension, host, statusText] = match;
    const registered = host !== "(Unspecified)" && /^OK/i.test(statusText);
    registrations.set(extension, {
      extension,
      registered,
      contact: host === "(Unspecified)" ? "" : host,
      rawStatus: statusText,
      checkedAt: now()
    });
  });
  return registrations;
}

function registrationRowsToMap(rows = [], source = "push") {
  const registrations = new Map();
  rows.forEach((item) => {
    const extension = String(item.extension || item.ramal || "").trim();
    if (!extension) return;
    registrations.set(extension, {
      extension,
      registered: Boolean(item.registered || item.status === "Registrado" || item.registrationStatus === "REGISTERED"),
      contact: item.contact || item.ip || "",
      rawStatus: item.rawStatus || item.status || "",
      checkedAt: item.checkedAt || now(),
      source
    });
  });
  return registrations;
}

function rememberPushedExtensionRegistrations(rows = []) {
  Object.assign(extensionRegistrationCache, {
    generatedAt: now(),
    expiresAt: Date.now() + 45000,
    source: "push",
    error: "",
    registrations: registrationRowsToMap(rows, "push")
  });
  return extensionRegistrationCache;
}

async function fetchRegistrationStatusUrl() {
  const statusUrl = String(process.env.ASTERISK_STATUS_URL || "").trim();
  if (!statusUrl) return null;
  const response = await fetch(statusUrl);
  if (!response.ok) throw new Error(`Status de telefonia HTTP ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload.extensions || [];
  return { source: "status-url", registrations: registrationRowsToMap(rows, "status-url") };
}

function fetchAmiCommand(command) {
  const host = String(process.env.ASTERISK_AMI_HOST || "").trim();
  const username = String(process.env.ASTERISK_AMI_USER || "").trim();
  const secret = String(process.env.ASTERISK_AMI_PASSWORD || "").trim();
  const amiPort = Number(process.env.ASTERISK_AMI_PORT || 5038);
  if (!host || !username || !secret) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: amiPort });
    const chunks = [];
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timeout ao consultar AMI"));
    }, 3500);

    socket.on("connect", () => {
      socket.write(`Action: Login\r\nUsername: ${username}\r\nSecret: ${secret}\r\nEvents: off\r\n\r\n`);
      socket.write(`Action: Command\r\nCommand: ${command}\r\n\r\n`);
      socket.write("Action: Logoff\r\n\r\n");
    });
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.on("close", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

async function refreshExtensionRegistrations(force = false) {
  if (extensionRegistrationCache.source === "push" && extensionRegistrationCache.expiresAt > Date.now()) {
    return extensionRegistrationCache;
  }

  if (!force && extensionRegistrationCache.expiresAt > Date.now()) {
    return extensionRegistrationCache;
  }

  try {
    const statusUrlResult = await fetchRegistrationStatusUrl();
    if (statusUrlResult) {
      Object.assign(extensionRegistrationCache, {
        ...statusUrlResult,
        generatedAt: now(),
        expiresAt: Date.now() + 15000,
        error: ""
      });
      return extensionRegistrationCache;
    }

    const amiOutput = await fetchAmiCommand("sip show peers");
    if (!amiOutput) {
      Object.assign(extensionRegistrationCache, {
        generatedAt: now(),
        expiresAt: Date.now() + 15000,
        source: "none",
        error: "",
        registrations: new Map()
      });
      return extensionRegistrationCache;
    }

    Object.assign(extensionRegistrationCache, {
      generatedAt: now(),
      expiresAt: Date.now() + 15000,
      source: "ami",
      error: "",
      registrations: parseRegistrationRows(amiOutput)
    });
    return extensionRegistrationCache;
  } catch (error) {
    Object.assign(extensionRegistrationCache, {
      generatedAt: now(),
      expiresAt: Date.now() + 15000,
      source: "error",
      error: error instanceof Error ? error.message : "Falha ao consultar registros de telefonia"
    });
    return extensionRegistrationCache;
  }
}

function extensionRegistrationStatus(extension, configured, registrationMap) {
  if (!configured) {
    return { status: "Livre", registrationStatus: "FREE", registrationLabel: "Livre", registered: false };
  }

  const registration = registrationMap?.get(String(extension));
  if (!registration) {
    return {
      status: "Sem leitura",
      registrationStatus: "UNKNOWN",
      registrationLabel: "Sem leitura",
      registered: false
    };
  }

  return registration.registered
    ? { status: "Registrado", registrationStatus: "REGISTERED", registrationLabel: "Registrado", registered: true, contact: registration.contact, rawStatus: registration.rawStatus }
    : { status: "Nao registrado", registrationStatus: "UNREGISTERED", registrationLabel: "Nao registrado", registered: false, contact: registration.contact, rawStatus: registration.rawStatus };
}

function extensionStatus(tenantId = "", registrationMap = null) {
  const targetTenant = tenantId ? findTenant(tenantId) : allTenants()[0];
  if (!targetTenant) return [];
  const start = Number(targetTenant.sipExtensionStart || 9100);
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
    const configured = Boolean(unit || device || isPorter);
    const registration = extensionRegistrationStatus(extension, configured, registrationMap);
    return {
      extension,
      label: isPorter ? "Portaria" : unit ? `Unidade ${unit.unitNumber}` : device ? device.name : "Livre",
      type: isPorter ? "PORTER" : unit ? "UNIT" : device ? device.intercomType || "DEVICE" : "FREE",
      configured,
      provisioningStatus: configured ? "Configurado" : "Livre",
      ...registration,
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
    adapter: deviceAdapter(device),
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
    cameraProfiles: publicCameraProfiles(),
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
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  });
  response.end(JSON.stringify(body));
}

function sendText(response, statusCode, contentType, body, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    ...extraHeaders
  });
  response.end(body);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function publicInviteHtml(invite, origin) {
  const mobileInvite = toMobileInvite(invite, origin);
  const validFrom = mobileInvite.validFrom ? new Date(mobileInvite.validFrom).toLocaleString("pt-BR") : "";
  const validUntil = mobileInvite.validUntil ? new Date(mobileInvite.validUntil).toLocaleString("pt-BR") : "";
  const qrUrl = mobileInvite.qrCodeUrl || `${invitePublicUrl(origin, mobileInvite.code)}/qr.png`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Convite Condo Access</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f3f7f8; color: #12242b; }
    main { max-width: 520px; margin: 0 auto; padding: 24px; }
    .card { background: #fff; border: 1px solid #dbe5e8; border-radius: 8px; padding: 22px; box-shadow: 0 8px 24px rgba(10, 31, 38, .08); }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .muted { color: #64757d; margin: 0 0 18px; }
    .qr { width: 100%; max-width: 320px; display: block; margin: 18px auto; border: 1px solid #e5ecef; border-radius: 8px; }
    dl { display: grid; grid-template-columns: 120px 1fr; gap: 10px; margin: 18px 0 0; }
    dt { font-weight: 700; color: #395058; }
    dd { margin: 0; }
    .code { font-family: monospace; word-break: break-all; background: #eef5f6; padding: 10px; border-radius: 6px; }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <h1>Convite de acesso</h1>
      <p class="muted">Apresente este QR Code na portaria ou no leitor autorizado.</p>
      <img class="qr" src="${escapeHtml(qrUrl)}" alt="QR Code do convite">
      <dl>
        <dt>Visitante</dt><dd>${escapeHtml(mobileInvite.guestName)}</dd>
        <dt>Condominio</dt><dd>${escapeHtml(mobileInvite.unit?.tenant?.name || "Condominio")}</dd>
        <dt>Unidade</dt><dd>${escapeHtml(mobileInvite.unit?.id || "-")}</dd>
        <dt>Porta</dt><dd>${escapeHtml(mobileInvite.door?.name || "Entrada")}</dd>
        <dt>Status</dt><dd>${escapeHtml(mobileInvite.status || "Ativo")}</dd>
        ${validFrom ? `<dt>Inicio</dt><dd>${escapeHtml(validFrom)}</dd>` : ""}
        ${validUntil ? `<dt>Valido ate</dt><dd>${escapeHtml(validUntil)}</dd>` : ""}
        <dt>Codigo</dt><dd class="code">${escapeHtml(mobileInvite.code)}</dd>
      </dl>
    </section>
  </main>
</body>
</html>`;
}

async function readBody(request) {
  const raw = await readRawBody(request);
  return raw ? JSON.parse(raw) : {};
}

async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
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
    const target = new URL(targetUrl);
    const uri = `${target.pathname}${target.search}`;
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

function manufacturerKey(item = {}) {
  return String(item.manufacturer || "").toLowerCase();
}

function deviceAdapter(device) {
  const manufacturer = manufacturerKey(device);
  if (manufacturer.includes("hikvision")) return "HIKVISION_ISAPI";
  if (manufacturer.includes("intelbras")) {
    if (matchesSs3532Mfw(device)) return INTELBRAS_SS_3532_MF_W_ADAPTER;
    if (matchesMhdx3116c(device)) return INTELBRAS_MHDX_3116C_ADAPTER;
    return INTELBRAS_MHDX_3116C_ADAPTER;
  }
  return "GENERIC_TCP";
}

async function authenticatedDeviceRequest(device, targetPath, { method = "GET", body = undefined, contentType = "application/xml", timeoutMs = 7000 } = {}) {
  if (!device.password) {
    throw new Error("Senha de integracao nao cadastrada para este equipamento");
  }

  const targetUrl = `${deviceBaseUrl(device)}${targetPath}`;
  const headers = await hikvisionAuthHeaders(device, targetUrl, method);
  const request = withTimeout(timeoutMs);
  try {
    const response = await fetch(targetUrl, {
      method,
      headers: body ? { ...headers, "Content-Type": contentType } : headers,
      body,
      signal: request.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Equipamento respondeu ${response.status}: ${text.slice(0, 240)}`);
    }
    return { ok: true, status: response.status, body: text };
  } finally {
    request.done();
  }
}

async function hikvisionRequest(device, targetPath, options = {}) {
  try {
    return await authenticatedDeviceRequest(device, targetPath, options);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Senha de integracao")) {
      throw new Error("Senha Hikvision nao cadastrada para este equipamento");
    }
    throw error;
  }
}

async function testHikvisionDevice(device) {
  return hikvisionRequest(device, "/ISAPI/System/deviceInfo", { method: "GET" });
}

async function tryDeviceHttpCandidates(device, candidates, timeoutMs = 7000) {
  const attempts = [];
  for (const candidate of candidates) {
    try {
      const result = await authenticatedDeviceRequest(device, candidate.path, {
        method: candidate.method || "GET",
        timeoutMs
      });
      return {
        ...result,
        matched: candidate,
        attempts
      };
    } catch (error) {
      attempts.push({
        path: candidate.path,
        label: candidate.label || candidate.path,
        error: error instanceof Error ? error.message : "Falha desconhecida"
      });
    }
  }

  const lastAttempt = attempts.at(-1);
  const message = lastAttempt
    ? `${lastAttempt.label}: ${lastAttempt.error}`
    : "Nenhum endpoint de diagnostico configurado";
  const error = new Error(message);
  error.attempts = attempts;
  throw error;
}

async function openHikvisionDoor(device, relay = 1) {
  const body = "<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>";
  return hikvisionRequest(device, `/ISAPI/AccessControl/RemoteControl/door/${relay}`, {
    method: "PUT",
    body
  });
}

async function openDeviceDoor(device, relay = 1) {
  const adapter = deviceAdapter(device);
  if (adapter === "HIKVISION_ISAPI") {
    const result = await openHikvisionDoor(device, relay);
    return {
      adapter,
      status: result.status,
      message: `Hikvision respondeu ${result.status}`
    };
  }

  if (adapter === INTELBRAS_SS_3532_MF_W_ADAPTER) {
    const result = await openSs3532MfwDoor(device, relay, { requestDevice: authenticatedDeviceRequest });
    return {
      adapter,
      status: result.status,
      message: `Intelbras Bio-T respondeu ${result.status}`
    };
  }

  throw new Error(`Adapter ${adapter} nao possui comando de abertura direta homologado`);
}

function invitePublicPath(code) {
  return `/api/condominiums/invites/public/${encodeURIComponent(code)}`;
}

function invitePublicUrl(origin, code) {
  return `${origin}${invitePublicPath(code)}`;
}

function toMobileInvite(invite, origin) {
  const inviteTenant = findTenant(invite.tenantId);
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
      tenant: { id: invite.tenantId || inviteTenant.id, name: inviteTenant.name }
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

function activeMobileTenantId() {
  const configuredTenantId = String(process.env.MOBILE_TENANT_ID || "").trim();
  if (configuredTenantId && allTenants().some((item) => item.id === configuredTenantId)) {
    return configuredTenantId;
  }

  return allTenants().find((item) => unitList().some((unit) => unit.tenantId === item.id))?.id || tenant.id;
}

function isMobileTenantUnit(unit) {
  return Boolean(unit && unit.tenantId === activeMobileTenantId());
}

function syncTenantTelephony(body, targetTenant = tenant) {
  const nextDomain = normalizeSipDomain(body.sipDomain ?? targetTenant.sipDomain);
  const nextWebSocketUrl = normalizeSipWebSocketUrl(body.sipWebSocketUrl ?? targetTenant.sipWebSocketUrl, nextDomain);

  Object.assign(targetTenant, {
    telephonyEnabled: body.telephonyEnabled ?? targetTenant.telephonyEnabled,
    telephonyProvider: body.telephonyProvider ?? targetTenant.telephonyProvider,
    sipDomain: nextDomain,
    sipWebSocketUrl: nextWebSocketUrl,
    sipOutboundProxy: body.sipOutboundProxy ?? targetTenant.sipOutboundProxy,
    sipPorterExtension: body.sipPorterExtension ?? targetTenant.sipPorterExtension,
    sipPorterPassword: normalizeSipPassword(body.sipPorterPassword || targetTenant.sipPorterPassword, body.sipPorterExtension || targetTenant.sipPorterExtension),
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
      extensionPassword: normalizeSipPassword(unit.telephony?.extensionPassword, unit.telephony?.extension),
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

function normalizeLookup(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function unitExtension(unit = {}) {
  return String(unit.telephony?.extension || unit.extension || "").trim();
}

function resolveUnitForTelephonyRequest(source = {}) {
  const tenantId = String(source.tenantId || source.condominiumId || source.condoId || "").trim();
  const rawUnitId = String(source.unitId || source.unit_id || "").trim();
  const rawUnitNumber = String(source.unitNumber || source.unit || source.apartment || source.apto || "").trim();
  const rawBlock = String(source.blockName || source.block || "").trim();
  const rawExtension = String(source.sourceExtension || source.extension || source.ramal || source.accountExtension || "").trim();
  const allUnits = unitList();
  const tenantUnits = tenantId ? allUnits.filter((unit) => unit.tenantId === tenantId) : allUnits;
  const candidates = tenantUnits.length ? tenantUnits : allUnits;
  const matchesTenant = (unit) => !tenantId || unit.tenantId === tenantId;

  if (rawUnitId) {
    const exact = units.get(rawUnitId);
    if (exact && matchesTenant(exact)) return exact;
    const normalized = normalizeLookup(rawUnitId);
    const byUnitIdOrNumber = candidates.filter((unit) =>
      normalizeLookup(unit.unitId) === normalized ||
      normalizeLookup(unit.id) === normalized ||
      normalizeLookup(unit.unitNumber) === normalized
    );
    if (byUnitIdOrNumber.length === 1) return byUnitIdOrNumber[0];
    if (byUnitIdOrNumber.length > 1 && tenantId) return byUnitIdOrNumber[0];
  }

  if (rawUnitNumber) {
    const normalizedUnit = normalizeLookup(rawUnitNumber);
    const normalizedBlock = normalizeLookup(rawBlock);
    const byNumber = candidates.filter((unit) =>
      normalizeLookup(unit.unitNumber) === normalizedUnit &&
      (!normalizedBlock || normalizeLookup(unit.blockName) === normalizedBlock)
    );
    if (byNumber.length === 1) return byNumber[0];
    if (byNumber.length > 1 && tenantId) return byNumber[0];
  }

  if (rawExtension) {
    const byExtension = candidates.filter((unit) => unitExtension(unit) === rawExtension);
    if (byExtension.length === 1) return byExtension[0];
    if (byExtension.length > 1 && tenantId) return byExtension[0];
  }

  return tenantUnits[0] || allUnits.find(isMobileTenantUnit) || units.get("unit-101") || allUnits[0] || null;
}

function normalizeCredentialType(type = "APP") {
  const value = String(type || "APP").trim().toUpperCase().replace(/\s+/g, "_");
  if (value === "QR") return "QR_CODE";
  if (value === "CARTAO" || value === "CARD") return "RFID";
  if (value === "PLACA") return "PLATE";
  if (value === "FACIAL") return "FACE";
  return value || "APP";
}

function credentialDisplayValue(type, value, person = {}) {
  if (type === "FACE") return person.name ? `Face - ${person.name}` : "Face cadastrada";
  if (type === "APP") return person.email || person.phone || value;
  return value;
}

function generatedCredentialValue(type, person = {}) {
  const seed = normalizeLookup(person.cpf || person.email || person.phone || person.id || randomBytes(4).toString("hex")).slice(-8);
  if (type === "PIN") return String(Math.floor(100000 + Math.random() * 900000));
  if (type === "QR_CODE") return `QR-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
  if (type === "FACE") return `FACE-${person.id || seed || randomBytes(3).toString("hex")}`;
  if (type === "APP") return `APP-${person.id || seed || randomBytes(3).toString("hex")}`;
  if (type === "PLATE") return normalizeLookup(person.vehiclePlate || "").toUpperCase();
  if (type === "RFID") return seed ? `RFID-${seed.toUpperCase()}` : `RFID-${randomBytes(4).toString("hex").toUpperCase()}`;
  return `${type}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function credentialKey(tenantId, type, value) {
  return `${tenantId}:${normalizeCredentialType(type)}:${normalizeLookup(value)}`;
}

function findPersonForCredential(body = {}) {
  if (body.personId) {
    const person = residents.find((item) => item.id === body.personId);
    if (person) return person;
  }

  const cpf = normalizeLookup(body.cpf || "");
  const email = String(body.email || "").trim().toLowerCase();
  const name = normalizeLookup(body.name || body.personName || "");
  return residents.find((person) =>
    (cpf && normalizeLookup(person.cpf) === cpf) ||
    (email && String(person.email || "").trim().toLowerCase() === email) ||
    (body.unitId && name && person.unitId === body.unitId && normalizeLookup(person.name) === name)
  );
}

function saveCredential(body = {}) {
  const person = findPersonForCredential(body);
  const unit = units.get(body.unitId || person?.unitId) || units.get("unit-101");
  const tenantId = body.tenantId || person?.tenantId || unit?.tenantId || tenant.id;
  const type = normalizeCredentialType(body.type || body.credentialType || person?.credentialType || "APP");
  const value = String(body.value || body.credentialValue || generatedCredentialValue(type, person || body)).trim();
  if (!value) {
    return { error: "Valor da credencial vazio" };
  }

  const duplicate = credentials.find((credential) =>
    credential.id !== body.id &&
    credentialKey(credential.tenantId, credential.type, credential.value) === credentialKey(tenantId, type, value)
  );
  if (duplicate) {
    return { error: "Credencial duplicada", duplicate };
  }

  const credential = {
    id: body.id || makeId("credential"),
    tenantId,
    unitId: body.unitId || person?.unitId || unit?.unitId || "",
    personId: body.personId || person?.id || "",
    personName: body.personName || person?.name || "",
    type,
    value,
    valueLabel: body.valueLabel || credentialDisplayValue(type, value, person || body),
    syncStatus: body.syncStatus || "PENDING",
    deviceId: body.deviceId || "",
    source: body.source || "MANUAL",
    validFrom: body.validFrom || "",
    validUntil: body.validUntil || "",
    createdAt: body.createdAt || now(),
    updatedAt: now()
  };

  const updated = body.id ? updateById(credentials, body.id, credential) : null;
  if (!updated) credentials.unshift(credential);
  return { credential: updated || credential, duplicate: null };
}

function tryParseJson(text = "") {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function valueFromKeys(source = {}, keys = []) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current?.[part], source);
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function collectObjectsByKeys(source, keys = [], found = []) {
  if (!source || typeof source !== "object") return found;
  if (Array.isArray(source)) {
    source.forEach((item) => collectObjectsByKeys(item, keys, found));
    return found;
  }
  Object.entries(source).forEach(([key, value]) => {
    if (keys.includes(key) && Array.isArray(value)) {
      value.filter((item) => item && typeof item === "object").forEach((item) => found.push(item));
    }
    collectObjectsByKeys(value, keys, found);
  });
  return found;
}

function xmlBlocks(text = "", tagNames = []) {
  const blocks = [];
  tagNames.forEach((tagName) => {
    const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
    let match = pattern.exec(text);
    while (match) {
      blocks.push(match[1]);
      match = pattern.exec(text);
    }
  });
  return blocks;
}

function xmlValue(block = "", tagNames = []) {
  for (const tagName of tagNames) {
    const match = block.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
    if (match?.[1]) return match[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
  }
  return "";
}

function queryTableRows(text = "") {
  const rows = new Map();
  String(text).split(/\r?\n|&/).forEach((line) => {
    const match = line.trim().match(/^([^=]+)=([\s\S]*)$/);
    if (!match) return;
    const key = match[1].trim();
    const value = decodeURIComponent(match[2].trim());
    const rowMatch = key.match(/^(?:table\.)?([^.\[]+)\[(\d+)\]\.(.+)$/i);
    if (!rowMatch) return;
    const rowKey = `${rowMatch[1]}-${rowMatch[2]}`;
    const row = rows.get(rowKey) || {};
    row[rowMatch[3]] = value;
    rows.set(rowKey, row);
  });
  return Array.from(rows.values());
}

function deviceCredentialType(rawType = "", fallback = "APP") {
  const value = String(rawType || fallback).toLowerCase();
  if (value.includes("face") || value.includes("facial")) return "FACE";
  if (value.includes("card") || value.includes("cart") || value.includes("rfid") || value.includes("tag")) return "RFID";
  if (value.includes("pin") || value.includes("password") || value.includes("senha")) return "PIN";
  if (value.includes("qr")) return "QR_CODE";
  if (value.includes("plate") || value.includes("placa")) return "PLATE";
  return normalizeCredentialType(fallback);
}

function normalizeDeviceCredential(record = {}, source = {}, fallbackType = "APP") {
  const type = deviceCredentialType(
    record.type || record.credentialType || record.cardType || record.Method || record.method,
    fallbackType
  );
  const personName = valueFromKeys(record, ["name", "employeeName", "userName", "UserName", "CardName", "personName", "NickName"]);
  const personExternalId = valueFromKeys(record, ["employeeNoString", "employeeNo", "userId", "UserID", "cardUserId", "UserIDList.0", "id"]);
  const value = valueFromKeys(record, [
    "value",
    "cardNo",
    "CardNo",
    "cardNumber",
    "card",
    "password",
    "Password",
    "pin",
    "QRCode",
    "qrCode",
    "plateNo",
    "employeeNoString",
    "employeeNo",
    "userId",
    "UserID",
    "id"
  ]) || `${type}-${personExternalId || personName || randomBytes(3).toString("hex")}`;
  if (!String(value).trim()) return null;
  return {
    id: `${source.kind || type}-${normalizeLookup(value).slice(0, 24)}`,
    type,
    value: String(value).trim(),
    valueLabel: type === "FACE" && personName ? `Face - ${personName}` : String(value).trim(),
    personName,
    personExternalId,
    source: source.source || "DEVICE",
    sourceKind: source.kind || fallbackType,
    devicePath: source.path || "",
    raw: record
  };
}

function parseDeviceCredentialResponse(text = "", source = {}, fallbackType = "APP") {
  const parsed = tryParseJson(text);
  let rows = [];
  if (parsed) {
    rows = collectObjectsByKeys(parsed, [
      "CardInfo",
      "UserInfo",
      "FaceInfo",
      "MatchInfo",
      "Info",
      "users",
      "cards",
      "faces",
      "records"
    ]);
    if (!rows.length && parsed && typeof parsed === "object") rows = [parsed];
  } else if (text.includes("<")) {
    rows = xmlBlocks(text, ["CardInfo", "UserInfo", "FaceInfo", "MatchInfo", "Info"]).map((block) => ({
      cardNo: xmlValue(block, ["cardNo", "cardNumber", "CardNo"]),
      employeeNoString: xmlValue(block, ["employeeNoString", "employeeNo", "userId", "UserID", "id"]),
      name: xmlValue(block, ["name", "employeeName", "userName", "UserName", "CardName"]),
      password: xmlValue(block, ["password", "Password", "pin"]),
      type: source.kind
    })).filter((row) => Object.values(row).some(Boolean));
  } else {
    rows = queryTableRows(text);
  }

  const records = rows
    .map((row) => normalizeDeviceCredential(row, source, fallbackType))
    .filter(Boolean);
  const seen = new Set();
  return records.filter((record) => {
    const key = credentialKey("", record.type, record.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readDeviceCredentialsFromDevice(device) {
  const adapter = deviceAdapter(device);
  const attempts = [];
  const records = [];
  const hikvisionBody = (rootName) => JSON.stringify({
    [rootName]: {
      searchID: `condo-${Date.now()}`,
      searchResultPosition: 0,
      maxResults: 500
    }
  });
  const candidates = adapter === "HIKVISION_ISAPI"
    ? [
      { label: "Hikvision cartoes", kind: "CARD", type: "RFID", method: "POST", path: "/ISAPI/AccessControl/CardInfo/Search?format=json", body: hikvisionBody("CardInfoSearchCond"), contentType: "application/json" },
      { label: "Hikvision usuarios", kind: "USER", type: "APP", method: "POST", path: "/ISAPI/AccessControl/UserInfo/Search?format=json", body: hikvisionBody("UserInfoSearchCond"), contentType: "application/json" },
      { label: "Hikvision faces", kind: "FACE", type: "FACE", method: "POST", path: "/ISAPI/AccessControl/FaceInfo/Search?format=json", body: hikvisionBody("FaceInfoSearchCond"), contentType: "application/json" }
    ]
    : adapter === INTELBRAS_SS_3532_MF_W_ADAPTER
      ? [
        { label: "Intelbras usuarios", kind: "USER", type: "APP", method: "GET", path: "/cgi-bin/AccessUser.cgi?action=listAll" },
        { label: "Intelbras cartoes", kind: "CARD", type: "RFID", method: "GET", path: "/cgi-bin/AccessCard.cgi?action=listAll" },
        { label: "Intelbras faces", kind: "FACE", type: "FACE", method: "GET", path: "/cgi-bin/AccessFace.cgi?action=listAll" }
      ]
      : [];

  if (!candidates.length) {
    return {
      ok: false,
      adapter,
      records,
      attempts,
      message: `Adapter ${adapter} ainda nao possui leitura direta de credenciais homologada`
    };
  }

  for (const candidate of candidates) {
    try {
      const result = await authenticatedDeviceRequest(device, candidate.path, {
        method: candidate.method,
        body: candidate.body,
        contentType: candidate.contentType || "application/json",
        timeoutMs: 9000
      });
      const parsedRecords = parseDeviceCredentialResponse(result.body, {
        source: "DEVICE_API",
        kind: candidate.kind,
        path: candidate.path
      }, candidate.type);
      records.push(...parsedRecords);
      attempts.push({
        label: candidate.label,
        path: candidate.path,
        ok: true,
        status: result.status,
        records: parsedRecords.length
      });
    } catch (error) {
      attempts.push({
        label: candidate.label,
        path: candidate.path,
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao ler credenciais"
      });
    }
  }

  const seen = new Set();
  const uniqueRecords = records.filter((record) => {
    const key = credentialKey(device.tenantId, record.type, record.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    ok: uniqueRecords.length > 0,
    adapter,
    source: "DEVICE_API",
    records: uniqueRecords,
    attempts,
    message: uniqueRecords.length
      ? `${uniqueRecords.length} credencial(is) lida(s) do equipamento`
      : "Nenhuma credencial foi retornada pelos endpoints testados"
  };
}

function matchResidentForDeviceCredential(record = {}, device = {}) {
  const externalId = normalizeLookup(record.personExternalId || "");
  const name = normalizeLookup(record.personName || "");
  return residents.find((person) =>
    person.tenantId === device.tenantId &&
    (
      (externalId && [person.id, person.cpf, person.rg, person.phone, person.email].some((value) => normalizeLookup(value) === externalId)) ||
      (name && normalizeLookup(person.name) === name)
    )
  ) || null;
}

async function importDeviceCredentials(device, { dryRun = true } = {}) {
  const readResult = await readDeviceCredentialsFromDevice(device);
  const report = {
    dryRun,
    device: publicDevice(device),
    adapter: readResult.adapter,
    source: readResult.source || "DEVICE_API",
    generatedAt: now(),
    total: readResult.records.length,
    valid: 0,
    duplicates: 0,
    credentialsCreated: 0,
    credentialsUpdated: 0,
    invalid: 0,
    attempts: readResult.attempts,
    message: readResult.message,
    items: []
  };

  readResult.records.forEach((record, index) => {
    const rowNumber = index + 1;
    if (!record.value || !record.type) {
      report.invalid += 1;
      report.items.push({ row: rowNumber, status: "INVALID", payload: record, errors: ["Credencial sem tipo ou valor"] });
      return;
    }

    const person = matchResidentForDeviceCredential(record, device);
    const unit = unitForId(person?.unitId);
    const existingCredential = credentials.find((credential) =>
      credentialKey(credential.tenantId, credential.type, credential.value) === credentialKey(device.tenantId, record.type, record.value)
    );
    if (existingCredential) report.duplicates += 1;

    let credential = existingCredential;
    if (!dryRun) {
      if (existingCredential) {
        Object.assign(existingCredential, {
          deviceId: existingCredential.deviceId || device.id,
          personId: existingCredential.personId || person?.id || "",
          personName: existingCredential.personName || person?.name || record.personName || "",
          unitId: existingCredential.unitId || unit?.unitId || "",
          source: "DEVICE_IMPORT",
          syncStatus: "SYNCED",
          lastSyncedAt: now(),
          updatedAt: now()
        });
        credential = existingCredential;
      } else {
        const result = saveCredential({
          tenantId: device.tenantId,
          unitId: unit?.unitId || "",
          personId: person?.id || "",
          personName: person?.name || record.personName || "",
          type: record.type,
          value: record.value,
          valueLabel: record.valueLabel,
          deviceId: device.id,
          source: "DEVICE_IMPORT",
          syncStatus: "SYNCED"
        });
        credential = result.credential || result.duplicate;
      }
    }

    report.valid += 1;
    if (existingCredential) report.credentialsUpdated += dryRun ? 0 : 1;
    else report.credentialsCreated += dryRun ? 0 : 1;
    report.items.push({
      row: rowNumber,
      status: existingCredential ? "DUPLICATE_OR_UPDATE" : "NEW",
      credentialId: credential?.id || "",
      personId: person?.id || "",
      unitId: unit?.unitId || "",
      payload: {
        type: record.type,
        value: record.value,
        valueLabel: record.valueLabel,
        personName: record.personName,
        personExternalId: record.personExternalId,
        devicePath: record.devicePath
      }
    });
  });

  if (!dryRun) savePersistentState("device-credentials-imported");
  return report;
}

const equipmentIntegrationResources = new Set(["summary", "events", "credentials", "schedules", "faces", "users"]);

function unitForId(unitId = "") {
  return units.get(unitId) || unitList().find((unit) => unit.unitId === unitId) || null;
}

function tenantCredentialsForDevice(device) {
  return credentials.filter((credential) =>
    credential.tenantId === device.tenantId &&
    (!credential.deviceId || credential.deviceId === device.id)
  );
}

function integrationPerson(personId = "") {
  return residents.find((person) => person.id === personId) || null;
}

function integrationCredentialRecord(credential) {
  const person = integrationPerson(credential.personId);
  const unit = unitForId(credential.unitId || person?.unitId);
  return {
    id: credential.id,
    personId: credential.personId || person?.id || "",
    personName: credential.personName || person?.name || "Sem pessoa vinculada",
    unitId: credential.unitId || unit?.unitId || "",
    unitNumber: unit?.unitNumber || "",
    type: credential.type,
    valueLabel: credential.valueLabel || credential.value,
    syncStatus: credential.syncStatus || "PENDING",
    deviceId: credential.deviceId || "",
    validFrom: credential.validFrom || "",
    validUntil: credential.validUntil || "",
    source: credential.source || "LOCAL"
  };
}

function integrationUserRecord(person) {
  const unit = unitForId(person.unitId);
  const personCredentials = credentials.filter((credential) =>
    credential.tenantId === person.tenantId &&
    credential.personId === person.id
  );
  return {
    id: person.id,
    name: person.name,
    kind: person.kind || "RESIDENT",
    role: person.role || "",
    unitId: person.unitId || "",
    unitNumber: unit?.unitNumber || "",
    blockName: unit?.blockName || "",
    cpf: person.cpf || "",
    rg: person.rg || "",
    phone: person.phone || "",
    email: person.email || "",
    vehiclePlate: person.vehiclePlate || "",
    allowedDays: person.allowedDays || "",
    allowedHours: person.allowedHours || "",
    credentials: personCredentials.map((credential) => ({
      id: credential.id,
      type: credential.type,
      valueLabel: credential.valueLabel || credential.value,
      syncStatus: credential.syncStatus || "PENDING"
    }))
  };
}

function integrationScheduleRecords(device) {
  const credentialWindows = tenantCredentialsForDevice(device)
    .filter((credential) => credential.validFrom || credential.validUntil)
    .map((credential) => {
      const person = integrationPerson(credential.personId);
      return {
        id: `credential-${credential.id}`,
        name: credential.valueLabel || credential.type,
        type: "CREDENTIAL_WINDOW",
        origin: "Credencial",
        target: person?.name || credential.personName || credential.valueLabel || credential.type,
        validFrom: credential.validFrom || "",
        validUntil: credential.validUntil || "",
        allowedDays: "",
        allowedHours: ""
      };
    });

  const peopleRules = residents
    .filter((person) => person.tenantId === device.tenantId && (person.allowedDays || person.allowedHours))
    .map((person) => ({
      id: `person-${person.id}`,
      name: person.name,
      type: "PERSON_RULE",
      origin: person.kind || "Pessoa",
      target: unitForId(person.unitId)?.unitNumber ? `Unidade ${unitForId(person.unitId)?.unitNumber}` : "Pessoa",
      validFrom: "",
      validUntil: "",
      allowedDays: person.allowedDays || "",
      allowedHours: person.allowedHours || ""
    }));

  const inviteWindows = unitInvites
    .filter((invite) => invite.tenantId === device.tenantId)
    .map((invite) => ({
      id: `invite-${invite.id}`,
      name: invite.guest || invite.guestName || "Convite",
      type: "INVITE_WINDOW",
      origin: "Convite QR",
      target: invite.doorName || invite.door?.name || "Porta",
      validFrom: invite.validFrom || "",
      validUntil: invite.validUntil || "",
      allowedDays: "",
      allowedHours: ""
    }));

  const routeRules = accessRoutes
    .filter((route) => !route.tenantId || route.tenantId === device.tenantId)
    .map((route) => ({
      id: `route-${route.id}`,
      name: route.name,
      type: "ACCESS_ROUTE",
      origin: "Rota de acesso",
      target: route.description || route.name,
      validFrom: "",
      validUntil: "",
      allowedDays: route.allowedDays || "Todos",
      allowedHours: route.allowedHours || "24h"
    }));

  return [...credentialWindows, ...peopleRules, ...inviteWindows, ...routeRules];
}

function integrationEventRecords(device, limit = 50) {
  const deviceLogs = accessLogs.filter((log) => log.door?.deviceId === device.id);
  const tenantLogs = accessLogs.filter((log) => !log.tenantId || log.tenantId === device.tenantId);
  const selectedLogs = deviceLogs.length ? deviceLogs : tenantLogs;
  return selectedLogs.slice(0, limit).map((log) => ({
    id: log.id,
    decision: log.decision || "INFO",
    reason: log.reason || "",
    createdAt: log.createdAt || "",
    userName: log.user?.name || "",
    userId: log.user?.id || "",
    unitId: log.unitId || "",
    doorName: log.door?.name || "",
    doorId: log.door?.id || "",
    deviceId: log.door?.deviceId || "",
    manufacturer: log.door?.manufacturer || device.manufacturer || "",
    rawEvent: log.rawEvent || null,
    scope: deviceLogs.length ? "DEVICE" : "TENANT"
  }));
}

function deviceIntegrationPayload(device, resource = "summary", { limit = 50 } = {}) {
  const adapter = deviceAdapter(device);
  const credentialRecords = tenantCredentialsForDevice(device).map(integrationCredentialRecord);
  const faceRecords = credentialRecords.filter((credential) => credential.type === "FACE");
  const userRecords = residents
    .filter((person) => person.tenantId === device.tenantId)
    .map(integrationUserRecord);
  const scheduleRecords = integrationScheduleRecords(device);
  const eventRecords = integrationEventRecords(device, limit);
  const resourcesPayload = {
    events: eventRecords,
    credentials: credentialRecords,
    schedules: scheduleRecords,
    faces: faceRecords,
    users: userRecords
  };
  const summary = Object.fromEntries(Object.entries(resourcesPayload).map(([key, records]) => [key, records.length]));
  const hasDeviceApi = ["HIKVISION_ISAPI", INTELBRAS_SS_3532_MF_W_ADAPTER].includes(adapter);

  return {
    ok: true,
    generatedAt: now(),
    source: "LOCAL_STATE",
    message: hasDeviceApi
      ? "Dados consolidados do banco local; leitura direta do fabricante pronta para homologacao por endpoint."
      : "Dados consolidados do banco local; equipamento usa adapter generico.",
    resource,
    summary,
    capabilities: {
      adapter,
      directDeviceRead: false,
      webhookEvents: adapter === INTELBRAS_SS_3532_MF_W_ADAPTER,
      localCredentials: true,
      localSchedules: true,
      localFaces: true,
      localUsers: true
    },
    device: publicDevice(device),
    records: resource === "summary" ? [] : resourcesPayload[resource] || [],
    resources: resource === "summary" ? resourcesPayload : undefined
  };
}

function pickImportValue(row = {}, aliases = []) {
  const entries = Object.entries(row);
  const normalizedAliases = aliases.map(normalizeLookup);
  const found = entries.find(([key]) => normalizedAliases.includes(normalizeLookup(key)));
  return found ? String(found[1] ?? "").trim() : "";
}

function importRowToPayload(row = {}, tenantId = tenant.id) {
  return {
    tenantId,
    unitNumber: pickImportValue(row, ["unidade", "apartamento", "apto", "numero unidade", "unitNumber"]),
    blockName: pickImportValue(row, ["bloco", "torre", "quadra", "blockName"]),
    name: pickImportValue(row, ["nome", "morador", "pessoa", "responsavel", "name"]),
    cpf: pickImportValue(row, ["cpf", "documento", "doc"]),
    rg: pickImportValue(row, ["rg", "identidade"]),
    phone: pickImportValue(row, ["telefone", "celular", "phone", "whatsapp"]),
    email: pickImportValue(row, ["email", "e-mail", "login"]),
    relation: pickImportValue(row, ["relacao", "parentesco", "tipo morador"]) || "Morador",
    kind: pickImportValue(row, ["tipo pessoa", "perfil", "kind"]) || "RESIDENT",
    vehiclePlate: pickImportValue(row, ["placa", "veiculo", "plate"]),
    credentialType: pickImportValue(row, ["tipo credencial", "credencial tipo", "credentialType", "tipo"]) || "APP",
    credentialValue: pickImportValue(row, ["credencial", "valor credencial", "cartao", "rfid", "tag", "pin", "qr"])
  };
}

function findUnitByNumber(tenantId, unitNumber, blockName = "") {
  const normalizedUnit = normalizeLookup(unitNumber);
  const normalizedBlock = normalizeLookup(blockName);
  return unitList().find((unit) =>
    unit.tenantId === tenantId &&
    normalizeLookup(unit.unitNumber) === normalizedUnit &&
    (!normalizedBlock || normalizeLookup(unit.blockName) === normalizedBlock)
  );
}

function upsertImportUnit(payload, dryRun) {
  const existing = findUnitByNumber(payload.tenantId, payload.unitNumber, payload.blockName);
  if (dryRun) return existing || { unitId: "", unitNumber: payload.unitNumber, blockName: payload.blockName };
  const unitId = existing?.unitId || makeId("unit");
  const targetTenant = findTenant(payload.tenantId);
  const unit = {
    tenantId: targetTenant.id,
    unitId,
    unitNumber: payload.unitNumber,
    blockName: payload.blockName || existing?.blockName || "Bloco unico",
    residentName: payload.name || existing?.residentName || "",
    responsibleName: payload.name || existing?.responsibleName || "",
    extension: existing?.extension || "",
    telephony: existing?.telephony || {
      enabled: true,
      provider: targetTenant.telephonyProvider,
      sipDomain: targetTenant.sipDomain,
      sipWebSocketUrl: targetTenant.sipWebSocketUrl,
      sipTransport: "UDP",
      extension: "",
      extensionPassword: standardSipPassword,
      porterExtension: targetTenant.sipPorterExtension
    }
  };
  units.set(unitId, unit);
  return unit;
}

function upsertImportPerson(payload, unit, dryRun) {
  const existing = findPersonForCredential({ ...payload, unitId: unit?.unitId });
  if (dryRun) return existing || { id: "", unitId: unit?.unitId || "", tenantId: payload.tenantId, name: payload.name };
  const person = {
    id: existing?.id || makeId("person"),
    tenantId: payload.tenantId,
    unitId: unit?.unitId || "",
    name: payload.name,
    email: payload.email,
    cpf: payload.cpf,
    rg: payload.rg,
    phone: payload.phone,
    role: payload.kind === "RESIDENT" ? "RESIDENT" : payload.kind,
    relation: payload.relation,
    kind: payload.kind || "RESIDENT",
    isSyndic: Boolean(existing?.isSyndic),
    authorizedBy: existing?.authorizedBy || "",
    company: existing?.company || "",
    cnpj: existing?.cnpj || "",
    serviceType: existing?.serviceType || "",
    vehiclePlate: payload.vehiclePlate,
    accessReason: existing?.accessReason || "",
    credentialType: normalizeCredentialType(payload.credentialType),
    allowedDays: existing?.allowedDays || "",
    allowedHours: existing?.allowedHours || "",
    createdAt: existing?.createdAt || now(),
    updatedAt: now()
  };
  const updated = updateById(residents, person.id, person);
  if (!updated) residents.unshift(person);
  return updated || person;
}

function processCredentialSyncJob(job) {
  const targetDevices = job.deviceId
    ? devices.filter((device) => device.id === job.deviceId)
    : devices.filter((device) => !job.tenantId || device.tenantId === job.tenantId);
  const selectedCredentials = credentials.filter((credential) =>
    credential.tenantId === job.tenantId &&
    (!job.credentialType || credential.type === normalizeCredentialType(job.credentialType)) &&
    (!job.personId || credential.personId === job.personId) &&
    (!job.credentialId || credential.id === job.credentialId)
  );

  job.status = "RUNNING";
  job.total = selectedCredentials.length;
  job.synced = 0;
  job.errors = 0;
  job.results = [];

  selectedCredentials.forEach((credential) => {
    if (!targetDevices.length) {
      credential.syncStatus = "PENDING";
      job.errors += 1;
      job.results.push({ credentialId: credential.id, ok: false, message: "Nenhum equipamento alvo cadastrado" });
      return;
    }

    const compatible = targetDevices.find((device) => {
      const adapter = deviceAdapter(device);
      if (credential.type === "FACE") return adapter === "HIKVISION_ISAPI" || adapter === INTELBRAS_SS_3532_MF_W_ADAPTER;
      return adapter !== "GENERIC_TCP" || device.category === "access-control";
    });

    if (!compatible) {
      credential.syncStatus = "ERROR";
      job.errors += 1;
      job.results.push({ credentialId: credential.id, ok: false, message: "Nenhum equipamento compativel com o tipo da credencial" });
      return;
    }

    credential.syncStatus = "SYNCED";
    credential.deviceId = compatible.id;
    credential.lastSyncedAt = now();
    credential.syncMessage = `${credential.type} enfileirada para ${compatible.manufacturer}`;
    job.synced += 1;
    job.results.push({
      credentialId: credential.id,
      ok: true,
      deviceId: compatible.id,
      adapter: deviceAdapter(compatible),
      message: "Sincronismo local concluido; envio fisico depende do conector do fabricante"
    });
  });

  job.status = job.errors && job.synced ? "PARTIAL" : job.errors ? "ERROR" : "DONE";
  job.lastRunAt = now();
  return job;
}

function syncUnitResidentFromPreRegistration(unit, body = {}) {
  const name = String(body.residentName || body.responsibleName || "").trim();
  if (!name) return null;

  const existing = residents.find((person) =>
    person.unitId === unit.unitId &&
    (person.kind || "RESIDENT") === "RESIDENT" &&
    (person.relation === "Responsavel" || person.relation === "Proprietario" || person.name === unit.residentName)
  ) || residents.find((person) => person.unitId === unit.unitId && (person.kind || "RESIDENT") === "RESIDENT");

  const resident = {
    id: existing?.id || makeId("person"),
    tenantId: unit.tenantId,
    unitId: unit.unitId,
    name,
    email: body.residentEmail || existing?.email || "",
    cpf: body.residentCpf || existing?.cpf || "",
    rg: body.residentRg || existing?.rg || "",
    phone: body.residentPhone || existing?.phone || "",
    role: existing?.role || "RESIDENT",
    relation: body.residentRelation || existing?.relation || (body.responsibleName ? "Responsavel" : "Morador"),
    kind: "RESIDENT",
    isSyndic: Boolean(existing?.isSyndic),
    authorizedBy: existing?.authorizedBy || "",
    company: existing?.company || "",
    cnpj: existing?.cnpj || "",
    serviceType: existing?.serviceType || "",
    vehiclePlate: existing?.vehiclePlate || "",
    accessReason: existing?.accessReason || "",
    credentialType: existing?.credentialType || "APP",
    allowedDays: existing?.allowedDays || "",
    allowedHours: existing?.allowedHours || "",
    createdAt: existing?.createdAt || now(),
    updatedAt: now()
  };

  const updated = updateById(residents, resident.id, resident);
  if (!updated) residents.unshift(resident);
  return updated || resident;
}

function requestOrigin(request) {
  const proto = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers["x-forwarded-host"] || request.headers.host || `localhost:${port}`;
  return `${proto}://${host}`;
}

function normalizedTenantTelephony(tenantData) {
  const domain = normalizeSipDomain(tenantData?.sipDomain);
  return {
    sipDomain: domain,
    sipWebSocketUrl: normalizeSipWebSocketUrl(tenantData?.sipWebSocketUrl, domain),
    sipOutboundProxy: tenantData?.sipOutboundProxy || "",
    telephonyProvider: tenantData?.telephonyProvider || "DIRECT_SIP"
  };
}

function toMobileUnit(unit) {
  const tenantData = findTenant(unit.tenantId);
  const telephony = normalizedTenantTelephony(tenantData);
  return {
    id: unit.unitId,
    number: unit.unitNumber,
    ownerName: unit.ownerName || unit.responsibleName || unit.residentName || "",
    ownerDocument: unit.ownerDocument || unit.residentDocument || unit.residentCpf || "",
    extension: unit.telephony?.extension || unit.extension,
    extensionPassword: normalizeSipPassword(unit.telephony?.extensionPassword, unit.telephony?.extension || unit.extension),
    documents: unit.documents || "",
    tenant: {
      id: tenantData.id,
      name: tenantData.name,
      sipDomain: normalizeSipDomain(unit.telephony?.sipDomain || telephony.sipDomain),
      sipWebSocketUrl: normalizeSipWebSocketUrl(unit.telephony?.sipWebSocketUrl || telephony.sipWebSocketUrl, unit.telephony?.sipDomain || telephony.sipDomain),
      sipOutboundProxy: telephony.sipOutboundProxy,
      telephonyProvider: unit.telephony?.provider || telephony.telephonyProvider
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

function residentDateScore(person) {
  return Date.parse(person.updatedAt || person.createdAt || "") || 0;
}

function residentUnitPriority(person) {
  const unit = units.get(person.unitId);
  if (unit?.residentId === person.id) return 4;
  if (unit?.preRegisteredResident?.id === person.id) return 3;
  if (["Responsavel", "Proprietario"].includes(person.relation)) return 2;
  return 1;
}

function compareMobileResident(left, right) {
  const priorityDiff = residentUnitPriority(left) - residentUnitPriority(right);
  if (priorityDiff !== 0) return priorityDiff;
  return residentDateScore(left) - residentDateScore(right);
}

function mobileResidentList({ tenantId = "", userId = "", email = "" } = {}) {
  const normalizedUser = normalizeLookup(userId || email);
  const candidates = residents
    .filter((person) => (person.kind || "RESIDENT") === "RESIDENT")
    .filter((person) => {
      const unit = units.get(person.unitId);
      if (!unit) return false;
      if (tenantId && unit.tenantId !== tenantId) return false;
      if (normalizedUser) {
        return [person.id, person.email, person.cpf, person.phone].some((value) => normalizeLookup(value) === normalizedUser);
      }
      return tenantId ? true : isMobileTenantUnit(unit);
    });
  const scopedResidents = candidates.length
    ? candidates
    : residents.filter((person) => {
      const unit = units.get(person.unitId);
      return (person.kind || "RESIDENT") === "RESIDENT" &&
        Boolean(unit) &&
        (!tenantId || unit?.tenantId === tenantId);
    });
  const byUnit = new Map();

  scopedResidents.forEach((person) => {
    const current = byUnit.get(person.unitId);
    if (!current || compareMobileResident(person, current) > 0) {
      byUnit.set(person.unitId, person);
    }
  });

  return Array.from(byUnit.values()).map(toMobileResident);
}

function findMobileUnit(unitId = "") {
  const decoded = decodeURIComponent(String(unitId || ""));
  const normalized = normalizeLookup(decoded);
  return units.get(decoded) || unitList().find((unit) =>
    normalizeLookup(unit.unitId) === normalized ||
    normalizeLookup(unit.id) === normalized ||
    normalizeLookup(unit.unitNumber) === normalized
  ) || null;
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

function cameraUsesGatewayPlayback(camera = {}) {
  const loadMethod = String(camera.loadMethod || "HLS_GATEWAY").toUpperCase();
  return ["HLS_GATEWAY", "SNAPSHOT_TEMPO_REAL", ""].includes(loadMethod);
}

function cameraPlaybackRecord(camera = {}) {
  const linkedDevice = camera.deviceId ? devices.find((device) => device.id === camera.deviceId) : null;
  const profiledCamera = applyCameraProfileDefaults(camera);
  const deviceBackedCamera = linkedDevice
    ? {
      ...profiledCamera,
      host: profiledCamera.host || linkedDevice.ipAddress || linkedDevice.apiHost || "",
      ipAddress: profiledCamera.ipAddress || linkedDevice.ipAddress || linkedDevice.apiHost || "",
      rtspPort: Number(profiledCamera.rtspPort || linkedDevice.rtspPort || 554),
      username: linkedDevice.username || profiledCamera.username || "admin",
      password: linkedDevice.password || profiledCamera.password || "",
      passwordSet: Boolean(linkedDevice.password || profiledCamera.password || profiledCamera.passwordSet)
    }
    : profiledCamera;
  if (cameraUsesGatewayPlayback(deviceBackedCamera) && !deviceBackedCamera.rtspPath) {
    return { ...deviceBackedCamera, stream: "SUB" };
  }
  return deviceBackedCamera;
}

function cameraRtspPath(camera) {
  return cameraRtspPathFromProfile(cameraPlaybackRecord(camera));
}

function cameraRtspUrl(camera, { maskPassword = false } = {}) {
  const playbackCamera = cameraPlaybackRecord(camera);
  const username = encodeURIComponent(playbackCamera.username || "admin");
  const password = playbackCamera.password ? encodeURIComponent(playbackCamera.password) : "";
  const auth = password ? `${username}:${maskPassword ? "******" : password}@` : `${username}@`;
  const pathCamera = maskPassword && playbackCamera.password ? { ...playbackCamera, password: "******" } : playbackCamera;
  return `rtsp://${auth}${playbackCamera.host}:${playbackCamera.rtspPort}${cameraRtspPath(pathCamera)}`;
}

function deviceChannels(device) {
  const linkedCameras = cameras
    .filter((camera) => camera.deviceId === device.id || (!camera.deviceId && camera.ipAddress && camera.ipAddress === device.ipAddress))
    .flatMap((camera) => (camera.activeChannels?.length ? camera.activeChannels : [{ channel: camera.channel || 1, description: camera.description || camera.name }])
      .map((channel) => ({
        channel: Number(channel.channel || 1),
        description: channel.description || `Canal ${channel.channel || 1}`,
        cameraId: camera.id,
        status: camera.status || device.status || "UNKNOWN",
        streamUrl: `/streams/${cameraStreamKey(camera, channel.channel)}/index.m3u8`,
        rtspPath: cameraRtspPath({ ...camera, channel: channel.channel })
      })));

  if (linkedCameras.length) {
    return linkedCameras.sort((a, b) => a.channel - b.channel);
  }

  const declaredChannels = Math.min(Math.max(Number(device.channelCount || device.channels || 0), 0), 64);
  return Array.from({ length: declaredChannels }, (_, index) => {
    const channel = index + 1;
    return {
      channel,
      description: `Canal ${channel}`,
      cameraId: "",
      status: device.status || "UNKNOWN",
      streamUrl: "",
      rtspPath: cameraRtspPath({
        manufacturer: device.manufacturer,
        channel,
        stream: "MAIN"
      })
    };
  });
}

function cameraStreamKey(camera, channel) {
  const selectedChannel = Number(channel || camera.channel || camera.activeChannels?.[0]?.channel || 1);
  return selectedChannel ? `${camera.id}--ch-${selectedChannel}` : camera.id;
}

function cameraDiagnostic(camera, origin = "") {
  const channel = Number(camera.channel || camera.activeChannels?.[0]?.channel || 1);
  const streamKey = cameraStreamKey(camera, channel);
  const session = streamSessions.get(streamKey) || streamSessions.get(camera.id);
  const recentIssue = recentFfmpegIssues.get(streamKey) || recentFfmpegIssues.get(camera.id) || null;
  const hlsDir = streamDir(streamKey);
  const hlsReady = fs.existsSync(path.join(hlsDir, "index.m3u8"));
  return {
    cameraId: camera.id,
    deviceId: camera.deviceId || "",
    adapter: deviceAdapter(camera),
    cameraProfile: resolveCameraProfile(camera).id,
    manufacturer: camera.manufacturer || "",
    channel,
    status: camera.status || "UNKNOWN",
    passwordSet: Boolean(camera.password || camera.passwordSet),
    ffmpeg: {
      configuredPath: ffmpegPath,
      available: ffmpegAvailable(),
      sessionRunning: Boolean(session?.process && !session.process.killed),
      startedAt: session?.startedAt ? new Date(session.startedAt).toISOString() : "",
      lastAccessAt: session?.lastAccessAt ? new Date(session.lastAccessAt).toISOString() : "",
      lastError: session?.lastError || recentIssue?.lastError || "",
      lastWarning: session?.lastWarning || recentIssue?.lastWarning || "",
      lastExitCode: session?.exitCode ?? recentIssue?.exitCode ?? null,
      lastSignal: session?.signal || recentIssue?.signal || "",
      recentIssue
    },
    stream: {
      key: streamKey,
      hlsUrl: origin ? `${origin}/streams/${streamKey}/index.m3u8` : `/streams/${streamKey}/index.m3u8`,
      hlsReady,
      rtspMasked: cameraRtspUrl(camera, { maskPassword: true }),
      rtspPath: cameraRtspPath(camera),
      settings: cameraStreamSettings(cameraPlaybackRecord(camera))
    }
  };
}

async function testDeviceIntegration(device) {
  const adapter = deviceAdapter(device);
  const tcp = await checkTcpDevice(device);
  const base = {
    ok: tcp.online,
    deviceId: device.id,
    adapter,
    manufacturer: device.manufacturer || "Generico",
    baseUrl: deviceBaseUrl(device),
    tcp,
    checkedAt: now()
  };

  if (adapter === "HIKVISION_ISAPI") {
    const result = await testHikvisionDevice(device);
    return { ...base, ok: true, status: result.status, message: "Conexao Hikvision ISAPI OK" };
  }

  if (adapter === INTELBRAS_MHDX_3116C_ADAPTER) {
    const result = await testMhdx3116c(device, { tryHttpCandidates: tryDeviceHttpCandidates, checkTcpDevice });
    return {
      ...base,
      ok: true,
      status: result.status,
      message: result.partial
        ? "Intelbras DVR/MHDX respondeu TCP, mas CGI/API precisa ser verificado"
        : "Conexao Intelbras DVR/MHDX HTTP/RTSP OK",
      matchedEndpoint: result.matched?.path || "",
      attempts: result.attempts || [],
      bodyPreview: result.body.slice(0, 240)
    };
  }

  if (adapter === INTELBRAS_SS_3532_MF_W_ADAPTER) {
    const result = await testSs3532Mfw(device, { tryHttpCandidates: tryDeviceHttpCandidates, checkTcpDevice });
    return {
      ...base,
      ok: true,
      status: result.status,
      message: result.partial
        ? "Intelbras Bio-T respondeu TCP, mas CGI/API precisa ser habilitado ou autenticado"
        : "Conexao Intelbras Bio-T CGI OK",
      matchedEndpoint: result.matched?.path || "",
      attempts: result.attempts || [],
      bodyPreview: result.body.slice(0, 240)
    };
  }

  return {
    ...base,
    message: tcp.online ? "Conexao TCP generica OK" : tcp.reason
  };
}

function streamDir(cameraId) {
  return path.join(streamRoot, cameraId.replace(/[^a-z0-9_-]/gi, "_"));
}

function hlsContentType(filename) {
  if (filename.endsWith(".m3u8")) return "application/vnd.apple.mpegurl; charset=utf-8";
  if (filename.endsWith(".ts")) return "video/mp2t";
  return "application/octet-stream";
}

function snapshotFile(cameraId) {
  return path.join(streamDir(cameraId), "snapshot.jpg");
}

async function ensureSnapshot(camera, maxAgeMs = 15000) {
  const filePath = snapshotFile(camera.id);
  const cached = snapshotCache.get(camera.id);
  if (cached?.pending) return cached.pending;
  if (fs.existsSync(filePath)) {
    const ageMs = Date.now() - fs.statSync(filePath).mtimeMs;
    if (ageMs < maxAgeMs) return filePath;
  }

  if (!ffmpegAvailable()) {
    throw new Error(`FFmpeg nao encontrado em ${ffmpegPath}`);
  }

  if (!camera.password) {
    throw new Error("Senha RTSP nao cadastrada para esta camera");
  }

  const dir = streamDir(camera.id);
  fs.mkdirSync(dir, { recursive: true });
  const playbackCamera = cameraPlaybackRecord(camera);
  const settings = cameraStreamSettings(playbackCamera);

  const pending = new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-rtsp_transport", settings.rtspTransport,
      "-analyzeduration", settings.analyzeDuration,
      "-probesize", settings.probeSize,
      "-i", cameraRtspUrl(playbackCamera),
      "-an",
      "-frames:v", "1",
      "-q:v", "5",
      "-vf", settings.snapshotScale,
      "-y",
      filePath
    ];
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let errorText = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, 8000);

    child.stderr.on("data", (chunk) => {
      errorText = `${errorText}${chunk.toString("utf8")}`.slice(-1000);
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      snapshotCache.delete(camera.id);
      if (code === 0 && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
        resolve(filePath);
      } else {
        const message = errorText.trim() || (timedOut ? "FFmpeg excedeu o tempo limite ao gerar snapshot" : "Falha ao gerar snapshot da camera");
        rememberFfmpegIssue(camera.id, {
          kind: "snapshot",
          lastError: message,
          exitCode: code,
          timedOut
        });
        reject(new Error(message));
      }
    });
  });

  snapshotCache.set(camera.id, { pending });
  return pending;
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

  if (!ffmpegAvailable()) {
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
  const playbackCamera = cameraPlaybackRecord(camera);
  const settings = cameraStreamSettings(playbackCamera);
  const args = [
    "-hide_banner",
    "-loglevel", "warning",
    "-rtsp_transport", settings.rtspTransport,
    "-fflags", "nobuffer+genpts",
    "-flags", "low_delay",
    "-analyzeduration", settings.analyzeDuration,
    "-probesize", settings.probeSize,
    "-i", cameraRtspUrl(playbackCamera),
    "-an",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",
    "-profile:v", "baseline",
    "-level", "4.2",
    "-pix_fmt", "yuv420p",
    "-r", settings.hlsFrameRate,
    "-g", settings.hlsKeyframeInterval,
    "-keyint_min", settings.hlsKeyframeInterval,
    "-sc_threshold", "0",
    "-force_key_frames", `expr:gte(t,n_forced*${settings.hlsTime})`,
    "-vsync", "vfr",
    "-vf", settings.hlsVideoFilter,
    "-muxdelay", "0",
    "-muxpreload", "0",
    "-f", "hls",
    "-hls_time", settings.hlsTime,
    "-hls_list_size", settings.hlsListSize,
    "-hls_delete_threshold", settings.hlsDeleteThreshold,
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
    lastError: "",
    lastWarning: "",
    exitCode: null,
    signal: ""
  };

  child.stderr.on("data", (chunk) => {
    const message = chunk.toString("utf8").trim();
    if (isFfmpegFatalMessage(message)) {
      session.lastError = message.slice(-1000);
    } else if (message) {
      session.lastWarning = message.slice(-1000);
    }
  });
  child.on("exit", (code, signal) => {
    session.exitCode = code;
    session.signal = signal || "";
    const lastError = session.lastError || session.lastWarning || `FFmpeg saiu antes de gerar HLS (code=${code ?? ""}, signal=${signal || ""})`;
    rememberFfmpegIssue(camera.id, {
      kind: "hls",
      lastError,
      lastWarning: session.lastWarning,
      exitCode: code,
      signal: signal || ""
    });
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
  const streamKey = cameraStreamKey(camera, channel);
  const hlsUrl = `${origin}/streams/${streamKey}/index.m3u8`;
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

function replaceCollection(collection, items = []) {
  collection.splice(0, collection.length, ...(Array.isArray(items) ? items : []));
}

function mergeResourceState(savedResources = []) {
  const savedById = new Map((Array.isArray(savedResources) ? savedResources : []).map((resource) => [resource.id, resource]));
  const merged = resources.map((resource) => ({ ...resource, ...(savedById.get(resource.id) || {}) }));
  savedById.forEach((resource, id) => {
    if (!merged.some((item) => item.id === id)) merged.push(resource);
  });
  return merged;
}

function persistentState() {
  return {
    savedAt: now(),
    version: 1,
    extraTenants,
    deletedTenantIds: Array.from(deletedTenantIds),
    units: unitList(),
    residents,
    devices,
    cameras,
    actions,
    credentials,
    credentialSyncJobs,
    unitLogins,
    unitInvites,
    accessRoutes,
    permissionProfiles,
    licenses,
    resources,
    accessLogs,
    intercomCalls
  };
}

function applyPersistentState(state = {}) {
  replaceCollection(extraTenants, state.extraTenants);
  deletedTenantIds.clear();
  (state.deletedTenantIds || []).forEach((id) => deletedTenantIds.add(id));
  units.clear();
  (state.units || []).forEach((unit) => units.set(unit.unitId || unit.id, unit));
  replaceCollection(residents, state.residents);
  replaceCollection(devices, state.devices);
  replaceCollection(cameras, state.cameras);
  replaceCollection(actions, state.actions);
  replaceCollection(credentials, state.credentials);
  replaceCollection(credentialSyncJobs, state.credentialSyncJobs);
  replaceCollection(unitLogins, state.unitLogins);
  replaceCollection(unitInvites, state.unitInvites);
  replaceCollection(accessRoutes, state.accessRoutes);
  replaceCollection(permissionProfiles, state.permissionProfiles);
  replaceCollection(licenses, state.licenses);
  replaceCollection(resources, mergeResourceState(state.resources));
  replaceCollection(accessLogs, state.accessLogs);
  replaceCollection(intercomCalls, state.intercomCalls);
}

function normalizeCameraRecordsForPlayback() {
  let changed = false;
  cameras.forEach((camera) => {
    const profiledCamera = cameraPlaybackRecord(camera);
    if (profiledCamera.cameraProfile && camera.cameraProfile !== profiledCamera.cameraProfile) {
      camera.cameraProfile = profiledCamera.cameraProfile;
      changed = true;
    }

    if (profiledCamera.channelCount && camera.channelCount !== profiledCamera.channelCount) {
      camera.channelCount = profiledCamera.channelCount;
      changed = true;
    }

    if (profiledCamera.stream && camera.stream !== profiledCamera.stream) {
      camera.stream = profiledCamera.stream;
      changed = true;
    }
  });
  return changed;
}

async function ensurePostgresStateTable() {
  if (!postgresPool || postgresStateReady) return;
  await postgresPool.query(`
    create table if not exists condo_access_state (
      id text primary key,
      state jsonb not null,
      reason text not null default 'update',
      updated_at timestamptz not null default now()
    )
  `);
  postgresStateReady = true;
}

async function savePersistentStateToPostgres(state, reason) {
  await ensurePostgresStateTable();
  await postgresPool.query(
    `
      insert into condo_access_state (id, state, reason, updated_at)
      values ('main', $1::jsonb, $2, now())
      on conflict (id) do update set
        state = excluded.state,
        reason = excluded.reason,
        updated_at = excluded.updated_at
    `,
    [JSON.stringify({ ...state, reason }), reason]
  );
}

function savePersistentState(reason = "update") {
  const state = persistentState();
  if (postgresPool) {
    postgresSaveQueue = postgresSaveQueue
      .then(() => savePersistentStateToPostgres(state, reason))
      .catch((error) => {
        console.error("Falha ao salvar estado persistente no Postgres", error);
      });
    return { ok: true, store: "postgres", queued: true };
  }

  try {
    fs.mkdirSync(path.dirname(dataFilePath), { recursive: true });
    fs.writeFileSync(dataFilePath, JSON.stringify({ ...state, reason }, null, 2), "utf8");
    return { ok: true, store: "file", path: dataFilePath };
  } catch (error) {
    console.error("Falha ao salvar estado persistente", error);
    return {
      ok: false,
      path: dataFilePath,
      message: error instanceof Error ? error.message : "Falha ao salvar estado persistente"
    };
  }
}

async function loadPersistentState() {
  if (postgresPool) {
    try {
      await ensurePostgresStateTable();
      const result = await postgresPool.query("select state, updated_at from condo_access_state where id = 'main'");
      const state = result.rows[0]?.state;
      if (!state) {
        if (fs.existsSync(dataFilePath)) {
          const fileState = JSON.parse(fs.readFileSync(dataFilePath, "utf8"));
          applyPersistentState(fileState);
          await savePersistentStateToPostgres(fileState, "migrated-from-file");
          return { ok: true, store: "postgres", path: "postgres:condo_access_state/main", loadedAt: now(), migratedFrom: dataFilePath };
        }
        return { ok: false, store: "postgres", message: "Estado Postgres ainda nao existe" };
      }
      applyPersistentState(state);
      return { ok: true, store: "postgres", path: "postgres:condo_access_state/main", loadedAt: now(), updatedAt: result.rows[0].updated_at };
    } catch (error) {
      console.error("Falha ao carregar estado persistente do Postgres", error);
      return {
        ok: false,
        store: "postgres",
        path: "postgres:condo_access_state/main",
        message: error instanceof Error ? error.message : "Falha ao carregar estado persistente do Postgres"
      };
    }
  }

  if (!fs.existsSync(dataFilePath)) return { ok: false, message: "Arquivo de estado ainda nao existe" };
  try {
    const state = JSON.parse(fs.readFileSync(dataFilePath, "utf8"));
    applyPersistentState(state);
    return { ok: true, store: "file", path: dataFilePath, loadedAt: now() };
  } catch (error) {
    console.error("Falha ao carregar estado persistente", error);
    return {
      ok: false,
      path: dataFilePath,
      message: error instanceof Error ? error.message : "Falha ao carregar estado persistente"
    };
  }
}

function normalizeTelephonyState() {
  [tenant, showroomTenant, ...extraTenants].forEach((tenantData) => {
    tenantData.sipDomain = normalizeSipDomain(tenantData.sipDomain);
    tenantData.sipWebSocketUrl = normalizeSipWebSocketUrl(tenantData.sipWebSocketUrl, tenantData.sipDomain);
    tenantData.sipPorterPassword = normalizeSipPassword(tenantData.sipPorterPassword, tenantData.sipPorterExtension);
  });

  unitList().forEach((unit) => {
    const tenantData = unit.tenantId === showroomTenant.id ? showroomTenant : findTenant(unit.tenantId);
    const domain = normalizeSipDomain(unit.telephony?.sipDomain || tenantData.sipDomain);
    unit.telephony = {
      ...unit.telephony,
      sipDomain: domain,
      sipWebSocketUrl: normalizeSipWebSocketUrl(unit.telephony?.sipWebSocketUrl || tenantData.sipWebSocketUrl, domain),
      extensionPassword: normalizeSipPassword(unit.telephony?.extensionPassword, unit.telephony?.extension || unit.extension),
      porterExtension: unit.telephony?.porterExtension || tenantData.sipPorterExtension
    };
  });
}

function toMobileCameraFileRecord(camera) {
  const device = devices.find((item) => item.id === camera.deviceId);
  const channel = Number(camera.channel || camera.activeChannels?.[0]?.channel || 1);
  const streamKey = cameraStreamKey(camera, channel);
  return {
    id: camera.id,
    tenantId: camera.tenantId || "",
    groupId: camera.groupId || "",
    groupName: camera.groupName || "",
    name: camera.name || camera.description || `Camera ${channel}`,
    description: camera.description || "",
    location: camera.description || "",
    manufacturer: camera.manufacturer || "",
    model: camera.model || camera.type || "",
    host: camera.host || "",
    ipAddress: camera.ipAddress || camera.host || "",
    channel,
    activeChannels: camera.activeChannels?.length
      ? camera.activeChannels.map((item) => ({
        channel: Number(item.channel || 1),
        description: item.description || `Canal ${item.channel || 1}`
      }))
      : [{ channel, description: camera.description || `Canal ${channel}` }],
    status: camera.status || "ONLINE",
    rtspUrl: `/streams/${streamKey}/index.m3u8`,
    streamUrl: `/streams/${streamKey}/index.m3u8`,
    playbackMode: "HLS_GATEWAY",
    deviceType: camera.deviceType || camera.type || "",
    deviceId: camera.deviceId || "",
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

function toMobileCameraFileDevice(device) {
  return {
    id: device.id,
    name: device.name,
    manufacturer: device.manufacturer || "",
    model: device.model || "",
    ipAddress: device.ipAddress || "",
    status: device.status || "UNKNOWN"
  };
}

function formatMobileCameraExport() {
  const cameraRecords = cameras
    .slice()
    .sort((a, b) => String(a.name || a.description || a.id).localeCompare(String(b.name || b.description || b.id)))
    .map(toMobileCameraFileRecord);
  const deviceIds = new Set(cameraRecords.map((camera) => camera.deviceId).filter(Boolean));
  const deviceRecords = devices
    .filter((device) => deviceIds.has(device.id))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
    .map(toMobileCameraFileDevice);

  return [
    mobileCameraSyncStart,
    "// Este bloco e gerado pela API Web do Condo Access. Nao edite manualmente.",
    `export const WEB_SYNCED_CAMERA_DEVICES: Device[] = ${JSON.stringify(deviceRecords, null, 2)};`,
    "",
    `export const WEB_SYNCED_CAMERAS: CameraRecord[] = ${JSON.stringify(cameraRecords, null, 2)};`,
    mobileCameraSyncEnd
  ].join("\n");
}

function replaceMobileCameraExportBlock(currentContent, generatedBlock) {
  if (currentContent.includes(mobileCameraSyncStart) && currentContent.includes(mobileCameraSyncEnd)) {
    const pattern = new RegExp(`${mobileCameraSyncStart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${mobileCameraSyncEnd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    return currentContent.replace(pattern, generatedBlock);
  }
  return `${currentContent.trimEnd()}\n\n${generatedBlock}\n`;
}

function syncMobileCameraStreamsFile() {
  try {
    if (!mobileCameraStreamsFile) {
      return { ok: false, message: "Arquivo mobile de cameras nao configurado" };
    }

    const currentContent = fs.existsSync(mobileCameraStreamsFile)
      ? fs.readFileSync(mobileCameraStreamsFile, "utf8")
      : [
        'import { STREAM_URL } from "../constants/env";',
        'import type { CameraRecord, Device } from "../types";',
        ""
      ].join("\n");
    const nextContent = replaceMobileCameraExportBlock(currentContent, formatMobileCameraExport());
    fs.mkdirSync(path.dirname(mobileCameraStreamsFile), { recursive: true });
    fs.writeFileSync(mobileCameraStreamsFile, nextContent, "utf8");
    return {
      ok: true,
      path: mobileCameraStreamsFile,
      cameras: cameras.length,
      devices: devices.length,
      syncedAt: now()
    };
  } catch (error) {
    return {
      ok: false,
      path: mobileCameraStreamsFile,
      message: error instanceof Error ? error.message : "Falha ao sincronizar arquivo mobile de cameras"
    };
  }
}

function mobileTelephonyConfig(unit = units.get("unit-101")) {
  const unitData = unit || unitList().find(isMobileTenantUnit) || units.get("unit-101");
  const tenantData = findTenant(unitData?.tenantId || activeMobileTenantId());
  const provider = unitData?.telephony?.provider || tenantData.telephonyProvider || "DIRECT_SIP";
  const domain = normalizeSipDomain(unitData?.telephony?.sipDomain || tenantData.sipDomain);
  return {
    enabled: true,
    provider,
    gateway: { type: provider },
    sip: {
      domain,
      webSocketUrl: normalizeSipWebSocketUrl(unitData?.telephony?.sipWebSocketUrl || tenantData.sipWebSocketUrl, domain),
      outboundProxy: tenantData.sipOutboundProxy,
      accountPrefix: tenantData.sipAccountPrefix,
      porterExtension: unitData?.telephony?.porterExtension || tenantData.sipPorterExtension
    },
    account: {
      extension: unitData?.telephony?.extension || "9001",
      password: normalizeSipPassword(unitData?.telephony?.extensionPassword, unitData?.telephony?.extension || "9001"),
      displayName: `Unidade ${unitData?.unitNumber || "101"}`
    },
    callTargets: [
      { type: "PORTER", id: "porter", label: "Portaria", extension: tenantData.sipPorterExtension, available: true },
      ...devices
        .filter((device) => device.tenantId === tenantData.id && device.intercomEnabled && device.intercomExtension)
        .map((device) => ({ type: "FACIAL", id: device.id, label: device.name, extension: device.intercomExtension, available: true, device: toMobileDevice(device) }))
    ]
  };
}

const persistentLoadResult = await loadPersistentState();
if (persistentLoadResult.ok) {
  console.log(`Estado persistente carregado de ${persistentLoadResult.path}`);
} else {
  console.log(`Estado persistente nao carregado (${persistentLoadResult.store || "file"}): ${persistentLoadResult.message}`);
}
const cameraPlaybackMigrated = normalizeCameraRecordsForPlayback();
if (cameraPlaybackMigrated) {
  savePersistentState("camera-playback-normalized");
  console.log("Cameras normalizadas para perfis/substream HLS");
}
normalizeTelephonyState();

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
    return json(response, 200, {
      ok: true,
      service: "condo-access-clean-api",
      storage: postgresPool ? "postgres" : "file",
      cameras: cameras.length,
      devices: devices.length
    });
  }

  if (request.method === "GET" && url.pathname === "/api/bootstrap") {
    return json(response, 200, bootstrap());
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(request);
    const loginId = String(body.email || body.login || "").trim() || "agpsistemascorp@gmail.com";
    const loginKey = normalizeLookup(loginId);
    const matchedResident = residents.find((person) =>
      normalizeLookup(person.email) === loginKey ||
      normalizeLookup(person.cpf) === loginKey ||
      normalizeLookup(person.phone) === loginKey ||
      normalizeLookup(person.id) === loginKey
    );
    return json(response, 200, {
      accessToken: "local-demo-token",
      refreshToken: "local-demo-refresh",
      user: {
        id: matchedResident?.email || loginId,
        name: matchedResident?.name || "Master Administrador",
        email: matchedResident?.email || loginId,
        role: matchedResident ? "RESIDENT" : "SUPER_ADMIN",
        tenantId: matchedResident?.tenantId || activeMobileTenantId()
      }
    });
  }

  if (request.method === "GET" && url.pathname === "/api/condominiums") {
    return json(response, 200, allTenants());
  }

  if (request.method === "GET" && url.pathname === "/api/condominiums/residents") {
    return json(response, 200, mobileResidentList({
      tenantId: url.searchParams.get("tenantId") || "",
      userId: url.searchParams.get("userId") || "",
      email: url.searchParams.get("email") || ""
    }));
  }

  const mobileResidentMatch = url.pathname.match(/^\/api\/condominiums\/residents\/([^/]+)$/);
  if (mobileResidentMatch && ["PATCH", "PUT"].includes(request.method || "")) {
    const residentId = decodeURIComponent(mobileResidentMatch[1]);
    const body = await readBody(request);
    const person = residents.find((item) => item.id === residentId);
    if (!person) return json(response, 404, { message: "Morador nao encontrado" });
    const unit = findMobileUnit(body.unitId || person.unitId);
    Object.assign(person, {
      tenantId: body.tenantId || person.tenantId || unit?.tenantId || tenant.id,
      unitId: body.unitId || person.unitId,
      name: body.name || person.name,
      email: body.email ?? person.email,
      phone: body.phone ?? person.phone,
      cpf: body.cpf || body.document || person.cpf,
      rg: body.rg ?? person.rg,
      birthDate: body.birthDate ?? person.birthDate,
      photoUrl: body.photoUrl ?? person.photoUrl,
      relation: body.relation || person.relation,
      kind: body.personType === "MORADOR" ? "RESIDENT" : person.kind || "RESIDENT",
      updatedAt: now()
    });
    if (unit && unit.residentId === person.id) {
      unit.residentName = person.name;
      unit.responsibleName = person.relation === "Proprietario" ? person.name : unit.responsibleName || person.name;
      unit.residentCpf = person.cpf;
      unit.residentRg = person.rg;
      unit.residentPhone = person.phone;
      unit.residentEmail = person.email;
    }
    savePersistentState("mobile-resident-updated");
    return json(response, 200, toMobileResident(person));
  }

  const mobileUnitMatch = url.pathname.match(/^\/api\/condominiums\/units\/([^/]+)$/);
  if (mobileUnitMatch) {
    const unitId = decodeURIComponent(mobileUnitMatch[1]);
    const unit = findMobileUnit(unitId);
    if (!unit) return json(response, 404, { message: "Unidade nao encontrada" });

    if (request.method === "GET") {
      return json(response, 200, toMobileUnit(unit));
    }

    if (["PATCH", "PUT"].includes(request.method || "")) {
      const body = await readBody(request);
      unit.tenantId = body.tenantId || unit.tenantId;
      unit.ownerName = body.ownerName ?? unit.ownerName ?? unit.responsibleName ?? "";
      unit.ownerDocument = body.ownerDocument ?? unit.ownerDocument ?? unit.residentCpf ?? "";
      unit.documents = body.documents ?? unit.documents ?? "";
      unit.responsibleName = unit.ownerName || unit.responsibleName || unit.residentName || "";
      units.set(unit.unitId, unit);
      savePersistentState("mobile-unit-updated");
      return json(response, 200, toMobileUnit(unit));
    }
  }

  if (request.method === "GET" && url.pathname === "/api/devices") {
    const tenantId = url.searchParams.get("tenantId") || "";
    const filtered = tenantId ? devices.filter((device) => device.tenantId === tenantId) : devices;
    return json(response, 200, filtered.map(toMobileDevice));
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

    try {
      const result = await testDeviceIntegration(device);
      device.status = result.ok ? "ONLINE" : "OFFLINE";
      device.lastCheckedAt = now();
      device.statusReason = result.message || result.tcp?.reason || "";
      return json(response, result.ok ? 200 : 502, result);
    } catch (error) {
      return json(response, 502, {
        ok: false,
        deviceId: device.id,
        adapter: deviceAdapter(device),
        baseUrl: deviceBaseUrl(device),
        checkedAt: now(),
        message: error instanceof Error ? error.message : "Falha ao testar equipamento"
      });
    }
  }

  const deviceChannelsMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/channels$/);
  if (request.method === "GET" && deviceChannelsMatch) {
    const device = devices.find((item) => item.id === deviceChannelsMatch[1]);
    if (!device) return json(response, 404, { message: "Equipamento nao encontrado" });
    return json(response, 200, {
      deviceId: device.id,
      adapter: deviceAdapter(device),
      channels: deviceChannels(device)
    });
  }

  const deviceDiagnosticsMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/diagnostics$/);
  if (request.method === "GET" && deviceDiagnosticsMatch) {
    const device = devices.find((item) => item.id === deviceDiagnosticsMatch[1]);
    if (!device) return json(response, 404, { message: "Equipamento nao encontrado" });
    const origin = requestOrigin(request);
    const deviceCameras = cameras.filter((camera) => camera.deviceId === device.id || (!camera.deviceId && camera.ipAddress && camera.ipAddress === device.ipAddress));
    return json(response, 200, {
      device: publicDevice(device),
      adapter: deviceAdapter(device),
      baseUrl: deviceBaseUrl(device),
      channels: deviceChannels(device),
      cameras: deviceCameras.map((camera) => cameraDiagnostic(camera, origin))
    });
  }

  const deviceIntegrationMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/integration(?:\/([^/]+))?$/);
  if (request.method === "GET" && deviceIntegrationMatch) {
    const deviceId = decodeURIComponent(deviceIntegrationMatch[1]);
    const resource = String(deviceIntegrationMatch[2] || "summary");
    const device = devices.find((item) => item.id === deviceId);
    if (!device) return json(response, 404, { message: "Equipamento nao encontrado" });
    if (!equipmentIntegrationResources.has(resource)) {
      return json(response, 400, {
        message: "Recurso de integracao invalido",
        resources: Array.from(equipmentIntegrationResources)
      });
    }
    return json(response, 200, deviceIntegrationPayload(device, resource, {
      limit: Number(url.searchParams.get("limit") || 50)
    }));
  }

  const deviceCredentialImportMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/integration\/credentials\/import$/);
  if (request.method === "POST" && deviceCredentialImportMatch) {
    const deviceId = decodeURIComponent(deviceCredentialImportMatch[1]);
    const device = devices.find((item) => item.id === deviceId);
    if (!device) return json(response, 404, { message: "Equipamento nao encontrado" });
    const body = await readBody(request);
    try {
      const report = await importDeviceCredentials(device, { dryRun: body.dryRun !== false });
      return json(response, body.dryRun === false ? 201 : 200, report);
    } catch (error) {
      return json(response, 502, {
        ok: false,
        device: publicDevice(device),
        adapter: deviceAdapter(device),
        message: error instanceof Error ? error.message : "Falha ao importar credenciais do equipamento"
      });
    }
  }

  if (request.method === "GET" && url.pathname === "/api/devices/cameras") {
    const origin = requestOrigin(request);
    const tenantId = url.searchParams.get("tenantId") || "";
    const filtered = tenantId ? cameras.filter((camera) => camera.tenantId === tenantId) : cameras;
    return json(response, 200, filtered.map((camera) => toMobileCamera(camera, origin)));
  }

  if (request.method === "POST" && url.pathname === "/api/cameras/mobile-file/sync") {
    const result = syncMobileCameraStreamsFile();
    return json(response, result.ok ? 200 : 500, result);
  }

  if (request.method === "GET" && url.pathname === "/api/access/logs") {
    const tenantId = url.searchParams.get("tenantId");
    const unitId = url.searchParams.get("unitId") || "";
    const since = Date.parse(url.searchParams.get("since") || "") || 0;
    const from = Date.parse(url.searchParams.get("from") || "") || 0;
    const to = Date.parse(url.searchParams.get("to") || "") || 0;
    const limit = Number(url.searchParams.get("limit") || 50);
    const filtered = accessLogs.filter((log) => {
      const logTime = Date.parse(log.createdAt || log.occurredAt || "") || 0;
      return (!tenantId || log.tenantId === tenantId) &&
        (!unitId || !log.unitId || log.unitId === unitId) &&
        (!since || logTime > since) &&
        (!from || logTime >= from) &&
        (!to || logTime <= to);
    });
    return json(response, 200, filtered.slice(0, limit));
  }

  const intelbrasBiotEventMatch = url.pathname.match(/^\/api\/intelbras\/biot\/events(?:\/([^/]+))?$/)
    || url.pathname.match(/^\/api\/devices\/([^/]+)\/intelbras-biot\/events$/);
  if (request.method === "POST" && intelbrasBiotEventMatch) {
    const deviceId = intelbrasBiotEventMatch[1] ? decodeURIComponent(intelbrasBiotEventMatch[1]) : "";
    const device = deviceId
      ? devices.find((item) => item.id === deviceId)
      : devices.find((item) => deviceAdapter(item) === INTELBRAS_SS_3532_MF_W_ADAPTER);
    const contentType = request.headers["content-type"] || "";
    const raw = await readRawBody(request);
    const payload = parseSs3532MfwEventPayload(raw, contentType);
    const log = ss3532MfwEventToAccessLog(device, payload, { makeId, tenantId: tenant.id, now });
    accessLogs.unshift(log);
    savePersistentState("intelbras-biot-event");

    const onlineAuthorization = String(process.env.INTELBRAS_BIOT_DEFAULT_AUTH || "DENY").toUpperCase() === "ALLOW";
    return json(response, 200, {
      id: log.id,
      ok: true,
      auth: onlineAuthorization,
      message: onlineAuthorization
        ? "Evento Bio-T recebido e autorizado pelo modo de homologacao"
        : "Evento Bio-T recebido. Autorizacao online nao habilitada",
      log
    });
  }

  if (request.method === "POST" && url.pathname === "/api/access/open-door") {
    const body = await readBody(request);
    const action = actions.find((item) => item.id === body.doorId) || actions[0];
    const device = devices.find((item) => item.id === action?.deviceId);
    let delivered = false;
    let queued = false;
    let gatewayMessage = "";

    const adapter = device ? deviceAdapter(device) : "GENERIC_TCP";
    if (device && action?.status !== "DISABLED" && ["HIKVISION_ISAPI", INTELBRAS_SS_3532_MF_W_ADAPTER].includes(adapter)) {
      try {
        const result = await openDeviceDoor(device, action.relay || device.doorRelay || 1);
        delivered = true;
        gatewayMessage = result.message;
      } catch (error) {
        queued = true;
        gatewayMessage = error instanceof Error ? error.message : "Falha no acionamento do equipamento";
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
    savePersistentState("access-open-door");
    return json(response, 200, { delivered, queued, message: gatewayMessage, log });
  }

  if (request.method === "GET" && url.pathname === "/api/condominiums/invites") {
    const origin = requestOrigin(request);
    const tenantId = url.searchParams.get("tenantId") || "";
    const unitId = url.searchParams.get("unitId") || "";
    const filtered = unitInvites.filter((invite) =>
      (!tenantId || invite.tenantId === tenantId) &&
      (!unitId || invite.unitId === unitId)
    );
    return json(response, 200, filtered.map((invite) => toMobileInvite(invite, origin)));
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
    savePersistentState("invite-created");
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
    if (!invite) return sendText(response, 404, "text/html; charset=utf-8", "<h1>Convite nao encontrado</h1>");
    return sendText(response, 200, "text/html; charset=utf-8", publicInviteHtml(invite, requestOrigin(request)), {
      "Cache-Control": "no-store"
    });
  }

  if (request.method === "GET" && url.pathname === "/api/condominiums/notices") {
    return json(response, 200, []);
  }

  if (request.method === "GET" && url.pathname === "/api/condominiums/maintenance") {
    return json(response, 200, []);
  }

  if (request.method === "GET" && url.pathname === "/api/telephony/config") {
    const requestedUnit = resolveUnitForTelephonyRequest(Object.fromEntries(url.searchParams.entries()));
    return json(response, 200, mobileTelephonyConfig(requestedUnit));
  }

  if (request.method === "GET" && url.pathname === "/api/telephony/calls") {
    const tenantId = url.searchParams.get("tenantId");
    return json(response, 200, tenantId ? intercomCalls.filter((call) => call.tenantId === tenantId) : intercomCalls);
  }

  if (request.method === "POST" && url.pathname === "/api/telephony/mobile-call") {
    const body = await readBody(request);
    const unit = resolveUnitForTelephonyRequest(body);
    const callTenant = findTenant(unit?.tenantId || body.tenantId || activeMobileTenantId());
    const targetDevice = body.deviceId ? devices.find((device) => device.id === body.deviceId) : null;
    const call = {
      id: makeId("call"),
      tenantId: unit?.tenantId || callTenant.id,
      unitId: unit?.unitId || "",
      unitNumber: unit?.unitNumber || body.unitNumber || body.unit || "",
      targetType: body.targetType || "PORTER",
      deviceId: body.deviceId || "",
      targetExtension: body.targetExtension || (body.targetType === "FACIAL" ? targetDevice?.intercomExtension : callTenant.sipPorterExtension),
      targetLabel: body.targetLabel || (body.targetType === "FACIAL" ? targetDevice?.name : "Portaria"),
      sourceExtension: body.sourceExtension || body.extension || unitExtension(unit),
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
    savePersistentState("mobile-call-created");
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
    savePersistentState("call-answered");
    return json(response, 200, call);
  }

  const callEndMatch = url.pathname.match(/^\/api\/telephony\/calls\/([^/]+)\/end$/);
  if (request.method === "POST" && callEndMatch) {
    const call = intercomCalls.find((item) => item.id === callEndMatch[1]);
    if (!call) return json(response, 404, { message: "Chamada nao encontrada" });
    call.status = "ENDED";
    call.endedAt = now();
    savePersistentState("call-ended");
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

  const cameraDiagnosticsMatch = url.pathname.match(/^\/api\/cameras\/([^/]+)\/diagnostics$/);
  if (request.method === "GET" && cameraDiagnosticsMatch) {
    const camera = cameras.find((item) => item.id === cameraDiagnosticsMatch[1]);
    if (!camera) return json(response, 404, { message: "Camera nao encontrada" });
    return json(response, 200, cameraDiagnostic(camera, requestOrigin(request)));
  }

  const cameraSnapshotMatch = url.pathname.match(/^\/api\/cameras\/([^/]+)\/snapshot\.jpg$/);
  if (request.method === "GET" && cameraSnapshotMatch) {
    const camera = cameras.find((item) => item.id === cameraSnapshotMatch[1]);
    if (!camera) return json(response, 404, { message: "Camera nao encontrada" });
    const requestedChannel = Number(url.searchParams.get("channel") || camera.channel || 1);
    const streamCamera = requestedChannel > 0
      ? { ...camera, id: cameraStreamKey(camera, requestedChannel), channel: requestedChannel }
      : camera;

    try {
      const filePath = await ensureSnapshot(streamCamera);
      response.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=10",
        "Access-Control-Allow-Origin": "*",
        "X-Condo-Access-RTSP": cameraRtspUrl(streamCamera, { maskPassword: true })
      });
      return fs.createReadStream(filePath).pipe(response);
    } catch (error) {
      return json(response, 502, {
        message: error instanceof Error ? error.message : "Falha ao gerar snapshot",
        rtsp: cameraRtspUrl(streamCamera, { maskPassword: true })
      });
    }
  }

  const streamStopMatch = url.pathname.match(/^\/streams\/([^/]+)$/);
  if (request.method === "DELETE" && streamStopMatch) {
    stopStream(streamStopMatch[1]);
    return json(response, 200, { ok: true, stopped: streamStopMatch[1] });
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
    savePersistentState("tenant-telephony-updated");
    return json(response, 200, targetTenant);
  }

  if (request.method === "POST" && url.pathname === "/api/condominiums") {
    const body = await readBody(request);
    const requestedTenantId = body.id || body.tenantId || "";
    const existingTenant = requestedTenantId
      ? [tenant, showroomTenant, ...allTenants()].find((item) => item.id === requestedTenantId)
      : null;
    const isNewTenant = !existingTenant;
    const targetTenant = existingTenant || {
      id: requestedTenantId || makeId("tenant"),
      name: body.name || "Novo condominio",
      document: body.document || "",
      status: body.status || "ACTIVE",
      telephonyEnabled: true,
      telephonyProvider: body.telephonyProvider || "DIRECT_SIP",
      sipDomain: normalizeSipDomain(body.sipDomain || asteriskHost),
      sipWebSocketUrl: normalizeSipWebSocketUrl(body.sipWebSocketUrl || asteriskWebSocketUrl, body.sipDomain || asteriskHost),
      sipOutboundProxy: "",
      sipPorterExtension: body.sipPorterExtension || "9000",
      sipPorterPassword: normalizeSipPassword(body.sipPorterPassword, body.sipPorterExtension || "9000"),
      sipAccountPrefix: "",
      sipExtensionGroupName: body.name || "Novo condominio",
      sipExtensionStart: body.sipExtensionStart || "9100",
      sipExtensionEnd: body.sipExtensionEnd || "9199",
      updatedAt: now()
    };
    targetTenant.name = body.name || targetTenant.name;
    targetTenant.document = body.document ?? targetTenant.document;
    targetTenant.status = body.status || targetTenant.status;
    syncTenantTelephony(body, targetTenant);
    targetTenant.updatedAt = now();
    if (isNewTenant) extraTenants.unshift(targetTenant);
    savePersistentState("tenant-saved");
    return json(response, 201, targetTenant);
  }

  const deleteTenantMatch = url.pathname.match(/^\/api\/condominiums\/([^/]+)$/);
  if (request.method === "DELETE" && deleteTenantMatch) {
    const tenantId = deleteTenantMatch[1];
    const index = extraTenants.findIndex((item) => item.id === tenantId);
    const [removed] = index >= 0 ? extraTenants.splice(index, 1) : [findTenant(tenantId)];
    if (!removed) return json(response, 404, { message: "Condominio nao encontrado" });
    if (index === -1) deletedTenantIds.add(tenantId);
    savePersistentState("tenant-deleted");
    return json(response, 200, { ok: true, removed });
  }

  if (request.method === "GET" && url.pathname === "/api/licenses") {
    return json(response, 200, licenses);
  }

  if (request.method === "GET" && url.pathname === "/api/manufacturers") {
    return json(response, 200, manufacturerProfiles);
  }

  if (request.method === "GET" && url.pathname === "/api/camera-profiles") {
    return json(response, 200, publicCameraProfiles());
  }

  if (request.method === "GET" && url.pathname === "/api/credentials") {
    const tenantId = url.searchParams.get("tenantId") || "";
    const unitId = url.searchParams.get("unitId") || "";
    const filtered = credentials.filter((credential) =>
      (!tenantId || credential.tenantId === tenantId) &&
      (!unitId || credential.unitId === unitId)
    );
    return json(response, 200, filtered);
  }

  if (request.method === "POST" && url.pathname === "/api/credentials") {
    const body = await readBody(request);
    const result = saveCredential(body);
    if (result.error) return json(response, result.duplicate ? 409 : 400, { message: result.error, duplicate: result.duplicate });
    savePersistentState("credential-saved");
    return json(response, body.id ? 200 : 201, result.credential);
  }

  if (request.method === "POST" && url.pathname === "/api/credentials/generate") {
    const body = await readBody(request);
    const person = findPersonForCredential(body);
    if (!person) return json(response, 404, { message: "Pessoa nao encontrada para gerar credencial" });
    const type = normalizeCredentialType(body.type || body.credentialType || person.credentialType || "APP");
    const result = saveCredential({
      ...body,
      tenantId: body.tenantId || person.tenantId,
      unitId: body.unitId || person.unitId,
      personId: person.id,
      personName: person.name,
      type,
      value: body.value || generatedCredentialValue(type, person),
      valueLabel: body.valueLabel || credentialDisplayValue(type, body.value || "", person),
      source: "GENERATED"
    });
    if (result.error) return json(response, result.duplicate ? 409 : 400, { message: result.error, duplicate: result.duplicate });
    savePersistentState("credential-generated");
    return json(response, 201, result.credential);
  }

  if (request.method === "POST" && url.pathname === "/api/credentials/import") {
    const body = await readBody(request);
    const dryRun = body.dryRun !== false;
    const tenantId = body.tenantId || tenant.id;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const report = {
      dryRun,
      total: rows.length,
      valid: 0,
      invalid: 0,
      duplicates: 0,
      unitsCreated: 0,
      peopleCreated: 0,
      peopleUpdated: 0,
      credentialsCreated: 0,
      credentialsUpdated: 0,
      errors: [],
      items: []
    };

    rows.forEach((row, index) => {
      const payload = importRowToPayload(row, tenantId);
      const rowNumber = index + 2;
      const rowErrors = [];
      if (!payload.unitNumber) rowErrors.push("Unidade obrigatoria");
      if (!payload.name) rowErrors.push("Nome obrigatorio");
      if (!payload.cpf && !payload.email && !payload.phone) rowErrors.push("Informe CPF, e-mail ou telefone para deduplicar");
      const type = normalizeCredentialType(payload.credentialType);
      const generatedValue = payload.credentialValue || generatedCredentialValue(type, payload);
      const existingCredential = credentials.find((credential) =>
        credentialKey(credential.tenantId, credential.type, credential.value) === credentialKey(tenantId, type, generatedValue)
      );
      if (existingCredential) report.duplicates += 1;

      if (rowErrors.length) {
        report.invalid += 1;
        report.errors.push({ row: rowNumber, errors: rowErrors, payload });
        report.items.push({ row: rowNumber, status: "INVALID", errors: rowErrors, payload });
        return;
      }

      const existingUnit = findUnitByNumber(tenantId, payload.unitNumber, payload.blockName);
      const unit = upsertImportUnit(payload, dryRun);
      const existingPerson = findPersonForCredential({ ...payload, unitId: unit?.unitId });
      const person = upsertImportPerson(payload, unit, dryRun);

      let credential = existingCredential;
      if (!dryRun) {
        const result = saveCredential({
          tenantId,
          unitId: unit.unitId,
          personId: person.id,
          personName: person.name,
          type,
          value: generatedValue,
          valueLabel: credentialDisplayValue(type, generatedValue, person),
          source: "IMPORT"
        });
        credential = result.credential || result.duplicate;
      }

      report.valid += 1;
      if (!existingUnit) report.unitsCreated += 1;
      if (existingPerson) report.peopleUpdated += 1;
      else report.peopleCreated += 1;
      if (existingCredential) report.credentialsUpdated += dryRun ? 0 : 1;
      else report.credentialsCreated += 1;
      report.items.push({
        row: rowNumber,
        status: existingCredential ? "DUPLICATE_OR_UPDATE" : "OK",
        unitId: unit?.unitId || "",
        personId: person?.id || "",
        credentialId: credential?.id || "",
        payload: { ...payload, credentialType: type, credentialValue: generatedValue }
      });
    });

    if (!dryRun) savePersistentState("credentials-imported");
    return json(response, dryRun ? 200 : 201, report);
  }

  const deleteCredentialMatch = url.pathname.match(/^\/api\/credentials\/([^/]+)$/);
  if (request.method === "DELETE" && deleteCredentialMatch) {
    const credentialId = decodeURIComponent(deleteCredentialMatch[1]);
    const index = credentials.findIndex((item) => item.id === credentialId);
    if (index === -1) return json(response, 404, { message: "Credencial nao encontrada" });
    const [removed] = credentials.splice(index, 1);
    savePersistentState("credential-deleted");
    return json(response, 200, { ok: true, removed });
  }

  if (request.method === "GET" && url.pathname === "/api/permissions") {
    return json(response, 200, permissionProfiles);
  }

  if (request.method === "GET" && url.pathname === "/api/resources") {
    const tenantId = url.searchParams.get("tenantId") || "";
    const tenantResources = resources.filter((resource) => !resource.tenantId || !tenantId || resource.tenantId === tenantId);
    return json(response, 200, tenantResources);
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
      credentialType: normalizeCredentialType(body.credentialType || body.type || "FACE"),
      personId: body.personId || "",
      credentialId: body.credentialId || "",
      deviceId: body.deviceId || "",
      status: "PENDING",
      total: Number(body.total || 0),
      synced: 0,
      errors: 0,
      lastRunAt: now()
    };
    credentialSyncJobs.unshift(job);
    const result = processCredentialSyncJob(job);
    savePersistentState("credential-sync-created");
    return json(response, 201, result);
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
    savePersistentState("license-saved");
    return json(response, body.id ? 200 : 201, updated || license);
  }

  if (request.method === "POST" && url.pathname === "/api/devices") {
    const body = await readBody(request);
    const existingDevice = body.id ? devices.find((item) => item.id === body.id) : null;
    const manufacturer = body.manufacturer || existingDevice?.manufacturer || "Generico";
    const model = body.model || existingDevice?.model || "";
    const deviceProfile = matchesSs3532Mfw({ ...body, manufacturer, model })
      ? ss3532MfwDefaults({ ...body, manufacturer, model }, existingDevice)
      : matchesMhdx3116c({ ...body, manufacturer, model })
        ? mhdx3116cDefaults({ ...body, manufacturer, model }, existingDevice)
        : {};
    const device = {
      id: body.id || makeId("device"),
      tenantId: body.tenantId || tenant.id,
      name: body.name || body.description || "Novo equipamento",
      category: deviceProfile.category || body.category || "access-control",
      manufacturer,
      model: deviceProfile.model || model,
      ipAddress: body.ipAddress || body.host || "",
      apiHost: body.apiHost || body.ipAddress || body.host || "",
      apiPort: Number(deviceProfile.apiPort || body.apiPort || existingDevice?.apiPort || 80),
      apiProtocol: body.apiProtocol || existingDevice?.apiProtocol || "http",
      rtspPort: Number(deviceProfile.rtspPort || body.rtspPort || existingDevice?.rtspPort || 554),
      channelCount: Number(deviceProfile.channelCount ?? body.channelCount ?? existingDevice?.channelCount ?? 0),
      username: body.username || existingDevice?.username || "admin",
      password: body.password || existingDevice?.password || "",
      passwordSet: Boolean(body.password || existingDevice?.password || body.passwordSet),
      authMode: body.authMode || existingDevice?.authMode || "DIGEST",
      intercomEnabled: deviceProfile.intercomEnabled ?? Boolean(body.intercomEnabled),
      intercomType: deviceProfile.intercomType || body.intercomType || "FACIAL",
      intercomExtension: body.intercomExtension || "",
      status: body.status || "OFFLINE"
    };
    const updated = body.id ? updateById(devices, body.id, device) : null;
    if (!updated) devices.unshift(device);
    if (cameras.some((camera) => camera.deviceId === device.id)) syncMobileCameraStreamsFile();
    savePersistentState("device-saved");
    return json(response, body.id ? 200 : 201, publicDevice(updated || device));
  }

  const deleteDeviceMatch = url.pathname.match(/^\/api\/devices\/([^/]+)$/);
  if (request.method === "DELETE" && deleteDeviceMatch) {
    const deviceId = decodeURIComponent(deleteDeviceMatch[1]);
    const index = devices.findIndex((item) => item.id === deviceId);
    if (index === -1) return json(response, 404, { message: "Equipamento nao encontrado" });
    const [removed] = devices.splice(index, 1);
    const removedCameras = [];
    const removedActions = [];

    for (let cameraIndex = cameras.length - 1; cameraIndex >= 0; cameraIndex -= 1) {
      if (cameras[cameraIndex].deviceId === deviceId) {
        const [camera] = cameras.splice(cameraIndex, 1);
        removedCameras.unshift(camera);
        stopStream(camera.id);
      }
    }

    for (let actionIndex = actions.length - 1; actionIndex >= 0; actionIndex -= 1) {
      if (actions[actionIndex].deviceId === deviceId) {
        removedActions.unshift(...actions.splice(actionIndex, 1));
      }
    }

    syncMobileCameraStreamsFile();
    savePersistentState("device-deleted");
    return json(response, 200, {
      ok: true,
      removed: publicDevice(removed),
      removedCameras: removedCameras.map(publicCamera),
      removedActions
    });
  }

  if (request.method === "POST" && url.pathname === "/api/cameras") {
    const body = await readBody(request);
    const existingCamera = body.id ? cameras.find((item) => item.id === body.id) : null;
    const linkedDevice = body.deviceId ? devices.find((item) => item.id === body.deviceId) : null;
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
      const camera = {
        id: body.id || makeId("camera"),
        tenantId: body.tenantId || tenant.id,
        deviceId: body.deviceId || "",
        groupId: cameraGroupId,
        groupName: baseDescription,
        name: body.name || channelDescription,
        description: channelDescription,
        type,
        deviceType: body.deviceType || type,
        manufacturer: body.manufacturer || linkedDevice?.manufacturer || "Hikvision",
        model: body.model || linkedDevice?.model || type,
        cameraProfile: body.cameraProfile || existingCamera?.cameraProfile || "",
        protocol: body.protocol || "64",
        rtspPath: body.rtspPath || existingCamera?.rtspPath || "",
        stream: body.stream || existingCamera?.stream || "",
        host: body.host || linkedDevice?.ipAddress || "",
        ipAddress: body.ipAddress || body.host || linkedDevice?.ipAddress || "",
        rtspPort: Number(body.rtspPort || linkedDevice?.rtspPort || 554),
        httpPort: Number(body.httpPort || linkedDevice?.apiPort || 80),
        username: body.username || linkedDevice?.username || "admin",
        password: body.password || existingCamera?.password || linkedDevice?.password || "",
        passwordSet: Boolean(body.password || existingCamera?.password || body.passwordSet),
        aspectRatio: body.aspectRatio || "WIDESCREEN",
        loadMethod: body.loadMethod || "HLS_GATEWAY",
        photoCaptureEnabled: Boolean(body.photoCaptureEnabled),
        channel,
        status: body.status || "ONLINE",
        activeChannels: [{ channel, description: channelDescription }]
      };
      return cameraPlaybackRecord(camera);
    };
    const created = Array.from({ length: channelCount }, (_, index) => makeCamera(startChannel + index));
    if (body.id) {
      const updated = updateById(cameras, body.id, created[0]);
      stopStream(body.id);
      syncMobileCameraStreamsFile();
      savePersistentState("camera-updated");
      return json(response, 200, publicCamera(updated || created[0]));
    }
    cameras.unshift(...created);
    syncMobileCameraStreamsFile();
    savePersistentState("camera-created");
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
    syncMobileCameraStreamsFile();
    savePersistentState("camera-deleted");
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
    syncMobileCameraStreamsFile();
    savePersistentState("camera-group-deleted");
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
    savePersistentState("action-saved");
    return json(response, body.id ? 200 : 201, updated || action);
  }

  const deleteActionMatch = url.pathname.match(/^\/api\/actions\/([^/]+)$/);
  if (request.method === "DELETE" && deleteActionMatch) {
    const index = actions.findIndex((item) => item.id === deleteActionMatch[1]);
    if (index === -1) return json(response, 404, { message: "Acionamento nao encontrado" });
    const [removed] = actions.splice(index, 1);
    savePersistentState("action-deleted");
    return json(response, 200, { ok: true, removed });
  }

  const triggerActionMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/trigger$/);
  if (request.method === "POST" && triggerActionMatch) {
    const action = actions.find((item) => item.id === triggerActionMatch[1]);
    if (!action) return json(response, 404, { message: "Acionamento nao encontrado" });
    const device = devices.find((item) => item.id === action.deviceId);
    const adapter = device ? deviceAdapter(device) : "GENERIC_TCP";
    const actionLog = (decision, message) => {
      const log = {
        id: makeId("access"),
        tenantId: action.tenantId || device?.tenantId || tenant.id,
        unitId: "",
        decision,
        reason: `Acionamento Web: ${action.name}`,
        createdAt: now(),
        user: { name: "Portaria Web" },
        door: { id: action.id, name: action.name, deviceId: device?.id, manufacturer: device?.manufacturer },
        rawEvent: { route: action.route || "", relay: action.relay || 1, adapter, message }
      };
      accessLogs.unshift(log);
      return log;
    };
    if (device && action.status !== "DISABLED" && ["HIKVISION_ISAPI", INTELBRAS_SS_3532_MF_W_ADAPTER].includes(adapter)) {
      try {
        const result = await openDeviceDoor(device, action.relay || device.doorRelay || 1);
        const log = actionLog("ALLOW", result.message || `Acionamento ${action.name} enviado via ${adapter}`);
        savePersistentState("action-triggered");
        return json(response, 200, {
          ok: true,
          delivered: true,
          adapter,
          actionId: action.id,
          actionName: action.name,
          status: result.status,
          message: `Acionamento ${action.name} enviado via ${adapter}`,
          at: now(),
          log
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : `Falha ao acionar ${adapter}`;
        const log = actionLog("PENDING", message);
        savePersistentState("action-trigger-queued");
        return json(response, 502, {
          ok: false,
          delivered: false,
          queued: true,
          adapter,
          actionId: action.id,
          actionName: action.name,
          message,
          at: now(),
          log
        });
      }
    }

    const genericMessage = action.status === "DISABLED" ? "Acionamento desativado" : `Acionamento ${action.name} enviado para o gateway local`;
    const log = actionLog(action.status === "DISABLED" ? "PENDING" : "ALLOW", genericMessage);
    savePersistentState("action-triggered");
    return json(response, 200, {
      ok: true,
      delivered: action.status !== "DISABLED",
      queued: action.status === "DISABLED",
      actionId: action.id,
      actionName: action.name,
      message: genericMessage,
      at: now(),
      log
    });
  }

  const resourceMatch = url.pathname.match(/^\/api\/resources\/([^/]+)$/);
  if (request.method === "PATCH" && resourceMatch) {
    const body = await readBody(request);
    const resource = updateById(resources, resourceMatch[1], body);
    if (!resource) return json(response, 404, { message: "Recurso nao encontrado" });
    savePersistentState("resource-updated");
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
      ownerName: body.ownerName ?? existing?.ownerName ?? body.responsibleName ?? existing?.responsibleName ?? body.residentName ?? "",
      ownerDocument: body.ownerDocument ?? existing?.ownerDocument ?? body.residentCpf ?? existing?.residentCpf ?? "",
      documents: body.documents ?? existing?.documents ?? "",
      extension: body.extension || existing?.extension || "",
      telephony: {
        enabled: true,
        provider: body.provider || currentTelephony.provider || targetTenant.telephonyProvider,
        sipDomain: normalizeSipDomain(body.sipDomain || currentTelephony.sipDomain || targetTenant.sipDomain),
        sipWebSocketUrl: normalizeSipWebSocketUrl(body.sipWebSocketUrl || currentTelephony.sipWebSocketUrl || targetTenant.sipWebSocketUrl, body.sipDomain || currentTelephony.sipDomain || targetTenant.sipDomain),
        sipTransport: body.sipTransport || currentTelephony.sipTransport || "WSS",
        extension: body.extension || currentTelephony.extension || "",
        extensionPassword: normalizeSipPassword(body.extensionPassword || currentTelephony.extensionPassword, body.extension || currentTelephony.extension),
        porterExtension: body.porterExtension || currentTelephony.porterExtension || targetTenant.sipPorterExtension
      }
    };
    units.set(unitId, nextUnit);
    const unitResident = syncUnitResidentFromPreRegistration(nextUnit, body);
    if (unitResident) {
      nextUnit.residentId = unitResident.id;
      nextUnit.preRegisteredResident = unitResident;
    }
    savePersistentState("unit-saved");
    return json(response, existing ? 200 : 201, nextUnit);
  }

  const deleteUnitMatch = url.pathname.match(/^\/api\/units\/([^/]+)$/);
  if (request.method === "DELETE" && deleteUnitMatch) {
    const unitId = deleteUnitMatch[1];
    const unit = units.get(unitId);
    if (!unit) return json(response, 404, { message: "Unidade nao encontrada" });
    units.delete(unitId);
    for (let index = credentials.length - 1; index >= 0; index -= 1) {
      if (credentials[index].unitId === unitId) credentials.splice(index, 1);
    }
    savePersistentState("unit-deleted");
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
    savePersistentState("person-saved");
    return json(response, updated ? 200 : 201, updated || person);
  }

  const deletePersonMatch = url.pathname.match(/^\/api\/people\/([^/]+)$/);
  if (request.method === "DELETE" && deletePersonMatch) {
    const index = residents.findIndex((person) => person.id === deletePersonMatch[1]);
    if (index === -1) return json(response, 404, { message: "Pessoa nao encontrada" });
    const [removed] = residents.splice(index, 1);
    for (let credentialIndex = credentials.length - 1; credentialIndex >= 0; credentialIndex -= 1) {
      if (credentials[credentialIndex].personId === removed.id) credentials.splice(credentialIndex, 1);
    }
    savePersistentState("person-deleted");
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
        extensionPassword: normalizeSipPassword(body.extensionPassword || unit.telephony.extensionPassword, body.extension || unit.telephony.extension)
      };
      unit.extension = unit.telephony.extension;
      units.set(unitId, unit);
      savePersistentState("unit-telephony-updated");
      return json(response, 200, unit);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/extensions/status/push") {
    const expectedToken = String(process.env.SIP_STATUS_PUSH_TOKEN || "").trim();
    const providedToken = url.searchParams.get("token") || request.headers["x-sip-status-token"] || "";
    if (expectedToken && providedToken !== expectedToken) {
      return json(response, 403, { message: "Token invalido" });
    }

    const body = await readBody(request);
    const rows = Array.isArray(body) ? body : body.extensions || [];
    const registrationState = rememberPushedExtensionRegistrations(rows);
    return json(response, 200, {
      ok: true,
      generatedAt: registrationState.generatedAt,
      received: registrationState.registrations.size
    });
  }

  if (request.method === "GET" && url.pathname === "/api/extensions/status") {
    const tenantId = url.searchParams.get("tenantId");
    const registrationState = await refreshExtensionRegistrations(url.searchParams.get("refresh") !== "0");
    const statuses = extensionStatus(tenantId || "", registrationState.registrations);
    return json(response, 200, {
      generatedAt: now(),
      sipRegistrationSource: registrationState.source,
      sipRegistrationError: registrationState.error,
      extensions: statuses
    });
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

async function shutdown(signal) {
  console.log(`Encerrando API (${signal})`);
  try {
    await postgresSaveQueue;
    await postgresPool?.end();
  } catch (error) {
    console.error("Falha ao encerrar conexao Postgres", error);
  } finally {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
