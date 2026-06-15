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
  publicRestAccessProfiles,
  resolveRestAccessProfile,
  restAccessDefaults
} from "./integrations/access-control/restProfiles.js";
import {
  AXIS_VAPIX_PACS_ADAPTER,
  matchesAxisVapix,
  openAxisVapixDoor,
  testAxisVapix
} from "./integrations/axis/vapixPacs.js";
import {
  DAHUA_ACCESS_CGI_ADAPTER,
  matchesDahuaAccess,
  openDahuaAccessDoor,
  testDahuaAccess
} from "./integrations/dahua/accessCgi.js";
import {
  SUPREMA_BIOSTAR_REST_ADAPTER,
  matchesSupremaBiostar,
  testSupremaBiostar
} from "./integrations/suprema/biostar.js";
import {
  HIKVISION_ISAPI_ADAPTER,
  hikvisionIsapiDefaults,
  matchesHikvisionIsapi,
  openHikvisionIsapiDoor,
  testHikvisionIsapi
} from "./integrations/hikvision/isapi.js";
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
import { createHikvisionParsers } from "./integrations/hikvision/parsers.js";
import { createControlIdClient } from "./integrations/controlid/client.js";
import {
  CONTROL_ID_ACCESS_ADAPTER,
  controlIdDeviceDefaults,
  matchesControlIdDevice,
  publicControlIdProfiles,
  validateControlIdConfiguration
} from "./integrations/controlid/profiles.js";
import { controlIdVehicleTagRecords, normalizeControlIdUhfMode } from "./integrations/controlid/vehicleTags.js";
import { removeVehicleTag, syncVehicleTag } from "./modules/vehicles/vehicleTagController.js";
import {
  NICE_LINEAR_ADAPTER,
  NICE_LINEAR_DEVICE_TCP_MODE,
  matchesNiceLinear,
  niceLinearDefaults,
  niceLinearEventToAccessLog,
  normalizeNiceLinearMode,
  openNiceLinearDoor,
  testNiceLinearIntegration,
  validateNiceLinearConfiguration
} from "./integrations/nice-linear/gateway.js";
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
const facePhotoRoot = process.env.FACE_PHOTO_ROOT || path.join(path.dirname(dataFilePath), "face-photos");
const databaseUrl = process.env.DATABASE_URL || "";
const postgresSslMode = resolvePostgresSslMode(databaseUrl);
const postgresConnectionString = normalizePostgresConnectionString(databaseUrl);
const postgresPool = databaseUrl
  ? new pg.Pool({
    connectionString: postgresConnectionString,
    ssl: postgresSslMode === "require" ? { rejectUnauthorized: false } : undefined
  })
  : null;
const controlIdClient = createControlIdClient();
const {
  binaryRequest: controlIdBinaryRequest,
  loadObjects: controlIdLoadObjects,
  login: controlIdLogin,
  openDoor: openControlIdDoor,
  post: controlIdPost,
  readSnapshot: readControlIdSnapshot,
  testConnection: testControlIdConnection
} = controlIdClient;
let postgresStateReady = false;
let postgresSaveQueue = Promise.resolve();
let lastPostgresSaveError = "";
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
const oneSignalAppId = String(process.env.ONESIGNAL_APP_ID || "").trim();
const oneSignalRestApiKey = String(process.env.ONESIGNAL_REST_API_KEY || "").trim();
const asaasApiKey = String(process.env.ASAAS_API_KEY || "").trim();
const asaasEnvironment = String(process.env.ASAAS_ENVIRONMENT || "sandbox").trim().toLowerCase() === "production"
  ? "production"
  : "sandbox";
const asaasWebhookToken = String(process.env.ASAAS_WEBHOOK_TOKEN || "").trim();
const asaasWebhookTokenConfigured = Boolean(asaasWebhookToken);
const asaasApiBaseUrl = asaasEnvironment === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
const defaultCompanyPassword = "123456";
const masterAdminEmail = String(process.env.MASTER_ADMIN_EMAIL || "agpsistemascorp@gmail.com").trim().toLowerCase();

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

const vehicles = [];

const devices = [];

const cameras = [];

const niceLinearListeners = new Map();
const niceLinearSessions = new Map();
const niceLinearUnknownConnections = new Map();

function normalizedRemoteAddress(value = "") {
  return String(value || "").replace(/^::ffff:/, "").trim().toLowerCase();
}

function niceLinearDeviceForSocket(socket, port) {
  const remoteAddress = normalizedRemoteAddress(socket.remoteAddress);
  const candidates = devices.filter((device) =>
    matchesNiceLinear(device) &&
    normalizeNiceLinearMode(device.niceConnectionMode) === NICE_LINEAR_DEVICE_TCP_MODE &&
    Number(device.apiPort) === Number(port)
  );
  return candidates.find((device) =>
    normalizedRemoteAddress(device.ipAddress || device.apiHost) === remoteAddress
  ) || null;
}

function niceLinearPacketRecord(chunk) {
  const buffer = Buffer.from(chunk);
  return {
    receivedAt: now(),
    bytes: buffer.length,
    hex: buffer.subarray(0, 512).toString("hex").toUpperCase(),
    text: buffer.subarray(0, 512).toString("utf8").replace(/[^\x20-\x7E\r\n\t]/g, ".")
  };
}

function niceLinearTryJsonEvents(device, chunk) {
  const text = Buffer.from(chunk).toString("utf8").trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return;
  try {
    const parsed = JSON.parse(text);
    const events = Array.isArray(parsed) ? parsed : [parsed];
    events.forEach((payload) => {
      const log = niceLinearEventToAccessLog(device, payload, { makeId, now, tenantId: tenant.id });
      accessLogs.unshift(log);
    });
    if (events.length) savePersistentState("nice-linear-tcp-event");
  } catch {
    // O protocolo binario permanece disponivel no diagnostico para homologacao.
  }
}

function niceLinearConnectionStatus(device = {}) {
  const session = niceLinearSessions.get(device.id);
  const listener = niceLinearListeners.get(Number(device.apiPort));
  if (!session || session.socket.destroyed) {
    return {
      online: false,
      reason: listener?.error
        ? `Listener TCP indisponivel: ${listener.error}`
        : listener?.listening
          ? "Aguardando o equipamento iniciar a conexao TCP"
          : "Listener TCP ainda nao iniciado",
      listenPort: Number(device.apiPort || 0),
      listener: Boolean(listener?.listening)
    };
  }
  return {
    online: true,
    reason: "Equipamento conectado",
    listenPort: Number(device.apiPort || 0),
    listener: Boolean(listener?.listening),
    remoteAddress: session.remoteAddress,
    remotePort: session.remotePort,
    connectedAt: session.connectedAt,
    lastSeenAt: session.lastSeenAt,
    packets: session.packets.length
  };
}

function ensureNiceLinearTcpListener(portValue) {
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (niceLinearListeners.has(port)) return niceLinearListeners.get(port);

  const state = { port, listening: false, error: "", server: null };
  const tcpServer = net.createServer((socket) => {
    socket.setKeepAlive(true, 30000);
    const device = niceLinearDeviceForSocket(socket, port);
    const session = {
      socket,
      deviceId: device?.id || "",
      remoteAddress: normalizedRemoteAddress(socket.remoteAddress),
      remotePort: socket.remotePort || 0,
      connectedAt: now(),
      lastSeenAt: now(),
      packets: []
    };
    const unknownKey = `${session.remoteAddress}:${session.remotePort}`;
    if (device) {
      niceLinearSessions.get(device.id)?.socket?.destroy();
      niceLinearSessions.set(device.id, session);
      device.status = "ONLINE";
      device.lastSeenAt = session.lastSeenAt;
      device.statusReason = "Equipamento conectou ao listener TCP";
    } else {
      niceLinearUnknownConnections.set(unknownKey, session);
    }

    socket.on("data", (chunk) => {
      session.lastSeenAt = now();
      session.packets.unshift(niceLinearPacketRecord(chunk));
      session.packets = session.packets.slice(0, 30);
      if (device) {
        device.lastSeenAt = session.lastSeenAt;
        niceLinearTryJsonEvents(device, chunk);
      }
    });
    socket.on("close", () => {
      if (device && niceLinearSessions.get(device.id) === session) {
        niceLinearSessions.delete(device.id);
        device.status = "OFFLINE";
        device.statusReason = "Conexao TCP encerrada pelo equipamento";
      }
      niceLinearUnknownConnections.delete(unknownKey);
    });
    socket.on("error", () => undefined);
  });

  state.server = tcpServer;
  niceLinearListeners.set(port, state);
  tcpServer.once("error", (error) => {
    state.error = error.code || error.message || "Falha no listener TCP";
    state.listening = false;
  });
  tcpServer.listen(port, process.env.NICE_LINEAR_LISTEN_HOST || "0.0.0.0", () => {
    state.listening = true;
    state.error = "";
  });
  return state;
}

function ensureConfiguredNiceLinearListeners() {
  devices
    .filter((device) => matchesNiceLinear(device) &&
      normalizeNiceLinearMode(device.niceConnectionMode) === NICE_LINEAR_DEVICE_TCP_MODE)
    .forEach((device) => ensureNiceLinearTcpListener(device.apiPort));
}

const deviceCategories = [
  {
    id: "access-control",
    name: "Controle de Acesso",
    manufacturers: ["Control iD", "Nice/Linear", "Linear HCS", "Nice Guarita", "Bravas", "Hikvision", "Intelbras", "Dahua", "Axis", "Suprema"],
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
    manufacturers: ["Bravas", "Moni Software", "Nice/Linear", "Nice Guarita", "Linear HCS", "Generico"],
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
    families: ["Facial", "Controlador de acesso", "Leitor veicular iDUHF", "Relogio de ponto"],
    protocols: ["HTTP API", "SDK", "Eventos por polling"],
    defaultPorts: ["80", "443"],
    credentialTypes: ["FACE", "RFID", "UHF_TAG", "PIN", "BIOMETRIA"],
    syncModes: ["Pessoas", "Templates faciais", "Tags veiculares", "Eventos", "Portas"],
    models: publicControlIdProfiles(),
    notes: "API REST .fcgi centralizada por modelo. O acionamento varia entre door, sec_box e catra; iDUHF tambem suporta tags UHF estendidas."
  },
  {
    id: "linear-hcs",
    name: "Nice/Linear HCS",
    families: ["Modulo Guarita MG3000", "Modulo Guarita IP", "Controladora Ethernet II/III", "Receptores CAN"],
    protocols: ["TCP/IP iniciado pelo equipamento", "CAN entre modulo e receptores", "Gateway HTTP opcional"],
    defaultPorts: ["Configuravel na instalacao"],
    credentialTypes: ["RFID", "UHF_TAG", "CONTROLE_REMOTO", "BIOMETRIA", "QR"],
    syncModes: ["Conexao TCP", "Eventos", "Abertura via bridge", "Diagnostico de pacotes"],
    notes: "O equipamento conecta ao software. O listener TCP e o diagnostico estao implementados; comandos binarios diretos exigem o protocolo/SDK da Nice."
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
  },
  ...publicRestAccessProfiles()
    .filter((profile) => ["Axis", "Dahua", "Suprema"].includes(profile.manufacturer))
    .map((profile) => ({
      id: profile.id,
      name: profile.manufacturer,
      families: profile.models,
      protocols: profile.protocols,
      defaultPorts: [String(profile.defaultPort)],
      credentialTypes: profile.capabilities.filter((item) => ["users", "credentials", "cards", "faces"].includes(item)).map((item) => item.toUpperCase()),
      syncModes: profile.capabilities,
      notes: profile.notes
    }))
];


const actions = [];

const credentials = [];

const credentialSyncJobs = [];

const unitLogins = [];

const unitInvites = [];

const accessRoutes = [];

const permissionProfiles = [];

const systemUsers = [];

const companies = [];

const licenses = [];

const billingInvoices = [];

const paymentEvents = [];

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
  { id: "residents", name: "Cadastro de moradores", enabled: false, group: "Cadastro", configurable: true, description: "Permita cadastrar novos moradores vinculados a unidade pelo aplicativo." },
  { id: "temporaryFace", name: "Face Temporaria", enabled: false, group: "Controle de acesso", configurable: true, description: "Acesso facial com validade limitada e exclusao automatica no equipamento." },
  { id: "qrScanner", name: "QR Scanner", enabled: true, group: "Controle de acesso", configurable: true, description: "Leitura de QR Code pelo app ou convite para abertura e notificacao." },
  { id: "deliveries", name: "Entregas", enabled: true, group: "Digitalizacao dos processos", configurable: true, description: "Controle de encomendas com fotos e informacoes adicionais." },
  { id: "shiftLog", name: "Registro de turno", enabled: true, group: "Digitalizacao dos processos", configurable: true, description: "Registro digital das atividades da portaria e troca de turno." },
  { id: "nomenclatures", name: "Nomenclaturas", enabled: true, group: "Personalizacoes", configurable: true, description: "Nomes de agentes e unidades para ambientes residenciais, corporativos e educacionais." }
];

const resourceConfigurations = [];

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
  const previewEnd = Math.min(Number(targetTenant.sipExtensionEnd || start + 9), start + 9);
  const tenantUnits = unitList()
    .filter((unit) => unit.tenantId === targetTenant.id)
    .filter((unit) => unitExtension(unit));
  const tenantIntercoms = devices
    .filter((device) => device.tenantId === targetTenant.id && device.intercomEnabled && device.intercomExtension);
  const used = new Map(tenantUnits.map((unit) => [unitExtension(unit), unit]));
  const intercomByExtension = new Map(tenantIntercoms.map((device) => [String(device.intercomExtension), device]));
  const extensionNumbers = new Set(
    Array.from({ length: Math.max(0, previewEnd - start + 1) }, (_, index) => String(start + index))
  );
  tenantUnits.forEach((unit) => extensionNumbers.add(unitExtension(unit)));
  tenantIntercoms.forEach((device) => extensionNumbers.add(String(device.intercomExtension)));
  if (targetTenant.sipPorterExtension) extensionNumbers.add(String(targetTenant.sipPorterExtension));

  return Array.from(extensionNumbers).sort((left, right) => Number(left) - Number(right)).map((extension) => {
    const unit = used.get(extension);
    const device = intercomByExtension.get(extension);
    const isPorter = extension === String(targetTenant.sipPorterExtension || "");
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
  unitList().forEach((unit) => {
    if (residents.some((person) => person.unitId === unit.unitId && (person.kind || "RESIDENT") === "RESIDENT")) {
      syncUnitResidentSummary(unit.unitId);
    }
  });
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
    residents: residents.map(publicPerson),
    vehicles,
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
    companies: companies.map(publicCompany),
    licenses,
    billingInvoices,
    billingGateway: {
      provider: "ASAAS",
      environment: asaasEnvironment,
      configured: Boolean(asaasApiKey),
      webhookConfigured: asaasWebhookTokenConfigured,
      webhookPath: "/api/webhooks/asaas"
    },
    resources,
    resourceConfigurations,
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
  if (matchesNiceLinear(device)) return NICE_LINEAR_ADAPTER;
  if (manufacturer.includes("control") || manufacturer.includes("control id") || manufacturer.includes("controlid")) {
    return CONTROL_ID_ACCESS_ADAPTER;
  }
  if (matchesHikvisionIsapi(device)) return HIKVISION_ISAPI_ADAPTER;
  if (matchesAxisVapix(device)) return AXIS_VAPIX_PACS_ADAPTER;
  if (matchesDahuaAccess(device)) return DAHUA_ACCESS_CGI_ADAPTER;
  if (matchesSupremaBiostar(device)) return SUPREMA_BIOSTAR_REST_ADAPTER;
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
    const responseError = deviceAdapter(device) === "HIKVISION_ISAPI" ? hikvisionResponseError(text) : "";
    if (responseError) throw new Error(responseError);
    return { ok: true, status: response.status, body: text };
  } finally {
    request.done();
  }
}

function hikvisionResponseError(text = "") {
  const clean = String(text || "").trim();
  if (!clean) return "";
  let statusCode;
  let statusString = "";
  let subStatusCode = "";
  try {
    const parsed = JSON.parse(clean);
    const status = parsed.ResponseStatus || parsed.responseStatus || parsed;
    statusCode = Number(status.statusCode);
    statusString = String(status.statusString || "");
    subStatusCode = String(status.subStatusCode || "");
  } catch {
    statusCode = Number(clean.match(/<statusCode>\s*(\d+)\s*<\/statusCode>/i)?.[1]);
    statusString = clean.match(/<statusString>\s*([^<]+)\s*<\/statusString>/i)?.[1] || "";
    subStatusCode = clean.match(/<subStatusCode>\s*([^<]+)\s*<\/subStatusCode>/i)?.[1] || "";
  }
  if (!Number.isFinite(statusCode) || statusCode === 1) return "";
  return `Hikvision recusou a operacao (${statusCode}${subStatusCode ? `/${subStatusCode}` : ""}${statusString ? `: ${statusString}` : ""})`;
}

function controlIdUserMap(users = []) {
  return new Map(users.map((user) => [String(user.id), user]));
}

function controlIdCredentialRecords(snapshot = {}) {
  const objects = snapshot.objects || {};
  const users = objects.users || [];
  const userMap = controlIdUserMap(users);
  const userFaceIds = new Set((objects.face_templates || []).map((face) => String(face.user_id || face.userId || "")));
  (objects.user_images || []).forEach((image) => {
    const userId = typeof image === "object" ? image.user_id || image.userId || image.id : image;
    if (userId !== undefined && userId !== null && String(userId)) userFaceIds.add(String(userId));
  });
  users
    .filter((user) => Number(user.image_timestamp || 0) > 0)
    .forEach((user) => userFaceIds.add(String(user.id)));

  const recordFromObject = (objectName, row = {}, type) => {
    const user = userMap.get(String(row.user_id || row.userId || ""));
    const value = String(row.value ?? row.card_value ?? row.id ?? "").trim();
    if (!value) return null;
    return {
      id: `CONTROLID-${objectName}-${normalizeLookup(row.id || value).slice(0, 32)}`,
      type,
      value,
      valueLabel: type === "RFID" ? `Tag ${value}` : value,
      personName: user?.name || "",
      personExternalId: user?.registration || String(user?.id || row.user_id || ""),
      source: "CONTROL_ID",
      sourceKind: objectName,
      devicePath: `/load_objects.fcgi:${objectName}`,
      raw: row
    };
  };

  const records = [
    ...(objects.cards || []).map((row) => recordFromObject("cards", row, "RFID")),
    ...(objects.qrcodes || []).map((row) => recordFromObject("qrcodes", row, "QR_CODE")),
    ...(objects.pins || []).map((row) => recordFromObject("pins", row, "PIN")),
    ...Array.from(userFaceIds).map((userId) => {
      const user = userMap.get(String(userId));
      if (!user) return null;
      return {
        id: `CONTROLID-face-${normalizeLookup(user.id).slice(0, 32)}`,
        type: "FACE",
        value: `CONTROLID-FACE-${user.id}`,
        valueLabel: `Face - ${user.name || user.registration || user.id}`,
        personName: user.name || "",
        personExternalId: user.registration || String(user.id),
        photoUrl: `/user_get_image.fcgi?user_id=${encodeURIComponent(user.id)}`,
        source: "CONTROL_ID",
        sourceKind: "face_templates",
        devicePath: "/load_objects.fcgi:face_templates",
        raw: user
      };
    })
  ].filter(Boolean);

  const seen = new Set();
  return records.filter((record) => {
    const key = credentialKey("", record.type, record.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  return testHikvisionIsapi(device, { requestDevice: hikvisionRequest });
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
  return openHikvisionIsapiDoor(device, relay, { requestDevice: hikvisionRequest });
}

async function openDeviceDoor(device, relay = 1, action = {}) {
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

  if (adapter === DAHUA_ACCESS_CGI_ADAPTER) {
    const result = await openDahuaAccessDoor(device, relay, { requestDevice: authenticatedDeviceRequest });
    return { adapter, status: result.status, message: `Dahua respondeu ${result.status}` };
  }

  if (adapter === AXIS_VAPIX_PACS_ADAPTER) {
    const result = await openAxisVapixDoor(device, action, { requestDevice: authenticatedDeviceRequest });
    return { adapter, status: result.status, message: `Axis VAPIX respondeu ${result.status}` };
  }

  if (adapter === CONTROL_ID_ACCESS_ADAPTER) {
    const result = await openControlIdDoor(device, relay);
    return {
      adapter,
      status: result.status,
      message: `Control iD respondeu ${result.status}`
    };
  }

  if (adapter === NICE_LINEAR_ADAPTER) {
    const result = await openNiceLinearDoor(device, relay, action);
    return {
      adapter,
      status: result.status,
      message: result.message
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

function defaultLicensedResourceIds() {
  return resources.filter((resource) => resource.enabled !== false).map((resource) => resource.id);
}

function findCompany(companyId = "") {
  return companies.find((company) => company.id === companyId) || null;
}

function billingNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function billingRecordActive(record = {}) {
  return !["INACTIVE", "BLOCKED", "CANCELLED"].includes(String(record.status || "").toUpperCase()) && record.active !== false;
}

function companyBillingSnapshot(company = {}) {
  const activeTenants = allTenants().filter((item) => item.companyId === company.id && billingRecordActive(item));
  const activeTenantIds = new Set(activeTenants.map((item) => item.id));
  const activeLicenses = licenses.filter((license) =>
    billingRecordActive(license) &&
    (activeTenantIds.has(license.tenantId) || (!license.tenantId && license.companyId === company.id))
  );
  const allocatedExtensions = activeLicenses.reduce((total, license) => total + billingNumber(license.extensionLimit), 0);
  const extensionQuantity = company.voipBillingModel === "PACKAGE"
    ? billingNumber(company.maxExtensions)
    : allocatedExtensions;
  const billableExtensions = company.voipBillingModel === "DISABLED"
    ? 0
    : Math.max(0, extensionQuantity - billingNumber(company.includedExtensions));
  const baseSubtotal = billingNumber(company.baseMonthlyPrice);
  const condominiumSubtotal = activeTenants.length * billingNumber(company.condominiumUnitPrice);
  const extensionSubtotal = billableExtensions * billingNumber(company.extensionUnitPrice);
  return {
    activeCondominiums: activeTenants.length,
    allocatedExtensions,
    billableExtensions,
    baseSubtotal,
    condominiumSubtotal,
    extensionSubtotal,
    total: Number((baseSubtotal + condominiumSubtotal + extensionSubtotal).toFixed(2))
  };
}

function billingDueDate(company = {}) {
  const date = new Date();
  const dueDay = Math.min(28, Math.max(1, Number(company.billingDueDay || 10)));
  if (date.getDate() > dueDay) date.setMonth(date.getMonth() + 1);
  date.setDate(dueDay);
  return date.toISOString().slice(0, 10);
}

async function asaasRequest(pathName, { method = "GET", body } = {}) {
  if (!asaasApiKey) throw new Error("Integracao Asaas nao configurada no servidor");
  const request = withTimeout(15000);
  try {
    const response = await fetch(`${asaasApiBaseUrl}${pathName}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Condo Access",
        access_token: asaasApiKey
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: request.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const description = payload?.errors?.map((error) => error.description).filter(Boolean).join("; ");
      throw new Error(description || `Asaas respondeu ${response.status}`);
    }
    return payload;
  } finally {
    request.done();
  }
}

async function ensureAsaasCustomer(company = {}) {
  if (company.asaasCustomerId) return company.asaasCustomerId;
  const document = String(company.document || "").replace(/\D/g, "");
  if (!document) throw new Error("Informe o CNPJ/Documento da empresa antes de gerar a cobranca");
  const customer = await asaasRequest("/customers", {
    method: "POST",
    body: {
      name: company.name,
      cpfCnpj: document,
      email: company.contactEmail || undefined,
      mobilePhone: String(company.contactPhone || "").replace(/\D/g, "") || undefined,
      externalReference: company.id
    }
  });
  company.asaasCustomerId = customer.id;
  company.updatedAt = now();
  return customer.id;
}

function companyResourceIds(company) {
  return Array.isArray(company?.resourceIds) ? company.resourceIds : resources.map((resource) => resource.id);
}

function companyTenantCount(companyId = "", ignoredTenantId = "") {
  return allTenants().filter((item) => item.companyId === companyId && item.id !== ignoredTenantId).length;
}

function tenantLicense(tenantId = "") {
  return licenses.find((license) => license.tenantId === tenantId && license.active !== false) || null;
}

function licensedResourceIds(license) {
  return Array.isArray(license?.resourceIds) ? license.resourceIds : defaultLicensedResourceIds();
}

function resourceConfiguration(tenantId = "", resourceId = "") {
  return resourceConfigurations.find((item) => item.tenantId === tenantId && item.resourceId === resourceId) || null;
}

function effectiveResources(tenantId = "") {
  if (!tenantId) return resources;
  const tenantData = findTenant(tenantId);
  const company = findCompany(tenantData?.companyId);
  const license = tenantLicense(tenantId);
  const companyIds = new Set(companyResourceIds(company));
  const enabledIds = new Set(licensedResourceIds(license).filter((id) => !company || companyIds.has(id)));
  return resources.map((resource) => ({
    ...resource,
    tenantId,
    companyId: company?.id || "",
    licenseId: license?.id || "",
    contracted: !company || companyIds.has(resource.id),
    enabled: Boolean(license?.active !== false && enabledIds.has(resource.id)),
    configuration: resourceConfiguration(tenantId, resource.id)?.settings || {}
  }));
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

function passwordDigest(password = "", salt = "") {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function createPasswordRecord(password = defaultCompanyPassword) {
  const passwordSalt = randomBytes(16).toString("hex");
  return {
    passwordSalt,
    passwordHash: passwordDigest(password, passwordSalt)
  };
}

function validPassword(record, password = "") {
  return Boolean(record?.passwordSalt && record?.passwordHash && passwordDigest(password, record.passwordSalt) === record.passwordHash);
}

function publicCompany(company = {}) {
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...safeCompany } = company;
  return safeCompany;
}

function importedFaceCredentialForPerson(person = {}) {
  return credentials.find((credential) =>
    credential.type === "FACE" &&
    credential.photoUrl &&
    (
      (person.id && credential.personId === person.id) ||
      (
        person.tenantId === credential.tenantId &&
        person.unitId === credential.unitId &&
        normalizeLookup(person.name) === normalizeLookup(credential.personName)
      )
    )
  ) || null;
}

function publicPersonPhotoUrl(person = {}, origin = "") {
  const faceCredential = importedFaceCredentialForPerson(person);
  if (faceCredential) {
    const path = `/api/credentials/${encodeURIComponent(faceCredential.id)}/photo`;
    return origin ? `${origin}${path}` : path;
  }
  return person.photoUrl || "";
}

function publicPerson(person = {}) {
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...safePerson } = person;
  return {
    ...safePerson,
    photoUrl: publicPersonPhotoUrl(person)
  };
}

function ensureMasterAdmin() {
  let master = systemUsers.find((user) => user.role === "SUPER_ADMIN");
  if (master) return master;
  master = {
    id: "user-master",
    name: "Master Administrador",
    email: masterAdminEmail,
    role: "SUPER_ADMIN",
    mustChangePassword: true,
    ...createPasswordRecord(),
    updatedAt: now()
  };
  systemUsers.unshift(master);
  savePersistentState("master-admin-created");
  return master;
}

function updateById(collection, id, body) {
  const index = collection.findIndex((item) => item.id === id);
  if (index === -1) return null;
  collection[index] = { ...collection[index], ...body, id };
  return collection[index];
}

function removeMatching(collection, predicate) {
  let removed = 0;
  for (let index = collection.length - 1; index >= 0; index -= 1) {
    if (!predicate(collection[index])) continue;
    collection.splice(index, 1);
    removed += 1;
  }
  return removed;
}

function removeInactiveTenantData() {
  const activeTenantIds = new Set(allTenants().map((item) => item.id));
  const inactiveUnitIds = new Set(
    unitList()
      .filter((unit) => !activeTenantIds.has(unit.tenantId))
      .map((unit) => unit.unitId)
  );
  let removedUnits = 0;
  inactiveUnitIds.forEach((unitId) => {
    if (units.delete(unitId)) removedUnits += 1;
  });

  const belongsToInactiveTenant = (item) =>
    Boolean(item?.tenantId && !activeTenantIds.has(item.tenantId));
  const belongsToInactiveUnit = (item) =>
    Boolean(item?.unitId && inactiveUnitIds.has(item.unitId));

  return {
    units: removedUnits,
    residents: removeMatching(residents, (item) => belongsToInactiveTenant(item) || belongsToInactiveUnit(item)),
    vehicles: removeMatching(vehicles, (item) => belongsToInactiveTenant(item) || belongsToInactiveUnit(item)),
    devices: removeMatching(devices, belongsToInactiveTenant),
    cameras: removeMatching(cameras, belongsToInactiveTenant),
    actions: removeMatching(actions, belongsToInactiveTenant),
    credentials: removeMatching(credentials, (item) => belongsToInactiveTenant(item) || belongsToInactiveUnit(item)),
    syncJobs: removeMatching(credentialSyncJobs, belongsToInactiveTenant),
    logins: removeMatching(unitLogins, (item) => belongsToInactiveTenant(item) || belongsToInactiveUnit(item)),
    invites: removeMatching(unitInvites, (item) => belongsToInactiveTenant(item) || belongsToInactiveUnit(item)),
    routes: removeMatching(accessRoutes, belongsToInactiveTenant),
    profiles: removeMatching(permissionProfiles, belongsToInactiveTenant),
    licenses: removeMatching(licenses, belongsToInactiveTenant),
    configurations: removeMatching(resourceConfigurations, belongsToInactiveTenant),
    accessLogs: removeMatching(accessLogs, (item) => belongsToInactiveTenant(item) || belongsToInactiveUnit(item)),
    calls: removeMatching(intercomCalls, (item) => belongsToInactiveTenant(item) || belongsToInactiveUnit(item))
  };
}

function removedItemCount(cleanup = {}) {
  return Object.values(cleanup).reduce((total, count) => total + Number(count || 0), 0);
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

function oneSignalUnitExternalId(tenantId = "", unitId = "") {
  const tenant = String(tenantId || "").trim();
  const unit = String(unitId || "").trim();
  if (!tenant || !unit) return "";
  return `condo:${tenant}:unit:${unit}`;
}

async function sendOneSignalPushToUnit(unit, payload = {}) {
  const externalId = oneSignalUnitExternalId(unit?.tenantId, unit?.unitId);
  if (!oneSignalAppId || !oneSignalRestApiKey || !externalId) {
    return { ok: false, skipped: true, reason: "ONESIGNAL_NOT_CONFIGURED" };
  }

  const tenantData = findTenant(unit.tenantId);
  const messageBody = payload.body || `${tenantData.name} - Unidade ${unit.unitNumber || unit.unitId}`;
  const body = {
    app_id: oneSignalAppId,
    target_channel: "push",
    include_aliases: { external_id: [externalId] },
    headings: { pt: payload.title || "Chamada da portaria", en: payload.title || "Porter call" },
    contents: { pt: messageBody, en: messageBody },
    priority: 10,
    ttl: 60,
    data: {
      type: "PORTER_CALL",
      tenantId: unit.tenantId,
      unitId: unit.unitId,
      unitNumber: unit.unitNumber || "",
      callId: payload.callId || "",
      sourceExtension: payload.sourceExtension || "",
      targetExtension: payload.targetExtension || ""
    }
  };

  try {
    const pushResponse = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${oneSignalRestApiKey}`
      },
      body: JSON.stringify(body)
    });
    const result = await pushResponse.json().catch(() => ({}));
    if (!pushResponse.ok) {
      return { ok: false, status: pushResponse.status, result };
    }
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
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
    personExternalId: body.personExternalId || body.externalId || "",
    devicePath: body.devicePath || "",
    photoUrl: body.photoUrl || "",
    validFrom: body.validFrom || "",
    validUntil: body.validUntil || "",
    createdAt: body.createdAt || now(),
    updatedAt: now()
  };

  const updated = body.id ? updateById(credentials, body.id, credential) : null;
  if (!updated) credentials.unshift(credential);
  return { credential: updated || credential, duplicate: null };
}

const {
  tryParseJson,
  valueFromKeys,
  recursiveValueFromKeys,
  collectObjectsByKeys,
  collectRecordValuesByKeys,
  looksLikeDeviceCredentialRow,
  findFirstNumberByKeys,
  hikvisionSearchBody,
  hikvisionSearchXmlBody,
  hikvisionSearchRequestBody,
  responseSample,
  firstHikvisionImageValue,
  parseHikvisionEventTime,
  hikvisionEventDecision,
  normalizeHikvisionEvent,
  parseHikvisionEventsResponse,
  xmlBlocks,
  xmlValue,
  queryTableRows,
  deviceCredentialType,
  normalizeDeviceCredential,
  parseDeviceCredentialResponse
} = createHikvisionParsers({ normalizeLookup, normalizeCredentialType, credentialKey, now, tenant });

async function readPagedHikvisionCredentials(device, candidate) {
  const records = [];
  const attempts = [];
  const pageSize = candidate.pageSize || 30;
  const searchID = `condo-${Date.now()}-${randomBytes(3).toString("hex")}`;
  let position = 0;
  let totalMatches = 0;

  for (let page = 0; page < 1000; page += 1) {
    const result = await authenticatedDeviceRequest(device, candidate.path, {
      method: candidate.method,
      body: hikvisionSearchRequestBody(candidate, position, pageSize, searchID),
      contentType: candidate.contentType || "application/json",
      timeoutMs: 12000
    });
    let parsedRecords = parseDeviceCredentialResponse(result.body, {
      source: "DEVICE_API",
      kind: candidate.kind,
      path: `${candidate.path}#${position}`
    }, candidate.type);
    if (candidate.enrichPhotos) {
      parsedRecords = await enrichHikvisionFaceRecords(device, parsedRecords);
    }
    const payload = tryParseJson(result.body);
    const pageMatches = findFirstNumberByKeys(payload, ["numOfMatches", "numOfMatch", "matches"]);
    totalMatches = totalMatches || findFirstNumberByKeys(payload, ["totalMatches", "totalMatch", "total"]);
    records.push(...parsedRecords);
    attempts.push({
      label: `${candidate.label} pagina ${page + 1}`,
      path: `${candidate.path} @ ${position}`,
      ok: true,
      status: result.status,
      records: parsedRecords.length,
      totalMatches: totalMatches || undefined,
      bodyFormat: candidate.bodyFormat || "json",
      bodyPreview: parsedRecords.length ? undefined : responseSample(result.body)
    });
    const step = Math.max(pageMatches || parsedRecords.length, 0);
    if (!step) break;
    position += step;
    if (totalMatches && position >= totalMatches) break;
    if (!totalMatches && step < pageSize) break;
  }

  return { records, attempts };
}


function absoluteDeviceImageUrl(device, photoRef = "") {
  const clean = String(photoRef || "").trim();
  if (!clean || clean.startsWith("data:")) return clean;
  try {
    return new URL(clean).toString();
  } catch {
    const pathName = clean.startsWith("/") ? clean : `/${clean}`;
    return `${deviceBaseUrl(device)}${pathName}`;
  }
}

async function hikvisionFetchImageAsDataUrl(device, photoRef = "") {
  const clean = String(photoRef || "").trim();
  if (!clean || clean.startsWith("data:")) return clean;
  if (/[\?&]token=/i.test(clean)) return absoluteDeviceImageUrl(device, clean);

  const maxBytes = Number(process.env.HIKVISION_FACE_IMAGE_MAX_BYTES || 350000);
  const targetUrl = absoluteDeviceImageUrl(device, clean);
  const headers = await hikvisionAuthHeaders(device, targetUrl, "GET");
  const request = withTimeout(10000);
  try {
    const response = await fetch(targetUrl, { method: "GET", headers, signal: request.signal });
    if (!response.ok) throw new Error(`Imagem facial respondeu ${response.status}`);
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maxBytes) return targetUrl;
    return `data:${contentType.split(";")[0] || "image/jpeg"};base64,${buffer.toString("base64")}`;
  } finally {
    request.done();
  }
}

async function enrichHikvisionFaceRecords(device, records = []) {
  const enriched = [];
  for (const record of records) {
    const photoRef = record.photoUrl || record.photoRef || firstHikvisionImageValue(record.raw);
    if (!photoRef) {
      enriched.push(record);
      continue;
    }
    try {
      enriched.push({
        ...record,
        photoUrl: await hikvisionFetchImageAsDataUrl(device, photoRef),
        photoRef
      });
    } catch {
      enriched.push({
        ...record,
        photoUrl: absoluteDeviceImageUrl(device, photoRef),
        photoRef
      });
    }
  }
  return enriched;
}

async function readPagedHikvisionEvents(device, { limit = 200 } = {}) {
  const records = [];
  const attempts = [];
  const pageSize = 30;
  const searchID = `condo-events-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000);
  let position = 0;
  let totalMatches = 0;

  for (let page = 0; page < 1000 && records.length < limit; page += 1) {
    const result = await authenticatedDeviceRequest(device, "/ISAPI/AccessControl/AcsEvent?format=json", {
      method: "POST",
      body: hikvisionSearchBody("AcsEventCond", position, pageSize, {
        searchID,
        major: 0,
        minor: 0,
        picEnable: true,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString()
      }),
      contentType: "application/json",
      timeoutMs: 12000
    });
    const parsedRecords = parseHikvisionEventsResponse(result.body, device);
    const payload = tryParseJson(result.body);
    const pageMatches = findFirstNumberByKeys(payload, ["numOfMatches", "numOfMatch", "matches"]);
    totalMatches = totalMatches || findFirstNumberByKeys(payload, ["totalMatches", "totalMatch", "total"]);
    records.push(...parsedRecords);
    attempts.push({
      label: `Hikvision eventos pagina ${page + 1}`,
      path: `/ISAPI/AccessControl/AcsEvent?format=json @ ${position}`,
      ok: true,
      status: result.status,
      records: parsedRecords.length,
      totalMatches: totalMatches || undefined
    });

    const step = Math.max(pageMatches || parsedRecords.length, 0);
    if (!step) break;
    position += step;
    if (totalMatches && position >= totalMatches) break;
    if (!totalMatches && step < pageSize) break;
  }

  return { records: records.slice(0, limit), attempts };
}

function persistDeviceEvents(device, events = []) {
  let created = 0;
  let updated = 0;
  events.forEach((event) => {
    const key = normalizeLookup(`${event.door?.deviceId || device.id}-${event.createdAt}-${event.userId}-${event.cardNo}-${event.reason}`);
    const existing = accessLogs.find((log) =>
      normalizeLookup(`${log.door?.deviceId || ""}-${log.createdAt}-${log.user?.id || log.userId || ""}-${log.cardNo || ""}-${log.reason || ""}`) === key
    );
    if (existing) {
      Object.assign(existing, { ...existing, ...event, id: existing.id, updatedAt: now() });
      updated += 1;
    } else {
      accessLogs.unshift(event);
      created += 1;
    }
  });
  return { created, updated };
}


function logControlIdImportDebug(device = {}, snapshot = {}, records = [], stage = "read") {
}

async function readDeviceCredentialsFromDevice(device, { resource = "credentials" } = {}) {
  const adapter = deviceAdapter(device);
  const faceOnly = resource === "faces";
  const attempts = [];
  const records = [];
  const events = [];
  if (adapter === CONTROL_ID_ACCESS_ADAPTER) {
    const snapshot = await readControlIdSnapshot(device);
    const allRecords = resource === "vehicleTags"
      ? controlIdVehicleTagRecords(snapshot, device)
      : controlIdCredentialRecords(snapshot);
    const uniqueRecords = faceOnly ? allRecords.filter((record) => record.type === "FACE") : allRecords;
    logControlIdImportDebug(device, snapshot, uniqueRecords, "read-device-credentials");
    return {
      ok: uniqueRecords.length > 0,
      adapter,
      source: "CONTROL_ID_API",
      records: uniqueRecords,
      events: controlIdDeviceEvents(snapshot, device, 200),
      attempts: snapshot.attempts,
      message: uniqueRecords.length
        ? `${uniqueRecords.length} credencial(is) lida(s) do Control iD`
        : resource === "vehicleTags"
          ? "Control iD respondeu, mas nao retornou tags veiculares"
          : "Control iD respondeu, mas nao retornou cards, tags, QR, PIN ou faces"
    };
  }

  const candidates = (adapter === "HIKVISION_ISAPI"
    ? [
      { label: "Hikvision cartoes", kind: "CARD", type: "RFID", method: "POST", path: "/ISAPI/AccessControl/CardInfo/Search?format=json", rootName: "CardInfoSearchCond", contentType: "application/json" },
      { label: "Hikvision cartoes XML", kind: "CARD", type: "RFID", method: "POST", path: "/ISAPI/AccessControl/CardInfo/Search", rootName: "CardInfoSearchCond", contentType: "application/xml", bodyFormat: "xml" },
      { label: "Hikvision usuarios", kind: "USER", type: "APP", method: "POST", path: "/ISAPI/AccessControl/UserInfo/Search?format=json", rootName: "UserInfoSearchCond", contentType: "application/json" },
      { label: "Hikvision usuarios XML", kind: "USER", type: "APP", method: "POST", path: "/ISAPI/AccessControl/UserInfo/Search", rootName: "UserInfoSearchCond", contentType: "application/xml", bodyFormat: "xml" },
      { label: "Hikvision faces", kind: "FACE", type: "FACE", method: "POST", path: "/ISAPI/AccessControl/FaceInfo/Search?format=json", rootName: "FaceInfoSearchCond", contentType: "application/json" },
      { label: "Hikvision faces XML", kind: "FACE", type: "FACE", method: "POST", path: "/ISAPI/AccessControl/FaceInfo/Search", rootName: "FaceInfoSearchCond", contentType: "application/xml", bodyFormat: "xml" },
      { label: "Hikvision biblioteca facial", kind: "FACE", type: "FACE", method: "POST", path: "/ISAPI/Intelligent/FDLib/FDSearch?format=json", rootName: "FDSearchDescription", contentType: "application/json", search: { faceLibType: "blackFD" } },
      { label: "Hikvision biblioteca facial XML", kind: "FACE", type: "FACE", method: "POST", path: "/ISAPI/Intelligent/FDLib/FDSearch", rootName: "FDSearchDescription", contentType: "application/xml", bodyFormat: "xml", search: { faceLibType: "blackFD" } }
    ]
    : adapter === INTELBRAS_SS_3532_MF_W_ADAPTER
      ? [
        { label: "Intelbras usuarios", kind: "USER", type: "APP", method: "GET", path: "/cgi-bin/AccessUser.cgi?action=listAll" },
        { label: "Intelbras cartoes", kind: "CARD", type: "RFID", method: "GET", path: "/cgi-bin/AccessCard.cgi?action=listAll" },
        { label: "Intelbras faces", kind: "FACE", type: "FACE", method: "GET", path: "/cgi-bin/AccessFace.cgi?action=listAll" }
      ]
      : [])
    .filter((candidate) => !faceOnly || candidate.type === "FACE" || candidate.kind === "USER");

  if (!candidates.length) {
    return {
      ok: false,
      adapter,
      records,
      events,
      attempts,
      message: `Adapter ${adapter} ainda nao possui leitura direta de credenciais homologada`
    };
  }

  for (const candidate of candidates) {
    try {
      const recordsBefore = records.length;
      if (adapter === "HIKVISION_ISAPI" && candidate.rootName) {
        const paged = await readPagedHikvisionCredentials(device, candidate);
        records.push(...paged.records);
        attempts.push(...paged.attempts);
      } else {
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
      }
      if (faceOnly && records.slice(recordsBefore).some((record) => record.type === "FACE")) break;
    } catch (error) {
      attempts.push({
        label: candidate.label,
        path: candidate.path,
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao ler credenciais"
      });
    }
  }

  if (adapter === "HIKVISION_ISAPI" && !faceOnly) {
    try {
      const eventResult = await readPagedHikvisionEvents(device, { limit: 200 });
      events.push(...eventResult.records);
      attempts.push(...eventResult.attempts);
    } catch (error) {
      attempts.push({
        label: "Hikvision eventos",
        path: "/ISAPI/AccessControl/AcsEvent?format=json",
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao ler eventos Hikvision"
      });
    }
  }

  const seen = new Set();
  const uniqueRecords = records.filter((record) => {
    if (faceOnly && record.type !== "FACE") return false;
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
    events,
    attempts,
    message: uniqueRecords.length
      ? `${uniqueRecords.length} credencial(is) lida(s) do equipamento`
      : "Nenhuma credencial foi retornada pelos endpoints testados"
  };
}

function matchResidentForDeviceCredential(record = {}, device = {}) {
  return findPersonForDeviceCredential(record, device);
}

function faceImportSelectionForRecord(record = {}, index = 0, selections = []) {
  const row = index + 1;
  return selections.find((item) =>
    String(item.recordId || "") === String(record.id || "") ||
    Number(item.row || 0) === row ||
    credentialKey("", record.type, record.value) === credentialKey("", item.type || record.type, item.value || "")
  ) || null;
}

function unitPayloadFromFaceSelection(record = {}, device = {}, selection = {}) {
  const selectedUnitId = String(selection.unitId || "").trim();
  const selectedUnit = selectedUnitId ? unitForId(selectedUnitId) : null;
  if (selectedUnit && selectedUnit.tenantId === device.tenantId) {
    return {
      tenantId: device.tenantId,
      unitId: selectedUnit.unitId,
      unitNumber: selectedUnit.unitNumber,
      blockName: selectedUnit.blockName || "",
      name: record.personName || `Usuario ${record.personExternalId || ""}`.trim(),
      cpf: "",
      email: "",
      phone: "",
      relation: "Morador",
      kind: "RESIDENT",
      credentialType: record.type || "FACE",
      credentialValue: record.value
    };
  }
  const unitNumber = String(selection.unitNumber || selection.unit || record.raw?.unitNumber || record.raw?.apartment || record.raw?.roomNo || "").trim();
  const blockName = String(selection.blockName || selection.block || record.raw?.blockName || record.raw?.floorNo || "").trim();
  if (!unitNumber) return null;
  return {
    tenantId: device.tenantId,
    unitNumber,
    blockName,
    name: record.personName || `Usuario ${record.personExternalId || ""}`.trim(),
    cpf: "",
    email: "",
    phone: "",
    relation: "Morador",
    kind: "RESIDENT",
    credentialType: record.type || "FACE",
    credentialValue: record.value
  };
}

async function importDeviceCredentials(device, { dryRun = true, selections = [], resource = "credentials" } = {}) {
  const readResult = await readDeviceCredentialsFromDevice(device, { resource });
  const report = {
    dryRun,
    device: publicDevice(device),
    adapter: readResult.adapter,
    source: readResult.source || "DEVICE_API",
    generatedAt: now(),
    total: readResult.records.length,
    valid: 0,
    duplicates: 0,
    peopleCreated: 0,
    peopleUpdated: 0,
    unitsCreated: 0,
    credentialsCreated: 0,
    credentialsUpdated: 0,
    vehiclesCreated: 0,
    vehiclesUpdated: 0,
    eventsRead: readResult.events?.length || 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    syncJob: null,
    invalid: 0,
    attempts: readResult.attempts,
    message: readResult.message,
    items: []
  };

  readResult.records.forEach((record, index) => {
    const rowNumber = index + 1;
    const selection = faceImportSelectionForRecord(record, index, selections);
    const hasSelections = selections.length > 0;
    const selected = !hasSelections || selection?.selected !== false;
    if (!selected) {
      report.items.push({ row: rowNumber, status: "SKIPPED", payload: record, errors: ["Nao selecionado para importacao"] });
      return;
    }
    if (!record.value || !record.type) {
      report.invalid += 1;
      report.items.push({ row: rowNumber, status: "INVALID", payload: record, errors: ["Credencial sem tipo ou valor"] });
      return;
    }

    if (resource === "vehicleTags" && record.type === "VEHICLE_TAG") {
      const existingVehicle = vehicles.find((vehicle) =>
        vehicle.tenantId === device.tenantId &&
        normalizeLookup(vehicle.tagValue) === normalizeLookup(record.value)
      );
      let vehicle = existingVehicle;
      if (!dryRun) {
        if (existingVehicle) {
          Object.assign(existingVehicle, {
            tagValue: record.value,
            tagMode: record.mode || normalizeControlIdUhfMode(device.controlIdUhfMode),
            tagDeviceId: device.id,
            tagExternalId: record.externalId || existingVehicle.tagExternalId || "",
            tagUserId: record.raw?.user_id || existingVehicle.tagUserId || "",
            tagStatus: "SYNCED",
            tagSyncedAt: now(),
            updatedAt: now()
          });
        } else {
          const suffix = normalizeLookup(record.value).slice(-10).toUpperCase() || String(index + 1);
          vehicle = {
            id: makeId("vehicle"),
            tenantId: device.tenantId,
            unitId: "",
            personId: "",
            plate: `TAG-${suffix}`,
            brand: "",
            model: "",
            color: "",
            type: "NAO_INFORMADO",
            notes: "Importado do Control iD. Informe a placa e vincule a unidade.",
            tagValue: record.value,
            tagMode: record.mode || normalizeControlIdUhfMode(device.controlIdUhfMode),
            tagDeviceId: device.id,
            tagExternalId: record.externalId || "",
            tagUserId: record.raw?.user_id || "",
            tagStatus: "SYNCED",
            tagSyncedAt: now(),
            createdAt: now(),
            updatedAt: now()
          };
          vehicles.unshift(vehicle);
        }
      }
      report.valid += 1;
      if (existingVehicle) report.vehiclesUpdated += dryRun ? 0 : 1;
      else report.vehiclesCreated += dryRun ? 0 : 1;
      report.items.push({
        row: rowNumber,
        status: existingVehicle ? "DUPLICATE_OR_UPDATE" : "NEW",
        vehicleId: vehicle?.id || "",
        payload: {
          recordId: record.id,
          type: record.type,
          value: record.value,
          valueLabel: record.valueLabel,
          personName: record.personName,
          personExternalId: record.personExternalId,
          mode: record.mode,
          object: record.object,
          deviceId: device.id
        }
      });
      return;
    }

    const existingPerson = matchResidentForDeviceCredential(record, device);
    const selectedUnitPayload = unitPayloadFromFaceSelection(record, device, selection || {});
    const existingSelectedUnit = selectedUnitPayload?.unitId
      ? unitForId(selectedUnitPayload.unitId)
      : selectedUnitPayload
        ? findUnitByNumber(device.tenantId, selectedUnitPayload.unitNumber, selectedUnitPayload.blockName)
        : null;
    const selectedUnit = selectedUnitPayload
      ? existingSelectedUnit || upsertImportUnit(selectedUnitPayload, dryRun)
      : null;
    const person = (record.personName || record.personExternalId)
      ? upsertDeviceImportPerson(record, device, dryRun, selectedUnit?.unitId || existingPerson?.unitId || "")
      : existingPerson;
    const unit = selectedUnit || unitForId(person?.unitId);
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
          personExternalId: existingCredential.personExternalId || record.personExternalId || "",
          devicePath: existingCredential.devicePath || record.devicePath || "",
          photoUrl: existingCredential.photoUrl || record.photoUrl || "",
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
          personExternalId: record.personExternalId || "",
          devicePath: record.devicePath || "",
          photoUrl: record.photoUrl || "",
          deviceId: device.id,
          source: "DEVICE_IMPORT",
          syncStatus: "SYNCED"
        });
        credential = result.credential || result.duplicate;
      }
    }

    report.valid += 1;
    if (selectedUnitPayload && !existingSelectedUnit) {
      report.unitsCreated += dryRun ? 0 : 1;
    }
    if (record.personName || record.personExternalId) {
      if (existingPerson) report.peopleUpdated += dryRun ? 0 : 1;
      else report.peopleCreated += dryRun ? 0 : 1;
    }
    if (existingCredential) report.credentialsUpdated += dryRun ? 0 : 1;
    else report.credentialsCreated += dryRun ? 0 : 1;
    report.items.push({
      row: rowNumber,
      status: existingCredential ? "DUPLICATE_OR_UPDATE" : "NEW",
      credentialId: credential?.id || "",
      personId: person?.id || "",
      unitId: unit?.unitId || "",
      payload: {
        recordId: record.id,
        type: record.type,
        value: record.value,
        valueLabel: record.valueLabel,
        personName: record.personName,
        personExternalId: record.personExternalId,
        photoUrl: record.photoUrl || "",
        devicePath: record.devicePath,
        unitNumber: selectedUnitPayload?.unitNumber || unit?.unitNumber || "",
        blockName: selectedUnitPayload?.blockName || unit?.blockName || "",
        extension: unit?.telephony?.extension || unit?.extension || ""
      }
    });
  });

  if (!dryRun && readResult.events?.length) {
    const eventReport = persistDeviceEvents(device, readResult.events);
    report.eventsCreated = eventReport.created;
    report.eventsUpdated = eventReport.updated;
  }

  if (!dryRun) savePersistentState("device-credentials-imported");
  return report;
}

const equipmentIntegrationResources = new Set(["summary", "events", "credentials", "schedules", "faces", "vehicleTags", "users"]);

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
    source: credential.source || "LOCAL",
    photoUrl: credential.photoUrl || person?.photoUrl || ""
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

function secondsToClock(value = 0) {
  const seconds = Math.max(0, Number(value) || 0);
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function controlIdDeviceUsers(snapshot = {}, device = {}) {
  const objects = snapshot.objects || {};
  const credentialRecords = controlIdCredentialRecords(snapshot);
  return (objects.users || []).map((user) => {
    const person = matchResidentForDeviceCredential({
      personName: user.name,
      personExternalId: user.registration || String(user.id)
    }, device);
    const unit = unitForId(person?.unitId);
    const userCredentials = credentialRecords.filter((credential) =>
      String(credential.raw?.user_id || credential.raw?.userId || credential.raw?.id || "") === String(user.id)
    );
    return {
      id: `controlid-user-${user.id}`,
      name: user.name || user.registration || `Usuario ${user.id}`,
      kind: Number(user.user_type_id || 0) === 1 ? "VISITOR" : "USER",
      role: Number(user.user_type_id || 0) === 1 ? "Visitante" : "Usuario",
      unitId: unit?.unitId || "",
      unitNumber: unit?.unitNumber || "",
      blockName: unit?.blockName || "",
      cpf: person?.cpf || "",
      rg: person?.rg || "",
      phone: person?.phone || "",
      email: person?.email || "",
      vehiclePlate: person?.vehiclePlate || "",
      allowedDays: "",
      allowedHours: "",
      externalId: user.registration || String(user.id),
      source: "CONTROL_ID",
      credentials: userCredentials.map((credential) => ({
        id: credential.id,
        type: credential.type,
        valueLabel: credential.valueLabel,
        syncStatus: "DEVICE"
      })),
      raw: user
    };
  });
}

function controlIdDeviceCredentials(snapshot = {}, device = {}) {
  return controlIdCredentialRecords(snapshot).map((credential) => {
    const person = matchResidentForDeviceCredential(credential, device);
    const unit = unitForId(person?.unitId);
    return {
      id: credential.id,
      personId: person?.id || "",
      personName: person?.name || credential.personName || "Sem vinculo local",
      unitId: unit?.unitId || "",
      unitNumber: unit?.unitNumber || "",
      type: credential.type,
      valueLabel: credential.valueLabel || credential.value,
      syncStatus: "DEVICE",
      deviceId: device.id,
      validFrom: "",
      validUntil: "",
      photoUrl: credential.photoUrl || "",
      source: "CONTROL_ID",
      raw: credential.raw
    };
  });
}

function controlIdDeviceSchedules(snapshot = {}) {
  const objects = snapshot.objects || {};
  const zones = new Map((objects.time_zones || []).map((zone) => [String(zone.id), zone]));
  return (objects.time_spans || []).map((span) => {
    const zone = zones.get(String(span.time_zone_id)) || {};
    const days = [
      ["sun", "Dom"],
      ["mon", "Seg"],
      ["tue", "Ter"],
      ["wed", "Qua"],
      ["thu", "Qui"],
      ["fri", "Sex"],
      ["sat", "Sab"]
    ].filter(([key]) => Number(span[key] || 0) === 1).map(([, label]) => label).join(", ");
    return {
      id: `controlid-time-span-${span.id}`,
      name: zone.name || `Horario ${span.time_zone_id}`,
      type: "CONTROL_ID_TIME_SPAN",
      origin: "Control iD",
      target: zone.name || `Time zone ${span.time_zone_id}`,
      validFrom: "",
      validUntil: "",
      allowedDays: days || "Sem dias",
      allowedHours: `${secondsToClock(span.start)}-${secondsToClock(span.end)}`,
      raw: span
    };
  });
}

function controlIdDeviceEvents(snapshot = {}, device = {}, limit = 50) {
  const users = controlIdUserMap(snapshot.objects?.users || []);
  return (snapshot.objects?.access_logs || []).slice(0, limit).map((event) => {
    const user = users.get(String(event.user_id || ""));
    return {
      id: `controlid-event-${event.id}`,
      decision: Number(event.event) === 7 ? "ALLOW" : Number(event.event) === 6 ? "DENY" : "INFO",
      reason: `Evento Control iD ${event.event ?? ""}`.trim(),
      createdAt: event.time ? new Date(Number(event.time) * 1000).toISOString() : "",
      userName: user?.name || "",
      userId: String(event.user_id || ""),
      unitId: "",
      doorName: device.name || "",
      doorId: device.id,
      deviceId: device.id,
      manufacturer: device.manufacturer || "Control iD",
      rawEvent: event,
      scope: "DEVICE"
    };
  });
}

function hikvisionDeviceCredentials(records = [], device = {}) {
  return records.map((credential) => {
    const person = matchResidentForDeviceCredential(credential, device);
    const unit = unitForId(person?.unitId);
    return {
      id: credential.id,
      personId: person?.id || "",
      personName: person?.name || credential.personName || "Sem vinculo local",
      unitId: unit?.unitId || "",
      unitNumber: unit?.unitNumber || "",
      type: credential.type,
      valueLabel: credential.valueLabel || credential.value,
      syncStatus: "DEVICE",
      deviceId: device.id,
      validFrom: "",
      validUntil: "",
      source: "HIKVISION_ISAPI",
      photoUrl: credential.photoUrl || person?.photoUrl || "",
      raw: credential.raw
    };
  });
}

function hikvisionDeviceUsers(records = [], device = {}) {
  const byExternalId = new Map();
  records.forEach((record) => {
    const externalId = record.personExternalId || record.value;
    const key = normalizeLookup(externalId || record.personName || record.id);
    if (!key) return;
    const current = byExternalId.get(key) || {
      id: `hikvision-user-${key.slice(0, 32)}`,
      name: record.personName || `Usuario ${externalId || ""}`.trim(),
      kind: "USER",
      role: "Usuario",
      externalId,
      photoUrl: record.photoUrl || "",
      credentials: []
    };
    if (record.photoUrl && !current.photoUrl) current.photoUrl = record.photoUrl;
    current.credentials.push({
      id: record.id,
      type: record.type,
      valueLabel: record.valueLabel || record.value,
      syncStatus: "DEVICE"
    });
    byExternalId.set(key, current);
  });

  return Array.from(byExternalId.values()).map((user) => {
    const person = matchResidentForDeviceCredential({
      personName: user.name,
      personExternalId: user.externalId
    }, device);
    const unit = unitForId(person?.unitId);
    return {
      ...user,
      name: person?.name || user.name,
      unitId: unit?.unitId || "",
      unitNumber: unit?.unitNumber || "",
      blockName: unit?.blockName || "",
      cpf: person?.cpf || "",
      rg: person?.rg || "",
      phone: person?.phone || "",
      email: person?.email || "",
      vehiclePlate: person?.vehiclePlate || "",
      allowedDays: person?.allowedDays || "",
      allowedHours: person?.allowedHours || "",
      source: "HIKVISION_ISAPI"
    };
  });
}

async function deviceIntegrationPayload(device, resource = "summary", { limit = 50 } = {}) {
  const adapter = deviceAdapter(device);
  let directPayload = null;
  let directAttempts = [];

  if (adapter === CONTROL_ID_ACCESS_ADAPTER) {
    const snapshot = await readControlIdSnapshot(device);
    directAttempts = snapshot.attempts;
    const credentialRecords = controlIdDeviceCredentials(snapshot, device);
    directPayload = {
      source: "CONTROL_ID_API",
      credentials: credentialRecords,
      schedules: controlIdDeviceSchedules(snapshot),
      faces: credentialRecords.filter((credential) => credential.type === "FACE"),
      vehicleTags: controlIdVehicleTagRecords(snapshot, device),
      users: controlIdDeviceUsers(snapshot, device),
      events: controlIdDeviceEvents(snapshot, device, limit)
    };
  }

  if (adapter === "HIKVISION_ISAPI") {
    const snapshot = await readDeviceCredentialsFromDevice(device);
    directAttempts = snapshot.attempts;
    const credentialRecords = hikvisionDeviceCredentials(snapshot.records || [], device);
    directPayload = {
      source: "HIKVISION_ISAPI",
      credentials: credentialRecords,
      schedules: integrationScheduleRecords(device),
      faces: credentialRecords.filter((credential) => credential.type === "FACE"),
      users: hikvisionDeviceUsers(snapshot.records || [], device),
      events: (snapshot.events || []).slice(0, limit)
    };
  }

  if (adapter === INTELBRAS_SS_3532_MF_W_ADAPTER) {
    const snapshot = await readDeviceCredentialsFromDevice(device);
    directAttempts = snapshot.attempts;
    const credentialRecords = hikvisionDeviceCredentials(snapshot.records || [], device)
      .map((record) => ({ ...record, source: INTELBRAS_SS_3532_MF_W_ADAPTER }));
    directPayload = {
      source: INTELBRAS_SS_3532_MF_W_ADAPTER,
      credentials: credentialRecords,
      schedules: integrationScheduleRecords(device),
      faces: credentialRecords.filter((credential) => credential.type === "FACE"),
      users: hikvisionDeviceUsers(snapshot.records || [], device)
        .map((record) => ({ ...record, source: INTELBRAS_SS_3532_MF_W_ADAPTER })),
      events: (snapshot.events || []).slice(0, limit)
    };
  }

  const credentialRecords = directPayload?.credentials || tenantCredentialsForDevice(device).map(integrationCredentialRecord);
  const faceRecords = credentialRecords.filter((credential) => credential.type === "FACE");
  const userRecords = directPayload?.users || residents
    .filter((person) => person.tenantId === device.tenantId)
    .map(integrationUserRecord);
  const scheduleRecords = directPayload?.schedules || integrationScheduleRecords(device);
  const eventRecords = directPayload?.events || integrationEventRecords(device, limit);
  const resourcesPayload = {
    events: eventRecords,
    credentials: credentialRecords,
    schedules: scheduleRecords,
    faces: faceRecords,
    vehicleTags: directPayload?.vehicleTags || [],
    users: userRecords
  };
  const summary = Object.fromEntries(Object.entries(resourcesPayload).map(([key, records]) => [key, records.length]));
  const hasDeviceApi = [
    "HIKVISION_ISAPI",
    INTELBRAS_SS_3532_MF_W_ADAPTER,
    CONTROL_ID_ACCESS_ADAPTER,
    AXIS_VAPIX_PACS_ADAPTER,
    DAHUA_ACCESS_CGI_ADAPTER,
    SUPREMA_BIOSTAR_REST_ADAPTER
  ].includes(adapter);

  return {
    ok: true,
    generatedAt: now(),
    source: directPayload?.source || "LOCAL_STATE",
    message: hasDeviceApi
      ? directPayload
        ? "Dados lidos diretamente do equipamento para homologacao."
        : "Dados consolidados do banco local; leitura direta do fabricante disponivel pela importacao."
      : "Dados consolidados do banco local; equipamento usa adapter generico.",
    resource,
    summary,
    attempts: directAttempts,
    capabilities: {
      adapter,
      directDeviceRead: Boolean(directPayload),
      webhookEvents: adapter === INTELBRAS_SS_3532_MF_W_ADAPTER,
      localCredentials: true,
      localSchedules: true,
      localFaces: true,
      vehicleTags: adapter === CONTROL_ID_ACCESS_ADAPTER,
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

async function directHikvisionIntegrationPayload(device, resource = "summary", { limit = 50 } = {}) {
  const snapshot = await readDeviceCredentialsFromDevice(device, { resource });
  const credentialRecords = hikvisionDeviceCredentials(snapshot.records || [], device);
  const eventRecords = (snapshot.events || []).slice(0, limit);
  const resourcesPayload = {
    events: eventRecords,
    credentials: credentialRecords,
    schedules: integrationScheduleRecords(device),
    faces: credentialRecords.filter((credential) => credential.type === "FACE"),
    users: hikvisionDeviceUsers(snapshot.records || [], device)
  };
  const summary = Object.fromEntries(Object.entries(resourcesPayload).map(([key, records]) => [key, records.length]));
  return {
    ok: true,
    generatedAt: now(),
    source: "HIKVISION_ISAPI",
    message: snapshot.message || "Dados lidos diretamente do equipamento Hikvision.",
    resource,
    summary,
    attempts: snapshot.attempts,
    capabilities: {
      adapter: "HIKVISION_ISAPI",
      directDeviceRead: true,
      webhookEvents: false,
      localCredentials: true,
      localSchedules: true,
      localFaces: true,
      localUsers: true
    },
    device: publicDevice(device),
    records: resource === "summary" ? [] : (resourcesPayload[resource] || [])
  };
}

function nextAvailableUnitExtension(targetTenant = tenant) {
  const start = Number(targetTenant.sipExtensionStart || 9100);
  const end = Number(targetTenant.sipExtensionEnd || start + 99);
  const used = new Set(
    unitList()
      .filter((unit) => unit.tenantId === targetTenant.id)
      .flatMap((unit) => [unit.extension, unit.telephony?.extension])
      .filter(Boolean)
      .map(String)
  );
  if (targetTenant.sipPorterExtension) used.add(String(targetTenant.sipPorterExtension));
  for (let extension = start; extension <= end; extension += 1) {
    const value = String(extension);
    if (!used.has(value)) return value;
  }
  return "";
}

function parsePositiveInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function generatedUnitNumber(structureType, groupIndex, itemIndex) {
  if (structureType === "HORIZONTAL") return `${groupIndex}-${String(itemIndex).padStart(2, "0")}`;
  return `${groupIndex}${String(itemIndex).padStart(2, "0")}`;
}

function ensureTenantUnitsFromStructure(targetTenant, body = {}) {
  const shouldGenerate = Boolean(body.generateUnits || body.autoGenerateUnits);
  if (!shouldGenerate) return [];

  const structureType = String(body.structureType || targetTenant.structureType || "VERTICAL").toUpperCase();
  const groupCount = parsePositiveInteger(
    body.structureGroupCount ?? body.floorCount ?? body.blockCount,
    targetTenant.structureGroupCount || 0
  );
  const unitsPerGroup = parsePositiveInteger(
    body.unitsPerGroup ?? body.unitsPerFloor ?? body.unitsPerBlock,
    targetTenant.unitsPerGroup || 0
  );
  if (!groupCount || !unitsPerGroup) return [];

  const created = [];
  for (let groupIndex = 1; groupIndex <= groupCount; groupIndex += 1) {
    for (let itemIndex = 1; itemIndex <= unitsPerGroup; itemIndex += 1) {
      const unitNumber = generatedUnitNumber(structureType, groupIndex, itemIndex);
      const blockName = structureType === "HORIZONTAL" ? `Quadra ${groupIndex}` : `Andar ${groupIndex}`;
      const existing = findUnitByNumber(targetTenant.id, unitNumber, blockName);
      if (existing) continue;

      const extension = nextAvailableUnitExtension(targetTenant);
      const unitId = makeId("unit");
      const unit = {
        tenantId: targetTenant.id,
        unitId,
        unitNumber,
        blockName,
        residentName: "",
        responsibleName: "",
        ownerName: "",
        ownerDocument: "",
        documents: "",
        extension,
        telephony: {
          enabled: true,
          provider: targetTenant.telephonyProvider,
          sipDomain: targetTenant.sipDomain,
          sipWebSocketUrl: targetTenant.sipWebSocketUrl,
          sipTransport: "UDP",
          extension,
          extensionPassword: standardSipPassword,
          porterExtension: targetTenant.sipPorterExtension
        }
      };
      units.set(unitId, unit);
      created.push(unit);
    }
  }
  return created;
}

function upsertImportUnit(payload, dryRun) {
  const existing = findUnitByNumber(payload.tenantId, payload.unitNumber, payload.blockName);
  const targetTenant = findTenant(payload.tenantId);
  const nextExtension = existing?.telephony?.extension || existing?.extension || nextAvailableUnitExtension(targetTenant);
  if (dryRun) return existing || { unitId: "", unitNumber: payload.unitNumber, blockName: payload.blockName, extension: nextExtension, telephony: { extension: nextExtension } };
  const unitId = existing?.unitId || makeId("unit");
  const unit = {
    tenantId: targetTenant.id,
    unitId,
    unitNumber: payload.unitNumber,
    blockName: payload.blockName || existing?.blockName || "Bloco unico",
    residentName: payload.name || existing?.residentName || "",
    responsibleName: payload.name || existing?.responsibleName || "",
    extension: nextExtension,
    telephony: {
      ...(existing?.telephony || {}),
      enabled: true,
      provider: targetTenant.telephonyProvider,
      sipDomain: targetTenant.sipDomain,
      sipWebSocketUrl: targetTenant.sipWebSocketUrl,
      sipTransport: "UDP",
      extension: nextExtension,
      extensionPassword: existing?.telephony?.extensionPassword || standardSipPassword,
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

function findPersonForDeviceCredential(record = {}, device = {}) {
  const externalId = normalizeLookup(record.personExternalId || "");
  const name = normalizeLookup(record.personName || "");
  return residents.find((person) =>
    person.tenantId === device.tenantId &&
    (
      (externalId && normalizeLookup(person.controlIdUserId || person.externalId || "") === externalId) ||
      (externalId && [person.id, person.cpf, person.rg, person.phone, person.email].some((value) => normalizeLookup(value) === externalId)) ||
      (name && normalizeLookup(person.name) === name)
    )
  ) || null;
}

function upsertDeviceImportPerson(record = {}, device = {}, dryRun = true, unitId = "") {
  const existing = findPersonForDeviceCredential(record, device);
  const targetUnitId = unitId || existing?.unitId || "";
  if (dryRun) {
    return existing || {
      id: "",
      tenantId: device.tenantId,
      unitId: targetUnitId,
      name: record.personName || `Usuario ${record.personExternalId || ""}`.trim()
    };
  }

  const person = {
    id: existing?.id || makeId("person"),
    tenantId: device.tenantId,
    unitId: targetUnitId,
    name: record.personName || existing?.name || `Usuario ${record.personExternalId || ""}`.trim(),
    email: existing?.email || "",
    cpf: existing?.cpf || "",
    rg: existing?.rg || "",
    phone: existing?.phone || "",
    role: existing?.role || "RESIDENT",
    relation: existing?.relation || "Morador",
    kind: existing?.kind || "RESIDENT",
    isSyndic: Boolean(existing?.isSyndic),
    authorizedBy: existing?.authorizedBy || "",
    company: existing?.company || "",
    cnpj: existing?.cnpj || "",
    serviceType: existing?.serviceType || "",
    vehiclePlate: existing?.vehiclePlate || "",
    accessReason: existing?.accessReason || "",
    credentialType: existing?.credentialType || record.type || "FACE",
    photoUrl: record.photoUrl || existing?.photoUrl || "",
    allowedDays: existing?.allowedDays || "",
    allowedHours: existing?.allowedHours || "",
    source: existing?.source || "DEVICE_IMPORT",
    externalId: existing?.externalId || record.personExternalId || "",
    controlIdUserId: existing?.controlIdUserId || record.personExternalId || "",
    createdAt: existing?.createdAt || now(),
    updatedAt: now()
  };
  const updated = updateById(residents, person.id, person);
  if (!updated) residents.unshift(person);
  return updated || person;
}

function personForStoredCredential(credential = {}) {
  if (credential.personId) {
    const person = residents.find((item) => item.id === credential.personId);
    if (person) return person;
  }
  return residents.find((person) =>
    person.tenantId === credential.tenantId &&
    (
      (credential.unitId && person.unitId === credential.unitId && credential.personName && normalizeLookup(person.name) === normalizeLookup(credential.personName)) ||
      (credential.personName && normalizeLookup(person.name) === normalizeLookup(credential.personName))
    )
  ) || null;
}

function hikvisionEmployeeNoForCredential(credential = {}, person = null) {
  const explicit = String(
    credential.personExternalId ||
    credential.externalId ||
    person?.externalId ||
    person?.hikvisionEmployeeNo ||
    ""
  ).trim();
  if (explicit) return explicit.slice(0, 32);
  if (credential.type === "APP" && credential.value) return String(credential.value).trim().slice(0, 32);
  const fallback = normalizeLookup(person?.cpf || person?.rg || person?.id || credential.personId || credential.personName || credential.id || credential.value);
  return (fallback || normalizeLookup(credential.id || randomBytes(4).toString("hex"))).slice(0, 32);
}

function hikvisionUserNameForCredential(credential = {}, person = null) {
  return String(person?.name || credential.personName || credential.valueLabel || credential.value || "Usuario").trim().slice(0, 96);
}

function hikvisionUserPayload(credential = {}, person = null, employeeNo = "") {
  const payload = {
    employeeNo,
    employeeNoString: employeeNo,
    name: hikvisionUserNameForCredential(credential, person),
    userType: "normal",
    Valid: {
      enable: true,
      beginTime: credential.validFrom || "2020-01-01T00:00:00",
      endTime: credential.validUntil || "2037-12-31T23:59:59",
      timeType: "local"
    },
    doorRight: "1",
    RightPlan: [{ doorNo: 1, planTemplateNo: "1" }]
  };
  if (credential.type === "PIN" && credential.value) payload.password = String(credential.value);
  return payload;
}

async function hikvisionTryJsonWrites(device, attempts = []) {
  const errors = [];
  for (const attempt of attempts) {
    try {
      const result = await authenticatedDeviceRequest(device, attempt.path, {
        method: attempt.method || "POST",
        body: JSON.stringify(attempt.body),
        contentType: "application/json",
        timeoutMs: attempt.timeoutMs || 12000
      });
      return {
        ok: true,
        status: result.status,
        path: attempt.path,
        label: attempt.label,
        message: `${attempt.label} respondeu ${result.status}`,
        attempts: [{ label: attempt.label, path: attempt.path, ok: true, status: result.status }]
      };
    } catch (error) {
      errors.push({
        label: attempt.label,
        path: attempt.path,
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao enviar para Hikvision"
      });
    }
  }
  return {
    ok: false,
    message: errors.at(-1)?.error || "Nenhum endpoint Hikvision aceitou a credencial",
    attempts: errors
  };
}

async function ensureHikvisionCredentialUser(device, credential = {}, person = null, employeeNo = "") {
  const userInfo = hikvisionUserPayload(credential, person, employeeNo);
  return hikvisionTryJsonWrites(device, [
    {
      label: "Hikvision usuario Record",
      path: "/ISAPI/AccessControl/UserInfo/Record?format=json",
      method: "POST",
      body: { UserInfo: userInfo }
    },
    {
      label: "Hikvision usuario SetUp",
      path: "/ISAPI/AccessControl/UserInfo/SetUp?format=json",
      method: "PUT",
      body: { UserInfo: userInfo }
    }
  ]);
}

function dataUrlImageBuffer(dataUrl = "") {
  const match = String(dataUrl).match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1] || "image/jpeg",
    buffer: Buffer.from(match[2], "base64")
  };
}

function storedFacePhotoId(photoUrl = "") {
  const match = String(photoUrl || "").trim().match(/^credential-photo:(.+)$/);
  return match?.[1] || "";
}

async function storeCredentialFacePhoto(credentialId, dataUrl = "") {
  const photo = dataUrlImageBuffer(dataUrl);
  if (!credentialId || !photo?.buffer?.length) return "";
  if (postgresPool) {
    await ensurePostgresStateTable();
    await postgresPool.query(
      `insert into condo_access_face_photos (credential_id, mime_type, image_data, updated_at)
       values ($1, $2, $3, now())
       on conflict (credential_id) do update set mime_type = excluded.mime_type, image_data = excluded.image_data, updated_at = now()`,
      [credentialId, photo.mimeType, photo.buffer]
    );
  } else {
    fs.mkdirSync(facePhotoRoot, { recursive: true });
    fs.writeFileSync(path.join(facePhotoRoot, `${credentialId}.bin`), photo.buffer);
    fs.writeFileSync(path.join(facePhotoRoot, `${credentialId}.json`), JSON.stringify({ mimeType: photo.mimeType }), "utf8");
  }
  return `credential-photo:${credentialId}`;
}

async function loadCredentialFacePhoto(credentialId) {
  if (!credentialId) throw new Error("Foto facial armazenada sem identificador");
  if (postgresPool) {
    await ensurePostgresStateTable();
    const result = await postgresPool.query(
      "select mime_type, image_data from condo_access_face_photos where credential_id = $1",
      [credentialId]
    );
    const row = result.rows[0];
    if (!row?.image_data) throw new Error("Foto facial armazenada nao encontrada");
    return { mimeType: row.mime_type || "image/jpeg", buffer: Buffer.from(row.image_data) };
  }
  const imagePath = path.join(facePhotoRoot, `${credentialId}.bin`);
  const metadataPath = path.join(facePhotoRoot, `${credentialId}.json`);
  if (!fs.existsSync(imagePath)) throw new Error("Foto facial armazenada nao encontrada");
  const metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, "utf8")) : {};
  return { mimeType: metadata.mimeType || "image/jpeg", buffer: fs.readFileSync(imagePath) };
}

async function deleteCredentialFacePhoto(credentialId) {
  if (!credentialId) return;
  if (postgresPool) {
    await ensurePostgresStateTable();
    await postgresPool.query("delete from condo_access_face_photos where credential_id = $1", [credentialId]);
    return;
  }
  for (const suffix of [".bin", ".json"]) {
    const target = path.join(facePhotoRoot, `${credentialId}${suffix}`);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}

function validateManualFacePhoto(body = {}, person = null) {
  if (normalizeCredentialType(body.type || body.credentialType) !== "FACE") return "";
  const photoUrl = String(body.photoUrl || person?.photoUrl || "").trim();
  if (!photoUrl) return "Selecione uma foto para criar a credencial facial";
  if (!photoUrl.startsWith("data:")) return "";
  const photo = dataUrlImageBuffer(photoUrl);
  if (!photo?.buffer?.length || !["image/jpeg", "image/png"].includes(photo.mimeType)) {
    return "Foto facial invalida. Envie uma imagem JPG ou PNG";
  }
  const maxBytes = Number(process.env.FACE_UPLOAD_MAX_BYTES || 750000);
  if (photo.buffer.length > maxBytes) return `Foto facial maior que ${maxBytes} bytes`;
  return "";
}

async function fetchCredentialPhotoBytes(device, photoUrl = "") {
  const clean = String(photoUrl || "").trim();
  const storedId = storedFacePhotoId(clean);
  if (storedId) return loadCredentialFacePhoto(storedId);
  const dataImage = dataUrlImageBuffer(clean);
  if (dataImage?.buffer?.length) return dataImage;
  const targetUrl = absoluteDeviceImageUrl(device, clean);
  const sameDeviceOrigin = new URL(targetUrl).origin === new URL(deviceBaseUrl(device)).origin;
  let requestUrl = targetUrl;
  let headers = {};
  if (deviceAdapter(device) === CONTROL_ID_ACCESS_ADAPTER && sameDeviceOrigin) {
    const session = await controlIdLogin(device);
    const parsed = new URL(targetUrl);
    parsed.searchParams.set("session", session);
    requestUrl = parsed.toString();
  } else if (sameDeviceOrigin && !/[\?&]token=/i.test(clean)) {
    headers = await hikvisionAuthHeaders(device, targetUrl, "GET");
  }
  const request = withTimeout(12000);
  try {
    const response = await fetch(requestUrl, { method: "GET", headers, signal: request.signal });
    if (!response.ok) throw new Error(`Foto respondeu ${response.status}`);
    const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("Foto vazia");
    return { mimeType, buffer };
  } finally {
    request.done();
  }
}

function devicePhotoReferenceAllowed(device, photoUrl = "") {
  const clean = String(photoUrl || "").trim();
  if (!clean || clean.startsWith("data:")) return Boolean(clean);
  try {
    return new URL(absoluteDeviceImageUrl(device, clean)).origin === new URL(deviceBaseUrl(device)).origin;
  } catch {
    return false;
  }
}

async function hikvisionMultipartFaceWrite(device, faceInfo = {}, photo = {}, imageField = "FaceImage") {
  const pathName = "/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json";
  const targetUrl = `${deviceBaseUrl(device)}${pathName}`;
  const label = `Hikvision FDLib multipart (${imageField})`;
  const headers = await hikvisionAuthHeaders(device, targetUrl, "POST");
  const form = new FormData();
  form.append("FaceDataRecord", new Blob([JSON.stringify({
    faceLibType: faceInfo.faceLibType || "blackFD",
    FDID: faceInfo.FDID || "1",
    FPID: faceInfo.FPID,
    name: faceInfo.name
  })], { type: "application/json" }), "FaceDataRecord.json");
  form.append(imageField, new Blob([photo.buffer], { type: photo.mimeType || "image/jpeg" }), "face.jpg");
  const request = withTimeout(15000);
  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: form,
      signal: request.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Equipamento respondeu ${response.status}: ${text.slice(0, 240)}`);
    const responseError = hikvisionResponseError(text);
    if (responseError) throw new Error(responseError);
    return {
      ok: true,
      status: response.status,
      message: `Upload facial multipart respondeu ${response.status}`,
      attempts: [{ label, path: pathName, ok: true, status: response.status }]
    };
  } finally {
    request.done();
  }
}

async function hikvisionTryMultipartFaceWrite(device, faceInfo = {}, photoUrl = "") {
  const pathName = "/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json";
  const attempts = [];
  try {
    const photo = await fetchCredentialPhotoBytes(device, photoUrl);
    const maxBytes = Number(process.env.HIKVISION_FACE_UPLOAD_MAX_BYTES || 900000);
    if (photo.buffer.length > maxBytes) throw new Error(`Foto facial maior que ${maxBytes} bytes`);
    for (const imageField of ["FaceImage", "img"]) {
      try {
        const result = await hikvisionMultipartFaceWrite(device, faceInfo, photo, imageField);
        return { ...result, attempts: [...attempts, ...(result.attempts || [])] };
      } catch (error) {
        attempts.push({
          label: `Hikvision FDLib multipart (${imageField})`,
          path: pathName,
          ok: false,
          error: error instanceof Error ? error.message : "Falha no upload facial multipart"
        });
      }
    }
  } catch (error) {
    attempts.push({
      label: "Hikvision carregar foto para multipart",
      path: pathName,
      ok: false,
      error: error instanceof Error ? error.message : "Falha no upload facial multipart"
    });
  }
  return {
    ok: false,
    message: attempts.at(-1)?.error || "Falha no upload facial multipart",
    attempts
  };
}

async function sendHikvisionStoredCredential(device, credential = {}) {
  const person = personForStoredCredential(credential);
  const employeeNo = hikvisionEmployeeNoForCredential(credential, person);
  const userResult = await ensureHikvisionCredentialUser(device, credential, person, employeeNo);
  if (!userResult.ok) {
    return {
      ok: false,
      deviceId: device.id,
      adapter: "HIKVISION_ISAPI",
      message: `Usuario Hikvision ${employeeNo}: ${userResult.message}`,
      attempts: userResult.attempts || []
    };
  }

  const type = normalizeCredentialType(credential.type);
  if (["APP", "QR_CODE"].includes(type)) {
    return {
      ok: true,
      deviceId: device.id,
      adapter: "HIKVISION_ISAPI",
      message: `Usuario Hikvision ${employeeNo} enviado`,
      attempts: userResult.attempts || []
    };
  }

  if (type === "PIN") {
    return {
      ok: true,
      deviceId: device.id,
      adapter: "HIKVISION_ISAPI",
      message: `PIN do usuario Hikvision ${employeeNo} enviado`,
      attempts: userResult.attempts || []
    };
  }

  if (type === "RFID") {
    const cardInfo = {
      employeeNo,
      employeeNoString: employeeNo,
      cardNo: String(credential.value || "").trim(),
      cardType: "normalCard"
    };
    const cardResult = await hikvisionTryJsonWrites(device, [
      {
        label: "Hikvision cartao Record",
        path: "/ISAPI/AccessControl/CardInfo/Record?format=json",
        method: "POST",
        body: { CardInfo: cardInfo }
      },
      {
        label: "Hikvision cartao SetUp",
        path: "/ISAPI/AccessControl/CardInfo/SetUp?format=json",
        method: "PUT",
        body: { CardInfo: cardInfo }
      },
      {
        label: "Hikvision cartao SetUp lista",
        path: "/ISAPI/AccessControl/CardInfo/SetUp?format=json",
        method: "PUT",
        body: { CardInfo: [cardInfo] }
      }
    ]);
    return {
      ...cardResult,
      deviceId: device.id,
      adapter: "HIKVISION_ISAPI",
      message: cardResult.ok ? `Cartao ${cardInfo.cardNo} enviado para ${employeeNo}` : cardResult.message,
      attempts: [...(userResult.attempts || []), ...(cardResult.attempts || [])]
    };
  }

  if (type === "FACE") {
    const photoUrl = String(credential.photoUrl || person?.photoUrl || "").trim();
    if (!photoUrl) {
      return {
        ok: false,
        deviceId: device.id,
        adapter: "HIKVISION_ISAPI",
        message: "Facial sem foto vinculada para enviar ao Hikvision",
        attempts: userResult.attempts || []
      };
    }
    const faceInfo = {
      employeeNo,
      employeeNoString: employeeNo,
      FPID: employeeNo,
      name: hikvisionUserNameForCredential(credential, person),
      faceLibType: "blackFD",
      faceURL: photoUrl,
      URL: photoUrl
    };
    const multipartResult = await hikvisionTryMultipartFaceWrite(device, faceInfo, photoUrl);
    if (multipartResult.ok) {
      return {
        ...multipartResult,
        deviceId: device.id,
        adapter: "HIKVISION_ISAPI",
        message: `Face de ${employeeNo} enviada`,
        attempts: [...(userResult.attempts || []), ...(multipartResult.attempts || [])]
      };
    }
    const requiresBinaryUpload = Boolean(storedFacePhotoId(photoUrl) || dataUrlImageBuffer(photoUrl));
    if (requiresBinaryUpload) {
      return {
        ...multipartResult,
        deviceId: device.id,
        adapter: "HIKVISION_ISAPI",
        message: `Usuario ${employeeNo} cadastrado, mas a foto nao foi aceita pela Hikvision: ${multipartResult.message}`,
        attempts: [...(userResult.attempts || []), ...(multipartResult.attempts || [])]
      };
    }
    const faceResult = await hikvisionTryJsonWrites(device, [
      {
        label: "Hikvision face Record",
        path: "/ISAPI/AccessControl/FaceInfo/Record?format=json",
        method: "POST",
        body: { FaceInfo: faceInfo }
      },
      {
        label: "Hikvision FDLib FaceDataRecord",
        path: "/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json",
        method: "POST",
        body: { FaceDataRecord: faceInfo }
      }
    ]);
    return {
      ...faceResult,
      deviceId: device.id,
      adapter: "HIKVISION_ISAPI",
      message: faceResult.ok ? `Face de ${employeeNo} enviada` : faceResult.message,
      attempts: [...(userResult.attempts || []), ...(multipartResult.attempts || []), ...(faceResult.attempts || [])]
    };
  }

  return {
    ok: false,
    deviceId: device.id,
    adapter: "HIKVISION_ISAPI",
    message: `Tipo ${type} ainda nao possui envio Hikvision homologado`,
    attempts: userResult.attempts || []
  };
}

function controlIdUnixTimestamp(value = "") {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

function controlIdUserRegistration(credential = {}, person = null) {
  return String(
    credential.personExternalId ||
    credential.externalId ||
    person?.controlIdUserId ||
    person?.externalId ||
    person?.cpf ||
    person?.rg ||
    person?.id ||
    credential.personId ||
    credential.id ||
    credential.value
  ).trim().slice(0, 64);
}

function controlIdCardValue(value = "") {
  const clean = String(value || "").trim();
  const parts = clean.match(/^(\d+)[.,](\d+)$/);
  let parsed;
  if (parts) {
    parsed = (BigInt(parts[1]) * 4294967296n) + BigInt(parts[2]);
  } else if (/^\d+$/.test(clean)) {
    parsed = BigInt(clean);
  } else {
    throw new Error("Cartao Control iD deve conter apenas numeros ou usar formato facility.cartao");
  }
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Cartao Control iD excede o limite numerico seguro desta integracao");
  }
  return Number(parsed);
}

async function ensureControlIdCredentialUser(device, session, credential = {}, person = null) {
  const registration = controlIdUserRegistration(credential, person);
  const name = String(person?.name || credential.personName || credential.valueLabel || "Usuario").trim().slice(0, 100);
  const users = await controlIdLoadObjects(device, session, "users", { limit: 1000 });
  const existing = users.find((user) =>
    String(user.registration || "").trim() === registration ||
    String(user.id) === String(person?.controlIdUserId || credential.personExternalId || "")
  );
  const value = {
    ...(existing?.id ? { id: existing.id } : {}),
    registration,
    name,
    begin_time: controlIdUnixTimestamp(credential.validFrom),
    end_time: controlIdUnixTimestamp(credential.validUntil)
  };
  if (existing?.id) {
    await controlIdPost(device, session, "/create_or_modify_objects.fcgi", {
      object: "users",
      values: [value]
    });
    return { ...existing, ...value };
  }

  const created = await controlIdPost(device, session, "/create_objects.fcgi", {
    object: "users",
    values: [value]
  });
  const id = created.payload?.ids?.[0];
  if (!id) throw new Error(`Control iD nao retornou o ID do usuario criado para a matricula ${registration}`);
  return { ...value, id };
}

function controlIdCredentialObject(type = "") {
  if (type === "RFID") return "cards";
  if (type === "PIN") return "pins";
  if (type === "QR_CODE") return "qrcodes";
  return "";
}

function controlIdObjectValue(type = "", value = "") {
  return type === "RFID" ? controlIdCardValue(value) : String(value || "").trim();
}

async function upsertControlIdCredentialObject(device, session, object, userId, value) {
  const records = await controlIdLoadObjects(device, session, object, { limit: 1000 });
  const existing = records.find((record) =>
    String(record.value) === String(value) || (object === "pins" && String(record.user_id) === String(userId))
  );
  const pathName = existing?.id ? "/create_or_modify_objects.fcgi" : "/create_objects.fcgi";
  await controlIdPost(device, session, pathName, {
    object,
    values: [{
      ...(existing?.id ? { id: existing.id } : {}),
      value,
      user_id: userId
    }]
  });
  return existing;
}

async function ensureControlIdUserGroup(device, session, userId) {
  const groupId = Number(device.controlIdGroupId || 0);
  if (!Number.isSafeInteger(groupId) || groupId <= 0) return null;
  const userGroups = await controlIdLoadObjects(device, session, "user_groups", { limit: 1000 });
  const existing = userGroups.find((item) =>
    String(item.user_id) === String(userId) && String(item.group_id) === String(groupId)
  );
  if (!existing) {
    await controlIdPost(device, session, "/create_objects.fcgi", {
      object: "user_groups",
      values: [{ user_id: userId, group_id: groupId }]
    });
  }
  return groupId;
}

async function sendControlIdStoredCredential(device, credential = {}) {
  const session = await controlIdLogin(device);
  const person = personForStoredCredential(credential);
  const user = await ensureControlIdCredentialUser(device, session, credential, person);
  const groupId = await ensureControlIdUserGroup(device, session, user.id);
  const type = normalizeCredentialType(credential.type);
  const attempts = [{
    label: "Control iD usuario",
    path: "/create_or_modify_objects.fcgi:users",
    ok: true
  }];
  if (groupId) {
    attempts.push({
      label: `Control iD grupo ${groupId}`,
      path: "/create_objects.fcgi:user_groups",
      ok: true
    });
  }

  if (type === "APP") {
    return {
      ok: true,
      deviceId: device.id,
      adapter: CONTROL_ID_ACCESS_ADAPTER,
      message: `Usuario Control iD ${user.registration || user.id} enviado${groupId ? ` no grupo ${groupId}` : ""}`,
      attempts
    };
  }

  if (type === "FACE") {
    const photoUrl = String(credential.photoUrl || person?.photoUrl || "").trim();
    if (!photoUrl) {
      return {
        ok: false,
        deviceId: device.id,
        adapter: CONTROL_ID_ACCESS_ADAPTER,
        message: "Facial sem foto vinculada para enviar ao Control iD",
        attempts
      };
    }
    const photo = await fetchCredentialPhotoBytes(device, photoUrl);
    const maxBytes = Number(process.env.CONTROL_ID_FACE_UPLOAD_MAX_BYTES || 999000);
    if (photo.buffer.length > maxBytes) {
      throw new Error(`Foto facial maior que ${maxBytes} bytes para o Control iD`);
    }
    const timestamp = Math.floor(Date.now() / 1000);
    await controlIdBinaryRequest(
      device,
      session,
      `/user_set_image.fcgi?user_id=${encodeURIComponent(user.id)}&timestamp=${timestamp}&match=0`,
      { body: photo.buffer }
    );
    attempts.push({
      label: "Control iD foto facial",
      path: "/user_set_image.fcgi",
      ok: true
    });
    return {
      ok: true,
      deviceId: device.id,
      adapter: CONTROL_ID_ACCESS_ADAPTER,
      message: `Face de ${user.name || user.registration || user.id} enviada ao Control iD${groupId ? ` no grupo ${groupId}` : ""}`,
      attempts
    };
  }

  const object = controlIdCredentialObject(type);
  if (!object) {
    return {
      ok: false,
      deviceId: device.id,
      adapter: CONTROL_ID_ACCESS_ADAPTER,
      message: `Tipo ${type} ainda nao possui envio Control iD homologado`,
      attempts
    };
  }
  const value = controlIdObjectValue(type, credential.value);
  if (value === "") {
    return {
      ok: false,
      deviceId: device.id,
      adapter: CONTROL_ID_ACCESS_ADAPTER,
      message: `Credencial ${type} sem valor para enviar ao Control iD`,
      attempts
    };
  }
  await upsertControlIdCredentialObject(device, session, object, user.id, value);
  attempts.push({
    label: `Control iD ${object}`,
    path: `/create_or_modify_objects.fcgi:${object}`,
    ok: true
  });
  return {
    ok: true,
    deviceId: device.id,
    adapter: CONTROL_ID_ACCESS_ADAPTER,
    message: `${type} enviado ao Control iD para ${user.name || user.registration || user.id}${groupId ? ` no grupo ${groupId}` : ""}`,
    attempts
  };
}

async function deleteControlIdStoredCredential(device, credential = {}) {
  const session = await controlIdLogin(device);
  const person = personForStoredCredential(credential);
  const type = normalizeCredentialType(credential.type);
  const registration = controlIdUserRegistration(credential, person);
  const users = await controlIdLoadObjects(device, session, "users", { limit: 1000 });
  const user = users.find((item) =>
    String(item.registration || "").trim() === registration ||
    String(item.id) === String(person?.controlIdUserId || credential.personExternalId || "")
  );

  if (type === "FACE") {
    if (!user?.id) throw new Error(`Usuario Control iD ${registration} nao encontrado para excluir a foto`);
    await controlIdPost(device, session, "/user_destroy_image.fcgi", { user_id: user.id });
    return {
      ok: true,
      deviceId: device.id,
      adapter: CONTROL_ID_ACCESS_ADAPTER,
      message: `Face de ${user.name || registration} excluida do Control iD`,
      attempts: [{ label: "Control iD excluir foto", path: "/user_destroy_image.fcgi", ok: true }]
    };
  }

  const object = controlIdCredentialObject(type);
  if (object) {
    const value = controlIdObjectValue(type, credential.value);
    await controlIdPost(device, session, "/destroy_objects.fcgi", {
      object,
      where: {
        [object]: object === "pins" && user?.id
          ? { user_id: user.id }
          : { value }
      }
    });
    return {
      ok: true,
      deviceId: device.id,
      adapter: CONTROL_ID_ACCESS_ADAPTER,
      message: `${type} excluido do Control iD`,
      attempts: [{ label: `Control iD excluir ${object}`, path: `/destroy_objects.fcgi:${object}`, ok: true }]
    };
  }

  if (type === "APP" && user?.id) {
    await controlIdPost(device, session, "/destroy_objects.fcgi", {
      object: "users",
      where: { users: { id: user.id } }
    });
    return {
      ok: true,
      deviceId: device.id,
      adapter: CONTROL_ID_ACCESS_ADAPTER,
      message: `Usuario ${user.name || registration} excluido do Control iD`,
      attempts: [{ label: "Control iD excluir usuario", path: "/destroy_objects.fcgi:users", ok: true }]
    };
  }

  return {
    ok: true,
    deviceId: device.id,
    adapter: CONTROL_ID_ACCESS_ADAPTER,
    message: `Nenhum registro ${type} encontrado para excluir do Control iD`,
    attempts: []
  };
}

async function sendStoredCredentialToDevice(device, credential = {}) {
  const adapter = deviceAdapter(device);
  if (adapter === "HIKVISION_ISAPI") return sendHikvisionStoredCredential(device, credential);
  if (adapter === CONTROL_ID_ACCESS_ADAPTER) return sendControlIdStoredCredential(device, credential);
  return {
    ok: true,
    deviceId: device.id,
    adapter,
    message: "Sincronismo local concluido; envio fisico depende do conector do fabricante",
    attempts: []
  };
}

async function deleteStoredCredentialFromDevice(device, credential = {}) {
  const adapter = deviceAdapter(device);
  if (adapter === CONTROL_ID_ACCESS_ADAPTER) {
    return deleteControlIdStoredCredential(device, credential);
  }
  if (adapter !== "HIKVISION_ISAPI") {
    return {
      ok: true,
      deviceId: device.id,
      adapter,
      message: "Evento de exclusao registrado; exclusao fisica depende do conector do fabricante",
      attempts: []
    };
  }

  const person = personForStoredCredential(credential);
  const employeeNo = hikvisionEmployeeNoForCredential(credential, person);
  const type = normalizeCredentialType(credential.type);
  const attempts = type === "FACE"
    ? [{
        label: "Hikvision excluir face",
        path: "/ISAPI/AccessControl/FaceInfo/Delete?format=json",
        method: "PUT",
        body: { FaceInfoDelCond: { employeeNoList: [{ employeeNo }] } }
      }]
    : type === "RFID"
      ? [{
          label: "Hikvision excluir cartao",
          path: "/ISAPI/AccessControl/CardInfo/Delete?format=json",
          method: "PUT",
          body: { CardInfoDelCond: { CardNoList: [{ cardNo: String(credential.value || "").trim() }] } }
        }]
      : [{
          label: "Hikvision excluir usuario",
          path: "/ISAPI/AccessControl/UserInfo/Delete?format=json",
          method: "PUT",
          body: { UserInfoDelCond: { EmployeeNoList: [{ employeeNo }] } }
        }];
  const result = await hikvisionTryJsonWrites(device, attempts);
  return {
    ...result,
    deviceId: device.id,
    adapter,
    message: result.ok ? `Credencial ${type} excluida do equipamento` : result.message
  };
}

function credentialTargetDevice(credential = {}) {
  const targetDevices = credential.deviceId
    ? devices.filter((device) => device.id === credential.deviceId)
    : devices.filter((device) => device.tenantId === credential.tenantId);
  return targetDevices.find((device) => {
    const adapter = deviceAdapter(device);
    if (credential.type === "FACE") {
      return [CONTROL_ID_ACCESS_ADAPTER, "HIKVISION_ISAPI"].includes(adapter);
    }
    return adapter !== "GENERIC_TCP" || device.category === "access-control";
  }) || null;
}

async function emitCredentialEvent(action, credential = {}) {
  const device = credentialTargetDevice(credential);
  if (!device) return { action, ok: false, message: "Nenhum equipamento compativel cadastrado" };
  const result = action === "DELETE"
    ? await deleteStoredCredentialFromDevice(device, credential)
    : await sendStoredCredentialToDevice(device, credential);
  return { action, ...result };
}

async function processCredentialSyncJob(job) {
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

  for (const credential of selectedCredentials) {
    if (!targetDevices.length) {
      credential.syncStatus = "PENDING";
      job.errors += 1;
      job.results.push({ credentialId: credential.id, ok: false, message: "Nenhum equipamento alvo cadastrado" });
      continue;
    }

    const compatible = targetDevices.find((device) => {
      const adapter = deviceAdapter(device);
      if (credential.type === "FACE") {
        return [CONTROL_ID_ACCESS_ADAPTER, "HIKVISION_ISAPI"].includes(adapter);
      }
      return adapter !== "GENERIC_TCP" || device.category === "access-control";
    });

    if (!compatible) {
      credential.syncStatus = "ERROR";
      job.errors += 1;
      job.results.push({ credentialId: credential.id, ok: false, message: "Nenhum equipamento compativel com o tipo da credencial" });
      continue;
    }

    const sendResult = await sendStoredCredentialToDevice(compatible, credential);
    if (sendResult.ok) {
      credential.syncStatus = "SYNCED";
      credential.deviceId = compatible.id;
      credential.lastSyncedAt = now();
      credential.syncMessage = sendResult.message || `${credential.type} enviada para ${compatible.manufacturer}`;
      job.synced += 1;
    } else {
      credential.syncStatus = "ERROR";
      credential.syncMessage = sendResult.message || "Falha ao enviar credencial";
      job.errors += 1;
    }
    job.results.push({
      credentialId: credential.id,
      ok: Boolean(sendResult.ok),
      deviceId: compatible.id,
      adapter: deviceAdapter(compatible),
      message: sendResult.message,
      attempts: sendResult.attempts || []
    });
  }

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

function syncUnitResidentSummary(unitId = "") {
  const unit = unitForId(unitId);
  if (!unit) return null;
  const linkedResidents = residents.filter((person) =>
    person.unitId === unit.unitId && (person.kind || "RESIDENT") === "RESIDENT"
  );
  const principal = linkedResidents.find((person) => person.id === unit.residentId) ||
    linkedResidents.find((person) => ["Responsavel", "Proprietario"].includes(person.relation)) ||
    linkedResidents[0];

  if (!principal) {
    Object.assign(unit, {
      residentId: "",
      residentName: "",
      responsibleName: ""
    });
    return unit;
  }

  Object.assign(unit, {
    residentId: principal.id,
    residentName: principal.name || "",
    responsibleName: principal.name || "",
    residentCpf: principal.cpf || "",
    residentRg: principal.rg || "",
    residentPhone: principal.phone || "",
    residentEmail: principal.email || ""
  });
  return unit;
}

function recordUnitLogin(person, sessionId) {
  if (!person?.unitId) return null;
  const login = {
    id: makeId("login"),
    sessionId,
    tenantId: person.tenantId || unitForId(person.unitId)?.tenantId || tenant.id,
    unitId: person.unitId,
    userId: person.id,
    guest: person.name || "Usuario",
    profile: person.role || "RESIDENT",
    sentTo: person.email || person.phone || person.cpf || "",
    loginAt: now(),
    logoutAt: "",
    status: "ONLINE"
  };
  unitLogins.unshift(login);
  return login;
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

function toMobileResident(person, origin = "") {
  const unit = units.get(person.unitId);
  return {
    id: person.id,
    userId: person.email || person.id,
    document: person.cpf || "",
    cpf: person.cpf || "",
    rg: person.rg || "",
    birthDate: person.birthDate || "",
    photoUrl: publicPersonPhotoUrl(person, origin),
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

function mobileResidentList({ tenantId = "", userId = "", email = "", origin = "" } = {}) {
  const normalizedUser = normalizeLookup(userId || email);
  const activeTenantIds = new Set(allTenants().map((item) => item.id));
  const candidates = residents
    .filter((person) => (person.kind || "RESIDENT") === "RESIDENT")
    .filter((person) => {
      const unit = units.get(person.unitId);
      if (!unit) return false;
      if (!activeTenantIds.has(unit.tenantId)) return false;
      if (tenantId && unit.tenantId !== tenantId) return false;
      if (normalizedUser) {
        return [person.id, person.email, person.cpf, person.phone].some((value) => normalizeLookup(value) === normalizedUser);
      }
      return tenantId ? true : isMobileTenantUnit(unit);
    });
  const scopedResidents = normalizedUser
    ? candidates
    : candidates.length
      ? candidates
      : residents.filter((person) => {
      const unit = units.get(person.unitId);
      return (person.kind || "RESIDENT") === "RESIDENT" &&
        Boolean(unit) &&
        activeTenantIds.has(unit.tenantId) &&
        (!tenantId || unit?.tenantId === tenantId);
      });
  const byUnit = new Map();

  scopedResidents.forEach((person) => {
    const current = byUnit.get(person.unitId);
    if (!current || compareMobileResident(person, current) > 0) {
      byUnit.set(person.unitId, person);
    }
  });

  return Array.from(byUnit.values()).map((person) => toMobileResident(person, origin));
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
  if (adapter === NICE_LINEAR_ADAPTER) {
    const result = await testNiceLinearIntegration(device, {
      checkTcpDevice,
      connectionStatus: niceLinearConnectionStatus
    });
    return {
      ...result,
      deviceId: device.id,
      adapter,
      manufacturer: device.manufacturer || "Nice/Linear",
      checkedAt: now()
    };
  }

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

  if (adapter === HIKVISION_ISAPI_ADAPTER) {
    const result = await testHikvisionDevice(device);
    return { ...base, ok: true, status: result.status, message: "Conexao Hikvision ISAPI OK" };
  }

  if (adapter === AXIS_VAPIX_PACS_ADAPTER) {
    const result = await testAxisVapix(device, { requestDevice: authenticatedDeviceRequest });
    return { ...base, ok: true, status: result.status, message: "Conexao Axis VAPIX PACS OK", matchedEndpoint: result.matchedEndpoint };
  }

  if (adapter === DAHUA_ACCESS_CGI_ADAPTER) {
    const result = await testDahuaAccess(device, { tryHttpCandidates: tryDeviceHttpCandidates, checkTcpDevice });
    return {
      ...base,
      ok: true,
      status: result.status,
      message: result.partial ? "Dahua respondeu TCP, mas CGI precisa ser habilitado ou autenticado" : "Conexao Dahua Access CGI OK",
      matchedEndpoint: result.matched?.path || "",
      attempts: result.attempts || [],
      bodyPreview: result.body.slice(0, 240)
    };
  }

  if (adapter === SUPREMA_BIOSTAR_REST_ADAPTER) {
    const result = await testSupremaBiostar(device, { baseUrl: deviceBaseUrl, timeout: withTimeout });
    return { ...base, ok: true, status: result.status, message: "Conexao Suprema BioStar REST OK", matchedEndpoint: result.matchedEndpoint };
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

  if (adapter === CONTROL_ID_ACCESS_ADAPTER) {
    const result = await testControlIdConnection(device);
    return {
      ...base,
      ok: true,
      status: result.status,
      message: "Conexao Control iD OK",
      matchedEndpoint: result.matchedEndpoint,
      usersSample: result.usersSample,
      systemInformation: result.system
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

function snapshotVideoFilter(settings = {}) {
  const scale = String(settings.snapshotScale || "640:-2").trim();
  if (!scale) return "scale=640:-2";
  return scale.includes("=") ? scale : `scale=${scale}`;
}

function snapshotTimeoutMs(settings = {}) {
  const configured = Number(settings.snapshotTimeoutMs || process.env.CAMERA_SNAPSHOT_TIMEOUT_MS || 20000);
  return Number.isFinite(configured) && configured >= 5000 ? configured : 20000;
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
      "-vf", snapshotVideoFilter(settings),
      "-y",
      filePath
    ];
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let errorText = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, snapshotTimeoutMs(settings));

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
    vehicles,
    devices,
    cameras,
    actions,
    credentials,
    credentialSyncJobs,
    unitLogins,
    unitInvites,
    accessRoutes,
    permissionProfiles,
    systemUsers,
    companies,
    licenses,
    billingInvoices,
    paymentEvents,
    resources,
    resourceConfigurations,
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
  replaceCollection(vehicles, state.vehicles);
  replaceCollection(devices, state.devices);
  replaceCollection(cameras, state.cameras);
  replaceCollection(actions, state.actions);
  replaceCollection(credentials, state.credentials);
  replaceCollection(credentialSyncJobs, state.credentialSyncJobs);
  replaceCollection(unitLogins, state.unitLogins);
  replaceCollection(unitInvites, state.unitInvites);
  replaceCollection(accessRoutes, state.accessRoutes);
  replaceCollection(permissionProfiles, state.permissionProfiles);
  replaceCollection(systemUsers, state.systemUsers);
  replaceCollection(companies, state.companies);
  replaceCollection(licenses, state.licenses);
  replaceCollection(billingInvoices, state.billingInvoices);
  replaceCollection(paymentEvents, state.paymentEvents);
  replaceCollection(resources, mergeResourceState(state.resources));
  replaceCollection(resourceConfigurations, state.resourceConfigurations);
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
  await postgresPool.query(`
    create table if not exists condo_access_face_photos (
      credential_id text primary key,
      mime_type text not null default 'image/jpeg',
      image_data bytea not null,
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

function queuePersistentStateToPostgres(state, reason) {
  const pendingSave = postgresSaveQueue.then(() => savePersistentStateToPostgres(state, reason));
  postgresSaveQueue = pendingSave
    .then(() => {
      lastPostgresSaveError = "";
    })
    .catch((error) => {
      lastPostgresSaveError = error instanceof Error ? error.message : "Falha ao salvar estado persistente";
      console.error(`[persistence] ${reason}: ${lastPostgresSaveError}`);
    });
  return pendingSave;
}

function savePersistentState(reason = "update") {
  const state = persistentState();
  if (postgresPool) {
    queuePersistentStateToPostgres(state, reason);
    return { ok: true, store: "postgres", queued: true };
  }

  try {
    fs.mkdirSync(path.dirname(dataFilePath), { recursive: true });
    fs.writeFileSync(dataFilePath, JSON.stringify({ ...state, reason }, null, 2), "utf8");
    return { ok: true, store: "file", path: dataFilePath };
  } catch (error) {
    return {
      ok: false,
      path: dataFilePath,
      message: error instanceof Error ? error.message : "Falha ao salvar estado persistente"
    };
  }
}

async function savePersistentStateAndWait(reason = "update") {
  const state = persistentState();
  if (postgresPool) {
    await queuePersistentStateToPostgres(state, reason);
    return { ok: true, store: "postgres", queued: false };
  }

  const result = savePersistentState(reason);
  if (!result.ok) throw new Error(result.message || "Falha ao salvar estado persistente");
  return result;
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
      displayName: `Unidade ${unitData?.unitNumber || "101"}`,
      defaultAudioRoute: "EARPIECE",
      speakerphoneEnabled: false
    },
    audioRouteUi: {
      enabled: true,
      defaultAudioRoute: "EARPIECE",
      speakerphoneEnabled: false,
      stateEventName: "audioRouteChanged",
      actions: [
        { id: "speaker_on", label: "Viva-voz", nativeMethod: "setSpeakerphoneEnabled", value: true },
        { id: "speaker_off", label: "Auricular", nativeMethod: "setSpeakerphoneEnabled", value: false },
        { id: "speaker_toggle", label: "Alternar viva-voz", nativeMethod: "toggleSpeakerphone" }
      ]
    },
    incomingCallUi: {
      enabled: true,
      eventName: "incomingCall",
      stateEventName: "callStateChanged",
      actions: [
        { id: "answer", label: "Atender", nativeMethod: "answerIncomingCall" },
        { id: "reject", label: "Recusar", nativeMethod: "rejectIncomingCall" },
        { id: "hangup", label: "Encerrar", nativeMethod: "hangup" }
      ]
    },
    callTargets: [
      { type: "PORTER", id: "porter", label: "Portaria", extension: tenantData.sipPorterExtension, available: true },
      ...unitList()
        .filter((targetUnit) =>
          targetUnit.tenantId === tenantData.id &&
          targetUnit.unitId !== unitData?.unitId &&
          unitExtension(targetUnit)
        )
        .map((targetUnit) => ({
          type: "UNIT",
          id: targetUnit.unitId,
          label: `${targetUnit.blockName ? `${targetUnit.blockName} - ` : ""}Unidade ${targetUnit.unitNumber || targetUnit.unitId}`,
          extension: unitExtension(targetUnit),
          available: true
        })),
      ...devices
        .filter((device) => device.tenantId === tenantData.id && device.intercomEnabled && device.intercomExtension)
        .map((device) => ({ type: "FACIAL", id: device.id, label: device.name, extension: device.intercomExtension, available: true, device: toMobileDevice(device) }))
    ]
  };
}

const persistentStateLoad = await loadPersistentState();
if (persistentStateLoad.ok && allTenants().length) {
  const inactiveTenantCleanup = removeInactiveTenantData();
  if (removedItemCount(inactiveTenantCleanup)) {
    try {
      await savePersistentStateAndWait("inactive-tenant-data-cleanup");
    } catch (error) {
      console.error(`[persistence] inactive-tenant-data-cleanup: ${error instanceof Error ? error.message : "Falha ao limpar dados orfaos"}`);
    }
  }
}
ensureConfiguredNiceLinearListeners();
const cameraPlaybackMigrated = normalizeCameraRecordsForPlayback();
if (cameraPlaybackMigrated) {
  savePersistentState("camera-playback-normalized");
}
normalizeTelephonyState();

setInterval(() => {
  const maxIdleMs = 5 * 60 * 1000;
  for (const [cameraId, session] of streamSessions.entries()) {
    if (Date.now() - session.lastAccessAt > maxIdleMs) stopStream(cameraId);
  }
}, 60 * 1000).unref();

function isRequestAbortError(error) {
  return error?.code === "ECONNRESET" || error?.code === "ECONNABORTED" || error?.message === "aborted";
}

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    if (isRequestAbortError(error)) return;

    if (!response.headersSent && !response.destroyed) {
      return json(response, 500, { message: "Falha interna da API" });
    }
    if (!response.destroyed) response.destroy();
  });
});

async function handleRequest(request, response) {
  if (request.method === "OPTIONS") return json(response, 204, {});

  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, {
      ok: true,
      service: "condo-access-clean-api",
      storage: postgresPool ? "postgres" : "file",
      persistenceHealthy: !lastPostgresSaveError,
      cameras: cameras.length,
      devices: devices.length
    });
  }

  if (request.method === "GET" && url.pathname === "/api/bootstrap") {
    return json(response, 200, bootstrap());
  }

  if (request.method === "POST" && url.pathname === "/api/webhooks/asaas") {
    if (!asaasWebhookTokenConfigured) return json(response, 503, { message: "Webhook Asaas nao configurado" });
    if (String(request.headers["asaas-access-token"] || "") !== asaasWebhookToken) {
      return json(response, 401, { message: "Token do webhook Asaas invalido" });
    }
    const body = await readBody(request);
    const eventId = String(body.id || "").trim();
    if (!eventId) return json(response, 400, { message: "Evento Asaas sem identificador" });
    if (paymentEvents.some((event) => event.id === eventId)) return json(response, 200, { received: true, duplicate: true });
    const payment = body.payment || {};
    const invoice = billingInvoices.find((item) =>
      item.asaasPaymentId === payment.id || item.id === payment.externalReference
    );
    if (invoice) {
      invoice.status = payment.status || String(body.event || "").replace(/^PAYMENT_/, "") || invoice.status;
      invoice.paymentDate = payment.paymentDate || payment.confirmedDate || invoice.paymentDate || "";
      invoice.updatedAt = now();
    }
    paymentEvents.unshift({
      id: eventId,
      event: body.event || "",
      paymentId: payment.id || "",
      invoiceId: invoice?.id || payment.externalReference || "",
      receivedAt: now()
    });
    await savePersistentStateAndWait("asaas-webhook");
    return json(response, 200, { received: true });
  }

  if (request.method === "GET" && url.pathname === "/api/billing/invoices") {
    return json(response, 200, billingInvoices);
  }

  if (request.method === "POST" && url.pathname === "/api/billing/charges") {
    const body = await readBody(request);
    const company = findCompany(body.companyId);
    if (!company) return json(response, 404, { message: "Empresa nao encontrada" });
    if (company.billingStatus === "BLOCKED") return json(response, 409, { message: "Cobranca bloqueada para esta empresa" });
    const billingType = ["PIX", "BOLETO", "CREDIT_CARD", "UNDEFINED"].includes(body.billingType)
      ? body.billingType
      : company.defaultPaymentMethod === "TRANSFER" ? "UNDEFINED" : company.defaultPaymentMethod || "PIX";
    try {
      const snapshot = companyBillingSnapshot(company);
      if (snapshot.total <= 0) return json(response, 409, { message: "A empresa nao possui valor faturavel no periodo" });
      const dueDate = billingDueDate(company);
      const existingInvoice = billingInvoices.find((item) =>
        item.companyId === company.id &&
        item.dueDate === dueDate &&
        !["RECEIVED", "CONFIRMED", "REFUNDED", "DELETED", "CANCELLED"].includes(item.status)
      );
      if (existingInvoice) {
        return json(response, 409, { message: "Ja existe uma cobranca aberta para esta empresa e vencimento", invoice: existingInvoice });
      }
      const customerId = await ensureAsaasCustomer(company);
      const invoice = {
        id: makeId("invoice"),
        companyId: company.id,
        customerId,
        billingType,
        dueDate,
        value: snapshot.total,
        snapshot,
        status: "PENDING",
        createdAt: now(),
        updatedAt: now()
      };
      const payment = await asaasRequest("/payments", {
        method: "POST",
        body: {
          customer: customerId,
          billingType,
          value: invoice.value,
          dueDate: invoice.dueDate,
          description: `Mensalidade Condo Access - ${company.name}`,
          externalReference: invoice.id
        }
      });
      Object.assign(invoice, {
        asaasPaymentId: payment.id,
        status: payment.status || invoice.status,
        invoiceUrl: payment.invoiceUrl || payment.bankSlipUrl || "",
        bankSlipUrl: payment.bankSlipUrl || "",
        transactionReceiptUrl: payment.transactionReceiptUrl || ""
      });
      billingInvoices.unshift(invoice);
      await savePersistentStateAndWait("asaas-charge-created");
      return json(response, 201, invoice);
    } catch (error) {
      return json(response, 502, { message: error instanceof Error ? error.message : "Falha ao gerar cobranca no Asaas" });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(request);
    const loginId = String(body.email || body.login || "").trim() || "agpsistemascorp@gmail.com";
    const loginKey = normalizeLookup(loginId);
    const password = String(body.password || "");
    if (normalizeLookup(masterAdminEmail) === loginKey) {
      const master = ensureMasterAdmin();
      if (!validPassword(master, password)) return json(response, 401, { message: "Login ou senha invalidos." });
      const accessToken = randomBytes(24).toString("hex");
      return json(response, 200, {
        accessToken,
        refreshToken: randomBytes(24).toString("hex"),
        user: {
          id: master.id,
          name: master.name,
          email: master.email,
          role: "SUPER_ADMIN",
          mustChangePassword: master.mustChangePassword !== false
        }
      });
    }
    const matchedCompany = companies.find((company) =>
      normalizeLookup(company.login) === loginKey
    );
    if (matchedCompany) {
      if (matchedCompany.status === "INACTIVE") return json(response, 403, { message: "Empresa inativa. Entre em contato com o suporte." });
      if (!validPassword(matchedCompany, password)) return json(response, 401, { message: "Login ou senha invalidos." });
      const accessToken = randomBytes(24).toString("hex");
      return json(response, 200, {
        accessToken,
        refreshToken: randomBytes(24).toString("hex"),
        user: {
          id: `company-user-${matchedCompany.id}`,
          name: matchedCompany.contactName || matchedCompany.name,
          email: matchedCompany.login || matchedCompany.contactEmail,
          role: "COMPANY_ADMIN",
          companyId: matchedCompany.id,
          mustChangePassword: matchedCompany.mustChangePassword !== false
        }
      });
    }
    const matchedResident = residents.find((person) =>
      normalizeLookup(person.email) === loginKey ||
      normalizeLookup(person.cpf) === loginKey ||
      normalizeLookup(person.phone) === loginKey ||
      normalizeLookup(person.id) === loginKey
    );
    if (!matchedResident) return json(response, 401, { message: "Login ou senha invalidos." });
    if (!matchedResident.passwordHash || !matchedResident.passwordSalt) {
      Object.assign(matchedResident, createPasswordRecord(), { mustChangePassword: true, updatedAt: now() });
    }
    if (!validPassword(matchedResident, password)) return json(response, 401, { message: "Login ou senha invalidos." });
    const accessToken = randomBytes(24).toString("hex");
    recordUnitLogin(matchedResident, accessToken);
    savePersistentState("resident-login");
    return json(response, 200, {
      accessToken,
      refreshToken: randomBytes(24).toString("hex"),
      user: {
        id: matchedResident.id,
        name: matchedResident.name,
        email: matchedResident.email || loginId,
        role: matchedResident.role || "RESIDENT",
        tenantId: matchedResident.tenantId || activeMobileTenantId(),
        unitId: matchedResident.unitId || "",
        mustChangePassword: matchedResident.mustChangePassword === true
      }
    });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const body = await readBody(request);
    const sessionId = String(body.sessionId || body.accessToken || "").trim();
    const login = unitLogins.find((item) => item.sessionId === sessionId && !item.logoutAt);
    if (login) {
      login.logoutAt = now();
      login.status = "OFFLINE";
      savePersistentState("resident-logout");
    }
    return json(response, 200, { ok: true, logoutAt: login?.logoutAt || now() });
  }

  if (request.method === "GET" && url.pathname === "/api/condominiums") {
    return json(response, 200, allTenants());
  }

  if (request.method === "GET" && url.pathname === "/api/companies") {
    return json(response, 200, companies.map(publicCompany));
  }

  if (request.method === "POST" && url.pathname === "/api/companies") {
    const body = await readBody(request);
    const existingCompany = body.id ? findCompany(body.id) : null;
    const login = String(body.login ?? existingCompany?.login ?? body.contactEmail ?? "").trim().toLowerCase();
    if (!login) return json(response, 400, { message: "Informe o login da empresa." });
    const duplicatedLogin = companies.find((company) => company.id !== existingCompany?.id && normalizeLookup(company.login) === normalizeLookup(login));
    if (duplicatedLogin) return json(response, 409, { message: "Este login ja esta em uso por outra empresa." });
    const initialPassword = existingCompany?.passwordHash
      ? { passwordHash: existingCompany.passwordHash, passwordSalt: existingCompany.passwordSalt }
      : createPasswordRecord();
    const resourceIds = Array.isArray(body.resourceIds)
      ? body.resourceIds.filter((id) => resources.some((resource) => resource.id === id))
      : companyResourceIds(existingCompany);
    const company = {
      id: body.id || makeId("company"),
      name: body.name || existingCompany?.name || "Nova empresa",
      document: body.document ?? body.cnpj ?? existingCompany?.document ?? "",
      status: body.status || existingCompany?.status || "ACTIVE",
      contactName: body.contactName ?? existingCompany?.contactName ?? "",
      contactEmail: body.contactEmail ?? existingCompany?.contactEmail ?? "",
      contactPhone: body.contactPhone ?? existingCompany?.contactPhone ?? "",
      logoUrl: body.logoUrl ?? existingCompany?.logoUrl ?? "",
      asaasCustomerId: existingCompany?.asaasCustomerId || "",
      login,
      ...initialPassword,
      mustChangePassword: existingCompany?.mustChangePassword ?? true,
      billingModel: body.billingModel || existingCompany?.billingModel || "PER_CONDOMINIUM",
      maxCondominiums: parsePositiveInteger(body.maxCondominiums, existingCompany?.maxCondominiums || 1),
      baseMonthlyPrice: Number(body.baseMonthlyPrice ?? existingCompany?.baseMonthlyPrice ?? 0),
      condominiumUnitPrice: Number(body.condominiumUnitPrice ?? existingCompany?.condominiumUnitPrice ?? 0),
      voipBillingModel: body.voipBillingModel || existingCompany?.voipBillingModel || "PER_EXTENSION",
      includedExtensions: Number(body.includedExtensions ?? existingCompany?.includedExtensions ?? 0),
      maxExtensions: Number(body.maxExtensions ?? existingCompany?.maxExtensions ?? 0),
      extensionUnitPrice: Number(body.extensionUnitPrice ?? existingCompany?.extensionUnitPrice ?? 0),
      billingDueDay: Math.min(31, parsePositiveInteger(body.billingDueDay, existingCompany?.billingDueDay || 10)),
      defaultPaymentMethod: ["PIX", "BOLETO", "CREDIT_CARD", "TRANSFER"].includes(body.defaultPaymentMethod)
        ? body.defaultPaymentMethod
        : existingCompany?.defaultPaymentMethod || "PIX",
      billingStatus: ["ACTIVE", "TRIAL", "BLOCKED"].includes(body.billingStatus)
        ? body.billingStatus
        : existingCompany?.billingStatus || "ACTIVE",
      resourceIds,
      updatedAt: now()
    };
    const currentUsage = companyTenantCount(company.id);
    if (company.maxCondominiums < currentUsage) {
      return json(response, 409, {
        message: `A empresa ja possui ${currentUsage} condominio(s). O limite nao pode ser menor que o uso atual.`
      });
    }
    const updated = existingCompany ? updateById(companies, company.id, company) : null;
    if (!updated) companies.unshift(company);

    const allowedIds = new Set(resourceIds);
    licenses.forEach((license) => {
      const tenantData = allTenants().find((item) => item.id === license.tenantId);
      if (license.companyId === company.id || tenantData?.companyId === company.id) {
        license.companyId = company.id;
        license.resourceIds = licensedResourceIds(license).filter((id) => allowedIds.has(id));
      }
    });
    savePersistentState("company-saved");
    return json(response, existingCompany ? 200 : 201, {
      ...publicCompany(updated || company),
      temporaryPassword: existingCompany ? undefined : defaultCompanyPassword
    });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/change-password") {
    const body = await readBody(request);
    const loginKey = normalizeLookup(body.login || body.email);
    const account = systemUsers.find((item) => normalizeLookup(item.email) === loginKey) ||
      companies.find((item) => normalizeLookup(item.login) === loginKey) ||
      residents.find((item) => [item.email, item.cpf, item.phone, item.id].some((value) => normalizeLookup(value) === loginKey));
    if (!account || !validPassword(account, String(body.currentPassword || ""))) {
      return json(response, 401, { message: "Senha atual invalida." });
    }
    const nextPassword = String(body.newPassword || "");
    if (nextPassword.length < 6 || nextPassword === defaultCompanyPassword) {
      return json(response, 400, { message: "A nova senha deve ter ao menos 6 caracteres e ser diferente da senha temporaria." });
    }
    Object.assign(account, createPasswordRecord(nextPassword), {
      mustChangePassword: false,
      updatedAt: now()
    });
    savePersistentState("account-password-changed");
    return json(response, 200, { ok: true, mustChangePassword: false });
  }

  if (request.method === "GET" && url.pathname === "/api/condominiums/residents") {
    return json(response, 200, mobileResidentList({
      tenantId: url.searchParams.get("tenantId") || "",
      userId: url.searchParams.get("userId") || "",
      email: url.searchParams.get("email") || "",
      origin: requestOrigin(request)
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
      relation: body.source === "MOBILE" ? person.relation : body.relation || person.relation,
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
    return json(response, 200, toMobileResident(person, requestOrigin(request)));
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

  if (request.method === "GET" && url.pathname === "/api/nice-linear/connections") {
    return json(response, 200, {
      listeners: Array.from(niceLinearListeners.values()).map((listener) => ({
        port: listener.port,
        listening: listener.listening,
        error: listener.error
      })),
      devices: devices
        .filter(matchesNiceLinear)
        .map((device) => ({
          device: publicDevice(device),
          connection: niceLinearConnectionStatus(device)
        })),
      unknownConnections: Array.from(niceLinearUnknownConnections.values()).map((session) => ({
        remoteAddress: session.remoteAddress,
        remotePort: session.remotePort,
        connectedAt: session.connectedAt,
        lastSeenAt: session.lastSeenAt,
        packets: session.packets.length
      }))
    });
  }

  const niceLinearPacketsMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/nice-linear\/packets$/);
  if (request.method === "GET" && niceLinearPacketsMatch) {
    const device = devices.find((item) => item.id === decodeURIComponent(niceLinearPacketsMatch[1]));
    if (!device || deviceAdapter(device) !== NICE_LINEAR_ADAPTER) {
      return json(response, 404, { message: "Equipamento Nice/Linear nao encontrado" });
    }
    const session = niceLinearSessions.get(device.id);
    return json(response, 200, {
      device: publicDevice(device),
      connection: niceLinearConnectionStatus(device),
      packets: session?.packets || []
    });
  }

  const niceLinearEventMatch = url.pathname.match(/^\/api\/nice-linear\/events\/([^/]+)$/);
  if (request.method === "POST" && niceLinearEventMatch) {
    const device = devices.find((item) => item.id === decodeURIComponent(niceLinearEventMatch[1]));
    if (!device || deviceAdapter(device) !== NICE_LINEAR_ADAPTER) {
      return json(response, 404, { message: "Equipamento Nice/Linear nao encontrado" });
    }
    const authorization = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const apiKey = String(request.headers["x-api-key"] || "");
    if (!device.password || (authorization !== device.password && apiKey !== device.password)) {
      return json(response, 401, { message: "Token do gateway Nice/Linear invalido" });
    }
    const payload = await readBody(request);
    const log = niceLinearEventToAccessLog(device, payload, { makeId, now, tenantId: tenant.id });
    accessLogs.unshift(log);
    savePersistentState("nice-linear-http-event");
    return json(response, 201, { ok: true, log });
  }

  const deviceIntegrationPhotoMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/integration\/photo$/);
  if (request.method === "GET" && deviceIntegrationPhotoMatch) {
    const deviceId = decodeURIComponent(deviceIntegrationPhotoMatch[1]);
    const device = devices.find((item) => item.id === deviceId);
    if (!device) return json(response, 404, { message: "Equipamento nao encontrado" });
    const photoUrl = url.searchParams.get("url") || "";
    if (!devicePhotoReferenceAllowed(device, photoUrl)) {
      return json(response, 400, { message: "Referencia de foto invalida para este equipamento" });
    }
    try {
      const photo = await fetchCredentialPhotoBytes(device, photoUrl);
      response.writeHead(200, {
        "Content-Type": photo.mimeType || "image/jpeg",
        "Content-Length": photo.buffer.length,
        "Cache-Control": "private, max-age=300",
        "Access-Control-Allow-Origin": "*"
      });
      return response.end(photo.buffer);
    } catch (error) {
      return json(response, 502, { message: error instanceof Error ? error.message : "Falha ao carregar foto facial" });
    }
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
    try {
      const limit = Number(url.searchParams.get("limit") || 50);
      const payload = deviceAdapter(device) === "HIKVISION_ISAPI" && ["summary", "credentials", "faces", "users", "events"].includes(resource)
        ? await directHikvisionIntegrationPayload(device, resource, { limit })
        : await deviceIntegrationPayload(device, resource, { limit });
      return json(response, 200, payload);
    } catch (error) {
      return json(response, 502, {
        ok: false,
        device: publicDevice(device),
        adapter: deviceAdapter(device),
        message: error instanceof Error ? error.message : "Falha ao ler integracao do equipamento"
      });
    }
  }

  const deviceCredentialImportMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/integration\/credentials\/import$/);
  if (request.method === "POST" && deviceCredentialImportMatch) {
    const deviceId = decodeURIComponent(deviceCredentialImportMatch[1]);
    const device = devices.find((item) => item.id === deviceId);
    if (!device) return json(response, 404, { message: "Equipamento nao encontrado" });
    const body = await readBody(request);
    try {
      const report = await importDeviceCredentials(device, {
        dryRun: body.dryRun !== false,
        selections: Array.isArray(body.selections) ? body.selections : [],
        resource: ["faces", "vehicleTags"].includes(body.resource) ? body.resource : "credentials"
      });
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
    if (device && action?.status !== "DISABLED" && [CONTROL_ID_ACCESS_ADAPTER, "HIKVISION_ISAPI", INTELBRAS_SS_3532_MF_W_ADAPTER, DAHUA_ACCESS_CGI_ADAPTER, AXIS_VAPIX_PACS_ADAPTER, NICE_LINEAR_ADAPTER].includes(adapter)) {
      try {
        const result = await openDeviceDoor(device, action.relay || device.doorRelay || 1, action);
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

  if (request.method === "POST" && url.pathname === "/api/telephony/porter-call") {
    const body = await readBody(request);
    const unit = resolveUnitForTelephonyRequest(body);
    if (!unit) return json(response, 404, { message: "Unidade nao encontrada para chamada." });
    const callTenant = findTenant(unit.tenantId || body.tenantId || activeMobileTenantId());
    const sourceExtension = body.sourceExtension || callTenant.sipPorterExtension || "9000";
    const call = {
      id: makeId("call"),
      tenantId: unit.tenantId || callTenant.id,
      unitId: unit.unitId || "",
      unitNumber: unit.unitNumber || body.unitNumber || "",
      targetType: "UNIT",
      deviceId: "",
      targetExtension: body.targetExtension || unitExtension(unit),
      targetLabel: body.targetLabel || `Unidade ${unit.unitNumber || unit.unitId}`,
      sourceExtension,
      visitorLabel: body.visitorLabel || "Portaria",
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
      decision: "INFO",
      reason: "Chamada da portaria para unidade",
      createdAt: call.createdAt,
      user: { name: call.visitorLabel },
      door: { name: "Portaria" }
    });
    const push = await sendOneSignalPushToUnit(unit, {
      callId: call.id,
      sourceExtension,
      targetExtension: call.targetExtension,
      title: "Chamada da portaria",
      body: `${callTenant.name} - Unidade ${unit.unitNumber || unit.unitId}`
    });
    call.push = { ok: push.ok, skipped: Boolean(push.skipped), reason: push.reason || "", recipients: push.result?.recipients || 0 };
    savePersistentState("porter-call-created");
    return json(response, 201, call);
  }

  if (request.method === "POST" && url.pathname === "/api/telephony/extension-call") {
    const body = await readBody(request);
    const callTenant = findTenant(body.tenantId || activeMobileTenantId());
    const targetExtension = String(body.targetExtension || "").trim();
    const sourceExtension = String(body.sourceExtension || callTenant.sipPorterExtension || "9000").trim();
    if (!/^\d{2,8}$/.test(targetExtension)) {
      return json(response, 400, { message: "Ramal de destino invalido." });
    }
    if (targetExtension === sourceExtension) {
      return json(response, 400, { message: "O ramal de origem e destino nao podem ser iguais." });
    }

    const targetUnit = unitList().find((unit) => unit.tenantId === callTenant.id && unitExtension(unit) === targetExtension);
    const targetDevice = devices.find((device) =>
      device.tenantId === callTenant.id &&
      device.intercomEnabled &&
      String(device.intercomExtension || "") === targetExtension
    );
    const targetsPorter = String(callTenant.sipPorterExtension || "") === targetExtension;
    if (!targetUnit && !targetDevice && !targetsPorter) {
      return json(response, 404, { message: "Ramal nao cadastrado neste condominio." });
    }

    const targetType = targetsPorter ? "PORTER" : targetUnit ? "UNIT" : targetDevice?.intercomType || "DEVICE";
    const targetLabel = body.targetLabel || (targetsPorter
      ? "Portaria"
      : targetUnit
        ? `Unidade ${targetUnit.unitNumber || targetUnit.unitId}`
        : targetDevice.name);
    const call = {
      id: makeId("call"),
      tenantId: callTenant.id,
      unitId: targetUnit?.unitId || body.unitId || "",
      unitNumber: targetUnit?.unitNumber || body.unitNumber || "",
      targetType,
      deviceId: targetDevice?.id || body.deviceId || "",
      targetExtension,
      targetLabel,
      sourceExtension,
      visitorLabel: body.sourceLabel || `Ramal ${sourceExtension}`,
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
      decision: "INFO",
      reason: `Chamada interna para ${targetLabel}`,
      createdAt: call.createdAt,
      user: { name: call.visitorLabel },
      door: { name: "Telefonia interna" }
    });

    if (targetUnit) {
      const push = await sendOneSignalPushToUnit(targetUnit, {
        callId: call.id,
        sourceExtension,
        targetExtension,
        title: "Chamada interna",
        body: `${callTenant.name} - ${call.visitorLabel}`
      });
      call.push = { ok: push.ok, skipped: Boolean(push.skipped), reason: push.reason || "", recipients: push.result?.recipients || 0 };
    }
    savePersistentState("extension-call-created");
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
    const requestedCompanyId = String(body.companyId ?? existingTenant?.companyId ?? "").trim();
    const requestedCompany = requestedCompanyId ? findCompany(requestedCompanyId) : null;
    if (requestedCompanyId && !requestedCompany) {
      return json(response, 400, { message: "Empresa cliente nao encontrada." });
    }
    if (requestedCompany && requestedCompany.status === "INACTIVE") {
      return json(response, 409, { message: "A empresa cliente esta inativa." });
    }
    if (requestedCompany) {
      const usedCondominiums = companyTenantCount(requestedCompany.id, requestedTenantId);
      if (usedCondominiums >= requestedCompany.maxCondominiums) {
        return json(response, 409, {
          message: `Limite de ${requestedCompany.maxCondominiums} condominio(s) atingido para ${requestedCompany.name}.`
        });
      }
    }
    const targetTenant = existingTenant || {
      id: requestedTenantId || makeId("tenant"),
      name: body.name || "Novo condominio",
      document: body.document || "",
      status: body.status || "ACTIVE",
      structureType: body.structureType || "VERTICAL",
      structureGroupCount: parsePositiveInteger(body.structureGroupCount ?? body.floorCount ?? body.blockCount, 0),
      unitsPerGroup: parsePositiveInteger(body.unitsPerGroup ?? body.unitsPerFloor ?? body.unitsPerBlock, 0),
      totalUnits: parsePositiveInteger(body.totalUnits, 0),
      address: body.address || "",
      addressNumber: body.addressNumber || "",
      city: body.city || "",
      state: body.state || "",
      latitude: body.latitude || "",
      longitude: body.longitude || "",
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
    targetTenant.structureType = body.structureType || targetTenant.structureType || "VERTICAL";
    targetTenant.structureGroupCount = parsePositiveInteger(body.structureGroupCount ?? body.floorCount ?? body.blockCount, targetTenant.structureGroupCount || 0);
    targetTenant.unitsPerGroup = parsePositiveInteger(body.unitsPerGroup ?? body.unitsPerFloor ?? body.unitsPerBlock, targetTenant.unitsPerGroup || 0);
    targetTenant.totalUnits = parsePositiveInteger(body.totalUnits, targetTenant.totalUnits || (targetTenant.structureGroupCount || 0) * (targetTenant.unitsPerGroup || 0));
    targetTenant.address = body.address ?? targetTenant.address ?? "";
    targetTenant.addressNumber = body.addressNumber ?? targetTenant.addressNumber ?? "";
    targetTenant.city = body.city ?? targetTenant.city ?? "";
    targetTenant.state = body.state ?? targetTenant.state ?? "";
    targetTenant.latitude = body.latitude ?? targetTenant.latitude ?? "";
    targetTenant.longitude = body.longitude ?? targetTenant.longitude ?? "";
    targetTenant.companyId = requestedCompanyId;
    const currentTenantLicense = tenantLicense(targetTenant.id);
    if (currentTenantLicense) {
      currentTenantLicense.companyId = requestedCompanyId;
      if (requestedCompany) {
        const allowedIds = new Set(companyResourceIds(requestedCompany));
        currentTenantLicense.resourceIds = licensedResourceIds(currentTenantLicense).filter((id) => allowedIds.has(id));
      }
    }
    syncTenantTelephony(body, targetTenant);
    const generatedUnits = ensureTenantUnitsFromStructure(targetTenant, body);
    targetTenant.updatedAt = now();
    if (isNewTenant) extraTenants.unshift(targetTenant);
    savePersistentState(generatedUnits.length ? "tenant-saved-units-generated" : "tenant-saved");
    return json(response, isNewTenant ? 201 : 200, {
      ...targetTenant,
      generatedUnits: generatedUnits.length,
      generatedUnitList: generatedUnits
    });
  }

  const deleteTenantMatch = url.pathname.match(/^\/api\/condominiums\/([^/]+)$/);
  if (request.method === "DELETE" && deleteTenantMatch) {
    const tenantId = deleteTenantMatch[1];
    const index = extraTenants.findIndex((item) => item.id === tenantId);
    const builtInTenant = [tenant, showroomTenant].find((item) => item.id === tenantId) || null;
    const [removed] = index >= 0 ? extraTenants.splice(index, 1) : [builtInTenant];
    if (!removed) return json(response, 404, { message: "Condominio nao encontrado" });
    if (index === -1) deletedTenantIds.add(tenantId);
    const tenantUnitIds = new Set(unitList().filter((unit) => unit.tenantId === tenantId).map((unit) => unit.unitId));
    let removedUnits = 0;
    tenantUnitIds.forEach((unitId) => {
      if (units.delete(unitId)) removedUnits += 1;
    });
    const cleanup = {
      units: removedUnits,
      residents: removeMatching(residents, (item) => item.tenantId === tenantId || tenantUnitIds.has(item.unitId)),
      vehicles: removeMatching(vehicles, (item) => item.tenantId === tenantId || tenantUnitIds.has(item.unitId)),
      devices: removeMatching(devices, (item) => item.tenantId === tenantId),
      cameras: removeMatching(cameras, (item) => item.tenantId === tenantId),
      actions: removeMatching(actions, (item) => item.tenantId === tenantId),
      credentials: removeMatching(credentials, (item) => item.tenantId === tenantId || tenantUnitIds.has(item.unitId)),
      syncJobs: removeMatching(credentialSyncJobs, (item) => item.tenantId === tenantId),
      logins: removeMatching(unitLogins, (item) => item.tenantId === tenantId || tenantUnitIds.has(item.unitId)),
      invites: removeMatching(unitInvites, (item) => item.tenantId === tenantId || tenantUnitIds.has(item.unitId)),
      routes: removeMatching(accessRoutes, (item) => item.tenantId === tenantId),
      profiles: removeMatching(permissionProfiles, (item) => item.tenantId === tenantId),
      licenses: removeMatching(licenses, (item) => item.tenantId === tenantId),
      configurations: removeMatching(resourceConfigurations, (item) => item.tenantId === tenantId),
      accessLogs: removeMatching(accessLogs, (item) => item.tenantId === tenantId || tenantUnitIds.has(item.unitId)),
      calls: removeMatching(intercomCalls, (item) => item.tenantId === tenantId || tenantUnitIds.has(item.unitId))
    };
    await savePersistentStateAndWait("tenant-deleted");
    return json(response, 200, { ok: true, removed, cleanup });
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

  const credentialPhotoMatch = url.pathname.match(/^\/api\/credentials\/([^/]+)\/photo$/);
  if (request.method === "GET" && credentialPhotoMatch) {
    const credentialId = decodeURIComponent(credentialPhotoMatch[1]);
    const credential = credentials.find((item) => item.id === credentialId);
    if (!credential?.photoUrl) return json(response, 404, { message: "Foto facial nao encontrada" });
    const storedId = storedFacePhotoId(credential.photoUrl);
    const device = storedId ? null : devices.find((item) => item.id === credential.deviceId) ||
      devices.find((item) => item.tenantId === credential.tenantId && item.category === "access-control");
    if (!storedId && !device) return json(response, 404, { message: "Equipamento da facial nao encontrado" });
    try {
      const photo = await fetchCredentialPhotoBytes(device, credential.photoUrl);
      response.writeHead(200, {
        "Content-Type": photo.mimeType || "image/jpeg",
        "Content-Length": photo.buffer.length,
        "Cache-Control": "private, max-age=300",
        "Access-Control-Allow-Origin": "*"
      });
      return response.end(photo.buffer);
    } catch (error) {
      return json(response, 502, { message: error instanceof Error ? error.message : "Falha ao carregar foto facial" });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/credentials") {
    const body = await readBody(request);
    const photoError = validateManualFacePhoto(body, findPersonForCredential(body));
    if (photoError) return json(response, 400, { message: photoError });
    const uploadedPhoto = String(body.photoUrl || "").startsWith("data:") ? body.photoUrl : "";
    const result = saveCredential({ ...body, photoUrl: uploadedPhoto ? "" : body.photoUrl });
    if (result.error) return json(response, result.duplicate ? 409 : 400, { message: result.error, duplicate: result.duplicate });
    if (uploadedPhoto) result.credential.photoUrl = await storeCredentialFacePhoto(result.credential.id, uploadedPhoto);
    if (!body.id) {
      const event = await emitCredentialEvent("CREATE", result.credential);
      Object.assign(result.credential, {
        syncStatus: event.ok ? "SYNCED" : "ERROR",
        syncMessage: event.message || "",
        deviceId: event.deviceId || result.credential.deviceId || "",
        lastSyncedAt: event.ok ? now() : result.credential.lastSyncedAt
      });
    }
    savePersistentState("credential-saved");
    return json(response, body.id ? 200 : 201, result.credential);
  }

  if (request.method === "POST" && url.pathname === "/api/credentials/generate") {
    const body = await readBody(request);
    const person = findPersonForCredential(body);
    if (!person) return json(response, 404, { message: "Pessoa nao encontrada para gerar credencial" });
    const type = normalizeCredentialType(body.type || body.credentialType || person.credentialType || "APP");
    const photoError = validateManualFacePhoto({ ...body, type }, person);
    if (photoError) return json(response, 400, { message: photoError });
    const uploadedPhoto = String(body.photoUrl || "").startsWith("data:") ? body.photoUrl : "";
    const result = saveCredential({
      ...body,
      tenantId: body.tenantId || person.tenantId,
      unitId: body.unitId || person.unitId,
      personId: person.id,
      personName: person.name,
      type,
      value: body.value || generatedCredentialValue(type, person),
      valueLabel: body.valueLabel || credentialDisplayValue(type, body.value || "", person),
      photoUrl: uploadedPhoto ? "" : body.photoUrl,
      source: "GENERATED"
    });
    if (result.error) return json(response, result.duplicate ? 409 : 400, { message: result.error, duplicate: result.duplicate });
    if (uploadedPhoto) result.credential.photoUrl = await storeCredentialFacePhoto(result.credential.id, uploadedPhoto);
    const event = await emitCredentialEvent("CREATE", result.credential);
    Object.assign(result.credential, {
      syncStatus: event.ok ? "SYNCED" : "ERROR",
      syncMessage: event.message || "",
      deviceId: event.deviceId || result.credential.deviceId || "",
      lastSyncedAt: event.ok ? now() : result.credential.lastSyncedAt
    });
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
    const credential = credentials[index];
    const event = await emitCredentialEvent("DELETE", credential);
    const [removed] = credentials.splice(index, 1);
    await deleteCredentialFacePhoto(credential.id);
    await savePersistentStateAndWait("credential-deleted");
    return json(response, 200, { ok: true, removed, event });
  }

  if (request.method === "GET" && url.pathname === "/api/permissions") {
    return json(response, 200, permissionProfiles);
  }

  if (request.method === "GET" && url.pathname === "/api/resources") {
    const tenantId = url.searchParams.get("tenantId") || "";
    return json(response, 200, effectiveResources(tenantId));
  }

  if (request.method === "GET" && url.pathname === "/api/resource-configurations") {
    const tenantId = url.searchParams.get("tenantId") || "";
    return json(response, 200, tenantId
      ? resourceConfigurations.filter((item) => item.tenantId === tenantId)
      : resourceConfigurations);
  }

  if (request.method === "GET" && url.pathname === "/api/credential-sync") {
    return json(response, 200, credentialSyncJobs);
  }

  if (request.method === "POST" && url.pathname === "/api/credential-sync") {
    return json(response, 409, {
      message: "Sincronismo manual desativado. Credenciais sao enviadas somente nos eventos de criacao e exclusao."
    });
  }

  if (request.method === "POST" && url.pathname === "/api/licenses") {
    const body = await readBody(request);
    const existingLicense = body.id ? licenses.find((item) => item.id === body.id) : null;
    const targetTenantId = body.tenantId || existingLicense?.tenantId || tenant.id;
    const targetTenant = [tenant, showroomTenant, ...allTenants()].find((item) => item.id === targetTenantId);
    if (!targetTenant) return json(response, 400, { message: "Condominio nao encontrado." });
    const companyId = String(body.companyId || targetTenant?.companyId || existingLicense?.companyId || "").trim();
    const company = companyId ? findCompany(companyId) : null;
    if (companyId && !company) return json(response, 400, { message: "Empresa cliente nao encontrada." });
    if (company && targetTenant?.companyId && targetTenant.companyId !== company.id) {
      return json(response, 409, { message: "O condominio pertence a outra empresa cliente." });
    }
    const allowedResourceIds = new Set(companyResourceIds(company));
    const requestedResourceIds = Array.isArray(body.resourceIds)
      ? body.resourceIds.filter((id) => resources.some((resource) => resource.id === id))
      : licensedResourceIds(existingLicense);
    const invalidResourceIds = company
      ? requestedResourceIds.filter((id) => !allowedResourceIds.has(id))
      : [];
    if (invalidResourceIds.length) {
      return json(response, 409, {
        message: `A empresa nao contratou: ${invalidResourceIds.map((id) => resources.find((resource) => resource.id === id)?.name || id).join(", ")}.`
      });
    }
    const extensionLimit = Number(body.extensionLimit ?? existingLicense?.extensionLimit ?? 0);
    if (company?.maxExtensions > 0) {
      const allocatedExtensions = licenses
        .filter((item) => item.id !== existingLicense?.id && item.companyId === company.id && item.active !== false)
        .reduce((total, item) => total + Number(item.extensionLimit || 0), 0);
      if (allocatedExtensions + extensionLimit > company.maxExtensions) {
        return json(response, 409, {
          message: `O limite de ${company.maxExtensions} ramais da empresa seria excedido.`
        });
      }
    }
    const license = {
      id: body.id || makeId("license"),
      code: body.code || existingLicense?.code || String(Math.floor(10000 + Math.random() * 80000)),
      tenantId: targetTenant.id,
      companyId,
      name: body.name || existingLicense?.name || "Nova licenca",
      type: body.type || existingLicense?.type || "Condominio",
      city: body.city ?? existingLicense?.city ?? "",
      plan: body.plan || body.attendance || existingLicense?.plan || "Full",
      residents: Number(body.residents ?? existingLicense?.residents ?? 0),
      extensionLimit,
      contractor: body.contractor || body.contract || existingLicense?.contractor || "",
      visible: body.visible ?? existingLicense?.visible ?? true,
      active: body.active ?? existingLicense?.active ?? true,
      resourceIds: requestedResourceIds,
      updatedAt: now()
    };
    if (company && !targetTenant.companyId) targetTenant.companyId = company.id;
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
    const deviceProfile = matchesControlIdDevice({ ...body, manufacturer, model })
      ? controlIdDeviceDefaults({ ...body, manufacturer, model }, existingDevice)
      : matchesNiceLinear({ ...body, manufacturer, model })
        ? niceLinearDefaults({ ...body, manufacturer, model }, existingDevice)
      : matchesHikvisionIsapi({ ...body, manufacturer, model })
        ? hikvisionIsapiDefaults({ ...body, manufacturer, model }, existingDevice)
      : matchesSs3532Mfw({ ...body, manufacturer, model })
        ? ss3532MfwDefaults({ ...body, manufacturer, model }, existingDevice)
        : matchesMhdx3116c({ ...body, manufacturer, model })
          ? mhdx3116cDefaults({ ...body, manufacturer, model }, existingDevice)
          : resolveRestAccessProfile({ ...body, manufacturer, model })
            ? restAccessDefaults({ ...body, manufacturer, model }, existingDevice)
            : {};
    if (matchesControlIdDevice({ ...body, manufacturer, model })) {
      const validation = validateControlIdConfiguration(deviceProfile);
      if (!validation.ok) {
        return json(response, 400, {
          message: validation.errors[0],
          errors: validation.errors
        });
      }
    }
    if (matchesNiceLinear({ ...body, manufacturer, model })) {
      const validation = validateNiceLinearConfiguration({
        ...deviceProfile,
        ...body,
        model: deviceProfile.model || model,
        ipAddress: body.ipAddress || body.host || existingDevice?.ipAddress || "",
        apiPort: deviceProfile.apiPort || body.apiPort || existingDevice?.apiPort || 0,
        password: body.password || existingDevice?.password || ""
      });
      if (!validation.ok) {
        return json(response, 400, {
          message: validation.errors[0],
          errors: validation.errors
        });
      }
    }
    const device = {
      id: body.id || makeId("device"),
      tenantId: body.tenantId || tenant.id,
      name: body.name || body.description || "Novo equipamento",
      category: deviceProfile.category || body.category || "access-control",
      manufacturer,
      model: deviceProfile.model || model,
      ipAddress: body.ipAddress || body.host || "",
      apiHost: body.apiHost || body.ipAddress || body.host || "",
      apiPort: Number(deviceProfile.apiPort ?? body.apiPort ?? existingDevice?.apiPort ?? 80),
      apiProtocol: deviceProfile.apiProtocol || body.apiProtocol || existingDevice?.apiProtocol || "http",
      rtspPort: Number(deviceProfile.rtspPort ?? body.rtspPort ?? existingDevice?.rtspPort ?? 554),
      channelCount: Number(deviceProfile.channelCount ?? body.channelCount ?? existingDevice?.channelCount ?? 0),
      username: body.username || deviceProfile.username || existingDevice?.username || "admin",
      password: body.password || existingDevice?.password || "",
      passwordSet: Boolean(body.password || existingDevice?.password || body.passwordSet),
      authMode: body.authMode || existingDevice?.authMode || "DIGEST",
      integrationMode: deviceProfile.integrationMode || body.integrationMode || existingDevice?.integrationMode || "DIRECT_DEVICE",
      doorToken: deviceProfile.doorToken ?? body.doorToken ?? existingDevice?.doorToken ?? "",
      controlIdAction: deviceProfile.controlIdAction || body.controlIdAction || existingDevice?.controlIdAction || "door",
      controlIdSecBoxId: deviceProfile.controlIdSecBoxId ?? body.controlIdSecBoxId ?? existingDevice?.controlIdSecBoxId ?? "",
      controlIdGroupId: deviceProfile.controlIdGroupId ?? body.controlIdGroupId ?? existingDevice?.controlIdGroupId ?? "",
      controlIdUhfMode: normalizeControlIdUhfMode(deviceProfile.controlIdUhfMode || body.controlIdUhfMode || existingDevice?.controlIdUhfMode),
      niceConnectionMode: deviceProfile.niceConnectionMode || body.niceConnectionMode || existingDevice?.niceConnectionMode || "",
      niceGatewayHealthPath: deviceProfile.niceGatewayHealthPath || body.niceGatewayHealthPath || existingDevice?.niceGatewayHealthPath || "",
      niceGatewayOpenPath: deviceProfile.niceGatewayOpenPath || body.niceGatewayOpenPath || existingDevice?.niceGatewayOpenPath || "",
      niceDeviceId: deviceProfile.niceDeviceId ?? body.niceDeviceId ?? existingDevice?.niceDeviceId ?? "",
      intercomEnabled: deviceProfile.intercomEnabled ?? Boolean(body.intercomEnabled),
      intercomType: deviceProfile.intercomType || body.intercomType || "FACIAL",
      intercomExtension: body.intercomExtension || "",
      status: body.status || "OFFLINE"
    };
    const updated = body.id ? updateById(devices, body.id, device) : null;
    if (!updated) devices.unshift(device);
    if (deviceAdapter(updated || device) === NICE_LINEAR_ADAPTER &&
        normalizeNiceLinearMode((updated || device).niceConnectionMode) === NICE_LINEAR_DEVICE_TCP_MODE) {
      ensureNiceLinearTcpListener((updated || device).apiPort);
    }
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
    await savePersistentStateAndWait("device-deleted");
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
    await savePersistentStateAndWait("camera-deleted");
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
    await savePersistentStateAndWait("camera-group-deleted");
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
    await savePersistentStateAndWait("action-deleted");
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
    if (device && action.status !== "DISABLED" && [CONTROL_ID_ACCESS_ADAPTER, "HIKVISION_ISAPI", INTELBRAS_SS_3532_MF_W_ADAPTER, DAHUA_ACCESS_CGI_ADAPTER, AXIS_VAPIX_PACS_ADAPTER, NICE_LINEAR_ADAPTER].includes(adapter)) {
      try {
        const result = await openDeviceDoor(device, action.relay || device.doorRelay || 1, action);
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
    const resource = resources.find((item) => item.id === resourceMatch[1]);
    if (!resource) return json(response, 404, { message: "Recurso nao encontrado" });
    const tenantId = String(body.tenantId || "").trim();
    if (!tenantId) {
      Object.assign(resource, body, { id: resource.id });
      savePersistentState("resource-catalog-updated");
      return json(response, 200, resource);
    }

    let license = tenantLicense(tenantId);
    const tenantData = findTenant(tenantId);
    const company = findCompany(tenantData?.companyId);
    if (company && !companyResourceIds(company).includes(resource.id)) {
      return json(response, 409, {
        message: `${resource.name} nao faz parte do contrato da empresa ${company.name}.`
      });
    }
    if (!license) {
      license = {
        id: makeId("license"),
        code: String(Math.floor(10000 + Math.random() * 80000)),
        tenantId,
        companyId: company?.id || "",
        name: findTenant(tenantId).name || "Licenca do condominio",
        type: "Condominio",
        city: "",
        plan: "Personalizado",
        residents: 0,
        contractor: "",
        visible: true,
        active: true,
        resourceIds: defaultLicensedResourceIds()
      };
      licenses.unshift(license);
    }
    const enabledIds = new Set(licensedResourceIds(license));
    if (body.enabled === false) enabledIds.delete(resource.id);
    else enabledIds.add(resource.id);
    license.resourceIds = Array.from(enabledIds);
    savePersistentState("license-resource-updated");
    return json(response, 200, {
      ...resource,
      tenantId,
      licenseId: license.id,
      enabled: enabledIds.has(resource.id),
      resourceIds: license.resourceIds
    });
  }

  const resourceConfigurationMatch = url.pathname.match(/^\/api\/resources\/([^/]+)\/configuration$/);
  if (resourceConfigurationMatch && ["GET", "PUT", "PATCH"].includes(request.method || "")) {
    const resourceId = decodeURIComponent(resourceConfigurationMatch[1]);
    const resource = resources.find((item) => item.id === resourceId);
    if (!resource) return json(response, 404, { message: "Recurso nao encontrado" });

    if (request.method === "GET") {
      const tenantId = url.searchParams.get("tenantId") || "";
      if (!tenantId) return json(response, 400, { message: "Condominio obrigatorio" });
      return json(response, 200, resourceConfiguration(tenantId, resourceId) || {
        tenantId,
        resourceId,
        settings: {},
        updatedAt: null
      });
    }

    const body = await readBody(request);
    const tenantId = String(body.tenantId || "").trim();
    if (!tenantId) return json(response, 400, { message: "Condominio obrigatorio" });
    const current = resourceConfiguration(tenantId, resourceId);
    const next = {
      id: current?.id || makeId("resource-config"),
      tenantId,
      resourceId,
      settings: body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
        ? body.settings
        : {},
      updatedAt: now()
    };
    if (current) Object.assign(current, next);
    else resourceConfigurations.unshift(next);
    savePersistentState("resource-configuration-updated");
    return json(response, current ? 200 : 201, next);
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
    }
    syncUnitResidentSummary(unitId);
    savePersistentState("unit-saved");
    return json(response, existing ? 200 : 201, {
      ...nextUnit,
      preRegisteredResident: unitResident ? publicPerson(unitResident) : undefined
    });
  }

  const deleteUnitMatch = url.pathname.match(/^\/api\/units\/([^/]+)$/);
  if (request.method === "DELETE" && deleteUnitMatch) {
    const unitId = deleteUnitMatch[1];
    const unit = units.get(unitId);
    if (!unit) return json(response, 404, { message: "Unidade nao encontrada" });
    units.delete(unitId);
    for (let index = residents.length - 1; index >= 0; index -= 1) {
      if (residents[index].unitId === unitId) residents.splice(index, 1);
    }
    for (let index = vehicles.length - 1; index >= 0; index -= 1) {
      if (vehicles[index].unitId === unitId) vehicles.splice(index, 1);
    }
    for (let index = credentials.length - 1; index >= 0; index -= 1) {
      if (credentials[index].unitId === unitId) credentials.splice(index, 1);
    }
    for (let index = unitLogins.length - 1; index >= 0; index -= 1) {
      if (unitLogins[index].unitId === unitId) unitLogins.splice(index, 1);
    }
    for (let index = unitInvites.length - 1; index >= 0; index -= 1) {
      if (unitInvites[index].unitId === unitId) unitInvites.splice(index, 1);
    }
    await savePersistentStateAndWait("unit-deleted");
    return json(response, 200, { ok: true, removed: unit });
  }

  const unitPeopleMatch = url.pathname.match(/^\/api\/units\/([^/]+)\/people$/);
  if (request.method === "GET" && unitPeopleMatch) {
    return json(response, 200, residents.filter((person) => person.unitId === unitPeopleMatch[1]).map(publicPerson));
  }

  if (request.method === "POST" && url.pathname === "/api/people") {
    const body = await readBody(request);
    const id = body.id || makeId("person");
    const existing = residents.find((person) => person.id === id);
    const unit = units.get(body.unitId) || (body.kind === "STAFF" ? null : units.get("unit-101"));
    if (body.source === "MOBILE") {
      const requester = residents.find((person) =>
        person.id === body.requesterId ||
        (body.requesterEmail && normalizeLookup(person.email) === normalizeLookup(body.requesterEmail))
      );
      if (!requester || requester.unitId !== body.unitId || !["Responsavel", "Proprietario"].includes(requester.relation)) {
        return json(response, 403, { message: "Somente o responsavel da unidade pode cadastrar outros moradores." });
      }
      if (body.kind !== "RESIDENT" || body.role !== "RESIDENT") {
        return json(response, 403, { message: "O responsavel pode cadastrar apenas moradores da propria unidade." });
      }
    }
    const passwordRecord = body.newPassword
      ? createPasswordRecord(String(body.newPassword))
      : existing?.passwordHash
        ? { passwordHash: existing.passwordHash, passwordSalt: existing.passwordSalt }
        : createPasswordRecord();
    const person = {
      id,
      tenantId: body.tenantId || unit?.tenantId || tenant.id,
      unitId: body.unitId || unit?.unitId || "",
      name: body.name || "Nova pessoa",
      email: body.email ?? existing?.email ?? "",
      cpf: body.cpf || "",
      rg: body.rg || "",
      birthDate: body.birthDate || "",
      photoUrl: body.photoUrl ?? existing?.photoUrl ?? "",
      phone: body.phone || "",
      role: body.role || (body.kind === "RESIDENT" ? "RESIDENT" : body.kind || "VISITOR"),
      relation: body.relation || body.accessReason || "",
      kind: body.kind || "RESIDENT",
      isSyndic: body.isSyndic === undefined ? Boolean(existing?.isSyndic) : Boolean(body.isSyndic),
      syndicRole: existing?.syndicRole || "",
      mandateStart: existing?.mandateStart || "",
      mandateEnd: existing?.mandateEnd || "",
      authorizedBy: body.authorizedBy || "",
      company: body.company || "",
      cnpj: body.cnpj || "",
      serviceType: body.serviceType || "",
      vehiclePlate: body.vehiclePlate || "",
      accessReason: body.accessReason || "",
      credentialType: body.credentialType || "APP",
      allowedDays: body.allowedDays || "",
      allowedHours: body.allowedHours || "",
      ...passwordRecord,
      mustChangePassword: body.newPassword ? false : existing?.mustChangePassword ?? true,
      createdAt: existing?.createdAt || now(),
      updatedAt: now()
    };
    const updated = updateById(residents, id, person);
    if (!updated) residents.unshift(person);
    if (existing?.unitId && existing.unitId !== person.unitId) syncUnitResidentSummary(existing.unitId);
    syncUnitResidentSummary(person.unitId);
    savePersistentState("person-saved");
    return json(response, updated ? 200 : 201, publicPerson(updated || person));
  }

  const deletePersonMatch = url.pathname.match(/^\/api\/people\/([^/]+)$/);
  if (request.method === "DELETE" && deletePersonMatch) {
    const index = residents.findIndex((person) => person.id === deletePersonMatch[1]);
    if (index === -1) return json(response, 404, { message: "Pessoa nao encontrada" });
    const [removed] = residents.splice(index, 1);
    for (let credentialIndex = credentials.length - 1; credentialIndex >= 0; credentialIndex -= 1) {
      if (credentials[credentialIndex].personId === removed.id) credentials.splice(credentialIndex, 1);
    }
    vehicles.forEach((vehicle) => {
      if (vehicle.personId === removed.id) vehicle.personId = "";
    });
    syncUnitResidentSummary(removed.unitId);
    await savePersistentStateAndWait("person-deleted");
    return json(response, 200, { ok: true, removed });
  }

  const unitLoginsMatch = url.pathname.match(/^\/api\/units\/([^/]+)\/logins$/);
  if (request.method === "GET" && unitLoginsMatch) {
    return json(response, 200, unitLogins.filter((login) => login.unitId === unitLoginsMatch[1]));
  }

  if (request.method === "POST" && url.pathname === "/api/syndics") {
    const body = await readBody(request);
    const tenantId = String(body.tenantId || "").trim();
    const person = residents.find((item) => item.id === body.personId && item.tenantId === tenantId);
    if (!person) return json(response, 404, { message: "Pessoa nao encontrada neste condominio." });
    residents.forEach((item) => {
      if (item.tenantId === tenantId) item.isSyndic = false;
    });
    Object.assign(person, {
      isSyndic: true,
      syndicRole: body.syndicRole || "SINDICO",
      mandateStart: body.mandateStart || "",
      mandateEnd: body.mandateEnd || "",
      role: body.role || "CONDO_ADMIN",
      updatedAt: now()
    });
    savePersistentState("syndic-saved");
    return json(response, 200, publicPerson(person));
  }

  if (request.method === "POST" && url.pathname === "/api/condominium-staff") {
    const body = await readBody(request);
    const tenantId = String(body.tenantId || "").trim();
    if (!allTenants().some((item) => item.id === tenantId)) {
      return json(response, 404, { message: "Condominio nao encontrado." });
    }
    const role = body.role === "CONDO_ADMIN" ? "CONDO_ADMIN" : "PORTER";
    const existing = body.id ? residents.find((person) => person.id === body.id && person.tenantId === tenantId) : null;
    const email = String(body.email || existing?.email || "").trim().toLowerCase();
    if (!email) return json(response, 400, { message: "Informe o e-mail/login." });
    const duplicate = residents.find((person) => person.id !== existing?.id && normalizeLookup(person.email) === normalizeLookup(email));
    if (duplicate) return json(response, 409, { message: "Este e-mail/login ja esta cadastrado." });
    const passwordRecord = body.newPassword
      ? createPasswordRecord(String(body.newPassword))
      : existing?.passwordHash
        ? { passwordHash: existing.passwordHash, passwordSalt: existing.passwordSalt }
        : createPasswordRecord();
    const person = {
      id: existing?.id || makeId("staff"),
      tenantId,
      unitId: "",
      name: body.name || existing?.name || (role === "PORTER" ? "Novo porteiro" : "Novo sindico"),
      email,
      cpf: body.cpf || existing?.cpf || "",
      rg: body.rg || existing?.rg || "",
      phone: body.phone || existing?.phone || "",
      role,
      relation: role === "PORTER" ? "Porteiro" : "Sindico",
      kind: "STAFF",
      isSyndic: role === "CONDO_ADMIN",
      syndicRole: role === "CONDO_ADMIN" ? body.syndicRole || existing?.syndicRole || "SINDICO" : "",
      mandateStart: role === "CONDO_ADMIN" ? body.mandateStart || existing?.mandateStart || "" : "",
      mandateEnd: role === "CONDO_ADMIN" ? body.mandateEnd || existing?.mandateEnd || "" : "",
      ...passwordRecord,
      mustChangePassword: body.newPassword ? false : existing?.mustChangePassword ?? true,
      createdAt: existing?.createdAt || now(),
      updatedAt: now()
    };
    if (role === "CONDO_ADMIN" && body.primary !== false) {
      residents.forEach((item) => {
        if (item.tenantId === tenantId && item.id !== person.id) item.isSyndic = false;
      });
    }
    const updated = existing ? updateById(residents, person.id, person) : null;
    if (!updated) residents.unshift(person);
    savePersistentState("condominium-staff-saved");
    return json(response, existing ? 200 : 201, publicPerson(updated || person));
  }

  if (request.method === "GET" && url.pathname === "/api/vehicles") {
    const tenantId = url.searchParams.get("tenantId") || "";
    const unitId = url.searchParams.get("unitId") || "";
    return json(response, 200, vehicles.filter((vehicle) =>
      (!tenantId || vehicle.tenantId === tenantId) && (!unitId || vehicle.unitId === unitId)
    ));
  }

  if (request.method === "POST" && url.pathname === "/api/vehicles") {
    const body = await readBody(request);
    const existing = body.id ? vehicles.find((vehicle) => vehicle.id === body.id) : null;
    const unit = unitForId(body.unitId || existing?.unitId);
    if (!unit) return json(response, 404, { message: "Unidade nao encontrada." });
    const plate = String(body.plate || "").trim().toUpperCase();
    if (!plate) return json(response, 400, { message: "Informe a placa do veiculo." });
    const duplicate = vehicles.find((vehicle) => vehicle.id !== existing?.id && normalizeLookup(vehicle.plate) === normalizeLookup(plate));
    if (duplicate) return json(response, 409, { message: "Esta placa ja esta cadastrada." });
    const tagValue = String(body.tagValue ?? existing?.tagValue ?? "").trim().toUpperCase();
    const duplicateTag = tagValue && vehicles.find((vehicle) =>
      vehicle.id !== existing?.id &&
      vehicle.tenantId === unit.tenantId &&
      normalizeLookup(vehicle.tagValue) === normalizeLookup(tagValue)
    );
    if (duplicateTag) return json(response, 409, { message: "Esta tag veicular ja esta vinculada a outro veiculo." });
    const tagMode = normalizeControlIdUhfMode(body.tagMode || existing?.tagMode);
    const tagDeviceId = body.tagDeviceId ?? existing?.tagDeviceId ?? "";
    const tagChanged = body.tagValue !== undefined && (
      tagValue !== String(existing?.tagValue || "") ||
      tagMode !== normalizeControlIdUhfMode(existing?.tagMode) ||
      tagDeviceId !== String(existing?.tagDeviceId || "")
    );
    const vehicle = {
      id: existing?.id || makeId("vehicle"),
      tenantId: unit.tenantId,
      unitId: unit.unitId,
      personId: body.personId || "",
      plate,
      brand: body.brand || "",
      model: body.model || "",
      color: body.color || "",
      type: body.type || "CARRO",
      notes: body.notes || "",
      tagValue,
      tagMode,
      tagDeviceId,
      tagExternalId: tagChanged ? "" : existing?.tagExternalId || "",
      tagUserId: existing?.tagUserId || "",
      tagStatus: tagChanged
        ? (tagValue ? "PENDING" : "")
        : existing?.tagStatus || (tagValue ? "PENDING" : ""),
      tagSyncedAt: existing?.tagSyncedAt || "",
      createdAt: existing?.createdAt || now(),
      updatedAt: now()
    };
    const updated = existing ? updateById(vehicles, vehicle.id, vehicle) : null;
    if (!updated) vehicles.unshift(vehicle);
    savePersistentState("vehicle-saved");
    return json(response, existing ? 200 : 201, updated || vehicle);
  }

  const syncVehicleTagMatch = url.pathname.match(/^\/api\/vehicles\/([^/]+)\/control-id-tag\/sync$/);
  if (request.method === "POST" && syncVehicleTagMatch) {
    const vehicle = vehicles.find((item) => item.id === decodeURIComponent(syncVehicleTagMatch[1]));
    if (!vehicle) return json(response, 404, { message: "Veiculo nao encontrado." });
    const body = await readBody(request);
    const device = devices.find((item) => item.id === (body.deviceId || vehicle.tagDeviceId));
    const person = residents.find((item) => item.id === vehicle.personId) || null;
    try {
      const synced = await syncVehicleTag({
        vehicle,
        device,
        person,
        adapter: deviceAdapter,
        controlIdAdapter: CONTROL_ID_ACCESS_ADAPTER,
        login: controlIdLogin,
        loadObjects: controlIdLoadObjects,
        post: controlIdPost,
        ensureUser: ensureControlIdCredentialUser,
        ensureGroup: ensureControlIdUserGroup,
        now
      });
      Object.assign(vehicle, synced.vehiclePatch);
      savePersistentState("vehicle-tag-synced");
      return json(response, 200, { ...synced.result, vehicle });
    } catch (error) {
      vehicle.tagStatus = "ERROR";
      vehicle.updatedAt = now();
      savePersistentState("vehicle-tag-sync-error");
      return json(response, 502, { message: error instanceof Error ? error.message : "Falha ao enviar tag veicular" });
    }
  }

  const removeVehicleTagMatch = url.pathname.match(/^\/api\/vehicles\/([^/]+)\/control-id-tag$/);
  if (request.method === "DELETE" && removeVehicleTagMatch) {
    const vehicle = vehicles.find((item) => item.id === decodeURIComponent(removeVehicleTagMatch[1]));
    if (!vehicle) return json(response, 404, { message: "Veiculo nao encontrado." });
    const body = await readBody(request);
    const device = devices.find((item) => item.id === (body.deviceId || vehicle.tagDeviceId));
    try {
      const removed = await removeVehicleTag({
        vehicle,
        device,
        adapter: deviceAdapter,
        controlIdAdapter: CONTROL_ID_ACCESS_ADAPTER,
        login: controlIdLogin,
        loadObjects: controlIdLoadObjects,
        post: controlIdPost,
        now
      });
      Object.assign(vehicle, removed.vehiclePatch);
      await savePersistentStateAndWait("vehicle-tag-removed");
      return json(response, 200, { ...removed.result, vehicle });
    } catch (error) {
      vehicle.tagStatus = "ERROR";
      vehicle.updatedAt = now();
      savePersistentState("vehicle-tag-remove-error");
      return json(response, 502, { message: error instanceof Error ? error.message : "Falha ao remover tag veicular" });
    }
  }

  const deleteVehicleMatch = url.pathname.match(/^\/api\/vehicles\/([^/]+)$/);
  if (request.method === "DELETE" && deleteVehicleMatch) {
    const index = vehicles.findIndex((vehicle) => vehicle.id === deleteVehicleMatch[1]);
    if (index === -1) return json(response, 404, { message: "Veiculo nao encontrado." });
    const [removed] = vehicles.splice(index, 1);
    await savePersistentStateAndWait("vehicle-deleted");
    return json(response, 200, { ok: true, removed });
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
}

server.listen(port, "0.0.0.0");

async function shutdown() {
  try {
    await postgresSaveQueue;
    await postgresPool?.end();
    niceLinearListeners.forEach((listener) => listener.server?.close());
  } catch {
    // O encerramento continua mesmo se o armazenamento ja estiver indisponivel.
  } finally {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  }
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
