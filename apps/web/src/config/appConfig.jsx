import readXlsxFile from "read-excel-file/browser";
import { apiUrl, API_CACHE_KEY, railwayApiUrl, WEB_PORTER_EXTENSION, WEB_PORTER_PASSWORD } from "./constants.js";
import { condoSections, equipmentIntegrationResources, sections, settingsSections } from "./routes.js";

const emptyData = {
  generatedAt: null,
  session: null,
  condominiums: [],
  units: [],
  residents: [],
  vehicles: [],
  deviceCategories: [],
  permissionProfiles: [],
  devices: [],
  cameras: [],
  actions: [],
  credentials: [],
  credentialSyncJobs: [],
  accessLogs: [],
  unitLogins: [],
  unitInvites: [],
  manufacturerProfiles: [],
  accessRoutes: [],
  companies: [],
  licenses: [],
  billingGateway: {
    provider: "ASAAS",
    environment: "sandbox",
    configured: false,
    webhookConfigured: false
  },
  resources: [],
  resourceConfigurations: [],
  intercomCalls: [],
  extensionStatus: []
};

function normalizeBootstrap(payload = {}) {
  return Object.fromEntries(Object.entries(emptyData).map(([key, fallback]) => {
    const value = payload?.[key];
    return [key, Array.isArray(fallback) ? (Array.isArray(value) ? value : fallback) : (value ?? fallback)];
  }));
}

function readCachedBootstrap() {
  try {
    const raw = window.localStorage.getItem(API_CACHE_KEY);
    const cached = raw ? JSON.parse(raw) : null;
    return cached?.payload ? normalizeBootstrap(cached.payload) : emptyData;
  } catch {
    return emptyData;
  }
}

function parsePositiveInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function condoTotalUnits(source = {}) {
  const safeSource = source || {};
  const groups = parsePositiveInteger(safeSource.structureGroupCount ?? safeSource.floorCount ?? safeSource.blockCount, 0);
  const perGroup = parsePositiveInteger(safeSource.unitsPerGroup ?? safeSource.unitsPerFloor ?? safeSource.unitsPerBlock, 0);
  return groups * perGroup;
}

async function geocodeAddressFields({ address, addressNumber, city, state }) {
  const query = [address, addressNumber, city, state, "Brasil"].filter(Boolean).join(", ");
  if (!query.trim()) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { "Accept": "application/json" } });
  const payload = await response.json().catch(() => []);
  const first = Array.isArray(payload) ? payload[0] : null;
  if (!first?.lat || !first?.lon) return null;
  return { latitude: String(first.lat), longitude: String(first.lon) };
}

const emptyTelephony = {
  enabled: false,
  provider: "NATIVE_SIP",
  sipDomain: "",
  sipWebSocketUrl: "",
  sipTransport: "UDP",
  extension: "",
  extensionPassword: "",
  porterExtension: ""
};

function normalizeWebSocketForWebPhone(value, domain) {
  const cleanDomain = String(domain || "granportalresidency.ddns.net").trim() || "granportalresidency.ddns.net";
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return `wss://${cleanDomain}:8089/ws`;

  try {
    const url = new URL(cleanValue);
    url.protocol = "wss:";
    url.hostname = url.hostname || cleanDomain;
    url.port = "8089";
    if (!url.pathname || url.pathname === "/" || url.pathname === "/sw" || url.pathname === "/wss") {
      url.pathname = "/ws";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return `wss://${cleanDomain}:8089/ws`;
  }
}

function sameText(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}


function credentialPhotoUrl(credential = {}, person = {}) {
  if (person?.photoUrl) {
    return String(person.photoUrl).startsWith("/") ? `${apiUrl}${person.photoUrl}` : person.photoUrl;
  }
  const photoUrl = String(credential?.photoUrl || "").trim();
  if (!photoUrl) return "";
  if (photoUrl.startsWith("data:") || photoUrl.startsWith("https://")) return photoUrl;
  return `${apiUrl}/api/credentials/${encodeURIComponent(credential.id)}/photo`;
}

function equipmentPreviewPhotoUrl(deviceId = "", photoUrl = "") {
  const clean = String(photoUrl || "").trim();
  if (!clean || !deviceId) return "";
  if (clean.startsWith("data:")) return clean;
  return `${apiUrl}/api/devices/${encodeURIComponent(deviceId)}/integration/photo?url=${encodeURIComponent(clean)}`;
}

function callTime(call = {}) {
  return new Date(call.createdAt || call.answeredAt || 0).getTime() || 0;
}

function unitExtension(unit = {}) {
  return String(unit.telephony?.extension || unit.extension || "").trim();
}

function resolveCallUnit(call, allUnits = [], selectedTenantId = "") {
  if (!call) return null;
  const tenantId = call.tenantId || selectedTenantId || "";
  const scopedUnits = tenantId ? allUnits.filter((unit) => unit.tenantId === tenantId) : allUnits;
  const candidates = scopedUnits.length ? scopedUnits : allUnits;

  return candidates.find((unit) => sameText(unit.unitId, call.unitId)) ||
    candidates.find((unit) => sameText(unit.unitNumber, call.unitNumber)) ||
    candidates.find((unit) => call.sourceExtension && unitExtension(unit) === String(call.sourceExtension).trim()) ||
    null;
}

const emptyDeviceForm = {
  id: "",
  category: "access-control",
  manufacturer: "Hikvision",
  name: "",
  model: "",
  ipAddress: "",
  apiProtocol: "http",
  username: "admin",
  password: "",
  apiPort: "80",
  rtspPort: "554",
  channelCount: "",
  controlIdAction: "door",
  controlIdSecBoxId: "",
  controlIdGroupId: "",
  controlIdUhfMode: "EXTENDED",
  niceConnectionMode: "DEVICE_CONNECTS_TCP",
  niceGatewayHealthPath: "/health",
  niceGatewayOpenPath: "/api/nice-linear/open",
  niceDeviceId: "",
  intercomExtension: "",
  intercomType: "FACIAL",
  intercomEnabled: true
};

const controlIdIduhfProfile = {
  model: "iDUHF",
  actionOptions: [
    ["door", "Rele interno do iDUHF"],
    ["sec_box", "Rele externo via SecBox/MAE"]
  ],
  guidance: {
    door: "Use rele interno quando a fechadura ou cancela estiver ligada diretamente ao iDUHF.",
    sec_box: "Use SecBox somente para o modulo externo MAE e informe o ID numerico exibido pelo equipamento.",
    group: "Preencha o grupo no modo standalone para incluir automaticamente usuarios sincronizados no departamento/grupo que ja possui regras e horarios. Deixe vazio no modo online ou quando o servidor controlar a autorizacao.",
    device: "O perfil usa API HTTP na porta 80, sem RTSP, canais de video ou ramal SIP."
  }
};

function controlIdActionOptions(model = "") {
  return model === controlIdIduhfProfile.model
    ? controlIdIduhfProfile.actionOptions
    : [["door", "Rele interno"], ["sec_box", "SecBox"], ["catra", "Catraca"]];
}

function controlIdProfileGuidance(device = {}) {
  if (device.model !== controlIdIduhfProfile.model) return "";
  const actionHint = device.controlIdAction === "sec_box"
    ? controlIdIduhfProfile.guidance.sec_box
    : controlIdIduhfProfile.guidance.door;
  return `${controlIdIduhfProfile.guidance.device} ${actionHint} ${controlIdIduhfProfile.guidance.group}`;
}

const niceLinearModels = [
  "Modulo Guarita MG3000",
  "Modulo Guarita IP",
  "Controladora Ethernet II",
  "Controladora Ethernet III"
];

function isNiceLinearManufacturer(value = "") {
  return ["Nice/Linear", "Nice Guarita", "Linear HCS"].includes(value);
}

function niceLinearProfileGuidance(device = {}) {
  if (!isNiceLinearManufacturer(device.manufacturer)) return "";
  if (device.niceConnectionMode === "HTTP_GATEWAY") {
    return "Modo bridge: informe o endereco do gateway HTTP, as rotas e um token no campo Senha. A abertura sera enviada ao bridge e os eventos podem retornar pelo webhook do Condo Access.";
  }
  return "Modo usado nas instalacoes Nice/Linear: o equipamento inicia a conexao. Configure nele o IP do servidor Condo Access e a mesma porta de escuta informada aqui. O status e os pacotes recebidos ficam disponiveis para diagnostico; o comando binario de abertura depende do protocolo/SDK da Nice.";
}

const emptyLicenseForm = {
  id: "",
  companyId: "",
  tenantId: "",
  contract: "",
  name: "",
  cnpj: "",
  type: "Condominio",
  structure: "Residencial",
  attendance: "Full",
  city: "",
  residents: "0",
  extensionLimit: "0",
  resourceIds: []
};

const emptyCompanyForm = {
  id: "",
  name: "",
  document: "",
  status: "ACTIVE",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  login: "",
  logoUrl: "",
  billingModel: "PER_CONDOMINIUM",
  maxCondominiums: "1",
  baseMonthlyPrice: "0",
  condominiumUnitPrice: "0",
  voipBillingModel: "PER_EXTENSION",
  includedExtensions: "0",
  maxExtensions: "0",
  extensionUnitPrice: "0",
  resourceIds: []
};

const emptyCameraForm = {
  id: "",
  deviceId: "",
  description: "",
  type: "NVR",
  manufacturer: "Hikvision",
  model: "",
  host: "",
  rtspPort: "554",
  httpPort: "80",
  rtspPath: "",
  username: "admin",
  password: "",
  channel: "1",
  channelCount: "16",
  channelDescription: "",
  stream: "SUB",
  aspectRatio: "WIDESCREEN",
  loadMethod: "HLS_GATEWAY",
  photoCaptureEnabled: false
};

const emptyActionForm = {
  id: "",
  name: "",
  manufacturer: "Hikvision",
  deviceId: "",
  relay: "1",
  route: "",
  status: "ACTIVE"
};

const emptyCredentialForm = {
  id: "",
  tenantId: "",
  unitId: "",
  personId: "",
  type: "APP",
  value: "",
  valueLabel: "",
  deviceId: "",
  photoUrl: ""
};

const emptyVehicleForm = {
  id: "",
  unitId: "",
  personId: "",
  plate: "",
  brand: "",
  model: "",
  color: "",
  type: "CARRO",
  tagValue: "",
  tagMode: "EXTENDED",
  tagDeviceId: "",
  tagExternalId: "",
  tagUserId: "",
  tagStatus: "",
  tagSyncedAt: "",
  notes: ""
};

const resourceConfigurationFields = {
  voicy: [
    { id: "callLabel", label: "Nome exibido da portaria", type: "text", defaultValue: "Portaria" },
    { id: "defaultAudioRoute", label: "Audio inicial", type: "select", options: [["EARPIECE", "Auricular"], ["SPEAKER", "Viva-voz"]], defaultValue: "EARPIECE" },
    { id: "allowResidentCalls", label: "Permitir ligacao do morador", type: "boolean", defaultValue: true }
  ],
  clickApprove: [
    { id: "approvalTimeoutSeconds", label: "Tempo para aprovar (segundos)", type: "number", defaultValue: "30" },
    { id: "requireCamera", label: "Exigir camera na aprovacao", type: "boolean", defaultValue: true },
    { id: "requireReason", label: "Exigir motivo ao negar", type: "boolean", defaultValue: false }
  ],
  invites: [
    { id: "defaultValidityHours", label: "Validade padrao (horas)", type: "number", defaultValue: "24" },
    { id: "allowRecurring", label: "Permitir convite recorrente", type: "boolean", defaultValue: true },
    { id: "requireDocument", label: "Exigir documento do visitante", type: "boolean", defaultValue: false },
    { id: "sendWhatsApp", label: "Oferecer envio por WhatsApp", type: "boolean", defaultValue: true }
  ],
  notices: [
    { id: "defaultPriority", label: "Prioridade padrao", type: "select", options: [["NORMAL", "Normal"], ["IMPORTANT", "Importante"], ["URGENT", "Urgente"]], defaultValue: "NORMAL" },
    { id: "allowAttachments", label: "Permitir anexos", type: "boolean", defaultValue: true },
    { id: "notifyResidents", label: "Notificar moradores", type: "boolean", defaultValue: true }
  ],
  maintenance: [
    { id: "categories", label: "Categorias (separadas por virgula)", type: "text", defaultValue: "Eletrica,Hidraulica,Elevador,Limpeza,Geral" },
    { id: "allowPhoto", label: "Permitir foto", type: "boolean", defaultValue: true },
    { id: "notifyManager", label: "Notificar responsavel", type: "boolean", defaultValue: true }
  ],
  personalData: [
    { id: "allowProfilePhoto", label: "Permitir foto de perfil", type: "boolean", defaultValue: true },
    { id: "editableFields", label: "Campos editaveis", type: "text", defaultValue: "name,email,phone,cpf,rg,birthDate,photoUrl" },
    { id: "requireApproval", label: "Exigir aprovacao da administracao", type: "boolean", defaultValue: false }
  ],
  unitData: [
    { id: "editableFields", label: "Campos editaveis", type: "text", defaultValue: "ownerName,ownerDocument,documents" },
    { id: "showDocuments", label: "Exibir documentos da unidade", type: "boolean", defaultValue: true }
  ],
  residents: [
    { id: "requireCpf", label: "Exigir CPF", type: "boolean", defaultValue: true },
    { id: "requirePhoto", label: "Exigir foto", type: "boolean", defaultValue: false },
    { id: "requireApproval", label: "Exigir aprovacao da administracao", type: "boolean", defaultValue: true }
  ],
  temporaryFace: [
    { id: "defaultValidityHours", label: "Validade padrao (horas)", type: "number", defaultValue: "8" },
    { id: "maxValidityHours", label: "Validade maxima (horas)", type: "number", defaultValue: "72" },
    { id: "autoDelete", label: "Excluir automaticamente no equipamento", type: "boolean", defaultValue: true }
  ],
  qrScanner: [
    { id: "validityMinutes", label: "Validade da leitura (minutos)", type: "number", defaultValue: "5" },
    { id: "allowOffline", label: "Permitir validacao offline", type: "boolean", defaultValue: false },
    { id: "notifyOnRead", label: "Notificar ao ler QR Code", type: "boolean", defaultValue: true }
  ],
  deliveries: [
    { id: "requirePhoto", label: "Exigir foto da entrega", type: "boolean", defaultValue: true },
    { id: "requireRecipientConfirmation", label: "Exigir confirmacao do recebedor", type: "boolean", defaultValue: true },
    { id: "notifyResident", label: "Notificar morador", type: "boolean", defaultValue: true }
  ],
  shiftLog: [
    { id: "requireClosingNote", label: "Exigir observacao no encerramento", type: "boolean", defaultValue: true },
    { id: "allowAttachments", label: "Permitir anexos", type: "boolean", defaultValue: true }
  ],
  nomenclatures: [
    { id: "residentLabel", label: "Nome para morador", type: "text", defaultValue: "Morador" },
    { id: "unitLabel", label: "Nome para unidade", type: "text", defaultValue: "Unidade" },
    { id: "porterLabel", label: "Nome para portaria", type: "text", defaultValue: "Portaria" }
  ]
};

function defaultResourceSettings(resourceId) {
  return Object.fromEntries((resourceConfigurationFields[resourceId] || []).map((field) => [field.id, field.defaultValue]));
}


function intelbrasDeviceDefaults(category, manufacturer) {
  if (isNiceLinearManufacturer(manufacturer) && ["access-control", "iot"].includes(category)) {
    return {
      model: "Modulo Guarita MG3000",
      apiProtocol: "tcp",
      apiPort: "",
      rtspPort: "0",
      channelCount: "0",
      niceConnectionMode: "DEVICE_CONNECTS_TCP",
      niceGatewayHealthPath: "/health",
      niceGatewayOpenPath: "/api/nice-linear/open",
      niceDeviceId: "",
      intercomEnabled: false
    };
  }

  if (manufacturer === "Control iD" && category === "access-control") {
    return {
      model: "iDUHF",
      apiProtocol: "http",
      apiPort: "80",
      rtspPort: "0",
      channelCount: "0",
      controlIdAction: "door",
      controlIdSecBoxId: "",
      controlIdGroupId: "",
      controlIdUhfMode: "EXTENDED",
      intercomType: "FACIAL",
      intercomEnabled: true
    };
  }

  if (manufacturer === "Hikvision") {
    if (category === "cameras") {
      return {
        model: "DS-7616NI-E2 / 16P",
        apiProtocol: "http",
        apiPort: "80",
        rtspPort: "554",
        channelCount: "16",
        intercomEnabled: false
      };
    }

    if (category === "access-control") {
      return {
        model: "DS-K1T342MWX",
        apiProtocol: "http",
        apiPort: "80",
        rtspPort: "554",
        channelCount: "",
        intercomType: "FACIAL",
        intercomEnabled: true
      };
    }
  }

  if (manufacturer !== "Intelbras") return {};
  if (category === "cameras") {
    return {
      model: "MHDX 3116-C",
      apiProtocol: "http",
      apiPort: "80",
      rtspPort: "554",
      channelCount: "16",
      intercomEnabled: false
    };
  }

  if (category === "access-control") {
    return {
      model: "SS 3532 MF W",
      apiProtocol: "http",
      apiPort: "80",
      rtspPort: "554",
      channelCount: "",
      intercomType: "FACIAL",
      intercomEnabled: true
    };
  }

  return {};
}

function intelbrasModelDefaults(model) {
  if (niceLinearModels.includes(model)) {
    return {
      category: "access-control",
      manufacturer: "Nice/Linear",
      model,
      apiProtocol: "tcp",
      apiPort: "",
      rtspPort: "0",
      channelCount: "0",
      niceConnectionMode: "DEVICE_CONNECTS_TCP",
      niceGatewayHealthPath: "/health",
      niceGatewayOpenPath: "/api/nice-linear/open",
      niceDeviceId: "",
      intercomEnabled: false
    };
  }

  if (model === "iDUHF") {
    return {
      category: "access-control",
      manufacturer: "Control iD",
      model,
      apiProtocol: "http",
      apiPort: "80",
      rtspPort: "0",
      channelCount: "0",
      controlIdAction: "door",
      controlIdSecBoxId: "",
      controlIdGroupId: "",
      controlIdUhfMode: "EXTENDED",
      intercomType: "UHF",
      intercomEnabled: false
    };
  }

  if (model === "DS-7616NI-E2 / 16P") {
    return {
      category: "cameras",
      manufacturer: "Hikvision",
      model,
      apiProtocol: "http",
      apiPort: "80",
      rtspPort: "554",
      channelCount: "16",
      intercomEnabled: false
    };
  }

  if (model === "DS-K1T342MWX") {
    return {
      category: "access-control",
      manufacturer: "Hikvision",
      model,
      apiProtocol: "http",
      apiPort: "80",
      rtspPort: "554",
      channelCount: "",
      intercomType: "FACIAL",
      intercomEnabled: true
    };
  }

  if (model === "MHDX 3116-C") {
    return {
      category: "cameras",
      manufacturer: "Intelbras",
      model,
      apiProtocol: "http",
      apiPort: "80",
      rtspPort: "554",
      channelCount: "16",
      intercomEnabled: false
    };
  }

  if (model === "SS 3532 MF W") {
    return {
      category: "access-control",
      manufacturer: "Intelbras",
      model,
      apiProtocol: "http",
      apiPort: "80",
      rtspPort: "554",
      channelCount: "",
      intercomType: "FACIAL",
      intercomEnabled: true
    };
  }

  return { model };
}

function homologatedModelOptions(manufacturer, categoryOrType) {
  const key = String(categoryOrType || "").toLowerCase();
  if (manufacturer === "Hikvision") {
    if (key.includes("camera") || key === "dvr" || key === "nvr") return ["DS-7616NI-E2 / 16P"];
    if (key.includes("access") || key.includes("facial")) return ["DS-K1T342MWX"];
    return ["DS-K1T342MWX", "DS-7616NI-E2 / 16P"];
  }

  if (manufacturer === "Intelbras") {
    if (key.includes("camera") || key === "dvr" || key === "nvr") return ["MHDX 3116-C"];
    if (key.includes("access") || key.includes("facial")) return ["SS 3532 MF W"];
    return ["SS 3532 MF W", "MHDX 3116-C"];
  }

  if (manufacturer === "Control iD") {
    if (key.includes("access") || key.includes("uhf") || key.includes("vehicle")) return ["iDUHF"];
    return ["iDUHF"];
  }

  if (isNiceLinearManufacturer(manufacturer)) {
    if (key.includes("access") || key.includes("iot") || key.includes("gateway") || key.includes("control")) {
      return niceLinearModels;
    }
    return niceLinearModels;
  }

  return [];
}

function intelbrasCameraDefaults(type, manufacturer) {
  if (manufacturer === "Hikvision") {
    if (type === "DVR" || type === "NVR") {
      return {
        model: "DS-7616NI-E2 / 16P",
        rtspPort: "554",
        httpPort: "80",
        channelCount: "16",
        stream: "SUB",
        loadMethod: "HLS_GATEWAY"
      };
    }

    if (type === "FACIAL") {
      return {
        model: "DS-K1T342MWX",
        rtspPort: "554",
        httpPort: "80",
        channelCount: "1",
        stream: "SUB",
        loadMethod: "HLS_GATEWAY"
      };
    }
  }

  if (manufacturer !== "Intelbras") return {};
  if (type === "DVR" || type === "NVR") {
    return {
      model: "MHDX 3116-C",
      rtspPort: "554",
      httpPort: "80",
      channelCount: "16",
      stream: "SUB",
      loadMethod: "HLS_GATEWAY"
    };
  }

  if (type === "FACIAL") {
    return {
      model: "SS 3532 MF W",
      rtspPort: "554",
      httpPort: "80",
      channelCount: "1",
      stream: "SUB",
      loadMethod: "HLS_GATEWAY"
    };
  }

  return {};
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(";")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function readImportRows(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    const text = await file.text();
    const delimiter = text.includes(";") ? ";" : ",";
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const headers = (lines.shift() || "").split(delimiter).map((header) => header.trim());
    return lines.map((line) => {
      const values = line.split(delimiter).map((value) => value.trim());
      return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    });
  }

  const rows = await readXlsxFile(file);
  const headers = (rows.shift() || []).map((header) => String(header || "").trim());
  return rows
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] == null ? "" : String(row[index]).trim()])));
}


function faceImportSelectionKey(item = {}) {
  return item.payload?.recordId || `${item.row}-${item.payload?.value || ""}`;
}

function importSelectionBase(item = {}, selection = {}) {
  return {
    key: faceImportSelectionKey(item),
    row: item.row,
    recordId: item.payload?.recordId || "",
    type: item.payload?.type || "",
    value: item.payload?.value || "",
    selected: selection.selected !== false,
    unitId: selection.unitId || item.unitId || "",
    unitNumber: selection.unitNumber ?? item.payload?.unitNumber ?? "",
    blockName: selection.blockName ?? item.payload?.blockName ?? ""
  };
}

export {
  railwayApiUrl,
  apiUrl,
  WEB_PORTER_EXTENSION,
  WEB_PORTER_PASSWORD,
  sections,
  condoSections,
  settingsSections,
  equipmentIntegrationResources,
  emptyData,
  API_CACHE_KEY,
  normalizeBootstrap,
  readCachedBootstrap,
  parsePositiveInteger,
  condoTotalUnits,
  geocodeAddressFields,
  emptyTelephony,
  normalizeWebSocketForWebPhone,
  sameText,
  credentialPhotoUrl,
  equipmentPreviewPhotoUrl,
  callTime,
  unitExtension,
  resolveCallUnit,
  emptyDeviceForm,
  emptyLicenseForm,
  emptyCompanyForm,
  emptyCameraForm,
  emptyActionForm,
  emptyCredentialForm,
  emptyVehicleForm,
  resourceConfigurationFields,
  defaultResourceSettings,
  controlIdActionOptions,
  controlIdProfileGuidance,
  isNiceLinearManufacturer,
  niceLinearProfileGuidance,
  intelbrasDeviceDefaults,
  intelbrasModelDefaults,
  homologatedModelOptions,
  intelbrasCameraDefaults,
  formatDateTime,
  csvCell,
  downloadCsv,
  readImportRows,
  faceImportSelectionKey,
  importSelectionBase
};
