import Hls from "hls.js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import readXlsxFile from "read-excel-file/browser";
import { Invitation, Inviter, Registerer, RegistererState, SessionState, UserAgent } from "sip.js";
import {
  Activity,
  BadgeCheck,
  Building2,
  Camera,
  ClipboardList,
  CreditCard,
  FileKey2,
  Grid3X3,
  Home,
  KeySquare,
  LogIn,
  MoreVertical,
  PhoneCall,
  PhoneOff,
  Plus,
  RadioTower,
  RefreshCw,
  Save,
  Search,
  ServerCog,
  Settings,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
  UserPlus,
  Users,
  WifiOff
} from "lucide-react";
import Logo from "./logo.png";
import "./styles.css";

const railwayApiUrl = "https://api-production-441f.up.railway.app";
const apiUrl = import.meta.env.VITE_API_URL || railwayApiUrl;
const WEB_PORTER_EXTENSION = "9000";
const WEB_PORTER_PASSWORD = "CondoAccess@2026";

const sections = [
  { id: "dashboard", label: "Dashboard", icon: Activity },
  { id: "condominiums", label: "Condominios", icon: Building2 },
  { id: "remotePorter", label: "Portaria Remota", icon: PhoneCall }
];

const condoSections = [
  { id: "syndic", label: "Sindico", icon: ShieldCheck },
  { id: "units", label: "Unidades", icon: Home },
  { id: "residents", label: "Pessoas", icon: UserRound },
  { id: "devices", label: "Equipamentos", icon: RadioTower },
  { id: "credentials", label: "Credenciais", icon: BadgeCheck },
  { id: "permissions", label: "Permissoes", icon: KeySquare },
  { id: "resources", label: "Recursos", icon: ClipboardList },
  { id: "sdk", label: "SDK equipamentos", icon: ServerCog }
];

const settingsSections = [
  { id: "licenses", label: "Licencas", icon: FileKey2 },
  { id: "payments", label: "Pagamentos", icon: CreditCard }
];

const equipmentIntegrationResources = [
  ["events", "Ler eventos", Activity],
  ["credentials", "Buscar credenciais", BadgeCheck],
  ["schedules", "Horarios", ClipboardList],
  ["faces", "Faciais", UserRound],
  ["users", "Usuarios", Users]
];

const emptyData = {
  generatedAt: null,
  session: null,
  condominiums: [],
  units: [],
  residents: [],
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
  licenses: [],
  resources: [],
  intercomCalls: [],
  extensionStatus: []
};

const API_CACHE_KEY = "condo-clean-api-cache";

function readCachedBootstrap() {
  try {
    const raw = window.localStorage.getItem(API_CACHE_KEY);
    const cached = raw ? JSON.parse(raw) : null;
    return cached?.payload ? { ...emptyData, ...cached.payload } : emptyData;
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
  intercomExtension: "",
  intercomType: "FACIAL",
  intercomEnabled: true
};

const emptyLicenseForm = {
  id: "",
  contract: "DINAMUS SERVICOS DE SEGURANCA PRIVADA",
  name: "",
  cnpj: "",
  type: "Condominio",
  structure: "Residencial",
  attendance: "Full",
  city: "",
  residents: "0"
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
  deviceId: ""
};

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function intelbrasDeviceDefaults(category, manufacturer) {
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

function StatusBanner({ status, error, lastSyncAt }) {
  if (status !== "offline" && !error) return null;

  return (
    <div className="sync-banner offline">
      <div>
        <WifiOff size={20} />
        <strong>Nao foi possivel atualizar</strong>
        <span>Ultima sincronizacao {formatDateTime(lastSyncAt)}</span>
      </div>
      <small>{error || "Verifique a conexao com a API e tente novamente."}</small>
    </div>
  );
}

function cameraStreamKey(camera, channel) {
  if (!camera) return "";
  const selectedChannel = Number(channel || camera.channel || camera.activeChannels?.[0]?.channel || 1);
  return selectedChannel ? `${camera.id}--ch-${selectedChannel}` : camera.id;
}

function cameraSnapshotUrl(camera, channel) {
  if (!camera) return "";
  const selectedChannel = Number(channel || camera.channel || camera.activeChannels?.[0]?.channel || 1);
  return `${apiUrl}/api/cameras/${camera.id}/snapshot.jpg?channel=${selectedChannel}`;
}

function cameraChannels(camera) {
  const channels = camera?.activeChannels?.length
    ? camera.activeChannels
    : [{ channel: camera?.channel || 1, description: camera?.description || "Canal 1" }];
  return channels
    .map((item) => ({ channel: Number(item.channel || 1), description: item.description || `Canal ${item.channel || 1}` }))
    .sort((a, b) => a.channel - b.channel);
}

function cameraMosaicLabel(item) {
  const base = item.camera.groupName || item.camera.description || item.camera.name || "Camera";
  return `${base.slice(0, 14)} C${item.channel}`;
}

function faceImportSelectionKey(item = {}) {
  return item.payload?.recordId || `${item.row}-${item.payload?.value || ""}`;
}

function groupCameraDevices(cameras) {
  const groups = new Map();
  cameras.forEach((camera) => {
    const key = camera.deviceId || camera.groupId || `${camera.tenantId || ""}-${camera.host || camera.ipAddress || ""}-${camera.rtspPort || ""}-${camera.type || ""}-${camera.manufacturer || ""}`;
    if (!groups.has(key)) {
      groups.set(key, { ...camera, id: camera.id, groupKey: key, activeChannels: [], groupedIds: [] });
    }
    const group = groups.get(key);
    group.groupedIds.push(camera.id);
    const sourceChannels = camera.activeChannels?.length
      ? camera.activeChannels
      : [{ channel: camera.channel || group.activeChannels.length + 1, description: camera.description || camera.name }];
    sourceChannels.forEach((channel) => {
      const channelNumber = Number(channel.channel || 1);
      if (!group.activeChannels.some((item) => Number(item.channel) === channelNumber)) {
        group.activeChannels.push({ channel: channelNumber, description: channel.description || `Canal ${channelNumber}` });
      }
    });
  });

  return Array.from(groups.values()).map((camera) => ({
    ...camera,
    activeChannels: cameraChannels(camera)
  }));
}

function CameraPreview({ camera, channel, onFrameClick, frameLabel }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState("Carregando camera...");
  const selectedChannel = Number(channel || camera?.channel || camera?.activeChannels?.[0]?.channel || 1);
  const streamKey = cameraStreamKey(camera, selectedChannel);
  const streamUrl = camera ? `${apiUrl}/streams/${streamKey}/index.m3u8` : "";

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return undefined;

    let hls = null;
    let fallbackTimer = null;
    let usingFallback = false;
    const fallbackDelayMs = 25000;

    setStatus("Abrindo stream HLS da API local...");

    function markConnected() {
      setStatus("Stream conectado");
    }

    function startHlsFallback(reason = "timeout") {
      if (usingFallback) return;
      usingFallback = true;

      if (!Hls.isSupported()) {
        setStatus(reason === "timeout" ? "Aguardando player nativo do navegador..." : "Navegador sem suporte HLS. Abra pelo botao HLS ou VLC.");
        return;
      }

      setStatus("Abrindo stream com fallback HLS.js...");
      video.removeAttribute("src");
      video.load();

      hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 10,
        liveSyncDurationCount: 2
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        markConnected();
        void video.play().catch(() => undefined);
      });
      hls.on(Hls.Events.FRAG_BUFFERED, markConnected);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setStatus("Reconectando stream HLS...");
          hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          setStatus("Recuperando decodificacao do video...");
          hls.recoverMediaError();
          return;
        }
        setStatus("Falha ao carregar. Verifique senha RTSP e FFmpeg.");
      });
    }

    function handleLoadedMetadata() {
      markConnected();
      void video.play().catch(() => undefined);
    }

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("playing", markConnected);
    const handleVideoError = () => startHlsFallback("error");

    video.addEventListener("error", handleVideoError);

    video.src = streamUrl;
    video.load();
    void video.play().catch(() => undefined);

    fallbackTimer = window.setTimeout(() => {
      if (video.readyState < 2) startHlsFallback();
    }, fallbackDelayMs);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("playing", markConnected);
      video.removeEventListener("error", handleVideoError);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
      if (streamKey) {
        void fetch(`${apiUrl}/streams/${encodeURIComponent(streamKey)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
      }
    };
  }, [streamKey, streamUrl]);

  if (!camera) {
    return <div className="empty-state">Selecione uma camera do condominio.</div>;
  }

  const failed = status.startsWith("Falha") || status.startsWith("Nao foi possivel");
  const connected = status === "Stream conectado";
  const previewImageUrl = cameraSnapshotUrl(camera, selectedChannel);

  return (
    <div className="camera-preview">
      <div
        className={`camera-preview-frame ${connected ? "connected" : "loading"} ${failed ? "failed" : ""} ${onFrameClick ? "clickable" : ""}`}
        role={onFrameClick ? "button" : undefined}
        tabIndex={onFrameClick ? 0 : undefined}
        onClick={onFrameClick}
        onKeyDown={(event) => {
          if (onFrameClick && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onFrameClick();
          }
        }}
        aria-label={frameLabel}
      >
        <img className="camera-preview-snapshot" src={previewImageUrl} alt={camera.description || camera.name || "Camera"} />
        <video ref={videoRef} controls muted playsInline autoPlay />
        <span className={`camera-live-badge ${connected ? "online" : failed ? "offline" : ""}`}>
          {connected ? "AO VIVO" : failed ? "Falha ao carregar" : "Carregando"}
        </span>
      </div>
      <div className="camera-preview-meta">
        <strong>{camera.description || camera.name}</strong>
        <span>{camera.host}:{camera.rtspPort} - Canal {selectedChannel}</span>
        <small>{status}</small>
      </div>
      <div className="camera-preview-actions">
        <a className="secondary-button" href={`${apiUrl}/api/cameras/${camera.id}/vlc.m3u`} download><Camera size={16} /> Abrir no VLC</a>
        <a className="secondary-button" href={streamUrl} target="_blank" rel="noreferrer"><Camera size={16} /> HLS</a>
      </div>
    </div>
  );
}

function CameraTile({ camera, channel, description, index, onSelect }) {
  const videoRef = useRef(null);
  const selectedChannel = Number(channel || camera?.channel || camera?.activeChannels?.[0]?.channel || index + 1);
  const streamKey = cameraStreamKey(camera, selectedChannel);
  const streamUrl = camera ? `${apiUrl}/streams/${streamKey}/index.m3u8` : "";
  const snapshotUrl = cameraSnapshotUrl(camera, selectedChannel);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return undefined;

    let hls = null;
    let mounted = true;

    setStatus("loading");

    function markReady() {
      if (mounted) setStatus("online");
    }

    function markFailed() {
      if (mounted) setStatus("offline");
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.load();
      void video.play().catch(markFailed);
    } else if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 4,
        liveSyncDurationCount: 2,
        maxBufferLength: 8
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().then(markReady).catch(markFailed));
      hls.on(Hls.Events.FRAG_BUFFERED, markReady);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        markFailed();
      });
    } else {
      markFailed();
    }

    video.addEventListener("playing", markReady);
    video.addEventListener("error", markFailed);

    return () => {
      mounted = false;
      video.removeEventListener("playing", markReady);
      video.removeEventListener("error", markFailed);
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
      if (streamKey) {
        void fetch(`${apiUrl}/streams/${encodeURIComponent(streamKey)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
      }
    };
  }, [streamKey, streamUrl]);

  if (!camera) return null;

  return (
    <button className={`camera-tile live-tile tile-tone-${index % 4}`} type="button" onClick={onSelect}>
      <img className="camera-tile-snapshot" src={snapshotUrl} alt={description || camera.description || camera.name || `Camera ${index + 1}`} loading="eager" />
      <video ref={videoRef} className="camera-tile-video" muted playsInline autoPlay />
      <span className="camera-tile-channel">Canal {selectedChannel}</span>
      <span className={`camera-tile-live ${status}`}>{status === "online" ? "AO VIVO" : status === "offline" ? "Falha" : "Carregando"}</span>
      <strong>{description || camera.description || camera.name || `Camera ${index + 1}`}</strong>
    </button>
  );
}

function Pagination({ page, totalPages, onPage }) {
  return (
    <div className="pagination-bar">
      <button className="secondary-button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
      <span>Pagina {page} de {totalPages}</span>
      <button className="secondary-button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Proxima</button>
    </div>
  );
}

function usePaged(items, pageSize = 6) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = items.slice((safePage - 1) * pageSize, safePage * pageSize);
  return { page: safePage, setPage, totalPages, pageItems };
}

function Metric({ label, value, icon: Icon }) {
  return (
    <article className="metric">
      <Icon size={22} />
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function LocalLogin({ onLogin }) {
  const [mode, setMode] = useState("choice");
  const [email, setEmail] = useState("agpsistemascorp@gmail.com");
  const [password, setPassword] = useState("");

  if (mode === "choice") {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="login-brand">
            <img src={Logo} alt="Condo Access" style={{ width: 44, height: 44, objectFit: "contain" }} />
            <div><strong>Condo Access</strong><span>Acesso seguro</span></div>
          </div>
          <button onClick={() => setMode("login")}><LogIn size={18} />Ja sou cliente</button>
          <button className="secondary-button" onClick={() => setMode("signup")}><UserPlus size={18} />Quero me cadastrar</button>
        </section>
      </main>
    );
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={(event) => {
        event.preventDefault();
        onLogin({ email, name: "Master Administrador", role: "SUPER_ADMIN" });
      }}>
        <div className="login-brand">
          <img src={Logo} alt="Condo Access" style={{ width: 44, height: 44, objectFit: "contain" }} />
          <div><strong>Condo Access</strong><span>{mode === "signup" ? "Cadastro inicial" : "Acesso seguro"}</span></div>
        </div>
        <Field label="E-mail"><input value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Senha"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
        {mode === "signup" && <div className="form-hint">Fluxo local de demonstracao. Na API real, este cadastro cria ou solicita acesso ao condominio.</div>}
        <button type="submit"><LogIn size={18} />Entrar</button>
        <button className="secondary-button" type="button" onClick={() => setMode("choice")}>Voltar</button>
      </form>
    </main>
  );
}

function CameraConfig({ cameras, devices = [], form, setForm, showForm, onSave, onEdit, onNew, onDelete }) {
  const isMultiChannel = form.type === "DVR" || form.type === "NVR";
  const cameraModelOptions = homologatedModelOptions(form.manufacturer, form.type);
  return (
    <section className="config-stack">
      {showForm && <form className="nested-form" onSubmit={onSave}>
        <div className="panel-heading compact-heading">
          <h2>{form.id ? "Editar camera" : "Nova camera"}</h2>
          <div className="toolbar-actions compact-actions">
            {form.id && <button className="secondary-button" type="button" onClick={onNew}><Plus size={16} /> Nova</button>}
            <button type="submit"><Save size={16} /> Salvar camera</button>
          </div>
        </div>
        <div className="form-hint">Cadastre Camera IP como canal unico, ou DVR/NVR multicanal como um equipamento com lista de canais. A API entrega HLS por canal para Web/APK e mantem RTSP sob demanda.</div>
        <div className="form-grid">
          <Field label="Equipamento"><select name="deviceId" value={form.deviceId || ""} onChange={(event) => {
            const device = devices.find((item) => item.id === event.target.value);
            setForm((current) => ({
              ...current,
              deviceId: event.target.value,
              manufacturer: device?.manufacturer || current.manufacturer,
              model: device?.model || current.model,
              type: device?.category === "cameras" ? "DVR" : current.type,
              host: device?.ipAddress || current.host,
              rtspPort: String(device?.rtspPort || current.rtspPort),
              httpPort: String(device?.apiPort || current.httpPort),
              username: device?.username || current.username,
              channelCount: String(device?.channelCount || current.channelCount),
              channelDescription: current.channelDescription || device?.name || ""
            }));
          }}><option value="">Sem vinculo</option>{devices.filter((device) => device.category === "cameras" || device.channelCount).map((device) => <option key={device.id} value={device.id}>{device.name} - {device.model || device.manufacturer}</option>)}</select></Field>
          <Field label="Descricao"><input name="description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></Field>
          <Field label="Fabricante"><select name="manufacturer" value={form.manufacturer} onChange={(event) => setForm((current) => ({ ...current, manufacturer: event.target.value, ...intelbrasCameraDefaults(current.type, event.target.value) }))}><option>Hikvision</option><option>Intelbras</option><option>Uniview</option><option>Tecvoz</option><option>Motorola</option><option>Anko</option><option>Master Digital</option><option>TRX</option><option>ONVIF</option><option>RTSP Generico</option><option>Control iD</option><option>Linear HCS</option><option>Bravas</option><option>SIM Next Cloud</option><option>Generico</option></select></Field>
          <Field label="Modelo homologacao">{cameraModelOptions.length
            ? <select name="model" value={form.model || ""} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}><option value="">Selecione o modelo</option>{cameraModelOptions.map((model) => <option key={model} value={model}>{model}</option>)}</select>
            : <input name="model" value={form.model || ""} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} placeholder="Modelo do equipamento" />}</Field>
          <Field label="Tipo"><select name="type" value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value, channelCount: event.target.value === "CAMERA_IP" ? "1" : current.channelCount || "16", ...intelbrasCameraDefaults(event.target.value, current.manufacturer) }))}><option value="CAMERA_IP">Camera IP</option><option value="DVR">DVR multicanal</option><option value="NVR">NVR multicanal</option><option value="VIDEO_PORTEIRO">Video porteiro</option><option value="FACIAL">Facial</option><option value="CLOUD">Cloud</option></select></Field>
          <Field label="IP / DDNS"><input name="host" value={form.host} onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))} /></Field>
          <Field label="Porta RTSP"><input name="rtspPort" value={form.rtspPort} onChange={(event) => setForm((current) => ({ ...current, rtspPort: event.target.value }))} /></Field>
          <Field label="Porta HTTP"><input name="httpPort" value={form.httpPort} onChange={(event) => setForm((current) => ({ ...current, httpPort: event.target.value }))} /></Field>
          <Field label="Path RTSP"><input name="rtspPath" value={form.rtspPath || ""} onChange={(event) => setForm((current) => ({ ...current, rtspPath: event.target.value }))} placeholder="/Streaming/channels/101" /></Field>
          <Field label="Usuario"><input name="username" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} /></Field>
          <Field label="Senha"><input name="password" type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} /></Field>
          <Field label="Canal inicial"><input name="channel" value={form.channel} onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value }))} /></Field>
          <Field label="Quantidade de canais"><input name="channelCount" disabled={form.id || !isMultiChannel} value={isMultiChannel ? form.channelCount : "1"} onChange={(event) => setForm((current) => ({ ...current, channelCount: event.target.value }))} /></Field>
          <Field label="Descricao base"><input name="channelDescription" value={form.channelDescription} onChange={(event) => setForm((current) => ({ ...current, channelDescription: event.target.value }))} placeholder="Ex.: NVR portaria, garagem, torre A" /></Field>
          <Field label="Stream"><select name="stream" value={form.stream} onChange={(event) => setForm((current) => ({ ...current, stream: event.target.value }))}><option value="MAIN">Principal</option><option value="SUB">Substream</option></select></Field>
          <Field label="Proporcao"><select name="aspectRatio" value={form.aspectRatio} onChange={(event) => setForm((current) => ({ ...current, aspectRatio: event.target.value }))}><option value="WIDESCREEN">16:9</option><option value="STANDARD">4:3</option><option value="PORTRAIT">Vertical</option></select></Field>
          <Field label="Metodo no app"><select name="loadMethod" value={form.loadMethod} onChange={(event) => setForm((current) => ({ ...current, loadMethod: event.target.value }))}><option value="SNAPSHOT_TEMPO_REAL">RTSP tempo real</option><option value="HLS_GATEWAY">HLS pela API</option><option value="CLOUD">Cloud/fabricante</option></select></Field>
          <Field label="Captura de foto"><select name="photoCaptureEnabled" value={form.photoCaptureEnabled ? "true" : "false"} onChange={(event) => setForm((current) => ({ ...current, photoCaptureEnabled: event.target.value === "true" }))}><option value="false">Desativada</option><option value="true">Ativada</option></select></Field>
        </div>
      </form>}
      {cameras.length ? (
        <div className="camera-card-grid">
          {cameras.map((camera) => (
            <article className="config-card camera-card" key={camera.id}>
              <header>
                <div>
                  <strong>{camera.description || camera.name}</strong>
                  <span>{camera.manufacturer} {camera.model || ""} - {camera.type}</span>
                </div>
                <span className={`status ${camera.status === "ONLINE" ? "" : "offline"}`}>{camera.status === "ONLINE" ? "Online" : "Offline"}</span>
              </header>
              <div className="summary-list">
                <span><strong>Host</strong>{camera.host || camera.ipAddress || "-"}</span>
                <span><strong>Portas</strong>RTSP {camera.rtspPort} / HTTP {camera.httpPort}</span>
                <span><strong>Canais ativos</strong>{cameraChannels(camera).length}</span>
                <span><strong>Stream</strong>{camera.stream}</span>
                <span><strong>Metodo</strong>{camera.loadMethod}</span>
                <span><strong>RTSP no APK</strong>{camera.passwordSet ? "Pronto" : "Salvar senha"}</span>
              </div>
              <div className="channel-list">
                {cameraChannels(camera).map((channel) => <em key={channel.channel}>Canal {channel.channel} - {channel.description || camera.groupName || "sem descricao"}</em>)}
              </div>
              <div className="toolbar-actions compact-actions">
                <button className="secondary-button" onClick={() => onEdit(camera)}>Editar camera</button>
                <button className="danger-button" type="button" onClick={() => onDelete(camera)}><Trash2 size={16} /> Excluir</button>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="empty-state">Nenhuma camera cadastrada neste condominio.</div>}
    </section>
  );
}

function ActionConfig({ actions, devices, form, setForm, onSave, onEdit, onTrigger, onDelete }) {
  const selectedDevice = devices.find((device) => device.id === form.deviceId);
  return (
    <section className="config-stack">
      <form className="nested-form" onSubmit={onSave}>
        <div className="panel-heading compact-heading">
          <h2>{form.id ? "Editar acionamento" : "Novo acionamento"}</h2>
          <button type="submit"><Save size={16} /> Salvar acionamento</button>
        </div>
        <div className="form-hint">
          {devices.length
            ? `Equipamentos disponiveis neste condominio: ${devices.length}. ${selectedDevice ? `Configurando ${selectedDevice.name}.` : "Selecione um equipamento para vincular o rele/porta."}`
            : "Nenhum equipamento cadastrado neste condominio. Cadastre o equipamento antes de configurar acionamentos."}
        </div>
        <div className="form-grid">
          <Field label="Nome"><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
          <Field label="Equipamento"><select value={form.deviceId} onChange={(event) => {
            const device = devices.find((item) => item.id === event.target.value);
            setForm((current) => ({ ...current, deviceId: event.target.value, manufacturer: device?.manufacturer || current.manufacturer }));
          }}><option value="">{devices.length ? "Selecione o equipamento" : "Sem equipamento neste condominio"}</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name} - {device.manufacturer} - {device.ipAddress || "sem IP"}</option>)}</select></Field>
          <Field label="Rele / porta"><input value={form.relay} onChange={(event) => setForm((current) => ({ ...current, relay: event.target.value }))} /></Field>
          <Field label="Rota"><input value={form.route} onChange={(event) => setForm((current) => ({ ...current, route: event.target.value }))} /></Field>
          <Field label="Status"><select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option>ACTIVE</option><option>DISABLED</option></select></Field>
        </div>
      </form>
      <div className="equipment-choice-list">
        {devices.length ? devices.map((device) => (
          <button
            key={device.id}
            className={form.deviceId === device.id ? "" : "secondary-button"}
            type="button"
            onClick={() => setForm((current) => ({ ...current, deviceId: device.id, manufacturer: device.manufacturer || current.manufacturer }))}
          >
            <RadioTower size={16} />
            <span><strong>{device.name}</strong><small>{device.manufacturer} - {device.ipAddress || "sem IP"} - {device.passwordSet ? "senha salva" : "sem senha"}</small></span>
          </button>
        )) : <div className="empty-state">Cadastre primeiro os equipamentos do condominio.</div>}
      </div>
      {actions.map((action) => (
        <article className="action-row" key={action.id}>
          <button className="secondary-button" disabled={action.status === "DISABLED"} onClick={() => onTrigger(action)}>Acionar</button>
          <span><strong>{action.name}</strong><small>{action.route}</small></span>
          <span>{devices.find((device) => device.id === action.deviceId)?.name || action.manufacturer}{action.relay ? ` / rele ${action.relay}` : ""}</span>
          <span className="status offline">{action.status === "DISABLED" ? "Desabilitado" : "Ativo"}</span>
          <button className="secondary-button" onClick={() => onEdit(action)}>Editar</button>
          <button className="danger-button" type="button" onClick={() => onDelete(action)}><Trash2 size={16} /> Excluir</button>
        </article>
      ))}
    </section>
  );
}

function App() {
  const [session, setSession] = useState(() => {
    const raw = window.localStorage.getItem("condo-clean-session");
    return raw ? JSON.parse(raw) : null;
  });
  const [activeSection, setActiveSection] = useState("dashboard");
  const [data, setData] = useState(readCachedBootstrap);
  const [syncState, setSyncState] = useState({ status: "idle", error: "", lastSyncAt: null });
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [condoFormMode, setCondoFormMode] = useState("edit");
  const [unitFormMode, setUnitFormMode] = useState("edit");
  const [search, setSearch] = useState("");
  const [unitSearch, setUnitSearch] = useState("");
  const [porterSearchType, setPorterSearchType] = useState("Nome");
  const [porterSearchTerm, setPorterSearchTerm] = useState("");
  const [resourceTab, setResourceTab] = useState("portaria");
  const [resourceConfig, setResourceConfig] = useState("");
  const [deviceTab, setDeviceTab] = useState("inicio");
  const [unitTab, setUnitTab] = useState("geral");
  const [personSubtab, setPersonSubtab] = useState("moradores");
  const [inviteSubtab, setInviteSubtab] = useState("qrCodes");
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [selectedPorterCameraId, setSelectedPorterCameraId] = useState("");
  const [expandedPorterCameraId, setExpandedPorterCameraId] = useState("");
  const [selectedMosaicKeys, setSelectedMosaicKeys] = useState([]);
  const [selectedCallId, setSelectedCallId] = useState("");
  const [porterDrawerOpen, setPorterDrawerOpen] = useState(true);
  const [porterUnitSearch, setPorterUnitSearch] = useState("");
  const [porterSelectedUnitId, setPorterSelectedUnitId] = useState("");
  const [telephony, setTelephony] = useState(emptyTelephony);
  const [tenantTelephony, setTenantTelephony] = useState({});
  const [condoGeo, setCondoGeo] = useState({ latitude: "", longitude: "" });
  const [message, setMessage] = useState("");
  const [actionFeedback, setActionFeedback] = useState(null);
  const [deviceForm, setDeviceForm] = useState(emptyDeviceForm);
  const [licenseForm, setLicenseForm] = useState(emptyLicenseForm);
  const [cameraForm, setCameraForm] = useState(emptyCameraForm);
  const [showCameraForm, setShowCameraForm] = useState(false);
  const [actionForm, setActionForm] = useState(emptyActionForm);
  const [credentialForm, setCredentialForm] = useState(emptyCredentialForm);
  const [credentialImportRows, setCredentialImportRows] = useState([]);
  const [credentialImportReport, setCredentialImportReport] = useState(null);
  const [credentialImportFile, setCredentialImportFile] = useState("");
  const [porterReportDate, setPorterReportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [equipmentIntegration, setEquipmentIntegration] = useState({
    deviceId: "",
    resource: "events",
    loading: false,
    importing: false,
    error: "",
    updatedAt: "",
    payload: null,
    importReport: null
  });
  const [equipmentFaceSelections, setEquipmentFaceSelections] = useState({});
  const selectedTenantIdRef = useRef("");
  const syncInFlightRef = useRef(false);
  const apiCacheRef = useRef(data);
  const webPhoneAudioRef = useRef(null);
  const webPhoneRingRef = useRef({ context: null, timer: null });
  const webPhoneUserAgentRef = useRef(null);
  const webPhoneRegistererRef = useRef(null);
  const webPhoneSessionRef = useRef(null);
  const webPhoneTenantRef = useRef("");
  const webPhoneClientsRef = useRef(new Map());
  const webPhoneInviteKeysRef = useRef(new Set());
  const webPhoneAutoAttemptRef = useRef("");
  const [webPhone, setWebPhone] = useState({
    status: "DISCONNECTED",
    diagnostic: "Desconectado",
    incomingLabel: "",
    remoteIdentity: ""
  });

  useEffect(() => {
    selectedTenantIdRef.current = selectedTenantId;
  }, [selectedTenantId]);

  useEffect(() => {
    if (!actionFeedback) return undefined;
    const timer = window.setTimeout(() => setActionFeedback(null), 4200);
    return () => window.clearTimeout(timer);
  }, [actionFeedback]);

  const allSections = [...sections, ...condoSections, ...settingsSections];
  const active = allSections.find((section) => section.id === activeSection) || sections[0];
  const selectedTenant = data.condominiums.find((item) => item.id === selectedTenantId) || data.condominiums[0];
  const condoFormTenant = condoFormMode === "new" ? null : selectedTenant;
  const units = useMemo(() => data.units.filter((unit) => unit.tenantId === selectedTenant?.id), [data.units, selectedTenant?.id]);
  const filteredUnits = useMemo(() => {
    const term = unitSearch.trim().toLowerCase();
    if (!term) return units;
    return units.filter((unit) => `${unit.unitNumber} ${unit.blockName} ${unit.residentName} ${unit.responsibleName} ${unit.telephony?.extension || unit.extension || ""}`.toLowerCase().includes(term));
  }, [unitSearch, units]);
  const selectedUnit = units.find((unit) => unit.unitId === selectedUnitId) || units[0];
  const unitFormUnit = unitFormMode === "new" ? null : selectedUnit;
  const selectedPerson = data.residents.find((person) => person.id === selectedPersonId) || data.residents.find((person) => person.unitId === selectedUnit?.unitId);

  useEffect(() => {
    setCondoGeo({
      latitude: condoFormTenant?.latitude || "",
      longitude: condoFormTenant?.longitude || ""
    });
  }, [condoFormTenant?.id, condoFormTenant?.latitude, condoFormTenant?.longitude]);

  const resolveSipIncomingContext = useCallback((sourceExtension, targetExtension, fallbackTenant) => {
    const cleanSource = String(sourceExtension || "").trim();
    const cleanTarget = String(targetExtension || "").trim();
    const unit = cleanSource
      ? data.units.find((item) => unitExtension(item) === cleanSource || String(item.extension || "").trim() === cleanSource)
      : null;
    const tenantFromUnit = unit ? data.condominiums.find((item) => item.id === unit.tenantId) : null;
    const tenantFromPorter = cleanTarget
      ? data.condominiums.find((item) => String(item.sipPorterExtension || WEB_PORTER_EXTENSION).trim() === cleanTarget)
      : null;
    return {
      tenant: tenantFromUnit || tenantFromPorter || fallbackTenant || selectedTenant,
      unit
    };
  }, [data.condominiums, data.units, selectedTenant]);

  const stopWebPhoneRing = useCallback(() => {
    const ring = webPhoneRingRef.current;
    if (ring.timer) {
      window.clearInterval(ring.timer);
      ring.timer = null;
    }
  }, []);

  const startWebPhoneRing = useCallback(() => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || webPhoneRingRef.current.timer) return;

    const playTone = () => {
      try {
        const ring = webPhoneRingRef.current;
        ring.context = ring.context || new AudioContext();
        void ring.context.resume?.();
        const oscillator = ring.context.createOscillator();
        const gain = ring.context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, ring.context.currentTime);
        oscillator.frequency.setValueAtTime(660, ring.context.currentTime + 0.18);
        gain.gain.setValueAtTime(0.0001, ring.context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.22, ring.context.currentTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, ring.context.currentTime + 0.48);
        oscillator.connect(gain);
        gain.connect(ring.context.destination);
        oscillator.start();
        oscillator.stop(ring.context.currentTime + 0.5);
      } catch {
        stopWebPhoneRing();
      }
    };

    playTone();
    webPhoneRingRef.current.timer = window.setInterval(playTone, 1400);
  }, [stopWebPhoneRing]);

  const attachWebPhoneAudio = useCallback((session) => {
    window.setTimeout(() => {
      const peerConnection = session?.sessionDescriptionHandler?.peerConnection;
      const audio = webPhoneAudioRef.current;
      if (!peerConnection || !audio) return;

      const stream = new MediaStream();
      peerConnection.getReceivers().forEach((receiver) => {
        if (receiver.track?.kind === "audio") stream.addTrack(receiver.track);
      });
      peerConnection.addEventListener("track", (event) => {
        event.streams?.[0]?.getAudioTracks().forEach((track) => {
          if (!stream.getTracks().some((item) => item.id === track.id)) stream.addTrack(track);
        });
        audio.srcObject = stream;
        void audio.play().catch(() => undefined);
      });
      audio.srcObject = stream;
      void audio.play().catch(() => undefined);
    }, 250);
  }, []);

  const connectWebPhone = useCallback(async (tenantForPhone = selectedTenant, options = {}) => {
    const trackPrimary = options.trackPrimary !== false;
    if (!tenantForPhone?.id) return;

    const domain = tenantForPhone.sipDomain || "granportalresidency.ddns.net";
    const webSocketUrl = normalizeWebSocketForWebPhone(tenantForPhone.sipWebSocketUrl, domain);
    const porterExtension = String(tenantForPhone.sipPorterExtension || WEB_PORTER_EXTENSION).trim();
    const porterPassword = String(tenantForPhone.sipPorterPassword || WEB_PORTER_PASSWORD).trim();
    const clientKey = `${tenantForPhone.id}:${porterExtension}@${domain}`;
    const existingClient = webPhoneClientsRef.current.get(clientKey);
    if (existingClient?.userAgent) {
      if (trackPrimary) {
        webPhoneUserAgentRef.current = existingClient.userAgent;
        webPhoneRegistererRef.current = existingClient.registerer;
        webPhoneTenantRef.current = tenantForPhone.id;
      }
      setWebPhone((current) => ({ ...current, diagnostic: "Audio ja conectado" }));
      return;
    }

    const uri = UserAgent.makeURI(`sip:${porterExtension}@${domain}`);
    if (!uri) {
      setWebPhone((current) => ({ ...current, status: "ERROR", diagnostic: "Configuracao de audio invalida" }));
      return;
    }

    setWebPhone({
      status: "CONNECTING",
      diagnostic: `Conectando ramal Web ${porterExtension} em ${webSocketUrl}`,
      incomingLabel: "",
      remoteIdentity: ""
    });

    try {
      const userAgent = new UserAgent({
        uri,
        authorizationUsername: porterExtension,
        authorizationPassword: porterPassword,
        contactName: porterExtension,
        transportOptions: { server: webSocketUrl },
        sessionDescriptionHandlerFactoryOptions: {
          constraints: { audio: true, video: false }
        },
        delegate: {
          onInvite(invitation) {
            webPhoneSessionRef.current = invitation;
            const remoteExtension = invitation.remoteIdentity?.uri?.user || "";
            const targetExtension = invitation.request?.message?.to?.uri?.user || invitation.localIdentity?.uri?.user || porterExtension;
            const { tenant: callTenant, unit: callUnit } = resolveSipIncomingContext(remoteExtension, targetExtension, tenantForPhone);
            const remoteLabel = invitation.remoteIdentity?.displayName || remoteExtension || "Chamada";
            if (callTenant?.id) {
              setSelectedTenantId(callTenant.id);
              setActiveSection("remotePorter");
              setResourceTab("portaria");
            }
            if (callUnit) {
              setPorterSelectedUnitId(callUnit.unitId);
              setPorterUnitSearch(`${callUnit.blockName || ""} ${callUnit.unitNumber || ""}`.trim());
            }
            const inviteKey = invitation.id || `${tenantForPhone.id}:${remoteExtension}:${targetExtension}:${Date.now()}`;
            if (!webPhoneInviteKeysRef.current.has(inviteKey)) {
              webPhoneInviteKeysRef.current.add(inviteKey);
              void fetch(`${apiUrl}/api/telephony/mobile-call`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  tenantId: callTenant?.id || tenantForPhone.id,
                  unitId: callUnit?.unitId || "",
                  unitNumber: callUnit?.unitNumber || "",
                  sourceExtension: remoteExtension,
                  targetExtension,
                  targetType: "PORTER",
                  targetLabel: "Portaria",
                  visitorLabel: callUnit ? `Unidade ${callUnit.unitNumber || callUnit.unitId}` : `Ramal ${remoteExtension || "-"}`,
                  sipHandled: true
                })
              })
                .then((response) => response.ok ? response.json() : null)
                .then((callRecord) => {
                  if (!callRecord?.id) return;
                  setSelectedCallId(callRecord.id);
                  setData((current) => ({
                    ...current,
                    intercomCalls: [callRecord, ...current.intercomCalls.filter((item) => item.id !== callRecord.id)]
                  }));
                })
                .catch(() => undefined);
            }
            startWebPhoneRing();
            setWebPhone({
              status: "RINGING",
              diagnostic: "Chamada recebida na Portaria Web",
              incomingLabel: `Chamada de ${remoteLabel}`,
              remoteIdentity: remoteLabel
            });
            invitation.stateChange.addListener((state) => {
              if (state === SessionState.Established) {
                stopWebPhoneRing();
                attachWebPhoneAudio(invitation);
                setWebPhone((current) => ({ ...current, status: "IN_CALL", diagnostic: "Chamada em atendimento" }));
              }
              if (state === SessionState.Terminated) {
                stopWebPhoneRing();
                webPhoneSessionRef.current = null;
                setWebPhone((current) => ({
                  ...current,
                  status: webPhoneRegistererRef.current ? "REGISTERED" : "DISCONNECTED",
                  diagnostic: webPhoneRegistererRef.current ? "Audio conectado" : "Desconectado",
                  incomingLabel: "",
                  remoteIdentity: ""
                }));
              }
            });
          }
        }
      });

      const registerer = new Registerer(userAgent);
      registerer.stateChange.addListener((state) => {
        if (state === RegistererState.Registered) {
          setWebPhone((current) => ({ ...current, status: "REGISTERED", diagnostic: "Audio conectado" }));
        }
        if (state === RegistererState.Unregistered) {
          setWebPhone((current) => ({ ...current, status: "DISCONNECTED", diagnostic: "Desconectado" }));
        }
      });

      await userAgent.start();
      await registerer.register();
      webPhoneClientsRef.current.set(clientKey, { tenantId: tenantForPhone.id, userAgent, registerer });
      if (trackPrimary) {
        webPhoneUserAgentRef.current = userAgent;
        webPhoneRegistererRef.current = registerer;
        webPhoneTenantRef.current = tenantForPhone.id;
      }
    } catch (error) {
      if (trackPrimary) {
        webPhoneUserAgentRef.current = null;
        webPhoneRegistererRef.current = null;
        webPhoneTenantRef.current = "";
      }
      setWebPhone({
        status: "ERROR",
        diagnostic: error instanceof Error ? error.message : "Falha ao conectar Portaria Web",
        incomingLabel: "",
        remoteIdentity: ""
      });
    }
  }, [attachWebPhoneAudio, resolveSipIncomingContext, selectedTenant, startWebPhoneRing, stopWebPhoneRing]);

  const disconnectWebPhone = useCallback(async () => {
    const session = webPhoneSessionRef.current;
    try {
      if (session?.state === SessionState.Established) await session.bye();
      if (session instanceof Invitation && [SessionState.Initial, SessionState.Establishing].includes(session.state)) await session.reject();
      const clients = Array.from(webPhoneClientsRef.current.values());
      if (!clients.length) {
        if (webPhoneRegistererRef.current) await webPhoneRegistererRef.current.unregister();
        if (webPhoneUserAgentRef.current) await webPhoneUserAgentRef.current.stop();
      }
      await Promise.allSettled(clients.map(async (client) => {
        await client.registerer?.unregister().catch(() => undefined);
        await client.userAgent?.stop().catch(() => undefined);
      }));
    } catch {
      // Best effort cleanup; the UI state below is authoritative for the operator.
    } finally {
      webPhoneSessionRef.current = null;
      webPhoneRegistererRef.current = null;
      webPhoneUserAgentRef.current = null;
      webPhoneTenantRef.current = "";
      webPhoneClientsRef.current.clear();
      stopWebPhoneRing();
      if (webPhoneAudioRef.current) webPhoneAudioRef.current.srcObject = null;
      setWebPhone({ status: "DISCONNECTED", diagnostic: "Desconectado", incomingLabel: "", remoteIdentity: "" });
    }
  }, [stopWebPhoneRing]);

  const answerWebPhone = useCallback(async () => {
    const session = webPhoneSessionRef.current;
    if (!(session instanceof Invitation)) return;
    try {
      stopWebPhoneRing();
      await session.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
      attachWebPhoneAudio(session);
    } catch (error) {
      setWebPhone((current) => ({
        ...current,
        status: "ERROR",
        diagnostic: error instanceof Error ? error.message : "Falha ao atender chamada"
      }));
    }
  }, [attachWebPhoneAudio, stopWebPhoneRing]);

  const hangupWebPhone = useCallback(async () => {
    const session = webPhoneSessionRef.current;
    if (!session) return;
    try {
      stopWebPhoneRing();
      if (session instanceof Invitation && [SessionState.Initial, SessionState.Establishing].includes(session.state)) {
        await session.reject();
      } else if (session.state !== SessionState.Established && typeof session.cancel === "function") {
        await session.cancel();
      } else if (session.state === SessionState.Established) {
        await session.bye();
      }
    } catch {
      webPhoneSessionRef.current = null;
      setWebPhone((current) => ({ ...current, status: "REGISTERED", diagnostic: "Audio conectado", incomingLabel: "", remoteIdentity: "" }));
    }
  }, [stopWebPhoneRing]);

  useEffect(() => () => {
    void disconnectWebPhone();
  }, [disconnectWebPhone]);

  useEffect(() => {
    if (!session || !data.condominiums.length) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      if (webPhone.status === "RINGING" || webPhone.status === "IN_CALL" || webPhone.status === "CALLING") return;
      const orderedTenants = [
        selectedTenant,
        ...data.condominiums.filter((item) => item.id !== selectedTenant?.id)
      ].filter(Boolean);
      const uniqueAccounts = new Map();
      orderedTenants.forEach((tenantItem) => {
        const domain = tenantItem.sipDomain || "granportalresidency.ddns.net";
        const extension = String(tenantItem.sipPorterExtension || WEB_PORTER_EXTENSION).trim();
        const key = `${extension}@${domain}`;
        if (!uniqueAccounts.has(key)) uniqueAccounts.set(key, tenantItem);
      });
      const attemptKey = `${session.user?.id || session.email || "session"}:${Array.from(uniqueAccounts.keys()).join("|")}`;
      if (webPhoneAutoAttemptRef.current === attemptKey && webPhoneClientsRef.current.size >= uniqueAccounts.size) return;
      webPhoneAutoAttemptRef.current = attemptKey;
      for (const tenantItem of uniqueAccounts.values()) {
        if (cancelled) return;
        await connectWebPhone(tenantItem, { trackPrimary: tenantItem.id === selectedTenant?.id });
      }
    }, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connectWebPhone, data.condominiums, selectedTenant, session, webPhone.status]);

  const normalizeUnitId = useCallback((rawUnitId) => {
    if (!rawUnitId) return "";
    const decoded = decodeURIComponent(rawUnitId);
    return data.units.find((unit) => unit.unitId === decoded || unit.unitId === `unit-${decoded}` || unit.unitNumber === decoded)?.unitId || decoded;
  }, [data.units]);

  const applyRoute = useCallback((path) => {
    const pathname = path || window.location.pathname;
    const licenseUnitsMatch = pathname.match(/^\/licencas\/([^/]+)\/unidades$/);
    const licenseCamerasMatch = pathname.match(/^\/licencas\/([^/]+)\/configuracaoCameras$/);
    const licenseActionsMatch = pathname.match(/^\/licencas\/([^/]+)\/configuracaoAcionamentos$/);
    const licenseDevicesMatch = pathname.match(/^\/licencas\/([^/]+)\/equipamentos$/);
    const licenseCredentialsMatch = pathname.match(/^\/licencas\/([^/]+)\/credenciais(?:\/importacao)?$/);
    const credentialsMatch = pathname.match(/^\/credenciais(?:\/importacao)?$/);
    const condoCredentialsMatch = pathname.match(/^\/condominios\/([^/]+)\/credenciais(?:\/importacao)?$/);
    const unitRootMatch = pathname.match(/^\/unidades\/([^/]+)$/);
    const unitPeopleMatch = pathname.match(/^\/unidades\/([^/]+)\/pessoas\/([^/]+)\/ver\/([^/]+)$/);
    const unitLoginsMatch = pathname.match(/^\/unidades\/([^/]+)\/logins$/);
    const unitInvitesMatch = pathname.match(/^\/unidades\/([^/]+)\/convites\/([^/]+)$/);

    const selectTenantByLicense = (code) => {
      const license = data.licenses.find((item) => item.code === code || item.id === code || item.id === `license-${code}`);
      if (license?.tenantId && license.tenantId !== selectedTenantIdRef.current) {
        setSelectedTenantId(license.tenantId);
      }
    };

    if (licenseUnitsMatch) {
      selectTenantByLicense(licenseUnitsMatch[1]);
      setActiveSection("units");
      setUnitTab("geral");
      return true;
    }

    if (licenseCamerasMatch) {
      selectTenantByLicense(licenseCamerasMatch[1]);
      setActiveSection("devices");
      setDeviceTab("cameras");
      return true;
    }

    if (licenseActionsMatch) {
      selectTenantByLicense(licenseActionsMatch[1]);
      setActiveSection("devices");
      setDeviceTab("actions");
      return true;
    }

    if (licenseDevicesMatch) {
      selectTenantByLicense(licenseDevicesMatch[1]);
      setActiveSection("devices");
      setDeviceTab("inicio");
      return true;
    }

    if (licenseCredentialsMatch) {
      selectTenantByLicense(licenseCredentialsMatch[1]);
      setActiveSection("credentials");
      return true;
    }

    if (credentialsMatch) {
      setActiveSection("credentials");
      return true;
    }

    if (condoCredentialsMatch) {
      const tenantId = decodeURIComponent(condoCredentialsMatch[1]);
      if (data.condominiums.some((item) => item.id === tenantId)) {
        setSelectedTenantId(tenantId);
      }
      setActiveSection("credentials");
      return true;
    }

    if (unitRootMatch) {
      setSelectedUnitId(normalizeUnitId(unitRootMatch[1]));
      setUnitFormMode("edit");
      setActiveSection("units");
      setUnitTab("geral");
      return true;
    }

    if (unitPeopleMatch) {
      setSelectedUnitId(normalizeUnitId(unitPeopleMatch[1]));
      setActiveSection("units");
      setUnitTab(unitPeopleMatch[2] === "visitantes" ? "visitantes" : unitPeopleMatch[2] === "prestadores" ? "prestadores" : "moradores");
      setPersonSubtab(unitPeopleMatch[2]);
      setSelectedPersonId(unitPeopleMatch[3]);
      return true;
    }

    if (unitLoginsMatch) {
      setSelectedUnitId(normalizeUnitId(unitLoginsMatch[1]));
      setActiveSection("units");
      setUnitTab("logins");
      return true;
    }

    if (unitInvitesMatch) {
      setSelectedUnitId(normalizeUnitId(unitInvitesMatch[1]));
      setActiveSection("units");
      setUnitTab("convites");
      setInviteSubtab(unitInvitesMatch[2]);
      return true;
    }

    return false;
  }, [data.condominiums, data.licenses, normalizeUnitId]);

  const navigateTo = useCallback((path) => {
    window.history.pushState({}, "", path);
    applyRoute(path);
  }, [applyRoute]);

  const storeApiCache = useCallback((payload) => {
    apiCacheRef.current = payload;
    try {
      window.localStorage.setItem(API_CACHE_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        payload
      }));
    } catch {
      // Cache silencioso: se o navegador negar armazenamento, a tela segue normal.
    }
  }, []);

  const refreshApiCache = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/bootstrap`);
      if (!response.ok) return null;
      const payload = await response.json();
      storeApiCache(payload);
      return payload;
    } catch {
      return null;
    }
  }, [storeApiCache]);

  const syncNow = useCallback(async ({ silent = false } = {}) => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    if (!silent) setSyncState((current) => ({ ...current, status: "syncing", error: "" }));
    try {
      const response = await fetch(`${apiUrl}/api/bootstrap`);
      if (!response.ok) throw new Error(`API ${response.status}`);
      const payload = await response.json();
      const selectedTenantIdSnapshot = selectedTenantIdRef.current;
      const currentTenantId = payload.condominiums.some((item) => item.id === selectedTenantIdSnapshot)
        ? selectedTenantIdSnapshot
        : payload.condominiums[0]?.id || "";
      const extensionResponse = currentTenantId
        ? await fetch(`${apiUrl}/api/extensions/status?tenantId=${encodeURIComponent(currentTenantId)}`).catch(() => null)
        : null;
      const extensionPayload = extensionResponse?.ok ? await extensionResponse.json().catch(() => null) : null;
      if (extensionPayload?.extensions) payload.extensionStatus = extensionPayload.extensions;
      storeApiCache(payload);
      setData(payload);
      const nextTenant = payload.condominiums[0];
      const nextUnit = payload.units[0];
      setSelectedTenantId((current) => payload.condominiums.some((item) => item.id === current) ? current : nextTenant?.id || "");
      setSelectedUnitId((current) => payload.units.some((item) => item.unitId === current) ? current : nextUnit?.unitId || "");
      setTenantTelephony(nextTenant || {});
      setTelephony(nextUnit?.telephony || emptyTelephony);
      setSyncState({ status: "synced", error: "", lastSyncAt: new Date() });
    } catch (error) {
      setSyncState({ status: "offline", error: error instanceof Error ? error.message : "API indisponivel", lastSyncAt: new Date() });
    } finally {
      syncInFlightRef.current = false;
    }
  }, [storeApiCache]);

  useEffect(() => {
    void syncNow();
  }, []);

  useEffect(() => {
    applyRoute(window.location.pathname);
    const onPopState = () => applyRoute(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyRoute]);

  useEffect(() => {
    if (selectedTenant) {
      setTenantTelephony(selectedTenant);
    }
  }, [selectedTenant]);

  useEffect(() => {
    if (selectedUnit) {
      setTelephony(selectedUnit.telephony || emptyTelephony);
    }
  }, [selectedUnit]);

  const filteredCondos = data.condominiums.filter((item) => `${item.name} ${item.document}`.toLowerCase().includes(search.toLowerCase()));
  const condoPager = usePaged(filteredCondos, 4);
  const unitPager = usePaged(filteredUnits, 6);
  const tenantCameras = useMemo(() => data.cameras.filter((camera) => camera.tenantId === selectedTenant?.id), [data.cameras, selectedTenant?.id]);
  const tenantCameraGroups = tenantCameras;
  const tenantMosaicOptions = useMemo(() => tenantCameraGroups.flatMap((camera) => cameraChannels(camera).map((channel) => ({
    key: cameraStreamKey(camera, channel.channel),
    camera,
    channel: channel.channel,
    description: channel.description
  }))), [tenantCameraGroups]);
  const selectedMosaicItems = useMemo(() => {
    const selected = tenantMosaicOptions.filter((item) => selectedMosaicKeys.includes(item.key));
    return selected.length ? selected : tenantMosaicOptions.slice(0, 4);
  }, [selectedMosaicKeys, tenantMosaicOptions]);
  const tenantDevices = useMemo(() => data.devices.filter((device) => device.tenantId === selectedTenant?.id), [data.devices, selectedTenant?.id]);
  const tenantCredentials = useMemo(() => data.credentials.filter((credential) => credential.tenantId === selectedTenant?.id), [data.credentials, selectedTenant?.id]);
  const tenantActions = useMemo(() => data.actions.filter((action) => action.tenantId === selectedTenant?.id), [data.actions, selectedTenant?.id]);
  const tenantCalls = useMemo(() => data.intercomCalls.filter((call) => !call.tenantId || call.tenantId === selectedTenant?.id), [data.intercomCalls, selectedTenant?.id]);
  const activeTenantCalls = useMemo(() => tenantCalls.filter((call) => !["ENDED", "MISSED", "FAILED"].includes(call.status)), [tenantCalls]);
  const tenantEvents = useMemo(() => (data.accessLogs || []).filter((log) => !log.tenantId || log.tenantId === selectedTenant?.id), [data.accessLogs, selectedTenant?.id]);
  const disconnectedDevices = useMemo(() => tenantDevices.filter((device) => device.status && device.status !== "ONLINE"), [tenantDevices]);
  const selectedIntegrationDevice = tenantDevices.find((device) => device.id === equipmentIntegration.deviceId) || tenantDevices[0];
  const porterMosaicItems = useMemo(() => tenantMosaicOptions.slice(0, 16), [tenantMosaicOptions]);
  const porterMosaicLayout = porterMosaicItems.length <= 2 ? "two" : porterMosaicItems.length <= 4 ? "four" : porterMosaicItems.length <= 8 ? "eight" : "sixteen";
  const expandedPorterItem = porterMosaicItems.find((item) => item.key === expandedPorterCameraId) || null;
  const incomingCall = useMemo(() => data.intercomCalls
    .filter((call) => call.status === "RINGING" && call.targetType !== "UNIT")
    .sort((left, right) => callTime(right) - callTime(left))[0] || null, [data.intercomCalls]);
  const incomingCallUnit = useMemo(() => resolveCallUnit(incomingCall, data.units, selectedTenant?.id), [data.units, incomingCall, selectedTenant?.id]);
  const incomingCallTenant = useMemo(() => data.condominiums.find((item) => item.id === (incomingCall?.tenantId || incomingCallUnit?.tenantId)), [data.condominiums, incomingCall?.tenantId, incomingCallUnit?.tenantId]);
  const selectedCall = useMemo(() => data.intercomCalls.find((call) => call.id === selectedCallId), [data.intercomCalls, selectedCallId]);
  const activeSelectedCall = useMemo(() => selectedCall && !["ENDED", "MISSED", "FAILED"].includes(selectedCall.status) ? selectedCall : null, [selectedCall]);

  useEffect(() => {
    const shouldRing = webPhone.status === "RINGING" || incomingCall?.status === "RINGING";
    if (shouldRing) startWebPhoneRing();
    else stopWebPhoneRing();
    return undefined;
  }, [incomingCall?.id, incomingCall?.status, startWebPhoneRing, stopWebPhoneRing, webPhone.status]);

  const selectedCallUnit = useMemo(() => {
    const call = activeSelectedCall || incomingCall;
    return resolveCallUnit(call, data.units, selectedTenant?.id);
  }, [activeSelectedCall, data.units, incomingCall, selectedTenant?.id]);
  const porterDrawerUnit = useMemo(() => {
    return units.find((unit) => unit.unitId === porterSelectedUnitId) || selectedCallUnit || null;
  }, [porterSelectedUnitId, selectedCallUnit, units]);
  const porterDrawerResidents = useMemo(() => {
    if (!porterDrawerUnit) return [];
    return data.residents.filter((person) => person.unitId === porterDrawerUnit.unitId || person.id === porterDrawerUnit.residentId);
  }, [data.residents, porterDrawerUnit]);
  const porterUnitResults = useMemo(() => {
    const term = porterUnitSearch.trim().toLowerCase();
    const source = units.filter((unit) => {
      if (!term) return true;
      const residents = data.residents.filter((person) => person.unitId === unit.unitId);
      return `${unit.unitNumber} ${unit.blockName} ${unit.residentName} ${unit.responsibleName} ${unit.extension || ""} ${unit.telephony?.extension || ""} ${residents.map((person) => `${person.name} ${person.cpf} ${person.rg} ${person.phone} ${person.email}`).join(" ")}`.toLowerCase().includes(term);
    });
    return source.slice(0, 10);
  }, [data.residents, porterUnitSearch, units]);

  useEffect(() => {
    setSelectedMosaicKeys((current) => {
      const available = new Set(tenantMosaicOptions.map((item) => item.key));
      const next = current.filter((key) => available.has(key));
      if (next.length) return next;
      return tenantMosaicOptions.slice(0, 4).map((item) => item.key);
    });
  }, [tenantMosaicOptions]);

  useEffect(() => {
    setEquipmentIntegration((current) => {
      const hasCurrentDevice = tenantDevices.some((device) => device.id === current.deviceId);
      const nextDeviceId = hasCurrentDevice ? current.deviceId : tenantDevices[0]?.id || "";
      if (nextDeviceId === current.deviceId) return current;
      return { ...current, deviceId: nextDeviceId, payload: null, error: "", updatedAt: "" };
    });
  }, [selectedTenant?.id, tenantDevices]);

  function defaultActionForm() {
    const firstDevice = tenantDevices[0];
    return {
      ...emptyActionForm,
      tenantId: selectedTenant?.id || "",
      deviceId: firstDevice?.id || "",
      manufacturer: firstDevice?.manufacturer || "Hikvision"
    };
  }

  useEffect(() => {
    if (activeSection === "devices" && deviceTab === "actions" && !actionForm.id && !actionForm.deviceId && tenantDevices.length) {
      setActionForm(defaultActionForm());
    }
  }, [activeSection, actionForm.deviceId, actionForm.id, deviceTab, selectedTenant?.id, tenantDevices.length]);

  const porterSearchResults = useMemo(() => {
    const term = porterSearchTerm.trim().toLowerCase();
    if (!term) return [];
    const inTenant = (item) => !item.tenantId || item.tenantId === selectedTenant?.id;
    if (porterSearchType === "Unidade") {
      return data.units.filter(inTenant).filter((unit) => `${unit.unitNumber} ${unit.blockName} ${unit.residentName} ${unit.responsibleName} ${unit.extension || ""} ${unit.telephony?.extension || ""}`.toLowerCase().includes(term)).slice(0, 8);
    }
    if (porterSearchType === "Credencial") {
      return data.credentials.filter(inTenant).filter((credential) => `${credential.type} ${credential.valueLabel} ${credential.personId} ${credential.unitId}`.toLowerCase().includes(term)).slice(0, 8);
    }
    return data.residents.filter(inTenant).filter((person) => {
      const source = porterSearchType === "CPF" ? person.cpf : porterSearchType === "RG" ? person.rg : porterSearchType === "Placa" ? person.vehiclePlate : `${person.name} ${person.email} ${person.phone} ${person.cpf} ${person.rg}`;
      return String(source || "").toLowerCase().includes(term);
    }).slice(0, 8);
  }, [data.credentials, data.residents, data.units, porterSearchTerm, porterSearchType, selectedTenant?.id]);

  function selectPorterUnit(unit) {
    if (!unit) return;
    setPorterSelectedUnitId(unit.unitId);
    setPorterUnitSearch(`${unit.blockName || ""} ${unit.unitNumber || ""}`.trim());
    setPorterDrawerOpen(true);
  }

  function unitDisplay(unit) {
    if (!unit) return "-";
    return `${unit.blockName ? `${unit.blockName} - ` : ""}Unidade ${unit.unitNumber || unit.unitId || "-"}`;
  }

  async function callUnitFromPorter(unit) {
    if (!unit) return;
    selectPorterUnit(unit);

    const extension = unit.telephony?.extension || unit.extension || "";
    if (!extension) {
      setMessage(`Unidade ${unit.unitNumber || unit.unitId || "-"} sem ramal cadastrado.`);
      return;
    }

    try {
      const callResponse = await fetch(`${apiUrl}/api/telephony/porter-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: selectedTenant?.id || unit.tenantId,
          unitId: unit.unitId,
          unitNumber: unit.unitNumber,
          targetExtension: extension,
          targetLabel: unitDisplay(unit),
          sourceExtension: selectedTenant?.sipPorterExtension || WEB_PORTER_EXTENSION,
          visitorLabel: "Portaria"
        })
      });
      const callRecord = await callResponse.json().catch(() => null);
      if (callRecord?.id) {
        setData((current) => ({
          ...current,
          intercomCalls: [callRecord, ...current.intercomCalls.filter((item) => item.id !== callRecord.id)]
        }));
        setSelectedCallId(callRecord.id);
      }

      if (!webPhoneUserAgentRef.current) await connectWebPhone();
      const userAgent = webPhoneUserAgentRef.current;
      if (!userAgent) {
        setMessage("Audio da portaria ainda nao conectado para ligar para a unidade.");
        return;
      }

      const domain = selectedTenant?.sipDomain || "granportalresidency.ddns.net";
      const targetUri = UserAgent.makeURI(`sip:${extension}@${domain}`);
      if (!targetUri) {
        setMessage(`Ramal ${extension} da unidade invalido.`);
        return;
      }

      const inviter = new Inviter(userAgent, targetUri, {
        sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } }
      });
      webPhoneSessionRef.current = inviter;
      setWebPhone((current) => ({
        ...current,
        status: "CALLING",
        diagnostic: `Chamando unidade ${unit.unitNumber || unit.unitId || "-"} no ramal ${extension}`,
        incomingLabel: `Ligando para ${unitDisplay(unit)}`,
        remoteIdentity: extension
      }));
      inviter.stateChange.addListener((state) => {
        if (state === SessionState.Established) {
          attachWebPhoneAudio(inviter);
          setWebPhone((current) => ({ ...current, status: "IN_CALL", diagnostic: `Em chamada com unidade ${unit.unitNumber || unit.unitId || "-"}` }));
          if (callRecord?.id) void markCallAnswered(callRecord);
        }
        if (state === SessionState.Terminated) {
          webPhoneSessionRef.current = null;
          if (callRecord?.id) void endCall(callRecord, { clearSelection: false, quiet: true });
          setWebPhone((current) => ({
            ...current,
            status: webPhoneRegistererRef.current ? "REGISTERED" : "DISCONNECTED",
            diagnostic: webPhoneRegistererRef.current ? "Audio conectado" : "Desconectado",
            incomingLabel: "",
            remoteIdentity: ""
          }));
        }
      });
      await inviter.invite();
      setMessage(`Ligando para unidade ${unit.unitNumber || unit.unitId || "-"} no ramal ${extension}.`);
    } catch (error) {
      setWebPhone((current) => ({
        ...current,
        status: webPhoneRegistererRef.current ? "REGISTERED" : "ERROR",
        diagnostic: error instanceof Error ? error.message : "Falha ao ligar para a unidade"
      }));
      setMessage(error instanceof Error ? error.message : "Falha ao ligar para a unidade.");
    }
  }

  const editCamera = useCallback((camera) => {
    setShowCameraForm(true);
    setCameraForm({
      id: camera.id,
      tenantId: camera.tenantId || selectedTenant?.id || "",
      deviceId: camera.deviceId || "",
      description: camera.description || "",
      type: camera.type === "NVR/DVR" ? "NVR" : camera.type || "NVR",
      manufacturer: camera.manufacturer || "Hikvision",
      model: camera.model || "",
      host: camera.host || camera.ipAddress || "",
      rtspPort: String(camera.rtspPort || 554),
      httpPort: String(camera.httpPort || 80),
      rtspPath: camera.rtspPath || "",
      username: camera.username || "admin",
      password: "",
      channel: String(camera.activeChannels?.[0]?.channel || camera.channel || 1),
      channelCount: String(camera.activeChannels?.length || 1),
      channelDescription: camera.activeChannels?.[0]?.description || "",
      stream: camera.stream || "MAIN",
      aspectRatio: camera.aspectRatio || "WIDESCREEN",
      loadMethod: camera.loadMethod || "SNAPSHOT_TEMPO_REAL",
      photoCaptureEnabled: Boolean(camera.photoCaptureEnabled)
    });
  }, [selectedTenant?.id]);

  async function saveUnitTelephony(event) {
    event?.preventDefault();
    if (!selectedUnit) return;
    setMessage("Salvando ramal da unidade...");
    const { extensionPassword: _extensionPassword, ...sipTelephony } = telephony;
    const response = await fetch(`${apiUrl}/api/units/${selectedUnit.unitId}/telephony`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sipTelephony)
    });
    if (!response.ok) {
      setMessage("Falha ao salvar ramal da unidade.");
      return;
    }
    setData((current) => ({
      ...current,
      units: current.units.map((unit) => unit.unitId === selectedUnit.unitId
        ? { ...unit, extension: telephony.extension, telephony: { ...unit.telephony, ...telephony } }
        : unit)
    }));
    setMessage("Ramal da unidade salvo. O app mobile recebe estes dados no login/troca de unidade.");
    void refreshApiCache();
  }

  async function saveTenantTelephony(event) {
    event?.preventDefault();
    if (!selectedTenant) return;
    setMessage("Salvando configuracao do condominio...");
    const { sipPorterPassword: _sipPorterPassword, ...sipTenantTelephony } = tenantTelephony;
    const response = await fetch(`${apiUrl}/api/condominiums/${selectedTenant.id}/telephony`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sipTenantTelephony)
    });
    if (!response.ok) {
      setMessage("Falha ao salvar configuracao do condominio.");
      return;
    }
    setData((current) => ({
      ...current,
      condominiums: current.condominiums.map((item) => item.id === selectedTenant.id ? { ...item, ...tenantTelephony } : item),
      units: current.units.map((unit) => unit.tenantId === selectedTenant.id
        ? { ...unit, telephony: { ...unit.telephony, sipDomain: tenantTelephony.sipDomain, sipWebSocketUrl: tenantTelephony.sipWebSocketUrl, porterExtension: tenantTelephony.sipPorterExtension } }
        : unit)
    }));
    setMessage("Configuracao salva e propagada para as unidades.");
    void refreshApiCache();
  }

  async function createOrUpdateCondo(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let latitude = String(form.get("latitude") || condoGeo.latitude || "").trim();
    let longitude = String(form.get("longitude") || condoGeo.longitude || "").trim();
    if (!latitude || !longitude) {
      const geo = await geocodeAddressFields({
        address: form.get("address"),
        addressNumber: form.get("addressNumber"),
        city: form.get("city"),
        state: form.get("state")
      }).catch(() => null);
      if (geo) {
        latitude = geo.latitude;
        longitude = geo.longitude;
        setCondoGeo(geo);
      }
    }
    const structureGroupCount = parsePositiveInteger(form.get("structureGroupCount"), 0);
    const unitsPerGroup = parsePositiveInteger(form.get("unitsPerGroup"), 0);
    const response = await fetch(`${apiUrl}/api/condominiums`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: form.get("id"),
        name: form.get("name"),
        document: form.get("document"),
        status: form.get("status"),
        structureType: form.get("structureType"),
        structureGroupCount,
        unitsPerGroup,
        totalUnits: structureGroupCount * unitsPerGroup,
        address: form.get("address"),
        addressNumber: form.get("addressNumber"),
        city: form.get("city"),
        state: form.get("state"),
        latitude,
        longitude,
        generateUnits: form.get("generateUnits") === "on",
        telephonyProvider: form.get("telephonyProvider"),
        sipDomain: form.get("sipDomain"),
        sipWebSocketUrl: form.get("sipWebSocketUrl"),
        sipPorterExtension: form.get("sipPorterExtension"),
        sipExtensionStart: form.get("sipExtensionStart"),
        sipExtensionEnd: form.get("sipExtensionEnd")
      })
    });
    const saved = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(saved.message || "Falha ao salvar condominio.");
      return;
    }
    const generatedUnitCount = saved?.generatedUnits || 0;
    if (saved?.id) {
      const { generatedUnitList: rawGeneratedUnitList, generatedUnits: _generatedUnits, ...savedTenant } = saved;
      const generatedUnitList = Array.isArray(rawGeneratedUnitList) ? rawGeneratedUnitList : [];
      setData((current) => {
        const exists = current.condominiums.some((item) => item.id === savedTenant.id);
        const generatedUnitIds = new Set(generatedUnitList.map((unit) => unit.unitId));
        return {
          ...current,
          condominiums: exists
            ? current.condominiums.map((item) => item.id === savedTenant.id ? savedTenant : item)
            : [savedTenant, ...current.condominiums],
          units: generatedUnitList.length
            ? [...current.units.filter((unit) => !generatedUnitIds.has(unit.unitId)), ...generatedUnitList]
            : current.units
        };
      });
      setSelectedTenantId(savedTenant.id);
      setCondoFormMode("edit");
      setActiveSection("condoHome");
    }
    setMessage(generatedUnitCount ? `Condominio salvo. ${generatedUnitCount} unidade(s) criada(s).` : "Condominio salvo.");
    void refreshApiCache();
  }

  async function geocodeCondoForm(event) {
    const form = event.currentTarget.closest("form");
    if (!form) return;
    const payload = new FormData(form);
    setMessage("Buscando latitude e longitude...");
    const geo = await geocodeAddressFields({
      address: payload.get("address"),
      addressNumber: payload.get("addressNumber"),
      city: payload.get("city"),
      state: payload.get("state")
    }).catch(() => null);
    if (!geo) {
      setMessage("Nao foi possivel localizar esse endereco.");
      return;
    }
    setCondoGeo(geo);
    setMessage("Latitude e longitude preenchidas.");
  }

  function updateCondoTotal(event) {
    const form = event.currentTarget.form;
    if (!form) return;
    const groups = parsePositiveInteger(form.elements.structureGroupCount?.value, 0);
    const perGroup = parsePositiveInteger(form.elements.unitsPerGroup?.value, 0);
    if (form.elements.totalUnits) form.elements.totalUnits.value = groups && perGroup ? String(groups * perGroup) : "";
  }

  async function deleteCondo(condo) {
    if (!window.confirm(`Excluir condominio ${condo.name}?`)) return;
    const response = await fetch(`${apiUrl}/api/condominiums/${condo.id}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setMessage(result.message || "Falha ao excluir condominio.");
      return;
    }
    setSelectedTenantId("");
    setCondoFormMode("new");
    setData((current) => ({
      ...current,
      condominiums: current.condominiums.filter((item) => item.id !== condo.id),
      units: current.units.filter((unit) => unit.tenantId !== condo.id),
      residents: current.residents.filter((person) => person.tenantId !== condo.id)
    }));
    setMessage("Condominio excluido.");
    void refreshApiCache();
  }

  async function saveUnitForm(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`${apiUrl}/api/units`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unitId: form.get("unitId"),
        tenantId: selectedTenant?.id,
        unitNumber: form.get("unitNumber"),
        blockName: form.get("blockName"),
        residentName: form.get("residentName"),
        responsibleName: form.get("responsibleName"),
        residentCpf: form.get("residentCpf"),
        residentRg: form.get("residentRg"),
        residentPhone: form.get("residentPhone"),
        residentEmail: form.get("residentEmail"),
        residentRelation: form.get("residentRelation"),
        extension: form.get("extension")
      })
    });
    if (!response.ok) {
      setMessage("Falha ao salvar unidade.");
      return;
    }
    const saved = await response.json();
    setData((current) => {
      const exists = current.units.some((unit) => unit.unitId === saved.unitId);
      const resident = saved.preRegisteredResident;
      const residentExists = resident && current.residents.some((person) => person.id === resident.id);
      return {
        ...current,
        units: exists
          ? current.units.map((unit) => unit.unitId === saved.unitId ? saved : unit)
          : [saved, ...current.units],
        residents: resident
          ? residentExists
            ? current.residents.map((person) => person.id === resident.id ? resident : person)
            : [resident, ...current.residents]
          : current.residents
      };
    });
    setSelectedUnitId(saved.unitId);
    setUnitFormMode("edit");
    setMessage("Unidade salva e morador vinculado ao cadastro da unidade.");
  }

  async function deleteUnit(unit) {
    if (!unit || !window.confirm(`Excluir unidade ${unit.unitNumber}?`)) return;
    const response = await fetch(`${apiUrl}/api/units/${unit.unitId}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("Falha ao excluir unidade.");
      return;
    }
    setSelectedUnitId("");
    setUnitFormMode("edit");
    setData((current) => ({
      ...current,
      units: current.units.filter((item) => item.unitId !== unit.unitId),
      residents: current.residents.filter((person) => person.unitId !== unit.unitId),
      credentials: current.credentials.filter((credential) => credential.unitId !== unit.unitId),
      unitLogins: current.unitLogins.filter((login) => login.unitId !== unit.unitId),
      unitInvites: current.unitInvites.filter((invite) => invite.unitId !== unit.unitId)
    }));
    setMessage("Unidade excluida.");
    void refreshApiCache();
  }

  async function savePersonForm(event, kind, currentPerson) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`${apiUrl}/api/people`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: currentPerson?.id,
        tenantId: selectedTenant?.id,
        unitId: form.get("unitId"),
        kind,
        name: form.get("name"),
        company: form.get("company"),
        cnpj: form.get("cnpj"),
        serviceType: form.get("serviceType"),
        cpf: form.get("cpf"),
        rg: form.get("rg"),
        phone: form.get("phone"),
        email: form.get("email"),
        relation: form.get("relation"),
        role: form.get("role"),
        authorizedBy: form.get("authorizedBy"),
        accessReason: form.get("accessReason"),
        vehiclePlate: form.get("vehiclePlate"),
        credentialType: form.get("credentialType"),
        allowedDays: form.get("allowedDays"),
        allowedHours: form.get("allowedHours")
      })
    });
    if (!response.ok) {
      setMessage("Falha ao salvar pessoa.");
      return;
    }
    const saved = await response.json();
    setData((current) => {
      const exists = current.residents.some((person) => person.id === saved.id);
      return {
        ...current,
        residents: exists
          ? current.residents.map((person) => person.id === saved.id ? saved : person)
          : [saved, ...current.residents]
      };
    });
    setSelectedPersonId(saved.id);
    setMessage(`${kind === "RESIDENT" ? "Morador" : kind === "VISITOR" ? "Visitante" : "Prestador"} salvo.`);
    void refreshApiCache();
  }

  async function deletePerson(person) {
    if (!person || !window.confirm(`Excluir ${person.name}?`)) return;
    const response = await fetch(`${apiUrl}/api/people/${person.id}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("Falha ao excluir pessoa.");
      return;
    }
    setSelectedPersonId("new");
    setData((current) => ({
      ...current,
      residents: current.residents.filter((item) => item.id !== person.id),
      credentials: current.credentials.filter((credential) => credential.personId !== person.id)
    }));
    setMessage("Pessoa excluida.");
    void refreshApiCache();
  }

  async function saveCredentialForm(event) {
    event.preventDefault();
    const payload = {
      ...credentialForm,
      tenantId: credentialForm.tenantId || selectedTenant?.id || "",
      unitId: credentialForm.unitId || selectedUnit?.unitId || ""
    };
    const response = await fetch(`${apiUrl}/api/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage(result?.message || "Falha ao salvar credencial.");
      return;
    }
    setData((current) => {
      const exists = current.credentials.some((credential) => credential.id === result.id);
      return {
        ...current,
        credentials: exists
          ? current.credentials.map((credential) => credential.id === result.id ? result : credential)
          : [result, ...current.credentials]
      };
    });
    setCredentialForm({ ...emptyCredentialForm, tenantId: selectedTenant?.id || "" });
    setMessage("Credencial salva e pendente de sincronismo.");
    void refreshApiCache();
  }

  async function deleteCredential(credential) {
    if (!credential?.id) return;
    if (!window.confirm(`Excluir credencial ${credential.valueLabel || credential.value || credential.type}?`)) return;
    const response = await fetch(`${apiUrl}/api/credentials/${encodeURIComponent(credential.id)}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(result.message || "Falha ao excluir credencial.");
      return;
    }
    setData((current) => ({
      ...current,
      credentials: current.credentials.filter((item) => item.id !== credential.id)
    }));
    setCredentialForm((current) => current.id === credential.id ? { ...emptyCredentialForm, tenantId: selectedTenant?.id || "" } : current);
    setMessage("Credencial excluida.");
    void refreshApiCache();
  }

  async function generateCredentialForPerson(person, type = person?.credentialType || "APP") {
    if (!person?.id) return;
    const response = await fetch(`${apiUrl}/api/credentials/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: person.tenantId || selectedTenant?.id,
        unitId: person.unitId,
        personId: person.id,
        credentialType: type
      })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage(result?.message || "Falha ao gerar credencial.");
      return;
    }
    setData((current) => ({
      ...current,
      credentials: [result, ...current.credentials.filter((credential) => credential.id !== result.id)]
    }));
    setMessage(`Credencial ${result.type} gerada para ${person.name}.`);
    void refreshApiCache();
  }

  async function syncCredentialTarget(payload) {
    const response = await fetch(`${apiUrl}/api/credential-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: selectedTenant?.id,
        manufacturer: payload.manufacturer || "Equipamentos",
        target: payload.target || "Sincronismo manual",
        credentialType: payload.credentialType || payload.type || "APP",
        personId: payload.personId || "",
        credentialId: payload.credentialId || "",
        deviceId: payload.deviceId || "",
        direction: payload.direction || "SEND"
      })
    });
    const job = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage(job?.message || "Falha ao sincronizar credencial.");
      return;
    }
    setData((current) => ({
      ...current,
      credentialSyncJobs: [job, ...current.credentialSyncJobs.filter((item) => item.id !== job.id)],
      credentials: current.credentials.map((credential) => {
        const result = job.results?.find((item) => item.credentialId === credential.id);
        return result?.ok ? { ...credential, syncStatus: "SYNCED", deviceId: result.deviceId, lastSyncedAt: job.lastRunAt } : credential;
      })
    }));
    setMessage(`Sincronismo ${job.status}: ${job.synced}/${job.total} credenciais.`);
    void refreshApiCache();
  }

  async function handleCredentialImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readImportRows(file);
      setCredentialImportRows(rows);
      setCredentialImportFile(file.name);
      const response = await fetch(`${apiUrl}/api/credentials/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: selectedTenant?.id, rows, dryRun: true })
      });
      const report = await response.json();
      setCredentialImportReport(report);
      setMessage(`Arquivo lido: ${report.valid} validos, ${report.invalid} invalidos, ${report.duplicates} duplicados.`);
    } catch (error) {
      setCredentialImportRows([]);
      setCredentialImportReport(null);
      setMessage(error instanceof Error ? error.message : "Falha ao ler arquivo de importacao.");
    }
  }

  async function commitCredentialImport() {
    if (!credentialImportRows.length) {
      setMessage("Selecione um arquivo para importar.");
      return;
    }
    const response = await fetch(`${apiUrl}/api/credentials/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: selectedTenant?.id, rows: credentialImportRows, dryRun: false })
    });
    const report = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage(report?.message || "Falha ao importar credenciais.");
      return;
    }
    setCredentialImportReport(report);
    setMessage(`Importacao concluida: ${report.peopleCreated} pessoas novas, ${report.credentialsCreated} credenciais.`);
    const payload = await refreshApiCache();
    if (payload) setData(payload);
  }

  function persistSession(nextSession) {
    setSession(nextSession);
    if (nextSession) {
      window.localStorage.setItem("condo-clean-session", JSON.stringify(nextSession));
    } else {
      window.localStorage.removeItem("condo-clean-session");
    }
  }

  async function saveDeviceForm(event) {
    event.preventDefault();
    const payload = {
      ...deviceForm,
      tenantId: deviceForm.tenantId || selectedTenant?.id || ""
    };
    const response = await fetch(`${apiUrl}/api/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      setMessage("Falha ao salvar equipamento.");
      return;
    }
    const saved = await response.json().catch(() => null);
    if (saved?.id) {
      setData((current) => {
        const exists = current.devices.some((device) => device.id === saved.id);
        return {
          ...current,
          devices: exists
            ? current.devices.map((device) => device.id === saved.id ? saved : device)
            : [saved, ...current.devices]
        };
      });
    }
    setDeviceForm({ ...emptyDeviceForm, tenantId: selectedTenant?.id || "" });
    setMessage(saved?.passwordSet
      ? "Equipamento salvo com senha de integracao."
      : "Equipamento salvo. Informe usuario/senha para testes e acionamentos do fabricante.");
    void refreshApiCache();
  }

  async function deleteDevice(device) {
    if (!device) return;
    const linkedCameras = data.cameras.filter((camera) => camera.deviceId === device.id).length;
    const linkedActions = data.actions.filter((action) => action.deviceId === device.id).length;
    const detail = [
      linkedCameras ? `${linkedCameras} camera(s)` : "",
      linkedActions ? `${linkedActions} acionamento(s)` : ""
    ].filter(Boolean).join(" e ");
    const suffix = detail ? ` Tambem serao removidos ${detail} vinculados.` : "";
    if (!window.confirm(`Excluir equipamento ${device.name}?${suffix}`)) return;

    const response = await fetch(`${apiUrl}/api/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(result.message || "Falha ao excluir equipamento.");
      return;
    }

    const removedCameraIds = new Set((result.removedCameras || []).map((camera) => camera.id));
    const removedActionIds = new Set((result.removedActions || []).map((action) => action.id));
    setData((current) => ({
      ...current,
      devices: current.devices.filter((item) => item.id !== device.id),
      cameras: current.cameras.filter((camera) => camera.deviceId !== device.id && !removedCameraIds.has(camera.id)),
      actions: current.actions.filter((action) => action.deviceId !== device.id && !removedActionIds.has(action.id))
    }));
    setDeviceForm((current) => current.id === device.id ? { ...emptyDeviceForm, tenantId: selectedTenant?.id || "" } : current);
    setMessage("Equipamento excluido.");
    void refreshApiCache();
  }

  async function saveLicenseForm(event) {
    event.preventDefault();
    const response = await fetch(`${apiUrl}/api/licenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(licenseForm)
    });
    if (!response.ok) {
      setMessage("Falha ao salvar licenca.");
      return;
    }
    const saved = await response.json().catch(() => null);
    if (saved?.id) {
      setData((current) => {
        const exists = current.licenses.some((license) => license.id === saved.id);
        return {
          ...current,
          licenses: exists
            ? current.licenses.map((license) => license.id === saved.id ? saved : license)
            : [saved, ...current.licenses]
        };
      });
    }
    setLicenseForm(emptyLicenseForm);
    setMessage("Licenca salva.");
    void refreshApiCache();
  }

  async function saveCameraForm(event) {
    event.preventDefault();
    const formValues = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = {
      ...cameraForm,
      ...formValues,
      channelCount: formValues.channelCount || cameraForm.channelCount,
      photoCaptureEnabled: formValues.photoCaptureEnabled === "true",
      tenantId: cameraForm.tenantId || selectedTenant?.id || ""
    };
    const response = await fetch(`${apiUrl}/api/cameras`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage("Falha ao salvar camera.");
      return;
    }
    const saved = Array.isArray(result) ? result[0] : result;
    const savedCameras = Array.isArray(result) ? result : [result].filter(Boolean);
    if (savedCameras.length) {
      setData((current) => {
        const savedIds = new Set(savedCameras.map((camera) => camera.id));
        return {
          ...current,
          cameras: [
            ...savedCameras,
            ...current.cameras.filter((camera) => !savedIds.has(camera.id))
          ]
        };
      });
    }
    setCameraForm({ ...emptyCameraForm, tenantId: selectedTenant?.id || "" });
    setShowCameraForm(false);
    setMessage(saved?.passwordSet
      ? "Camera(s) salva(s) com senha RTSP."
      : "Camera(s) salva(s). Informe a senha RTSP para liberar HLS/APK.");
    void refreshApiCache();
  }

  async function deleteCamera(camera) {
    if (!window.confirm(`Excluir camera ${camera.description || camera.name}?${camera.groupId ? " Todos os canais deste DVR/NVR tambem serao removidos." : ""}`)) return;
    const response = await fetch(`${apiUrl}/api/cameras/${encodeURIComponent(camera.id)}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(result.message || "Falha ao excluir camera.");
      return;
    }
    const removedCount = Array.isArray(result.removed) ? result.removed.length : 1;
    const removedIds = new Set((Array.isArray(result.removed) ? result.removed : [camera]).map((item) => item.id));
    setData((current) => ({
      ...current,
      cameras: current.cameras.filter((item) => !removedIds.has(item.id) && (!camera.groupId || item.groupId !== camera.groupId))
    }));
    setMessage(removedCount > 1 ? `${removedCount} canais de camera excluidos.` : "Camera excluida.");
    void refreshApiCache();
  }

  async function saveActionForm(event) {
    event.preventDefault();
    const response = await fetch(`${apiUrl}/api/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...actionForm, tenantId: actionForm.tenantId || selectedTenant?.id, relay: Number(actionForm.relay || 1) })
    });
    if (!response.ok) {
      setMessage("Falha ao salvar acionamento.");
      return;
    }
    const saved = await response.json().catch(() => null);
    if (saved?.id) {
      setData((current) => {
        const exists = current.actions.some((action) => action.id === saved.id);
        return {
          ...current,
          actions: exists
            ? current.actions.map((action) => action.id === saved.id ? saved : action)
            : [saved, ...current.actions]
        };
      });
    }
    setActionForm(defaultActionForm());
    setMessage("Acionamento salvo.");
    void refreshApiCache();
  }

  async function deleteAction(action) {
    if (!window.confirm(`Excluir acionamento ${action.name}?`)) return;
    const response = await fetch(`${apiUrl}/api/actions/${action.id}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("Falha ao excluir acionamento.");
      return;
    }
    setData((current) => ({
      ...current,
      actions: current.actions.filter((item) => item.id !== action.id)
    }));
    setMessage("Acionamento excluido.");
    void refreshApiCache();
  }

  async function triggerAction(action) {
    const response = await fetch(`${apiUrl}/api/actions/${action.id}/trigger`, { method: "POST" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(result.message || `Falha ao acionar ${action.name}.`);
      return;
    }
    const sentAt = new Date().toISOString();
    const feedback = {
      id: `${action.id}-${sentAt}`,
      actionId: action.id,
      name: action.name,
      route: action.route || result.door?.name || "Portaria",
      sentAt,
      message: result.message || `Acionamento ${action.name} enviado.`
    };
    setActionFeedback(feedback);
    setMessage(feedback.message);
    if (result.log?.id) {
      setData((current) => ({
        ...current,
        accessLogs: [result.log, ...current.accessLogs.filter((event) => event.id !== result.log.id)].slice(0, 200)
      }));
    }
  }

  async function refreshDeviceStatus() {
    if (!selectedTenant?.id) return;
    const response = await fetch(`${apiUrl}/api/devices/status?tenantId=${encodeURIComponent(selectedTenant.id)}`, { method: "POST" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(result.message || "Falha ao atualizar status dos equipamentos.");
      return;
    }
    const offlineCount = Array.isArray(result.offline) ? result.offline.length : 0;
    setMessage(offlineCount ? `${offlineCount} equipamento(s) desconectado(s).` : "Todos os equipamentos estao online.");
    if (Array.isArray(result.devices)) {
      setData((current) => ({
        ...current,
        devices: current.devices.map((device) => result.devices.find((item) => item.id === device.id) || device)
      }));
    }
  }

  async function testDeviceIntegration(device) {
    const response = await fetch(`${apiUrl}/api/devices/${encodeURIComponent(device.id)}/test`);
    const result = await response.json().catch(() => ({}));
    const adapter = result.adapter || device.manufacturer || "Generico";
    setData((current) => ({
      ...current,
      devices: current.devices.map((item) => item.id === device.id
        ? {
          ...item,
          status: result.ok ? "ONLINE" : "OFFLINE",
          statusReason: result.message || result.tcp?.reason || "",
          lastCheckedAt: result.checkedAt || new Date().toISOString(),
          latencyMs: result.tcp?.latencyMs ?? item.latencyMs
        }
        : item)
    }));
    if (!response.ok) {
      setMessage(`${adapter}: ${result.message || "falha ao testar equipamento"}`);
      return;
    }
    setMessage(`${adapter}: ${result.message || "integracao OK"}`);
  }

  async function readEquipmentIntegration(resource = equipmentIntegration.resource) {
    const deviceId = equipmentIntegration.deviceId || selectedIntegrationDevice?.id || "";
    if (!deviceId) {
      setMessage("Cadastre um equipamento antes de ler integracoes.");
      return;
    }
    setEquipmentIntegration((current) => ({ ...current, deviceId, resource, loading: true, error: "" }));
    const response = await fetch(`${apiUrl}/api/devices/${encodeURIComponent(deviceId)}/integration/${resource}?limit=80`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = result.message || "Falha ao ler integracao do equipamento.";
      setEquipmentIntegration((current) => ({ ...current, loading: false, error }));
      setMessage(error);
      return;
    }
    setEquipmentIntegration((current) => ({
      ...current,
      resource,
      loading: false,
      error: "",
      updatedAt: result.generatedAt || new Date().toISOString(),
      payload: result
    }));
    const count = Array.isArray(result.records) ? result.records.length : result.summary?.[resource] || 0;
    setMessage(`${result.device?.name || "Equipamento"}: ${count} registro(s) em ${resource}.`);
  }

  async function importEquipmentCredentials(dryRun = true) {
    const deviceId = equipmentIntegration.deviceId || selectedIntegrationDevice?.id || "";
    if (!deviceId) {
      setMessage("Selecione um equipamento para buscar credenciais.");
      return;
    }
    setEquipmentIntegration((current) => ({
      ...current,
      deviceId,
      resource: "credentials",
      importing: true,
      error: ""
    }));
    const response = await fetch(`${apiUrl}/api/devices/${encodeURIComponent(deviceId)}/integration/credentials/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun,
        selections: dryRun ? [] : Object.values(equipmentFaceSelections)
      })
    });
    const report = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = report.message || "Falha ao importar credenciais do equipamento.";
      setEquipmentIntegration((current) => ({ ...current, importing: false, error, importReport: report }));
      setMessage(error);
      return;
    }
    setEquipmentIntegration((current) => ({
      ...current,
      importing: false,
      updatedAt: report.generatedAt || new Date().toISOString(),
      importReport: report
    }));
    if (dryRun) {
      const nextSelections = {};
      (report.items || [])
        .filter((item) => item.payload?.type === "FACE")
        .forEach((item) => {
          const key = faceImportSelectionKey(item);
          nextSelections[key] = {
            key,
            row: item.row,
            recordId: item.payload?.recordId || "",
            type: item.payload?.type || "FACE",
            value: item.payload?.value || "",
            selected: true,
            unitNumber: item.payload?.unitNumber || "",
            blockName: item.payload?.blockName || ""
          };
        });
      setEquipmentFaceSelections(nextSelections);
    }
    if (!dryRun) {
      const payload = await refreshApiCache();
      if (payload) setData(payload);
    }
    setMessage(dryRun
      ? `${report.total || 0} credencial(is) encontrada(s) no equipamento para conferencia.`
      : `Importacao concluida: ${report.credentialsCreated || 0} nova(s), ${report.credentialsUpdated || 0} atualizada(s).`);
  }

  async function refreshExtensionStatus() {
    if (!selectedTenant?.id) return;
    const response = await fetch(`${apiUrl}/api/extensions/status?tenantId=${encodeURIComponent(selectedTenant.id)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(result.message || "Falha ao atualizar ramais.");
      return;
    }
    const extensions = Array.isArray(result.extensions) ? result.extensions : Array.isArray(result) ? result : [];
    setData((current) => ({ ...current, extensionStatus: extensions }));
    setSyncState((current) => ({ ...current, status: "synced", error: "", lastSyncAt: new Date() }));
  }

  async function refreshPorterTelephony({ silent = false } = {}) {
    try {
      const [callsResponse, extensionsResponse] = await Promise.all([
        fetch(`${apiUrl}/api/telephony/calls`).catch(() => null),
        selectedTenant?.id
          ? fetch(`${apiUrl}/api/extensions/status?tenantId=${encodeURIComponent(selectedTenant.id)}`).catch(() => null)
          : Promise.resolve(null)
      ]);
      const callsPayload = callsResponse?.ok ? await callsResponse.json().catch(() => []) : [];
      const extensionsPayload = extensionsResponse?.ok ? await extensionsResponse.json().catch(() => null) : null;
      const nextCalls = Array.isArray(callsPayload) ? callsPayload : [];
      const nextExtensions = Array.isArray(extensionsPayload?.extensions)
        ? extensionsPayload.extensions
        : Array.isArray(extensionsPayload)
          ? extensionsPayload
          : null;

      setData((current) => ({
        ...current,
        intercomCalls: nextCalls.length ? nextCalls : current.intercomCalls,
        extensionStatus: nextExtensions || current.extensionStatus
      }));
      if (!silent) {
        setSyncState((current) => ({ ...current, status: "synced", error: "", lastSyncAt: new Date() }));
      }
    } catch (error) {
      if (!silent) {
        setSyncState({ status: "offline", error: error instanceof Error ? error.message : "Falha ao sincronizar portaria", lastSyncAt: new Date() });
      }
    }
  }

  async function refreshAccessEvents({ silent = false } = {}) {
    if (!selectedTenant?.id) return;
    try {
      const latestEventTime = Math.max(0, ...tenantEvents.map((event) => Date.parse(event.createdAt || event.occurredAt || "") || 0));
      const sinceParam = latestEventTime ? `&since=${encodeURIComponent(new Date(latestEventTime).toISOString())}` : "";
      const response = await fetch(`${apiUrl}/api/access/logs?tenantId=${encodeURIComponent(selectedTenant.id)}&limit=80${sinceParam}`);
      const events = response.ok ? await response.json().catch(() => []) : [];
      if (Array.isArray(events) && events.length) {
        setData((current) => {
          const existingIds = new Set(current.accessLogs.map((event) => event.id));
          const merged = [...events.filter((event) => !existingIds.has(event.id)), ...current.accessLogs];
          return { ...current, accessLogs: merged.slice(0, 200) };
        });
      }
      if (!silent) {
        setSyncState((current) => ({ ...current, status: "synced", error: "", lastSyncAt: new Date() }));
      }
    } catch (error) {
      if (!silent) {
        setSyncState({ status: "offline", error: error instanceof Error ? error.message : "Falha ao atualizar eventos", lastSyncAt: new Date() });
      }
    }
  }

  async function downloadPorterEventReport() {
    if (!selectedTenant?.id) return;
    const date = porterReportDate || new Date().toISOString().slice(0, 10);
    const from = new Date(`${date}T00:00:00`).toISOString();
    const to = new Date(`${date}T23:59:59.999`).toISOString();
    const response = await fetch(`${apiUrl}/api/access/logs?tenantId=${encodeURIComponent(selectedTenant.id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=1000`);
    const events = response.ok ? await response.json().catch(() => []) : [];
    if (!response.ok || !Array.isArray(events)) {
      setMessage("Falha ao gerar relatorio de eventos.");
      return;
    }
    const rows = [
      ["Data/hora", "Evento", "Origem", "Usuario", "Unidade", "Status"],
      ...events.map((event) => [
        formatDateTime(event.createdAt || event.occurredAt),
        event.reason || event.door?.name || "Evento",
        event.door?.name || event.door?.manufacturer || event.rawEvent?.adapter || "API",
        event.user?.name || "-",
        event.unit?.number || event.unitId || "-",
        event.decision || "INFO"
      ])
    ];
    downloadCsv(`eventos-${selectedTenant.name || "condominio"}-${date}.csv`, rows);
    setMessage(`Relatorio gerado com ${events.length} evento(s).`);
  }

  function toggleMosaicCamera(key) {
    setSelectedMosaicKeys((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key]);
  }

  useEffect(() => {
    if (activeSection !== "devices" || deviceTab !== "painel" || !selectedTenant?.id) return undefined;
    void refreshDeviceStatus();
    const timer = window.setInterval(() => void refreshDeviceStatus(), 60000);
    return () => window.clearInterval(timer);
  }, [activeSection, deviceTab, selectedTenant?.id]);

  useEffect(() => {
    if (activeSection !== "remotePorter") return undefined;
    void refreshPorterTelephony({ silent: true });
    const timer = window.setInterval(() => void refreshPorterTelephony({ silent: true }), 4000);
    return () => window.clearInterval(timer);
  }, [activeSection, selectedTenant?.id]);

  useEffect(() => {
    if (!selectedTenant?.id) return undefined;
    void refreshAccessEvents({ silent: true });
    const timer = window.setInterval(() => void refreshAccessEvents({ silent: true }), activeSection === "dashboard" || activeSection === "remotePorter" ? 2500 : 5000);
    return () => window.clearInterval(timer);
  }, [activeSection, selectedTenant?.id]);

  useEffect(() => {
    const call = incomingCall || activeSelectedCall;
    if (!call) return;
    if (call.tenantId && call.tenantId !== selectedTenantId) {
      setSelectedTenantId(call.tenantId);
    }
    setSelectedCallId((current) => current || call.id);
    setPorterDrawerOpen(true);
    const unit = resolveCallUnit(call, data.units, call.tenantId || selectedTenantId);
    if (unit) {
      setPorterSelectedUnitId(unit.unitId);
      setPorterUnitSearch(`${unit.blockName || ""} ${unit.unitNumber || ""}`.trim());
    } else {
      setPorterSelectedUnitId("");
    }
  }, [activeSelectedCall, data.units, incomingCall, selectedTenantId]);

  function findPorterActionForCall(call) {
    if (!call) return null;
    const tenantId = call.tenantId || selectedTenant?.id || "";
    const candidates = data.actions.filter((action) => (!tenantId || action.tenantId === tenantId) && action.status !== "DISABLED");
    if (!candidates.length) return null;

    const porterTerms = ["portaria", "entrada", "principal", "social", "pedestre", "interfone", "facial", "eclusa"];
    const scoreAction = (action) => {
      const text = `${action.name || ""} ${action.route || ""}`.toLowerCase();
      const matchedIndex = porterTerms.findIndex((term) => text.includes(term));
      return matchedIndex === -1 ? porterTerms.length : matchedIndex;
    };

    return [...candidates].sort((left, right) => scoreAction(left) - scoreAction(right))[0];
  }

  async function triggerPorterActionForCall(call) {
    const action = findPorterActionForCall(call);
    if (!action) {
      const message = "Nao ha acionamento de portaria ativo para este condominio.";
      setMessage(message);
      return { ok: false, reason: "NO_ACTION", message };
    }

    try {
      const response = await fetch(`${apiUrl}/api/actions/${action.id}/trigger`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = result.message || `Falha ao acionar ${action.name}.`;
        setMessage(message);
        return { ok: false, reason: "TRIGGER_ERROR", message, action };
      }

      const sentAt = new Date().toISOString();
      const message = result.message || `Acionamento ${action.name} enviado.`;
      setActionFeedback({
        id: `${action.id}-${sentAt}`,
        actionId: action.id,
        name: action.name,
        route: action.route || result.door?.name || "Portaria",
        sentAt,
        message
      });
      setMessage(message);
      return { ok: true, action, message };
    } catch (error) {
      const message = error instanceof Error ? error.message : `Falha ao acionar ${action.name}.`;
      setMessage(message);
      return { ok: false, reason: "TRIGGER_ERROR", message, action };
    }
  }

  async function answerCall(call) {
    if (!call) return;
    const tenantId = call.tenantId || selectedTenant?.id || "";
    if (tenantId) setSelectedTenantId(tenantId);
    setSelectedCallId(call.id);
    setActiveSection("remotePorter");
    setResourceTab("portaria");

    try {
      if (webPhone.status === "RINGING") {
        await answerWebPhone();
      }
    } catch {
      // A abertura da portaria e o registro da chamada continuam mesmo se o audio do navegador falhar.
    }

    try {
      const response = await fetch(`${apiUrl}/api/telephony/calls/${call.id}/answer`, { method: "POST" });
      const updated = await response.json().catch(() => null);
      if (!response.ok) throw new Error(updated?.message || "Falha ao atender chamada.");
      if (updated?.id) {
        setData((current) => ({
          ...current,
          intercomCalls: current.intercomCalls.map((item) => item.id === updated.id ? updated : item)
        }));
      }

      const porterResult = await triggerPorterActionForCall(call);
      setMessage(porterResult.ok
        ? `Chamada da unidade ${call.unitNumber || call.unitId || "-"} atendida e portaria acionada.`
        : `Chamada da unidade ${call.unitNumber || call.unitId || "-"} atendida. ${porterResult.message}`);
      void refreshApiCache();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao atender chamada.");
    }
  }

  async function markCallAnswered(call) {
    if (!call?.id) return;
    const response = await fetch(`${apiUrl}/api/telephony/calls/${call.id}/answer`, { method: "POST" });
    const updated = await response.json().catch(() => null);
    if (!response.ok) throw new Error(updated?.message || "Falha ao atualizar chamada.");
    if (updated?.id) {
      setData((current) => ({
        ...current,
        intercomCalls: current.intercomCalls.map((item) => item.id === updated.id ? updated : item)
      }));
    }
    void refreshApiCache();
  }

  async function rejectIncomingCall(call) {
    if (!call) return;
    try {
      if (webPhone.status === "RINGING") {
        await hangupWebPhone();
      }
      await endCall(call);
    } catch {
      setMessage("Falha ao encerrar chamada recebida.");
    }
  }

  async function endCall(call, options = {}) {
    if (!call) return;
    const response = await fetch(`${apiUrl}/api/telephony/calls/${call.id}/end`, { method: "POST" });
    const updated = await response.json().catch(() => null);
    if (updated?.id) {
      setData((current) => ({
        ...current,
        intercomCalls: current.intercomCalls.map((item) => item.id === updated.id ? updated : item)
      }));
    }
    if (options.clearSelection !== false) setSelectedCallId("");
    if (!options.quiet) setMessage("Chamada encerrada.");
    void refreshApiCache();
  }

  async function toggleResource(resource, enabled) {
    setData((current) => ({
      ...current,
      resources: current.resources.map((item) => item.id === resource.id ? { ...item, enabled } : item)
    }));
    await fetch(`${apiUrl}/api/resources/${resource.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    setMessage(`Recurso ${resource.name} ${enabled ? "habilitado" : "desabilitado"}.`);
  }

  async function enqueueCredentialSync(profile, type = "FACE") {
    await syncCredentialTarget({
      manufacturer: profile.name,
      target: `${profile.name} - sincronismo manual`,
      credentialType: type
    });
  }

  function integrationRecordCells(record, resource) {
    const raw = record.raw || {};
    const rawSummary = [
      raw.id ? `ID ${raw.id}` : "",
      raw.registration ? `Matricula ${raw.registration}` : "",
      raw.user_type_id ? `Tipo ${raw.user_type_id}` : "",
      raw.image_timestamp ? "Imagem facial" : "",
      record.sourceKind || record.source || ""
    ].filter(Boolean).join(" - ");
    if (resource === "events") {
      return [
        <span><strong>{record.reason || record.doorName || "Evento"}</strong><small>{record.doorName || record.manufacturer || record.scope}</small></span>,
        record.userName || record.userId || "-",
        <span className={`status ${record.decision === "DENY" ? "offline" : ""}`}>{record.decision || "INFO"}</span>,
        formatDateTime(record.createdAt)
      ];
    }
    if (resource === "credentials") {
      return [
        <span><strong>{record.personName}</strong><small>Unidade {record.unitNumber || "-"}</small></span>,
        <span><strong>{record.type}</strong><small>{rawSummary || record.source || "LOCAL"}</small></span>,
        <span><strong>{record.valueLabel || "-"}</strong><small>{record.devicePath || record.deviceId || "-"}</small></span>,
        <span className={`status ${record.syncStatus === "PENDING" || record.syncStatus === "ERROR" ? "offline" : ""}`}>{record.syncStatus || "LOCAL"}</span>
      ];
    }
    if (resource === "schedules") {
      const validity = record.validFrom || record.validUntil
        ? `${record.validFrom ? formatDateTime(record.validFrom) : "Inicio livre"} ate ${record.validUntil ? formatDateTime(record.validUntil) : "sem fim"}`
        : `${record.allowedDays || "Todos"} / ${record.allowedHours || "24h"}`;
      return [
        <span><strong>{record.name || "Horario"}</strong><small>{record.type}</small></span>,
        record.origin || "-",
        validity,
        record.target || "-"
      ];
    }
    if (resource === "faces") {
      return [
        <span><strong>{record.personName}</strong><small>Unidade {record.unitNumber || "-"}</small></span>,
        <span><strong>{record.valueLabel || "Face cadastrada"}</strong><small>{rawSummary || record.source || "Equipamento"}</small></span>,
        <span className={`status ${record.syncStatus === "PENDING" || record.syncStatus === "ERROR" ? "offline" : ""}`}>{record.syncStatus || "LOCAL"}</span>,
        record.validUntil ? formatDateTime(record.validUntil) : "Sem validade final"
      ];
    }
    return [
      <span><strong>{record.name}</strong><small>{record.kind || "Pessoa"} - {record.role || "Usuario"}</small></span>,
      <span><strong>{record.unitNumber ? `Unidade ${record.unitNumber}` : "-"}</strong><small>{rawSummary || record.source || ""}</small></span>,
      record.phone || record.email || record.cpf || record.externalId || "-",
      `${record.credentials?.length || 0} credencial(is)`
    ];
  }

  if (!session) {
    return <LocalLogin onLogin={persistSession} />;
  }

  function renderPersonRegistry(kind, title, scopeUnit = false) {
    const people = data.residents.filter((person) => {
      const sameTenant = person.tenantId === selectedTenant?.id;
      const sameKind = (person.kind || "RESIDENT") === kind;
      const sameUnit = !scopeUnit || person.unitId === selectedUnit?.unitId;
      return sameTenant && sameKind && sameUnit;
    });
    const currentPerson = selectedPersonId === "new" ? {} : people.find((person) => person.id === selectedPersonId) || people[0] || {};
    const isResident = kind === "RESIDENT";
    const isVisitor = kind === "VISITOR";
    const currentPersonCredentials = currentPerson.id
      ? data.credentials.filter((credential) => credential.personId === currentPerson.id)
      : [];
    const currentPersonFace = currentPersonCredentials.find((credential) => credential.type === "FACE");

    return (
      <section className="people-layout">
        <form className="panel form-panel" key={`${kind}-${currentPerson.id || "new"}-${selectedUnit?.unitId || "all"}`} onSubmit={(event) => savePersonForm(event, kind, currentPerson)}>
          <div className="panel-heading"><h2>{currentPerson.id ? `Editar ${title.toLowerCase()}` : `Novo ${title.toLowerCase()}`}</h2><UserRound size={20} /></div>
          <div className="form-grid">
            <Field label={isVisitor ? "Unidade visitada" : kind === "PROVIDER" ? "Unidade atendida" : "Unidade"}><select name="unitId" defaultValue={currentPerson.unitId || selectedUnit?.unitId}>{units.map((unit) => <option key={unit.unitId} value={unit.unitId}>Unidade {unit.unitNumber}</option>)}</select></Field>
            <Field label={isVisitor ? "Nome do visitante" : kind === "PROVIDER" ? "Nome do prestador" : "Nome completo"}><input name="name" defaultValue={currentPerson.name || ""} /></Field>
            {kind === "PROVIDER" && <Field label="Empresa"><input name="company" defaultValue={currentPerson.company || ""} /></Field>}
            {kind === "PROVIDER" && <Field label="CNPJ"><input name="cnpj" defaultValue={currentPerson.cnpj || ""} /></Field>}
            {kind === "PROVIDER" && <Field label="Servico"><input name="serviceType" defaultValue={currentPerson.serviceType || ""} /></Field>}
            <Field label="CPF/Documento"><input name="cpf" defaultValue={currentPerson.cpf || ""} /></Field>
            {isResident && <Field label="RG"><input name="rg" defaultValue={currentPerson.rg || ""} /></Field>}
            <Field label="Celular"><input name="phone" defaultValue={currentPerson.phone || ""} /></Field>
            {isResident && <Field label="E-mail/Login"><input name="email" defaultValue={currentPerson.email || ""} /></Field>}
            {isResident && <Field label="Relacao"><select name="relation" defaultValue={currentPerson.relation || "Responsavel"}><option>Proprietario</option><option>Morador</option><option>Responsavel</option><option>Responsavel financeiro</option></select></Field>}
            {isResident && <Field label="Permissao"><select name="role" defaultValue={currentPerson.role || "RESIDENT"}><option value="CONDO_ADMIN">Administrador</option><option value="PORTER">Porteiro</option><option value="RESIDENT">Usuario normal</option></select></Field>}
            {isResident && <Field label="Nova senha"><input type="password" placeholder="Preencha apenas para alterar" /></Field>}
            {isVisitor && <Field label="Autorizado por"><input name="authorizedBy" defaultValue={currentPerson.authorizedBy || selectedUnit?.residentName || ""} /></Field>}
            {isVisitor && <Field label="Motivo"><input name="accessReason" defaultValue={currentPerson.accessReason || ""} /></Field>}
            {isVisitor && <Field label="Placa"><input name="vehiclePlate" defaultValue={currentPerson.vehiclePlate || ""} /></Field>}
            <Field label={isResident ? "Credencial padrao" : "Credencial"}><select name="credentialType" defaultValue={currentPerson.credentialType || (isResident ? "APP" : "QR_CODE")}><option>APP</option><option>FACE</option><option>RFID</option><option>QR_CODE</option><option>PIN</option><option>PLATE</option></select></Field>
            {isResident && <Field label="Facial do equipamento"><input readOnly value={currentPersonFace ? `${currentPersonFace.valueLabel || currentPersonFace.value} (${currentPersonFace.source || "equipamento"})` : "Nenhuma facial importada"} /></Field>}
            {kind === "PROVIDER" && <Field label="Dias permitidos"><input name="allowedDays" defaultValue={currentPerson.allowedDays || ""} /></Field>}
            {kind === "PROVIDER" && <Field label="Horario permitido"><input name="allowedHours" defaultValue={currentPerson.allowedHours || ""} /></Field>}
            {isVisitor && <Field label="Valido de"><input type="datetime-local" /></Field>}
            {isVisitor && <Field label="Valido ate"><input type="datetime-local" /></Field>}
          </div>
          <div className="toolbar-actions unit-actions"><button type="submit"><Save size={16} /> Salvar {title.toLowerCase()}</button><button className="secondary-button" type="button" disabled={!currentPerson.id} onClick={() => void generateCredentialForPerson(currentPerson, currentPerson.credentialType || (isResident ? "APP" : "QR_CODE"))}>Gerar credencial</button>{currentPerson.id && <button className="danger-button" type="button" onClick={() => void deletePerson(currentPerson)}><Trash2 size={16} /> Excluir</button>}</div>
        </form>
        <article className="panel people-panel">
          <div className="resource-toolbar">
            <label className="search-field"><Search size={16} /><input placeholder={`Filtre por ${title.toLowerCase()}`} /></label>
            <button type="button" onClick={() => setSelectedPersonId("new")}><Plus size={16} /> Novo {title.toLowerCase()}</button>
          </div>
          <div className="people-header"><span>Nome</span><span>Documentos</span><span>Celular</span><span>Relacao</span><span>Acoes</span></div>
          {people.map((person) => (
            <div className="person-row" key={person.id}>
              <button className="person-name-cell row-link" onClick={() => setSelectedPersonId(person.id)}><span className="avatar">{person.name?.[0]}</span><div><strong>{person.name}</strong><small>{person.email || person.company || person.authorizedBy || "Sem login"}</small><small>{isResident ? `Permissao: ${person.role || "RESIDENT"} - Face ${data.credentials.some((credential) => credential.personId === person.id && credential.type === "FACE") ? "importada" : "pendente"}` : person.credentialType}</small></div></button>
              <span>CPF: {person.cpf || "-"}<br />RG: {person.rg || "-"}</span>
              <span>{person.phone || "-"}</span>
              <span>{kind === "PROVIDER" ? person.serviceType || "-" : person.relation || person.accessReason || "-"}</span>
              <div className="row-actions"><button className="compact-action-button secondary-button" onClick={() => void generateCredentialForPerson(person, person.credentialType || (isResident ? "APP" : "QR_CODE"))}>Credencial</button><button className="compact-action-button secondary-button" onClick={() => void generateCredentialForPerson(person, "FACE")}>Face</button><button className="compact-action-button secondary-button" onClick={() => void syncCredentialTarget({ personId: person.id, credentialType: person.credentialType || "APP", target: `Pessoa ${person.name}` })}>Sincronizar</button><button className="compact-action-button secondary-button" onClick={() => setSelectedPersonId(person.id)}>Editar</button><button className="compact-action-button danger-button" onClick={() => void deletePerson(person)}>Excluir</button></div>
            </div>
          ))}
        </article>
      </section>
    );
  }

  function renderContent() {
    if (activeSection === "dashboard") {
      return (
        <section className="dashboard-panel">
          <div className="resource-hero panel">
            <div>
              <span>Dashboard do condominio</span>
              <h2>{selectedTenant?.name || "-"}</h2>
              <small>{selectedTenant?.document || "Documento nao informado"} - {selectedTenant?.status || "ACTIVE"}</small>
            </div>
            <Field label="Condominio"><select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)}>{data.condominiums.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          </div>
          <div className="metrics">
            <Metric icon={Home} label="unidades" value={units.length} />
            <Metric icon={RadioTower} label="equipamentos" value={tenantDevices.length} />
            <Metric icon={Camera} label="cameras" value={tenantCameras.length} />
            <Metric icon={PhoneCall} label="chamadas ativas" value={tenantCalls.length} />
          </div>
          <div className="grid">
            <article className="panel">
              <div className="panel-heading"><h2>Operacao</h2><Activity size={20} /></div>
              <div className="summary-list">
                <span><strong>API</strong> {syncState.status === "offline" ? "Offline" : "Conectada"}</span>
                <span><strong>Ramal portaria</strong> {selectedTenant?.sipPorterExtension || "-"}</span>
                <span><strong>Mobile</strong> Chamada por unidade</span>
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading"><h2>Fila da portaria</h2><PhoneCall size={20} /></div>
              {tenantCalls.length ? (
                <div className="simple-list">{tenantCalls.slice(0, 5).map((call) => <div className="simple-row" key={call.id}><PhoneCall size={18} /><div><strong>Unidade {call.unitNumber || call.unitId}</strong><span>{call.visitorLabel || call.targetType}</span></div><span className="status">{call.status}</span></div>)}</div>
              ) : <div className="empty-state">Nenhuma chamada ativa. Chamadas do facial/interfone aparecem aqui em tempo real.</div>}
            </article>
            <article className="panel">
              <div className="panel-heading"><h2>Eventos recentes</h2><ClipboardList size={20} /></div>
              {tenantEvents.length ? (
                <div className="simple-list">{tenantEvents.slice(0, 5).map((event) => <div className="simple-row" key={event.id}><BadgeCheck size={18} /><div><strong>{event.door?.name || event.reason}</strong><span>{event.user?.name || "Portaria"} - {formatDateTime(event.createdAt)}</span></div><span className="status">{event.decision || "INFO"}</span></div>)}</div>
              ) : <div className="empty-state">Nenhum evento recebido ainda.</div>}
            </article>
          </div>
        </section>
      );
    }

    if (activeSection === "condoHome") {
      const functionCards = [
        ["units", "Unidades", Home, "Cadastro, moradores, telefonia e convites", () => { setActiveSection("units"); setUnitTab("geral"); }],
        ["residents", "Pessoas", Users, "Moradores, visitantes e prestadores", () => setActiveSection("residents")],
        ["devices", "Equipamentos", RadioTower, "Faciais, NVRs, controladoras e SDK", () => { setActiveSection("devices"); setDeviceTab("inicio"); }],
        ["cameras", "Cameras", Camera, "Canais e streams do condominio", () => { setActiveSection("devices"); setDeviceTab("cameras"); }],
        ["actions", "Acionamentos", KeySquare, "Portas, reles e comandos remotos", () => { setActiveSection("devices"); setDeviceTab("actions"); }],
        ["credentials", "Credenciais", BadgeCheck, "Face, QR, RFID e sincronismo", () => setActiveSection("credentials")],
        ["permissions", "Permissoes", ShieldCheck, "Perfis por usuario e rota", () => setActiveSection("permissions")],
        ["resources", "Recursos", ClipboardList, "Modulos habilitados e gateway", () => setActiveSection("resources")]
      ];
      return (
        <section className="dashboard-panel">
          <div className="resource-hero panel">
            <div>
              <span>Painel do condominio</span>
              <h2>{selectedTenant?.name || "-"}</h2>
              <small>{selectedTenant?.document || "Documento nao informado"} - {selectedTenant?.status || "ACTIVE"}</small>
            </div>
            <button type="button" onClick={() => { setCondoFormMode("edit"); setActiveSection("condoForm"); }}><Building2 size={16} /> Editar cadastro</button>
          </div>
          <div className="metrics">
            <Metric icon={Home} label="unidades" value={units.length} />
            <Metric icon={Users} label="pessoas" value={data.residents.filter((person) => person.tenantId === selectedTenant?.id).length} />
            <Metric icon={RadioTower} label="equipamentos" value={tenantDevices.length} />
            <Metric icon={Camera} label="cameras" value={tenantCameras.length} />
          </div>
          <div className="condo-function-grid">
            {functionCards.map(([id, label, Icon, detail, onClick]) => (
              <button className="condo-function-card" type="button" key={id} onClick={onClick}>
                <Icon size={22} />
                <strong>{label}</strong>
                <span>{detail}</span>
              </button>
            ))}
          </div>
          <div className="grid">
            <article className="panel">
              <div className="panel-heading"><h2>Eventos do condominio</h2><ClipboardList size={20} /></div>
              {tenantEvents.length ? (
                <div className="simple-list">{tenantEvents.slice(0, 6).map((event) => <div className="simple-row" key={event.id}><BadgeCheck size={18} /><div><strong>{event.door?.name || event.reason}</strong><span>{event.user?.name || "Portaria"} - {formatDateTime(event.createdAt)}</span></div><span className="status">{event.decision || "INFO"}</span></div>)}</div>
              ) : <div className="empty-state">Nenhum evento recebido ainda.</div>}
            </article>
            <article className="panel">
              <div className="panel-heading"><h2>Chamadas</h2><PhoneCall size={20} /></div>
              {tenantCalls.length ? (
                <div className="simple-list">{tenantCalls.slice(0, 6).map((call) => <div className="simple-row" key={call.id}><PhoneCall size={18} /><div><strong>Unidade {call.unitNumber || call.unitId}</strong><span>{call.visitorLabel || call.targetType}</span></div><span className="status">{call.status}</span></div>)}</div>
              ) : <div className="empty-state">Nenhuma chamada para este condominio.</div>}
            </article>
          </div>
        </section>
      );
    }

    if (activeSection === "condominiums") {
      return (
        <section className="condominiums-page">
          <div className="resource-toolbar">
            <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquise o nome ou documento do condominio" /></label>
            <button type="button" onClick={() => { setCondoFormMode("new"); setActiveSection("condoForm"); }}><Plus size={16} /> Novo condominio</button>
          </div>
          <div className="condo-cards">
            {condoPager.pageItems.map((condo) => (
              <article className={`condo-card clickable-card ${condo.id === selectedTenantId ? "selected" : ""}`} key={condo.id} onClick={() => { setSelectedTenantId(condo.id); setCondoFormMode("edit"); setActiveSection("condoHome"); }}>
                <header>
                  <button className="card-title-button" onClick={(event) => { event.stopPropagation(); setSelectedTenantId(condo.id); setCondoFormMode("edit"); setActiveSection("condoHome"); }}>{condo.name}</button>
                  <button className="icon-button secondary-button" onClick={(event) => event.stopPropagation()}><MoreVertical size={18} /></button>
                </header>
                <div className="condo-card-body">
                  <span><Building2 size={16} /> Condominio</span>
                  <span><Users size={16} /> {data.units.filter((unit) => unit.tenantId === condo.id).length} unidades</span>
                  <span><RadioTower size={16} /> {data.devices.filter((device) => device.tenantId === condo.id).length} equipamentos</span>
                  <span><KeySquare size={16} /> Documento {condo.document || "nao informado"}</span>
                </div>
                <footer onClick={(event) => event.stopPropagation()}>
                  <button className="secondary-button" onClick={() => { setSelectedTenantId(condo.id); navigateTo(`/licencas/${data.licenses.find((license) => license.tenantId === condo.id)?.code || condo.id}/unidades`); }}><Home size={15} /> Unidades</button>
                  <button className="secondary-button" onClick={() => { setSelectedTenantId(condo.id); setCondoFormMode("edit"); setActiveSection("condoForm"); }}><Save size={15} /> Editar</button>
                  <button className="danger-button" type="button" onClick={() => void deleteCondo(condo)}><Trash2 size={15} /> Excluir</button>
                </footer>
              </article>
            ))}
          </div>
          <Pagination page={condoPager.page} totalPages={condoPager.totalPages} onPage={condoPager.setPage} />
        </section>
      );
    }

    if (activeSection === "condoForm") {
      return (
        <section className="condo-form-page">
          <form className="panel form-panel" key={`${condoFormMode}-${condoFormTenant?.id || "new"}`} onSubmit={createOrUpdateCondo}>
            <div className="panel-heading"><h2>Cadastro do condominio</h2><Building2 size={20} /></div>
            <div className="form-grid">
              <input type="hidden" name="id" value={condoFormTenant?.id || ""} />
              <Field label="Nome"><input name="name" defaultValue={condoFormTenant?.name || ""} /></Field>
              <Field label="Documento"><input name="document" defaultValue={condoFormTenant?.document || ""} /></Field>
              <Field label="Status"><select name="status" defaultValue={condoFormTenant?.status || "ACTIVE"}><option>ACTIVE</option><option>INACTIVE</option></select></Field>
              <Field label="Tipo"><select name="structureType" defaultValue={condoFormTenant?.structureType || "VERTICAL"}><option value="VERTICAL">Vertical</option><option value="HORIZONTAL">Horizontal</option></select></Field>
              <Field label="Andares / quadras"><input name="structureGroupCount" type="number" min="1" defaultValue={condoFormTenant?.structureGroupCount || ""} onChange={updateCondoTotal} /></Field>
              <Field label="Aps por andar / quadra"><input name="unitsPerGroup" type="number" min="1" defaultValue={condoFormTenant?.unitsPerGroup || ""} onChange={updateCondoTotal} /></Field>
              <Field label="Quantidade de unidades"><input name="totalUnits" type="number" min="0" readOnly defaultValue={condoTotalUnits(condoFormTenant) || ""} /></Field>
              <Field label="Endereco"><input name="address" defaultValue={condoFormTenant?.address || ""} /></Field>
              <Field label="Numero"><input name="addressNumber" defaultValue={condoFormTenant?.addressNumber || ""} /></Field>
              <Field label="Cidade"><input name="city" defaultValue={condoFormTenant?.city || ""} /></Field>
              <Field label="Estado"><input name="state" maxLength="2" defaultValue={condoFormTenant?.state || ""} /></Field>
              <Field label="Latitude"><input name="latitude" value={condoGeo.latitude} onChange={(event) => setCondoGeo((current) => ({ ...current, latitude: event.target.value }))} /></Field>
              <Field label="Longitude"><input name="longitude" value={condoGeo.longitude} onChange={(event) => setCondoGeo((current) => ({ ...current, longitude: event.target.value }))} /></Field>
              <Field label="Gerar unidades"><label className="checkbox-row"><input name="generateUnits" type="checkbox" defaultChecked={condoFormMode === "new" || Boolean(condoFormTenant?.structureGroupCount && condoFormTenant?.unitsPerGroup)} /> Criar apartamentos/unidades automaticamente</label></Field>
              <input type="hidden" name="telephonyProvider" value={condoFormTenant?.telephonyProvider || "DIRECT_SIP"} />
              <input type="hidden" name="sipDomain" value={condoFormTenant?.sipDomain || ""} />
              <input type="hidden" name="sipWebSocketUrl" value={condoFormTenant?.sipWebSocketUrl || ""} />
              <input type="hidden" name="sipExtensionStart" value={condoFormTenant?.sipExtensionStart || "9100"} />
              <input type="hidden" name="sipExtensionEnd" value={condoFormTenant?.sipExtensionEnd || "9199"} />
              <Field label="Ramal da portaria"><input name="sipPorterExtension" defaultValue={condoFormTenant?.sipPorterExtension || "9000"} /></Field>
              <button className="secondary-button" type="button" onClick={geocodeCondoForm}><Search size={16} /> Buscar geolocalizacao</button>
              <button type="submit"><Save size={16} /> Salvar condominio</button>
            </div>
          </form>
        </section>
      );
    }

    if (activeSection === "units") {
      const unitLogins = data.unitLogins.filter((login) => login.unitId === selectedUnit?.unitId);
      const unitInvites = data.unitInvites.filter((invite) => invite.unitId === selectedUnit?.unitId && (inviteSubtab !== "qrCodes" || invite.type === "QR_CODE"));
      const owner = data.residents.find((person) => person.unitId === selectedUnit?.unitId && person.kind === "RESIDENT") || data.residents.find((person) => person.unitId === selectedUnit?.unitId);
      const unitOwner = unitFormMode === "new" ? null : owner;
      return (
        <section className="unit-detail">
          <div className="breadcrumb-bar">Voltar <strong>{selectedTenant?.name || "Condominio"} &gt; Unidade &gt; {selectedUnit?.unitNumber || "-"}</strong></div>
          <div className="subtabs unit-main-tabs">
            {[
              ["geral", "Geral"],
              ["moradores", "Moradores"],
              ["visitantes", "Visitantes"],
              ["prestadores", "Prestadores"],
              ["veiculos", "Veiculos"],
              ["logins", "Logins"],
              ["convites", "Convites"],
              ["recursos", "Recursos"]
            ].map(([tab, label]) => (
              <button key={tab} className={unitTab === tab ? "active" : ""} onClick={() => setUnitTab(tab)}>{label}</button>
            ))}
          </div>
          {unitTab === "telefonia" ? (
            <form className="panel" onSubmit={saveUnitTelephony}>
              <div className="panel-heading"><h2>Ramal da unidade {selectedUnit?.unitNumber}</h2><button type="submit"><Save size={16} /> Salvar ramal</button></div>
              <div className="form-grid">
                <input type="hidden" value={telephony.sipDomain || ""} readOnly />
                <input type="hidden" value={telephony.sipWebSocketUrl || ""} readOnly />
                <input type="hidden" value={telephony.provider || "DIRECT_SIP"} readOnly />
                <input type="hidden" value={telephony.sipTransport || "WSS"} readOnly />
                <Field label="Ramal"><input value={telephony.extension || ""} onChange={(event) => setTelephony((current) => ({ ...current, extension: event.target.value }))} /></Field>
                <Field label="Ramal da portaria"><input value={telephony.porterExtension || ""} onChange={(event) => setTelephony((current) => ({ ...current, porterExtension: event.target.value }))} /></Field>
              </div>
            </form>
          ) : unitTab === "moradores" ? (
            renderPersonRegistry("RESIDENT", "Morador", true)
          ) : unitTab === "visitantes" ? (
            renderPersonRegistry("VISITOR", "Visitante", true)
          ) : unitTab === "prestadores" ? (
            renderPersonRegistry("PROVIDER", "Prestador", true)
          ) : unitTab === "logins" ? (
            <article className="panel people-panel">
              <div className="resource-toolbar">
                <label className="search-field"><Search size={16} /><input placeholder="Filtre por nome" /></label>
                <button><UserPlus size={16} /> Convidar ao app</button>
              </div>
              <div className="unit-table header"><span>Convidado / Perfil</span><span>Enviado para</span><span>Envio / Convidado por</span><span>Situacao</span></div>
              {unitLogins.map((login) => (
                <div className="unit-table row" key={login.id}>
                  <span><strong>{login.guest}</strong><small>{login.profile}</small></span>
                  <span>{login.sentTo}</span>
                  <span>{formatDateTime(login.sentAt)}<small>{login.invitedBy}</small></span>
                  <span className="status">{login.status}</span>
                </div>
              ))}
            </article>
          ) : unitTab === "convites" ? (
            <article className="panel people-panel">
              <div className="subtabs compact-subtabs">
                {["qrCodes", "chaveVirtual", "qrScanner"].map((tab) => <button key={tab} className={inviteSubtab === tab ? "active" : ""} onClick={() => navigateTo(`/unidades/${selectedUnit?.unitId || selectedUnitId}/convites/${tab}`)}>{tab === "qrCodes" ? "QR Code" : tab === "chaveVirtual" ? "Chave Virtual" : "QR Scanner"}</button>)}
              </div>
              <div className="resource-toolbar">
                <label className="search-field"><Search size={16} /><input placeholder="Filtre por convidado" /></label>
                <button><Plus size={16} /> Novo convite</button>
              </div>
              <div className="unit-table header"><span>Convidado</span><span>Identificacao</span><span>Convidado por</span><span>Status</span></div>
              {unitInvites.map((invite) => (
                <div className="unit-table row" key={invite.id}>
                  <span><strong>{invite.guest}</strong><small>{formatDateTime(invite.validUntil)}</small></span>
                  <span>{invite.identification}</span>
                  <span>{invite.invitedBy}</span>
                  <span className="status">{invite.status}</span>
                </div>
              ))}
            </article>
          ) : (
            <section className="unit-directory-grid">
              <article>
                <div className="resource-toolbar unit-search-toolbar">
                  <label className="search-field">
                    <Search size={16} />
                    <input
                      placeholder="Buscar por unidade, bloco, morador ou ramal"
                      value={unitSearch}
                      onChange={(event) => setUnitSearch(event.target.value)}
                    />
                  </label>
                  <span className="toolbar-note">{filteredUnits.length} unidade(s) encontradas</span>
                  <button type="button" onClick={() => { setUnitFormMode("new"); setSelectedUnitId(""); }}><Plus size={16} /> Nova unidade</button>
                </div>
                <div className="unit-cards">
                  {unitPager.pageItems.map((unit) => (
                    <article
                      className={`unit-card clickable-card ${unit.unitId === selectedUnit?.unitId ? "selected" : ""}`}
                      key={unit.unitId}
                      onClick={() => navigateTo(`/unidades/${unit.unitId}`)}
                    >
                      <header>
                        <strong>Unidade {unit.unitNumber}</strong>
                        <div className="inline-call-actions">
                          <button className="unit-call-button" title="Abrir ramal" onClick={(event) => { event.stopPropagation(); setSelectedUnitId(unit.unitId); setUnitFormMode("edit"); navigateTo(`/unidades/${unit.unitId}`); }}><PhoneCall size={18} /></button>
                          <button className="unit-call-button danger-button" title="Excluir unidade" onClick={(event) => { event.stopPropagation(); void deleteUnit(unit); }}><Trash2 size={18} /></button>
                        </div>
                      </header>
                      <div>
                        <span><Home size={16} /> {unit.blockName || "Bloco unico"}</span>
                        <span><UserRound size={16} /> {unit.residentName || "Sem morador"}</span>
                        <small>Ramal {unit.telephony?.extension || "-"}</small>
                      </div>
                    </article>
                  ))}
                </div>
                {unitPager.pageItems.length === 0 && <div className="empty-state">Nenhuma unidade encontrada para essa busca.</div>}
                <Pagination page={unitPager.page} totalPages={unitPager.totalPages} onPage={unitPager.setPage} />
              </article>
              {unitFormMode === "new" && <form className="panel form-panel" key={`${unitFormMode}-${unitFormUnit?.unitId || "new"}`} onSubmit={saveUnitForm}>
                <div className="panel-heading"><h2>{unitFormMode === "new" ? "Nova unidade" : `Geral da unidade ${unitFormUnit?.unitNumber || "-"}`}</h2><Home size={20} /></div>
                <div className="form-grid">
                  <input type="hidden" name="unitId" value={unitFormUnit?.unitId || ""} />
                  <Field label="Unidade"><input name="unitNumber" defaultValue={unitFormUnit?.unitNumber || ""} /></Field>
                  <Field label="Bloco/Torre"><input name="blockName" defaultValue={unitFormUnit?.blockName || ""} /></Field>
                  <Field label="Morador principal"><input name="residentName" defaultValue={unitFormUnit?.residentName || ""} /></Field>
                  <Field label="Proprietario/Responsavel"><input name="responsibleName" defaultValue={unitOwner?.name || unitFormUnit?.responsibleName || ""} /></Field>
                  <Field label="CPF do morador"><input name="residentCpf" defaultValue={unitOwner?.cpf || ""} /></Field>
                  <Field label="RG do morador"><input name="residentRg" defaultValue={unitOwner?.rg || ""} /></Field>
                  <Field label="Celular do responsavel"><input name="residentPhone" defaultValue={unitOwner?.phone || ""} /></Field>
                  <Field label="E-mail/Login"><input name="residentEmail" defaultValue={unitOwner?.email || ""} /></Field>
                  <Field label="Relacao"><select name="residentRelation" defaultValue={unitOwner?.relation || "Responsavel"}><option>Proprietario</option><option>Morador</option><option>Responsavel</option><option>Responsavel financeiro</option></select></Field>
                  <Field label="Ramal"><input name="extension" defaultValue={unitFormUnit?.telephony?.extension || unitFormUnit?.extension || ""} /></Field>
                </div>
                <div className="toolbar-actions unit-actions">
                  <button type="submit"><Save size={16} /> Salvar unidade</button>
                  <button className="secondary-button" type="button" onClick={() => navigateTo(`/unidades/${selectedUnit?.unitId || selectedUnitId}/pessoas/moradores/ver/${unitOwner?.id || "novo"}`)}>Abrir moradores</button>
                  <button className="secondary-button" type="button" onClick={() => navigateTo(`/unidades/${selectedUnit?.unitId || selectedUnitId}/logins`)}>Logins</button>
                  <button className="secondary-button" type="button" onClick={() => navigateTo(`/unidades/${selectedUnit?.unitId || selectedUnitId}/convites/qrCodes`)}>Convites</button>
                  <button className="secondary-button" type="button" onClick={() => setUnitFormMode("edit")}>Cancelar</button>
                  {unitFormUnit?.unitId && <button className="danger-button" type="button" onClick={() => void deleteUnit(unitFormUnit)}><Trash2 size={16} /> Excluir unidade</button>}
                </div>
              </form>}
            </section>
          )}
        </section>
      );
    }

    if (activeSection === "syndic") {
      const syndic = data.residents.find((person) => person.isSyndic) || data.residents.find((person) => person.role === "CONDO_ADMIN");
      return (
        <section className="people-layout">
          <article className="panel form-panel">
            <div className="panel-heading"><h2>Definir sindico</h2><ShieldCheck size={20} /></div>
            <div className="form-grid">
              <Field label="Condominio"><select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)}>{data.condominiums.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
              <Field label="Pessoa"><select defaultValue={syndic?.id || ""}>{data.residents.filter((person) => person.tenantId === selectedTenant?.id).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
              <Field label="Cargo"><select defaultValue="SINDICO"><option>SINDICO</option><option>SUBSINDICO</option><option>CONSELHEIRO</option><option>ADMINISTRADORA</option></select></Field>
              <Field label="Inicio do mandato"><input type="date" /></Field>
              <Field label="Fim do mandato"><input type="date" /></Field>
              <Field label="Permissao"><select defaultValue="CONDO_ADMIN"><option value="CONDO_ADMIN">Administrador do condominio</option><option value="PORTER">Porteiro</option><option value="RESIDENT">Usuario normal</option></select></Field>
              <button type="button"><Save size={16} /> Salvar sindico</button>
            </div>
            <div className="form-hint">Esta tela define quem e sindico/subsindico e quais permissoes administrativas essa pessoa tera.</div>
          </article>
          <article className="panel people-panel">
            <div className="panel-heading"><h2>Sindico atual</h2><ShieldCheck size={20} /></div>
            <div className="person-row">
              <div className="person-name-cell"><span className="avatar">{syndic?.name?.[0] || "S"}</span><div><strong>{syndic?.name || "Nao definido"}</strong><small>{syndic?.email || "-"}</small><small>{selectedTenant?.name}</small></div></div>
              <span>CPF: {syndic?.cpf || "-"}<br />RG: {syndic?.rg || "-"}</span>
              <span>{syndic?.phone || "-"}</span>
              <span>Sindico</span>
              <div className="row-actions"><button className="compact-action-button secondary-button">Permissoes</button><button className="compact-action-button secondary-button">Editar</button></div>
            </div>
          </article>
        </section>
      );
    }

    if (activeSection === "residents") {
      return renderPersonRegistry("RESIDENT", "Pessoa", false);
    }

    if (activeSection === "devices") {
      return (
        <section className="resource-page">
          <div className="subtabs resource-tabs">
            {[
              ["inicio", "Cadastro"],
              ["integration", "Integracao"],
              ["cameras", "Cameras"],
              ["actions", "Acionamentos"],
              ["painel", "Painel de controle"],
              ["rotas", "Rotas de acesso"]
            ].map(([id, label]) => <button key={id} className={deviceTab === id ? "active" : ""} onClick={() => setDeviceTab(id)}>{label}</button>)}
          </div>
          {deviceTab === "inicio" && (
            <section className="crud-grid">
              <form className="panel form-panel" onSubmit={saveDeviceForm}>
                <div className="panel-heading"><h2>Novo equipamento</h2><RadioTower size={20} /></div>
                <div className="form-grid">
                  <Field label="Categoria"><select value={deviceForm.category} onChange={(event) => {
                    const category = data.deviceCategories.find((item) => item.id === event.target.value);
                    setDeviceForm((current) => ({
                      ...current,
                      category: event.target.value,
                      manufacturer: category?.manufacturers?.[0] || current.manufacturer,
                      ...intelbrasDeviceDefaults(event.target.value, category?.manufacturers?.[0] || current.manufacturer)
                    }));
                  }}>{data.deviceCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
                  <Field label="Empresa/Fabricante"><select value={deviceForm.manufacturer} onChange={(event) => setDeviceForm((current) => ({
                    ...current,
                    manufacturer: event.target.value,
                    ...intelbrasDeviceDefaults(current.category, event.target.value)
                  }))}>{(data.deviceCategories.find((category) => category.id === deviceForm.category)?.manufacturers || ["Hikvision", "Control iD", "Intelbras"]).map((name) => <option key={name}>{name}</option>)}</select></Field>
                  <Field label="Descricao"><input value={deviceForm.name} onChange={(event) => setDeviceForm((current) => ({ ...current, name: event.target.value }))} /></Field>
                  <Field label="Modelo homologacao">{homologatedModelOptions(deviceForm.manufacturer, deviceForm.category).length
                    ? <select value={deviceForm.model} onChange={(event) => setDeviceForm((current) => ({ ...current, ...intelbrasModelDefaults(event.target.value) }))}><option value="">Selecione o modelo</option>{homologatedModelOptions(deviceForm.manufacturer, deviceForm.category).map((model) => <option key={model} value={model}>{model}</option>)}</select>
                    : <input value={deviceForm.model} onChange={(event) => setDeviceForm((current) => ({ ...current, model: event.target.value }))} placeholder="Modelo do equipamento" />}</Field>
                  <Field label="IP / DDNS"><input value={deviceForm.ipAddress} onChange={(event) => setDeviceForm((current) => ({ ...current, ipAddress: event.target.value }))} /></Field>
                  <Field label="Protocolo API"><select value={deviceForm.apiProtocol} onChange={(event) => setDeviceForm((current) => ({ ...current, apiProtocol: event.target.value }))}><option value="http">HTTP</option><option value="https">HTTPS</option></select></Field>
                  <Field label="Porta API"><input value={deviceForm.apiPort} onChange={(event) => setDeviceForm((current) => ({ ...current, apiPort: event.target.value }))} /></Field>
                  <Field label="Porta RTSP"><input value={deviceForm.rtspPort} onChange={(event) => setDeviceForm((current) => ({ ...current, rtspPort: event.target.value }))} /></Field>
                  <Field label="Canais esperados"><input value={deviceForm.channelCount} onChange={(event) => setDeviceForm((current) => ({ ...current, channelCount: event.target.value }))} placeholder="Ex.: 4, 8, 16" /></Field>
                  <Field label="Usuario"><input value={deviceForm.username} onChange={(event) => setDeviceForm((current) => ({ ...current, username: event.target.value }))} /></Field>
                  <Field label="Senha"><input type="password" autoComplete="new-password" value={deviceForm.password} onChange={(event) => setDeviceForm((current) => ({ ...current, password: event.target.value }))} placeholder={deviceForm.id ? "Preencha para alterar" : ""} /></Field>
                  <Field label="Ramal interfone"><input value={deviceForm.intercomExtension} onChange={(event) => setDeviceForm((current) => ({ ...current, intercomExtension: event.target.value }))} /></Field>
                  <Field label="Tipo interfone"><select value={deviceForm.intercomType} onChange={(event) => setDeviceForm((current) => ({ ...current, intercomType: event.target.value }))}><option>FACIAL</option><option>TELEFONE_IP</option><option>ATA_VOIP</option></select></Field>
                  <button type="submit"><Save size={16} /> Salvar equipamento</button>
                </div>
              </form>
              <article className="panel">
                <div className="panel-heading"><h2>Equipamentos cadastrados</h2><Camera size={20} /></div>
                <div className="simple-list">
                  {tenantDevices.map((device) => (
                    <div className="simple-row device-row" key={device.id}>
                      <RadioTower size={18} />
                      <div><strong>{device.name}</strong><span>{device.manufacturer} {device.model}</span></div>
                      <span>{device.ipAddress}</span>
                      <span>Ramal {device.intercomExtension}</span>
                      <span>{device.adapter || "GENERIC_TCP"}</span>
                      <span>{device.passwordSet ? "Senha salva" : "Sem senha"}</span>
                      <span className="status">{device.status}</span>
                      <button className="secondary-button" onClick={() => setDeviceForm({
                        id: device.id,
                        tenantId: device.tenantId || selectedTenant?.id || "",
                        category: device.category || "access-control",
                        manufacturer: device.manufacturer || "Hikvision",
                        name: device.name || "",
                        model: device.model || "",
                        ipAddress: device.ipAddress || "",
                        apiProtocol: device.apiProtocol || "http",
                        username: device.username || "admin",
                        password: "",
                        apiPort: String(device.apiPort || 80),
                        rtspPort: String(device.rtspPort || 554),
                        channelCount: String(device.channelCount || ""),
                        intercomExtension: device.intercomExtension || "",
                        intercomType: device.intercomType || "FACIAL",
                        intercomEnabled: Boolean(device.intercomEnabled)
                      })}>Editar</button>
                      <button className="secondary-button" onClick={() => void testDeviceIntegration(device)}>Testar API</button>
                      <button className="danger-button" type="button" onClick={() => void deleteDevice(device)}><Trash2 size={16} /> Excluir</button>
                    </div>
                  ))}
                </div>
                {!tenantDevices.length && <div className="empty-state">Nenhum equipamento cadastrado neste condominio.</div>}
              </article>
            </section>
          )}
          {deviceTab === "integration" && (
            <section className="equipment-integration-layout">
              <article className="panel form-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Integracao de equipamentos</h2>
                    <small>{selectedTenant?.name} - leitura de eventos, credenciais, horarios, faciais e usuarios</small>
                  </div>
                  <button className="secondary-button" type="button" disabled={equipmentIntegration.loading || !selectedIntegrationDevice} onClick={() => void readEquipmentIntegration(equipmentIntegration.resource)}>
                    <RefreshCw size={16} /> Atualizar leitura
                  </button>
                </div>
                <div className="form-grid">
                  <Field label="Equipamento">
                    <select value={equipmentIntegration.deviceId || selectedIntegrationDevice?.id || ""} onChange={(event) => setEquipmentIntegration((current) => ({ ...current, deviceId: event.target.value, payload: null, error: "", updatedAt: "" }))}>
                      {tenantDevices.map((device) => <option key={device.id} value={device.id}>{device.name} - {device.manufacturer} {device.model}</option>)}
                    </select>
                  </Field>
                  <Field label="Adapter"><input readOnly value={selectedIntegrationDevice?.adapter || "GENERIC_TCP"} /></Field>
                  <Field label="Endereco"><input readOnly value={selectedIntegrationDevice ? `${selectedIntegrationDevice.ipAddress || "-"}:${selectedIntegrationDevice.apiPort || 80}` : "-"} /></Field>
                  <Field label="Ultima leitura"><input readOnly value={equipmentIntegration.updatedAt ? formatDateTime(equipmentIntegration.updatedAt) : "Ainda nao executada"} /></Field>
                </div>
                <div className="equipment-read-actions">
                  {equipmentIntegrationResources.map(([resource, label, Icon]) => (
                    <button key={resource} type="button" className={equipmentIntegration.resource === resource ? "" : "secondary-button"} disabled={equipmentIntegration.loading || !selectedIntegrationDevice} onClick={() => void readEquipmentIntegration(resource)}>
                      <Icon size={16} /> {label}
                    </button>
                  ))}
                </div>
                <div className="toolbar-actions unit-actions">
                  <button className="secondary-button" type="button" disabled={equipmentIntegration.importing || !selectedIntegrationDevice} onClick={() => void importEquipmentCredentials(true)}>
                    <Search size={16} /> Previa credenciais do equipamento
                  </button>
                  <button type="button" disabled={equipmentIntegration.importing || !equipmentIntegration.importReport?.total} onClick={() => void importEquipmentCredentials(false)}>
                    <Save size={16} /> Importar para o banco
                  </button>
                </div>
                {equipmentIntegration.error && <div className="form-hint">{equipmentIntegration.error}</div>}
                {!tenantDevices.length && <div className="empty-state">Nenhum equipamento cadastrado neste condominio.</div>}
              </article>

              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Resultado da leitura</h2>
                    <small>{equipmentIntegration.payload?.message || "Selecione uma leitura para consultar os dados consolidados."}</small>
                  </div>
                  <span className="status">{equipmentIntegration.payload?.source || "LOCAL_STATE"}</span>
                </div>
                <div className="integration-summary-grid">
                  {equipmentIntegrationResources.map(([resource, label, Icon]) => (
                    <button key={resource} type="button" className={equipmentIntegration.resource === resource ? "integration-summary-card active" : "integration-summary-card"} onClick={() => void readEquipmentIntegration(resource)} disabled={equipmentIntegration.loading || !selectedIntegrationDevice}>
                      <Icon size={18} />
                      <span><strong>{equipmentIntegration.payload?.summary?.[resource] ?? 0}</strong>{label}</span>
                    </button>
                  ))}
                </div>

                <div className="unit-table header integration-table"><span>Registro</span><span>Tipo / origem</span><span>Status / validade</span><span>Destino</span></div>
                {(equipmentIntegration.payload?.records || []).map((record) => {
                  const cells = integrationRecordCells(record, equipmentIntegration.resource);
                  return (
                    <div className="unit-table row integration-table" key={record.id}>
                      <span>{cells[0]}</span>
                      <span>{cells[1]}</span>
                      <span>{cells[2]}</span>
                      <span>{cells[3]}</span>
                    </div>
                  );
                })}
                {equipmentIntegration.loading && <div className="empty-state">Lendo informacoes do equipamento...</div>}
                {!equipmentIntegration.loading && equipmentIntegration.payload && !equipmentIntegration.payload.records?.length && <div className="empty-state">Nenhum registro encontrado para esta leitura.</div>}
                {!equipmentIntegration.payload && !equipmentIntegration.loading && <div className="empty-state">Execute uma leitura para carregar os dados.</div>}
              </article>

              {equipmentIntegration.importReport && (
                <article className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Importacao do equipamento</h2>
                      <small>{equipmentIntegration.importReport.message || "Relatorio de credenciais lidas no equipamento."}</small>
                    </div>
                    <span className="status">{equipmentIntegration.importReport.dryRun ? "PREVIA" : "IMPORTADO"}</span>
                  </div>
                  <div className="import-report">
                    <span><strong>{equipmentIntegration.importReport.total || 0}</strong>lidas</span>
                    <span><strong>{equipmentIntegration.importReport.valid || 0}</strong>validas</span>
                    <span><strong>{equipmentIntegration.importReport.duplicates || 0}</strong>duplicadas</span>
                    <span><strong>{equipmentIntegration.importReport.unitsCreated || 0}</strong>unidades novas</span>
                    <span><strong>{equipmentIntegration.importReport.credentialsCreated || 0}</strong>novas</span>
                    <span><strong>{equipmentIntegration.importReport.credentialsUpdated || 0}</strong>atualizadas</span>
                  </div>
                  {(equipmentIntegration.importReport.items || []).some((item) => item.payload?.type === "FACE") && (
                    <div className="face-import-review">
                      <div className="unit-table header face-review-table"><span>Importar</span><span>Facial</span><span>Pessoa</span><span>Unidade</span><span>Bloco</span></div>
                      {(equipmentIntegration.importReport.items || []).filter((item) => item.payload?.type === "FACE").map((item) => {
                        const key = faceImportSelectionKey(item);
                        const selection = equipmentFaceSelections[key] || {};
                        return (
                          <div className="unit-table row face-review-table" key={key}>
                            <label className="check-cell"><input type="checkbox" checked={selection.selected !== false} onChange={(event) => setEquipmentFaceSelections((current) => ({ ...current, [key]: { ...selection, key, row: item.row, recordId: item.payload?.recordId || "", type: "FACE", value: item.payload?.value || "", selected: event.target.checked } }))} /></label>
                            <span><strong>{item.payload?.valueLabel || item.payload?.value || "-"}</strong><small>{item.payload?.devicePath || equipmentIntegration.importReport.adapter}</small></span>
                            <span>{item.payload?.personName || item.personId || "Sem nome"}</span>
                            <input value={selection.unitNumber ?? item.payload?.unitNumber ?? ""} placeholder="Ex.: 102" onChange={(event) => setEquipmentFaceSelections((current) => ({ ...current, [key]: { ...selection, key, row: item.row, recordId: item.payload?.recordId || "", type: "FACE", value: item.payload?.value || "", selected: selection.selected !== false, unitNumber: event.target.value } }))} />
                            <input value={selection.blockName ?? item.payload?.blockName ?? ""} placeholder="Bloco unico" onChange={(event) => setEquipmentFaceSelections((current) => ({ ...current, [key]: { ...selection, key, row: item.row, recordId: item.payload?.recordId || "", type: "FACE", value: item.payload?.value || "", selected: selection.selected !== false, blockName: event.target.value } }))} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="unit-table header integration-table"><span>Credencial</span><span>Pessoa</span><span>Status</span><span>Origem</span></div>
                  {(equipmentIntegration.importReport.items || []).slice(0, 12).map((item) => (
                    <div className="unit-table row integration-table" key={`${item.row}-${item.payload?.value}`}>
                      <span><strong>{item.payload?.type || "-"}</strong><small>{item.payload?.valueLabel || item.payload?.value || "-"}</small></span>
                      <span>{item.payload?.personName || item.personId || "Sem vinculo"}</span>
                      <span className={`status ${item.status === "INVALID" ? "offline" : ""}`}>{item.status}</span>
                      <span>{item.payload?.devicePath || equipmentIntegration.importReport.adapter}</span>
                    </div>
                  ))}
                  {equipmentIntegration.importReport.attempts?.length ? (
                    <div className="simple-list">
                      {equipmentIntegration.importReport.attempts.map((attempt) => (
                        <div className="simple-row" key={attempt.path}>
                          <ServerCog size={18} />
                          <div><strong>{attempt.label}</strong><span>{attempt.path}</span></div>
                          <span className={`status ${attempt.ok ? "" : "offline"}`}>{attempt.ok ? `${attempt.records || 0} registro(s)` : "Falhou"}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              )}
            </section>
          )}
          {deviceTab === "cameras" && (
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Cameras do condominio</h2>
                  <small>{selectedTenant?.name} - {tenantCameraGroups.length} equipamento(s), {tenantCameras.reduce((total, camera) => total + cameraChannels(camera).length, 0)} canal(is)</small>
                </div>
                <button className="secondary-button" type="button" onClick={() => { setCameraForm({ ...emptyCameraForm, tenantId: selectedTenant?.id || "" }); setShowCameraForm(true); }}><Plus size={16} /> Nova(s) cameras</button>
              </div>
              <CameraConfig
                cameras={tenantCameraGroups}
                devices={tenantDevices}
                form={cameraForm}
                setForm={setCameraForm}
                showForm={showCameraForm}
                onSave={saveCameraForm}
                onEdit={editCamera}
                onNew={() => { setCameraForm({ ...emptyCameraForm, tenantId: selectedTenant?.id || "" }); setShowCameraForm(true); }}
                onDelete={deleteCamera}
              />
            </article>
          )}
          {deviceTab === "actions" && (
            <article className="panel">
              <div className="panel-heading"><h2>Acionamentos do condominio</h2><button className="secondary-button" type="button" onClick={() => setActionForm(defaultActionForm())}><Plus size={16} /> Novo acionamento</button></div>
              <ActionConfig
                actions={tenantActions}
                devices={tenantDevices}
                form={actionForm}
                setForm={setActionForm}
                onSave={saveActionForm}
                onTrigger={triggerAction}
                onDelete={deleteAction}
                onEdit={(action) => setActionForm({
                  id: action.id,
                  name: action.name || "",
                  manufacturer: action.manufacturer || "Hikvision",
                  deviceId: action.deviceId || "",
                  relay: String(action.relay || 1),
                  route: action.route || "",
                  status: action.status || "ACTIVE"
                })}
              />
            </article>
          )}
          {deviceTab === "painel" && (
            <article className="panel">
              <div className="panel-heading"><h2>Painel de controle</h2><button className="secondary-button" type="button" onClick={() => void refreshDeviceStatus()}><RefreshCw size={16} /> Atualizar</button></div>
              <div className="data-grid header"><span>Descricao</span><span>Conexao</span><span>Status</span><span>Latencia</span></div>
              {tenantDevices.map((device) => (
                <div className="data-grid row" key={device.id}>
                  <span><strong>{device.name}</strong><small>{device.model}</small></span>
                  <span>{device.ipAddress}<small>{device.apiPort || 80}</small></span>
                  <span className={`status ${device.status === "ONLINE" ? "" : "offline"}`}>{device.status === "ONLINE" ? "Online" : "Offline"}</span>
                  <span>{device.status === "ONLINE" ? `${device.latencyMs ?? 0} ms` : device.statusReason || "Timeout"}</span>
                </div>
              ))}
              {!tenantDevices.length && <div className="empty-state">Nenhum equipamento cadastrado neste condominio.</div>}
            </article>
          )}
          {deviceTab === "rotas" && (
            <article className="panel">
              <div className="panel-heading"><h2>Rotas de acesso</h2><Grid3X3 size={18} /></div>
              <div className="form-hint">Rotas de acesso sao os grupos de portas/leitores/cameras que cada perfil pode usar. Exemplo: Morador acessa garagem e entrada; Visitante acessa somente eclusa no horario permitido.</div>
              <div className="route-grid">
                {data.accessRoutes.map((route) => <button className="secondary-button" key={route.id}>{route.name}</button>)}
              </div>
              <button type="button" onClick={() => setActiveSection("permissions")}><KeySquare size={16} /> Abrir permissoes</button>
            </article>
          )}
        </section>
      );
    }

    if (activeSection === "remotePorter") {
      const porterAttendanceCall = incomingCall || activeSelectedCall;
      const listedPorterUnits = porterUnitSearch.trim() ? porterUnitResults : units;
      return (
        <section className="resource-page">
          <div className="resource-hero panel">
            <div>
              <span>Portaria remota</span>
              <h2>{selectedTenant?.name || "-"}</h2>
              <small>Selecione o condominio para abrir o atendimento da portaria.</small>
            </div>
            <div className="remote-porter-selector">
              <Field label="Condominio">
                <select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)}>
                  {data.condominiums.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <button type="button" onClick={() => setResourceTab("portaria")}><PhoneCall size={16} /> Abrir portaria</button>
            </div>
          </div>
          {actionFeedback && (
            <div className="action-success-notification" role="status" aria-live="polite">
              <BadgeCheck size={24} />
              <div>
                <strong>Comando enviado com sucesso</strong>
                <span>{actionFeedback.name} - {actionFeedback.route}</span>
              </div>
            </div>
          )}
          <div className="resource-operational-grid remote-porter-layout">
            <article className="panel porter-attendance-panel">
              <div className="panel-heading">
                <h2>Atendimento da unidade</h2>
                <span>{activeTenantCalls.length} chamada(s)</span>
              </div>
              <label className="search-field porter-search-input">
                <Search size={16} />
                <input value={porterUnitSearch} onChange={(event) => { setPorterUnitSearch(event.target.value); setPorterSelectedUnitId(""); }} placeholder="Buscar unidade, morador, CPF, telefone ou ramal" />
              </label>
              {porterAttendanceCall && (
                <div className="porter-unit-call">
                  <span>Origem da chamada</span>
                  <strong>{porterAttendanceCall.visitorLabel || porterAttendanceCall.targetType || "Chamada recebida"} - {porterAttendanceCall.status}</strong>
                  <small>Ramal origem {porterAttendanceCall.sourceExtension || "-"} / destino {porterAttendanceCall.targetExtension || "-"}</small>
                </div>
              )}
              {porterDrawerUnit ? (
                <div className="porter-unit-card">
                  <div className="porter-attendance-toolbar">
                    <button className="secondary-button compact-action-button" type="button" onClick={() => { setPorterSelectedUnitId(""); setPorterUnitSearch(""); setSelectedCallId(""); }}>
                      <Grid3X3 size={15} /> Unidades
                    </button>
                    <button className="secondary-button compact-action-button" type="button" onClick={() => void callUnitFromPorter(porterDrawerUnit)}>
                      <PhoneCall size={15} /> Ligar unidade
                    </button>
                  </div>
                  <div className="unit-readonly-grid">
                    <span><small>Unidade</small><strong>{unitDisplay(porterDrawerUnit)}</strong></span>
                    <span><small>Ramal</small><strong>{porterDrawerUnit.telephony?.extension || porterDrawerUnit.extension || "-"}</strong></span>
                    <span><small>Responsavel</small><strong>{porterDrawerUnit.responsibleName || porterDrawerUnit.residentName || "-"}</strong></span>
                    <span><small>Portaria</small><strong>{porterDrawerUnit.telephony?.porterExtension || selectedTenant?.sipPorterExtension || "-"}</strong></span>
                  </div>
                  <div className="panel-heading compact-heading resident-heading">
                    <h2>Moradores</h2>
                    <span>{porterDrawerResidents.length}</span>
                  </div>
                  <div className="porter-resident-list">
                    {porterDrawerResidents.map((person) => (
                      <span key={person.id}>
                        <strong>{person.name}</strong>
                        <small>{person.relation || person.role || "Morador"} - {person.phone || "sem telefone"} - CPF {person.cpf || "-"}</small>
                      </span>
                    ))}
                    {!porterDrawerResidents.length && <span><strong>Sem moradores vinculados</strong><small>Confira o cadastro desta unidade.</small></span>}
                  </div>
                  {porterAttendanceCall && (
                    <div className="active-call-panel call-action-only">
                      {porterAttendanceCall.status === "RINGING" && !incomingCall && <button type="button" onClick={() => void answerCall(porterAttendanceCall)}><PhoneCall size={16} /> Atender</button>}
                      <button type="button" onClick={() => void triggerPorterActionForCall(porterAttendanceCall)}><KeySquare size={16} /> Ligar portaria</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="porter-unit-directory">
                  {porterAttendanceCall && <div className="empty-state">Chamada sem unidade identificada. Pesquise ou selecione uma unidade para conferir os moradores.</div>}
                  {listedPorterUnits.map((unit) => (
                    <div className="porter-unit-directory-row" key={unit.unitId}>
                      <button className="row-link-text" type="button" onClick={() => selectPorterUnit(unit)}>
                        <strong>{unitDisplay(unit)}</strong>
                        <span>{unit.residentName || unit.responsibleName || "Sem morador"} - Ramal {unit.telephony?.extension || unit.extension || "-"}</span>
                      </button>
                      <button className="unit-phone-action" title="Ligar para unidade" type="button" onClick={() => void callUnitFromPorter(unit)}>
                        <PhoneCall size={18} />
                      </button>
                    </div>
                  ))}
                  {!listedPorterUnits.length && <div className="empty-state">Nenhuma unidade encontrada.</div>}
                </div>
              )}
              <div className="porter-actions-panel">
                <div className="panel-heading compact-heading">
                  <h2>Acionamentos do condominio</h2>
                  <span>{tenantActions.filter((action) => action.status !== "DISABLED").length} ativo(s)</span>
                </div>
                <div className="porter-action-grid">
                  {tenantActions.map((action) => {
                    const actionDevice = tenantDevices.find((device) => device.id === action.deviceId);
                    return (
                      <button
                        key={action.id}
                        type="button"
                        className={action.status === "DISABLED" ? "secondary-button disabled-action" : "secondary-button"}
                        disabled={action.status === "DISABLED"}
                        onClick={() => void triggerAction(action)}
                        title={actionDevice ? `${actionDevice.name} - rele ${action.relay || 1}` : `Rele ${action.relay || 1}`}
                      >
                        <KeySquare size={16} />
                        <span><strong>{action.name}</strong><small>{action.route || actionDevice?.name || "Portaria"}</small></span>
                      </button>
                    );
                  })}
                  {!tenantActions.length && <div className="empty-state">Nenhum acionamento cadastrado para este condominio.</div>}
                </div>
              </div>
              <div className="porter-events-panel">
                <div className="panel-heading compact-heading">
                  <h2>Eventos da API</h2>
                  <span>ultimos 7</span>
                </div>
                <div className="porter-report-toolbar">
                  <Field label="Data do relatorio"><input type="date" value={porterReportDate} onChange={(event) => setPorterReportDate(event.target.value)} /></Field>
                  <button className="secondary-button" type="button" onClick={() => void downloadPorterEventReport()}><ClipboardList size={16} /> Relatorio</button>
                </div>
                <div className="porter-event-list">
                  {tenantEvents.slice(0, 7).map((event) => (
                    <div className="porter-event-row" key={event.id}>
                      <ClipboardList size={16} />
                      <div>
                        <strong>{event.reason || event.door?.name || "Evento"}</strong>
                        <span>{event.user?.name || "API"} - {event.door?.name || event.door?.manufacturer || event.rawEvent?.adapter || "Origem API"}</span>
                      </div>
                      <small>{formatDateTime(event.createdAt || event.occurredAt)}</small>
                      <em className={`status ${event.decision === "DENY" ? "offline" : ""}`}>{event.decision || "INFO"}</em>
                    </div>
                  ))}
                  {!tenantEvents.length && <div className="empty-state">Nenhum evento recebido da API para este condominio.</div>}
                </div>
              </div>
            </article>
            <article className="panel porter-camera-panel">
              <div className="panel-heading">
                <h2>Cameras do condominio</h2>
                <span>{porterMosaicItems.length} camera(s)</span>
              </div>
              <div className="webphone-panel compact-webphone">
                <div><strong>Audio da portaria</strong><span>{webPhone.incomingLabel || (webPhone.status === "DISCONNECTED" ? "Desconectado" : "Conectado")}</span></div>
                <div className="toolbar-actions">
                  <button type="button" disabled={["CONNECTING", "REGISTERED", "RINGING", "CALLING", "IN_CALL"].includes(webPhone.status)} onClick={() => void connectWebPhone()}><PhoneCall size={16} /> Conectar audio</button>
                  {webPhone.status === "RINGING" && !incomingCall && <button type="button" onClick={() => void answerWebPhone()}>Atender</button>}
                  {["RINGING", "CALLING", "IN_CALL"].includes(webPhone.status) && <button type="button" className="danger-button" onClick={() => void hangupWebPhone()}>Encerrar</button>}
                  <button type="button" className="secondary-button" disabled={webPhone.status === "DISCONNECTED"} onClick={() => void disconnectWebPhone()}>Desconectar</button>
                </div>
                <audio ref={webPhoneAudioRef} autoPlay playsInline />
              </div>
              <div className="porter-camera-stage">
                {expandedPorterItem ? (
                  <div className="porter-camera-expanded">
                    <CameraPreview
                      camera={expandedPorterItem.camera}
                      channel={expandedPorterItem.channel}
                      onFrameClick={() => setExpandedPorterCameraId("")}
                      frameLabel="Voltar para o mosaico de cameras"
                    />
                    <button className="secondary-button porter-camera-return" type="button" onClick={() => setExpandedPorterCameraId("")}>
                      <Grid3X3 size={16} /> Voltar ao mosaico
                    </button>
                  </div>
                ) : porterMosaicItems.length ? (
                  <div className={`porter-camera-mosaic layout-${porterMosaicLayout}`} aria-label="Mosaico de cameras do condominio">
                    {porterMosaicItems.map((item, index) => (
                      <CameraTile
                        key={item.key}
                        camera={item.camera}
                        channel={item.channel}
                        description={item.description}
                        index={index}
                        onSelect={() => {
                          setSelectedPorterCameraId(item.camera.id);
                          setExpandedPorterCameraId(item.key);
                        }}
                      />
                    ))}
                  </div>
                ) : <div className="empty-state">Nenhuma camera cadastrada para este condominio.</div>}
              </div>
            </article>
          </div>
        </section>
      );
    }

    if (activeSection === "resources") {
      return (
        <section className="resource-page">
          <div className="resource-hero panel">
            <div><span>Central por condominio</span><h2>{selectedTenant?.name || "-"}</h2><small>{data.resources.filter((item) => item.enabled).length} de {data.resources.length} recursos ativos</small></div>
            <Field label="Condominio"><select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)}>{data.condominiums.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          </div>
          <div className="subtabs resource-tabs">
            {["modulos", "portaria", "convites", "auditoria", "gateway"].map((tab) => <button key={tab} className={resourceTab === tab ? "active" : ""} onClick={() => setResourceTab(tab)}>{tab}</button>)}
          </div>
          {resourceTab === "portaria" ? (
            <div className="resource-operational-grid">
              <article className="panel">
                <div className="panel-heading"><h2>Busca rapida</h2><ShieldCheck size={18} /></div>
                <div className="remote-call-summary"><span><strong>0</strong>chamadas ativas</span><span><strong>{data.intercomCalls.length}</strong>no historico</span></div>
                <div className="porter-filter-grid">{["CPF", "RG", "Placa", "Nome", "Unidade", "Credencial"].map((item) => <button key={item} type="button" className={porterSearchType === item ? "" : "secondary-button"} onClick={() => setPorterSearchType(item)}><Search size={15} /> {item}</button>)}</div>
                <label className="search-field porter-search-input"><Search size={16} /><input value={porterSearchTerm} onChange={(event) => setPorterSearchTerm(event.target.value)} placeholder={`Buscar por ${porterSearchType.toLowerCase()}`} /></label>
              </article>
              <article className="panel">
                <div className="panel-heading"><h2>Portaria remota</h2><span>{data.intercomCalls.length} ativas</span></div>
                <div className="webphone-panel">
                <div><strong>Atendimento de audio</strong><span>{webPhone.incomingLabel || (webPhone.status === "DISCONNECTED" ? "Desconectado" : "Conectado")}</span></div>
                <div className="toolbar-actions">
                  <button type="button" disabled={["CONNECTING", "REGISTERED", "RINGING", "IN_CALL"].includes(webPhone.status)} onClick={() => void connectWebPhone()}><PhoneCall size={16} /> Conectar audio</button>
                    {webPhone.status === "RINGING" && !incomingCall && <button type="button" onClick={() => void answerWebPhone()}>Atender</button>}
                    {["RINGING", "IN_CALL"].includes(webPhone.status) && <button type="button" className="danger-button" onClick={() => void hangupWebPhone()}>Encerrar</button>}
                  <button type="button" className="secondary-button" disabled={webPhone.status === "DISCONNECTED"} onClick={() => void disconnectWebPhone()}>Desconectar</button>
                </div>
                  <audio ref={webPhoneAudioRef} autoPlay playsInline />
                </div>
                <div className="extensions-status-panel">
                <div className="panel-heading compact-heading"><h2>Ramais do condominio</h2><button className="secondary-button" type="button" onClick={() => void refreshExtensionStatus()}><RefreshCw size={16} /> Atualizar</button></div>
                  <div className="extensions-status-list">
                    {data.extensionStatus.map((item) => <span key={item.extension} className={item.registrationStatus === "REGISTERED" ? "registered" : item.configured ? "unregistered" : ""}><strong>{item.extension}</strong><em>{item.label}</em><small>{item.type} - {item.provisioningStatus || item.status}</small></span>)}
                  </div>
                </div>
                <div className="empty-state">Nenhuma chamada ativa. As chamadas do facial/interfone aparecem aqui em tempo real.</div>
              </article>
            </div>
          ) : resourceTab === "modulos" ? (
            <article className="panel">
              <div className="panel-heading"><h2>Modulos habilitados</h2><Grid3X3 size={18} /></div>
              {resourceConfig && (
                <div className="config-panel">
                  <div className="panel-heading compact-heading">
                    <h2>{resourceConfig === "cameras" ? "Cameras" : resourceConfig === "actions" ? "Acionamentos" : "Configuracao do recurso"}</h2>
                    <button className="secondary-button" onClick={() => setResourceConfig("")}>Voltar</button>
                  </div>
                  {resourceConfig === "cameras" && (
                    <CameraConfig
                    cameras={tenantCameraGroups}
                      devices={tenantDevices}
                      form={cameraForm}
                      setForm={setCameraForm}
                      showForm={showCameraForm}
                      onSave={saveCameraForm}
                      onEdit={editCamera}
                      onNew={() => { setCameraForm({ ...emptyCameraForm, tenantId: selectedTenant?.id || "" }); setShowCameraForm(true); }}
                      onDelete={deleteCamera}
                    />
                  )}
                  {resourceConfig === "actions" && (
                    <ActionConfig
                      actions={tenantActions}
                      devices={tenantDevices}
                      form={actionForm}
                      setForm={setActionForm}
                      onSave={saveActionForm}
                      onTrigger={triggerAction}
                      onDelete={deleteAction}
                      onEdit={(action) => setActionForm({
                        id: action.id,
                        name: action.name || "",
                        manufacturer: action.manufacturer || "Hikvision",
                        deviceId: action.deviceId || "",
                        relay: String(action.relay || 1),
                        route: action.route || "",
                        status: action.status || "ACTIVE"
                      })}
                    />
                  )}
                  {!["cameras", "actions"].includes(resourceConfig) && <div className="empty-state">Configuracao especifica mantida por modulo, perfil e permissao.</div>}
                </div>
              )}
              <div className="resource-module-list">
                {data.resources.map((item) => (
                  <div className="resource-module-row" key={item.id}>
                    <input type="checkbox" checked={item.enabled} onChange={(event) => void toggleResource(item, event.target.checked)} />
                    <span><strong>{item.name}</strong><small>{item.group} - {item.description}</small></span>
                    <div className="resource-row-actions">
                      {item.configurable && <button className="secondary-button" onClick={() => setResourceConfig(item.id)}>Configurar</button>}
                      <em>{item.enabled ? "Ativo" : "Pendente"}</em>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ) : (
            <article className="panel">
              <div className="panel-heading"><h2>{resourceTab === "convites" ? "Convites" : resourceTab === "auditoria" ? "Auditoria" : "Gateway"}</h2><ClipboardList size={18} /></div>
              {resourceTab === "convites" && (
                <div className="resource-module-list">
                  {["QR Code", "Chave virtual", "QR Scanner", "Convite recorrente", "Convite por prestador"].map((item) => <div className="resource-module-row" key={item}><input type="checkbox" defaultChecked /><span><strong>{item}</strong><small>Funcao liberada por condominio e perfil de usuario.</small></span><em>Ativo</em></div>)}
                </div>
              )}
              {resourceTab === "auditoria" && (
                <div className="unit-table header"><span>Evento</span><span>Origem</span><span>Usuario</span><span>Status</span></div>
              )}
              {resourceTab === "auditoria" && ["Abertura remota", "Credencial sincronizada", "Login mobile", "Camera visualizada"].map((eventName) => <div className="unit-table row" key={eventName}><span><strong>{eventName}</strong><small>{formatDateTime(new Date())}</small></span><span>API/Gateway</span><span>{session?.name || "Sistema"}</span><span className="status">Registrado</span></div>)}
              {resourceTab === "gateway" && (
                <div className="manufacturer-grid">
                  {data.manufacturerProfiles.map((profile) => <article className="manufacturer-card" key={profile.id}><strong>{profile.name}</strong><span>{profile.protocols.join(" / ")}</span><small>Status: pronto para conector</small><button className="secondary-button" onClick={() => setActiveSection("sdk")}>Ver SDK</button></article>)}
                </div>
              )}
            </article>
          )}
        </section>
      );
    }

    if (activeSection === "permissions") {
      const permissionKeys = ["dashboard.view", "units.manage", "people.manage", "visitors.manage", "providers.manage", "syndic.manage", "devices.manage", "credentials.manage", "resources.manage", "licenses.manage", "portaria.answer", "actions.trigger", "cameras.view", "telephony.manage"];
      return (
        <section className="resource-page">
          <article className="panel">
            <div className="panel-heading"><h2>Permissoes por tipo de usuario</h2><KeySquare size={20} /></div>
            <div className="permission-grid">
              {data.permissionProfiles.map((profile) => (
                <article className="permission-card" key={profile.id}>
                  <div><strong>{profile.label}</strong><span>{profile.description}</span></div>
                  <div className="permission-list">
                    {permissionKeys.map((permission) => (
                      <label key={permission}><input type="checkbox" defaultChecked={profile.permissions.includes(permission)} /> {permission}</label>
                    ))}
                  </div>
                  <button className="secondary-button" type="button"><Save size={16} /> Salvar perfil</button>
                </article>
              ))}
            </div>
          </article>
          <article className="panel">
            <div className="panel-heading"><h2>Permissoes por rota de acesso</h2><Grid3X3 size={20} /></div>
            <div className="route-grid">{data.accessRoutes.map((route) => <button className="secondary-button" key={route.id}>{route.name}</button>)}</div>
          </article>
        </section>
      );
    }

    if (activeSection === "credentials") {
      return (
        <section className="resource-page">
          <form className="panel form-panel" onSubmit={saveCredentialForm}>
            <div className="panel-heading"><h2>Nova credencial</h2><BadgeCheck size={20} /></div>
            <div className="form-grid">
              <Field label="Condominio"><input readOnly value={selectedTenant?.name || ""} /></Field>
              <Field label="Unidade"><select value={credentialForm.unitId || selectedUnit?.unitId || ""} onChange={(event) => setCredentialForm((current) => ({ ...current, unitId: event.target.value, personId: "" }))}>{units.map((unit) => <option key={unit.unitId} value={unit.unitId}>Unidade {unit.unitNumber}</option>)}</select></Field>
              <Field label="Pessoa"><select value={credentialForm.personId} onChange={(event) => setCredentialForm((current) => ({ ...current, personId: event.target.value }))}><option value="">Selecione</option>{data.residents.filter((person) => person.tenantId === selectedTenant?.id && (!credentialForm.unitId || person.unitId === credentialForm.unitId)).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
              <Field label="Tipo de credencial"><select value={credentialForm.type} onChange={(event) => setCredentialForm((current) => ({ ...current, type: event.target.value }))}><option>APP</option><option>FACE</option><option>RFID</option><option>QR_CODE</option><option>PIN</option><option>PLATE</option></select></Field>
              <Field label="Valor"><input value={credentialForm.value} placeholder="Vazio gera automaticamente" onChange={(event) => setCredentialForm((current) => ({ ...current, value: event.target.value }))} /></Field>
              <Field label="Equipamento alvo"><select value={credentialForm.deviceId} onChange={(event) => setCredentialForm((current) => ({ ...current, deviceId: event.target.value }))}><option value="">Todos compativeis</option>{tenantDevices.map((device) => <option key={device.id} value={device.id}>{device.name} - {device.manufacturer}</option>)}</select></Field>
              <button type="submit"><Save size={16} /> Salvar credencial</button>
              <button className="secondary-button" type="button" onClick={() => credentialForm.personId && void generateCredentialForPerson(data.residents.find((person) => person.id === credentialForm.personId), credentialForm.type)}><Plus size={16} /> Gerar automatico</button>
            </div>
            <div className="form-hint">Para FACE, APP, QR e PIN o sistema pode gerar o identificador. RFID e placa podem ser importados por planilha ou digitados aqui.</div>
          </form>
          <article className="panel form-panel">
            <div className="panel-heading"><h2>Importar moradores e credenciais</h2><ClipboardList size={20} /></div>
            <div className="form-grid">
              <Field label="Arquivo CSV/XLSX"><input type="file" accept=".csv,.xlsx,.xls" onChange={handleCredentialImportFile} /></Field>
              <Field label="Arquivo lido"><input readOnly value={credentialImportFile || "Nenhum arquivo"} /></Field>
              <button className="secondary-button" type="button" onClick={() => setCredentialImportReport(null)}>Limpar relatorio</button>
              <button type="button" disabled={!credentialImportRows.length || credentialImportReport?.invalid > 0} onClick={() => void commitCredentialImport()}><Save size={16} /> Confirmar importacao</button>
            </div>
            {credentialImportReport && (
              <div className="import-report">
                <span><strong>{credentialImportReport.valid}</strong>validos</span>
                <span><strong>{credentialImportReport.invalid}</strong>invalidos</span>
                <span><strong>{credentialImportReport.duplicates}</strong>duplicados</span>
                <span><strong>{credentialImportReport.peopleCreated}</strong>pessoas novas</span>
                <span><strong>{credentialImportReport.credentialsCreated}</strong>credenciais novas</span>
              </div>
            )}
            {credentialImportReport?.errors?.length ? (
              <div className="simple-list">
                {credentialImportReport.errors.slice(0, 6).map((item) => <div className="simple-row" key={item.row}><ClipboardList size={18} /><div><strong>Linha {item.row}</strong><span>{item.errors.join(", ")}</span></div><span className="status offline">Corrigir</span></div>)}
              </div>
            ) : null}
          </article>
          <article className="panel">
            <div className="panel-heading"><h2>Credenciais</h2><BadgeCheck size={20} /></div>
            <div className="unit-table header"><span>Pessoa / Unidade</span><span>Tipo</span><span>Identificacao</span><span>Sincronismo</span></div>
            {tenantCredentials.map((credential) => {
              const person = data.residents.find((item) => item.id === credential.personId);
              const unit = data.units.find((item) => item.unitId === credential.unitId);
              return (
                <div className="unit-table row" key={credential.id}>
                  <span><strong>{person?.name || credential.personId}</strong><small>Unidade {unit?.unitNumber || "-"}</small></span>
                  <span>{credential.type}</span>
                  <span>{credential.valueLabel}</span>
                  <span className={`status ${credential.syncStatus === "PENDING" || credential.syncStatus === "ERROR" ? "offline" : ""}`}>{credential.syncStatus}</span>
                  <div className="row-actions"><button className="compact-action-button secondary-button" onClick={() => setCredentialForm({ ...emptyCredentialForm, ...credential })}>Editar</button><button className="compact-action-button secondary-button" onClick={() => void syncCredentialTarget({ credentialId: credential.id, credentialType: credential.type, deviceId: credential.deviceId || credentialForm.deviceId, target: credential.valueLabel })}>Sincronizar</button><button className="compact-action-button danger-button" onClick={() => void deleteCredential(credential)}>Excluir</button></div>
                </div>
              );
            })}
            {!tenantCredentials.length && <div className="empty-state">Nenhuma credencial cadastrada para este condominio.</div>}
          </article>
          <article className="panel">
            <div className="panel-heading"><h2>Sincronismo de credenciais</h2><RefreshCw size={20} /></div>
            <div className="toolbar-actions unit-actions">
              <button type="button" onClick={() => void enqueueCredentialSync(data.manufacturerProfiles[0] || { name: "Generico" }, "FACE")}><RefreshCw size={16} /> Sincronizar faces</button>
              <button className="secondary-button" type="button" onClick={() => void syncCredentialTarget({ credentialType: "APP", target: "Todas credenciais APP" })}>Sincronizar APP/QR</button>
            </div>
            <div className="sync-job-grid">
              {data.credentialSyncJobs.map((job) => (
                <div className="sync-job-card" key={job.id}>
                  <strong>{job.manufacturer}</strong>
                  <span>{job.target}</span>
                  <small>{job.direction} {job.credentialType} - {job.synced}/{job.total} enviados, {job.errors} erro(s)</small>
                  <em className="status">{job.status}</em>
                </div>
              ))}
              {!data.credentialSyncJobs.length && <div className="empty-state">Nenhum sincronismo executado ainda.</div>}
            </div>
          </article>
        </section>
      );
    }

    if (activeSection === "payments") {
      return (
        <section className="resource-page">
          <article className="panel">
            <div className="panel-heading"><h2>Formas de pagamento</h2><CreditCard size={20} /></div>
            <div className="payment-grid">
              {[
                ["PIX", "Chave PIX, QR Code e conciliacao manual"],
                ["Boleto", "Vencimento, multa, juros e arquivo de retorno"],
                ["Cartao", "Credito/debito com gateway de pagamento"],
                ["Transferencia", "Dados bancarios e comprovante"]
              ].map(([title, description]) => (
                <article className="payment-card" key={title}>
                  <strong>{title}</strong>
                  <span>{description}</span>
                  <label><input type="checkbox" defaultChecked={title === "PIX" || title === "Boleto"} /> Ativo para novas licencas</label>
                </article>
              ))}
            </div>
          </article>
          <article className="panel form-panel">
            <div className="panel-heading"><h2>Configuracao financeira da licenca</h2><Settings size={20} /></div>
            <div className="form-grid">
              <Field label="Licenca"><select>{data.licenses.map((license) => <option key={license.id} value={license.id}>{license.name}</option>)}</select></Field>
              <Field label="Plano"><select><option>Full</option><option>Showroom</option><option>Basico</option></select></Field>
              <Field label="Valor mensal"><input defaultValue="0,00" /></Field>
              <Field label="Vencimento"><input defaultValue="10" /></Field>
              <Field label="Forma padrao"><select><option>PIX</option><option>Boleto</option><option>Cartao</option><option>Transferencia</option></select></Field>
              <Field label="Status"><select><option>Ativa</option><option>Em teste</option><option>Bloqueada</option></select></Field>
              <button type="button"><Save size={16} /> Salvar pagamento</button>
            </div>
            <div className="form-hint">Nesta etapa a tela ja separa o cadastro financeiro. A persistencia real entra junto com o modelo de licencas no banco definitivo.</div>
          </article>
        </section>
      );
    }

    if (activeSection === "licenses") {
      return (
        <section className="crud-grid">
          <form className="panel form-panel" onSubmit={saveLicenseForm}>
            <div className="panel-heading"><h2>Nova licenca</h2><FileKey2 size={20} /></div>
            <div className="form-grid">
              <Field label="Contrato"><select value={licenseForm.contract} onChange={(event) => setLicenseForm((current) => ({ ...current, contract: event.target.value, contractor: event.target.value }))}><option>DINAMUS SERVICOS DE SEGURANCA PRIVADA</option><option>AGP SISTEMAS CORP</option></select></Field>
              <Field label="Nome"><input value={licenseForm.name} onChange={(event) => setLicenseForm((current) => ({ ...current, name: event.target.value }))} /></Field>
              <Field label="CNPJ"><input value={licenseForm.cnpj} onChange={(event) => setLicenseForm((current) => ({ ...current, cnpj: event.target.value }))} /></Field>
              <Field label="Tipo"><select value={licenseForm.type} onChange={(event) => setLicenseForm((current) => ({ ...current, type: event.target.value }))}><option>Condominio</option><option>Empresa</option></select></Field>
              <Field label="Estrutura"><select value={licenseForm.structure} onChange={(event) => setLicenseForm((current) => ({ ...current, structure: event.target.value }))}><option>Residencial</option><option>Corporativo</option></select></Field>
              <Field label="Atendimento"><select value={licenseForm.attendance} onChange={(event) => setLicenseForm((current) => ({ ...current, attendance: event.target.value, plan: event.target.value }))}><option>Full</option><option>Showroom</option></select></Field>
              <Field label="Cidade/UF"><input value={licenseForm.city} onChange={(event) => setLicenseForm((current) => ({ ...current, city: event.target.value }))} /></Field>
              <Field label="Moradores"><input value={licenseForm.residents} onChange={(event) => setLicenseForm((current) => ({ ...current, residents: event.target.value }))} /></Field>
              <button type="submit"><Save size={16} /> Salvar licenca</button>
            </div>
          </form>
          <article className="panel">
            <div className="panel-heading"><h2>Licencas</h2><button><Plus size={16} /> Nova licenca</button></div>
            <label className="search-field"><Search size={16} /><input placeholder="Pesquise o nome ou codigo da licenca" /></label>
            <div className="license-list">
              {data.licenses.map((license) => (
                <article className="license-card" key={license.id}>
                  <strong>{license.name}</strong>
                  <span>{license.type}</span>
                  <span>{license.residents} moradores</span>
                  <span>{license.city}</span>
                  <em>{license.plan} - {license.code}</em>
                  <small>{license.contractor}</small>
                  <button className="secondary-button" onClick={() => navigateTo(`/licencas/${license.code}/unidades`)}><Home size={15} /> Unidades</button>
                  <button className="secondary-button" onClick={() => navigateTo(`/licencas/${license.code}/configuracaoCameras`)}><Camera size={15} /> Cameras</button>
                  <button className="secondary-button" onClick={() => navigateTo(`/licencas/${license.code}/configuracaoAcionamentos`)}><KeySquare size={15} /> Acionamentos</button>
                  <button className="secondary-button" onClick={() => navigateTo(`/licencas/${license.code}/equipamentos`)}><RadioTower size={15} /> Equipamentos</button>
                  <button className="secondary-button" onClick={() => navigateTo(`/licencas/${license.code}/credenciais`)}><BadgeCheck size={15} /> Credenciais</button>
                  <button className="secondary-button" onClick={() => setLicenseForm({
                    id: license.id,
                    contract: license.contractor || "DINAMUS SERVICOS DE SEGURANCA PRIVADA",
                    contractor: license.contractor || "DINAMUS SERVICOS DE SEGURANCA PRIVADA",
                    name: license.name || "",
                    cnpj: license.cnpj || "",
                    type: license.type || "Condominio",
                    structure: license.structure || "Residencial",
                    attendance: license.plan || "Full",
                    plan: license.plan || "Full",
                    city: license.city || "",
                    residents: String(license.residents || 0)
                  })}>Editar</button>
                </article>
              ))}
            </div>
          </article>
        </section>
      );
    }

    return (
      <section className="resource-page">
        <article className="panel">
          <div className="panel-heading"><h2>SDK equipamentos</h2><ServerCog size={20} /></div>
          <div className="manufacturer-grid">
            {data.manufacturerProfiles.map((profile) => (
              <article className="manufacturer-card" key={profile.id}>
                <div>
                  <strong>{profile.name}</strong>
                  <span>{profile.families.join(" / ")}</span>
                </div>
                <div className="tag-list">{profile.protocols.map((item) => <em key={item}>{item}</em>)}</div>
                <small>Portas padrao: {profile.defaultPorts.join(", ")}</small>
                <small>Credenciais: {profile.credentialTypes.join(", ")}</small>
                <p>{profile.notes}</p>
                <button className="secondary-button" onClick={() => void enqueueCredentialSync(profile)}><RefreshCw size={16} /> Sincronizar</button>
              </article>
            ))}
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading"><h2>Checklist de integracao</h2><ClipboardList size={20} /></div>
          <div className="resource-checklist">{["Nao salvar imagem pesada na API", "Usar URL/stream e snapshot sob demanda", "Fila para credenciais faciais", "Gateway local para equipamentos sem API HTTP", "Webhooks/eventos para atualizar status em tempo real"].map((item) => <span key={item}><Save size={16} /> {item}</span>)}</div>
        </article>
      </section>
    );
  }

  const isCondoSection = activeSection === "condoHome" || condoSections.some((section) => section.id === activeSection);
  const isCondoForm = activeSection === "condoForm";
  const ActiveIcon = activeSection === "condoHome" || activeSection === "condoForm" ? Building2 : active.icon;
  const topbarLabel = activeSection === "condoHome"
    ? selectedTenant?.name || "Condominio"
    : activeSection === "condoForm"
      ? condoFormMode === "new" ? "Novo condominio" : "Cadastro do condominio"
      : active.label;
  const showCondoMenu = isCondoSection || (isCondoForm && condoFormMode === "edit");
  const primarySections = showCondoMenu ? sections.filter((section) => section.id !== "condominiums") : sections;

  return (
    <main className="shell">
      {incomingCall && incomingCall.status === "RINGING" && (
        <div className="call-modal-backdrop" role="presentation">
          <section className="call-notification call-modal" role="dialog" aria-modal="true" aria-labelledby="incoming-call-title">
            <div className="call-modal-icon"><PhoneCall size={24} /></div>
            <div className="call-modal-content">
              <span className="call-modal-kicker">Chamada recebida</span>
              <h2 id="incoming-call-title">{incomingCallTenant?.name || "Condominio"}</h2>
              <div className="call-modal-grid">
                <span><strong>Unidade</strong>{incomingCallUnit?.unitNumber || incomingCall.unitNumber || incomingCall.unitId || "-"}</span>
                <span><strong>Ramal</strong>{incomingCall.sourceExtension || incomingCallUnit?.telephony?.extension || incomingCallUnit?.extension || "-"}</span>
                <span><strong>Origem</strong>{incomingCall.visitorLabel || incomingCall.targetType || "Aplicativo do morador"}</span>
                <span><strong>Status</strong>{incomingCall.status}</span>
              </div>
              {incomingCallUnit?.residentName && <p>{incomingCallUnit.residentName}</p>}
            </div>
            <div className="call-modal-actions">
              <button type="button" className="call-modal-button call-modal-reject" title="Recusar chamada" aria-label="Recusar chamada" onClick={() => void rejectIncomingCall(incomingCall)}><PhoneOff size={22} /></button>
              <button type="button" className="call-modal-button call-modal-answer" title="Atender chamada" aria-label="Atender chamada" onClick={() => void answerCall(incomingCall)}><PhoneCall size={22} /></button>
            </div>
          </section>
        </div>
      )}
      {disconnectedDevices.length > 0 && (
        <button className="device-alert-notification" type="button" onClick={() => { setActiveSection("devices"); setDeviceTab("painel"); }}>
          <WifiOff size={20} />
          <div>
            <strong>Equipamento desconectado</strong>
            <span>{disconnectedDevices[0].name}{disconnectedDevices.length > 1 ? ` +${disconnectedDevices.length - 1}` : ""}</span>
          </div>
        </button>
      )}
      <aside className="sidebar">
        <div className="brand">
          <img src={Logo} alt="Condo Access" />
          <div><strong>Condo Access</strong><span>Gestao operacional</span></div>
        </div>
        <nav>
          {primarySections.map((section) => {
            const Icon = section.icon;
            return (
              <button key={section.id} className={section.id === activeSection || (section.id === "condominiums" && activeSection === "condoForm") ? "active" : ""} onClick={() => {
                setActiveSection(section.id);
                if (section.id === "remotePorter") setResourceTab("portaria");
              }}>
                <Icon size={18} />
                {section.label}
              </button>
            );
          })}
          {!showCondoMenu && <div className="nav-group">
            <span>Configuracoes</span>
            {settingsSections.map((section) => {
              const Icon = section.icon;
            return (
              <button key={section.id} className={section.id === activeSection ? "active" : ""} onClick={() => setActiveSection(section.id)}>
                <Icon size={18} />
                {section.label}
              </button>
              );
            })}
          </div>}
          {showCondoMenu && <div className="nav-group">
            <span>{selectedTenant?.name || "Condominio"}</span>
            {condoSections.map((section) => {
              const Icon = section.icon;
            return (
                <button key={section.id} className={section.id === activeSection ? "active" : ""} onClick={() => {
                  setActiveSection(section.id);
                  if (section.id === "devices") setDeviceTab("inicio");
                }}>
                  <Icon size={18} />
                  {section.label}
                </button>
              );
            })}
          </div>}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="titulo">
            {(activeSection === "condoHome" || activeSection === "condoForm") && <button className="secondary-button back-title-button" type="button" onClick={() => setActiveSection("condominiums")}>{"<-"} Voltar</button>}
            <img className="logo" src={Logo} alt="" />
            <h1><ActiveIcon size={28} /> {topbarLabel}</h1>
          </div>
          <div className="toolbar-actions">
            <button onClick={() => void syncNow()}><RefreshCw size={16} /> Sincronizar</button>
            <button className="secondary-button" onClick={() => persistSession(null)}>Sair</button>
          </div>
        </header>
        <StatusBanner status={syncState.status} error={syncState.error} lastSyncAt={syncState.lastSyncAt} />
        {renderContent()}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
