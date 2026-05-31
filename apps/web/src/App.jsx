import Hls from "hls.js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
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
  Wifi,
  WifiOff
} from "lucide-react";
import Logo from "./logo.png";
import "./styles.css";

const apiUrl = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3333`;

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

const emptyDeviceForm = {
  id: "",
  category: "access-control",
  manufacturer: "Hikvision",
  name: "",
  model: "",
  ipAddress: "",
  apiPort: "80",
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
  description: "",
  type: "NVR",
  manufacturer: "Hikvision",
  host: "",
  rtspPort: "554",
  httpPort: "80",
  username: "admin",
  password: "",
  channel: "1",
  channelCount: "16",
  channelDescription: "",
  stream: "MAIN",
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

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
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

function StatusBanner({ status, error, lastSyncAt }) {
  const connected = status === "synced" || status === "saving";
  const Icon = connected ? Wifi : WifiOff;
  return (
    <div className={`sync-banner ${connected ? "synced" : "offline"}`}>
      <div>
        <Icon size={20} />
        <strong>{connected ? "API conectada" : "Verificando conexao"}</strong>
        <span>Ultima sincronizacao {formatDateTime(lastSyncAt)}</span>
      </div>
      <small>{error || "Configuracao SIP salva e enviada ao app mobile"}</small>
    </div>
  );
}

function cameraStreamKey(camera, channel) {
  if (!camera) return "";
  const selectedChannel = Number(channel || camera.channel || camera.activeChannels?.[0]?.channel || 1);
  return selectedChannel ? `${camera.id}--ch-${selectedChannel}` : camera.id;
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

function CameraPreview({ camera, channel }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState("Carregando camera...");
  const selectedChannel = Number(channel || camera?.channel || camera?.activeChannels?.[0]?.channel || 1);
  const streamUrl = camera ? `${apiUrl}/streams/${cameraStreamKey(camera, selectedChannel)}/index.m3u8` : "";

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return undefined;

    let hls = null;
    let fallbackTimer = null;
    let usingFallback = false;

    setStatus("Abrindo stream HLS da API local...");

    function markConnected() {
      setStatus("Stream conectado");
    }

    function startHlsFallback() {
      if (usingFallback) return;
      usingFallback = true;

      if (!Hls.isSupported()) {
        setStatus("Navegador sem suporte HLS. Abra pelo botao HLS ou VLC.");
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
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setStatus("Nao foi possivel abrir o stream. Verifique senha RTSP e FFmpeg.");
      });
    }

    function handleLoadedMetadata() {
      markConnected();
      void video.play().catch(() => undefined);
    }

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("playing", markConnected);
    video.addEventListener("error", startHlsFallback);

    video.src = streamUrl;
    video.load();
    void video.play().catch(() => undefined);

    fallbackTimer = window.setTimeout(() => {
      if (video.readyState < 2) startHlsFallback();
    }, 3500);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("playing", markConnected);
      video.removeEventListener("error", startHlsFallback);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [streamUrl]);

  if (!camera) {
    return <div className="empty-state">Selecione uma camera do condominio.</div>;
  }

  return (
    <div className="camera-preview">
      <video ref={videoRef} controls muted playsInline autoPlay />
      <div>
        <strong>{camera.description || camera.name}</strong>
        <span>{camera.host}:{camera.rtspPort} - Canal {selectedChannel}</span>
        <small>{status}</small>
      </div>
      <div className="camera-preview-actions">
        <a className="secondary-button" href={`${apiUrl}/api/cameras/${camera.id}/vlc.m3u`} download><Camera size={16} /> Abrir no VLC</a>
        <a className="secondary-button" href={`${apiUrl}/streams/${camera.id}/index.m3u8`} target="_blank" rel="noreferrer"><Camera size={16} /> HLS</a>
      </div>
    </div>
  );
}

function MiniCameraPreview({ camera, channel }) {
  const videoRef = useRef(null);
  const streamUrl = camera ? `${apiUrl}/streams/${cameraStreamKey(camera, channel)}/index.m3u8` : "";

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return undefined;
    let hls = null;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.load();
      void video.play().catch(() => undefined);
    } else if (Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: true, backBufferLength: 6, liveSyncDurationCount: 2 });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => undefined));
    }
    return () => {
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [streamUrl]);

  if (!camera) return null;
  return (
    <div className="mosaic-player">
      <video ref={videoRef} muted playsInline autoPlay />
      <span>{camera.description || camera.name} - Canal {channel}</span>
    </div>
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

function CameraConfig({ cameras, form, setForm, showForm, onSave, onEdit, onNew, onDelete }) {
  const isMultiChannel = form.type === "DVR" || form.type === "NVR";
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
          <Field label="Descricao"><input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></Field>
          <Field label="Fabricante"><select value={form.manufacturer} onChange={(event) => setForm((current) => ({ ...current, manufacturer: event.target.value }))}><option>Hikvision</option><option>Intelbras</option><option>Control iD</option><option>Linear HCS</option><option>Bravas</option><option>SIM Next Cloud</option><option>Generico</option></select></Field>
          <Field label="Tipo"><select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value, channelCount: event.target.value === "CAMERA_IP" ? "1" : current.channelCount || "16" }))}><option value="CAMERA_IP">Camera IP</option><option value="DVR">DVR multicanal</option><option value="NVR">NVR multicanal</option><option value="VIDEO_PORTEIRO">Video porteiro</option><option value="FACIAL">Facial</option><option value="CLOUD">Cloud</option></select></Field>
          <Field label="IP / DDNS"><input value={form.host} onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))} /></Field>
          <Field label="Porta RTSP"><input value={form.rtspPort} onChange={(event) => setForm((current) => ({ ...current, rtspPort: event.target.value }))} /></Field>
          <Field label="Porta HTTP"><input value={form.httpPort} onChange={(event) => setForm((current) => ({ ...current, httpPort: event.target.value }))} /></Field>
          <Field label="Usuario"><input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} /></Field>
          <Field label="Senha"><input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} /></Field>
          <Field label="Canal inicial"><input value={form.channel} onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value }))} /></Field>
          <Field label="Quantidade de canais"><input disabled={form.id || !isMultiChannel} value={isMultiChannel ? form.channelCount : "1"} onChange={(event) => setForm((current) => ({ ...current, channelCount: event.target.value }))} /></Field>
          <Field label="Descricao base"><input value={form.channelDescription} onChange={(event) => setForm((current) => ({ ...current, channelDescription: event.target.value }))} placeholder="Ex.: NVR portaria, garagem, torre A" /></Field>
          <Field label="Stream"><select value={form.stream} onChange={(event) => setForm((current) => ({ ...current, stream: event.target.value }))}><option value="MAIN">Principal</option><option value="SUB">Substream</option></select></Field>
          <Field label="Proporcao"><select value={form.aspectRatio} onChange={(event) => setForm((current) => ({ ...current, aspectRatio: event.target.value }))}><option value="WIDESCREEN">16:9</option><option value="STANDARD">4:3</option><option value="PORTRAIT">Vertical</option></select></Field>
          <Field label="Metodo no app"><select value={form.loadMethod} onChange={(event) => setForm((current) => ({ ...current, loadMethod: event.target.value }))}><option value="SNAPSHOT_TEMPO_REAL">RTSP tempo real</option><option value="HLS_GATEWAY">HLS pela API</option><option value="CLOUD">Cloud/fabricante</option></select></Field>
          <Field label="Captura de foto"><select value={form.photoCaptureEnabled ? "true" : "false"} onChange={(event) => setForm((current) => ({ ...current, photoCaptureEnabled: event.target.value === "true" }))}><option value="false">Desativada</option><option value="true">Ativada</option></select></Field>
        </div>
      </form>}
      {cameras.length ? (
        <div className="camera-card-grid">
          {cameras.map((camera) => (
            <article className="config-card camera-card" key={camera.id}>
              <header>
                <div>
                  <strong>{camera.description || camera.name}</strong>
                  <span>{camera.manufacturer} - {camera.type}</span>
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
          <Field label="Fabricante"><select value={form.manufacturer} onChange={(event) => setForm((current) => ({ ...current, manufacturer: event.target.value }))}><option>Hikvision</option><option>Moni Software</option><option>Control iD</option><option>Intelbras</option><option>Nice Guarita</option><option>Generico</option></select></Field>
          <Field label="Equipamento"><select value={form.deviceId} onChange={(event) => {
            const device = devices.find((item) => item.id === event.target.value);
            setForm((current) => ({ ...current, deviceId: event.target.value, manufacturer: device?.manufacturer || current.manufacturer }));
          }}><option value="">{devices.length ? "Selecione o equipamento" : "Sem equipamento neste condominio"}</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name} - {device.manufacturer} - {device.ipAddress || "sem IP"}</option>)}</select></Field>
          <Field label="Rele / porta"><input value={form.relay} onChange={(event) => setForm((current) => ({ ...current, relay: event.target.value }))} /></Field>
          <Field label="Rota"><input value={form.route} onChange={(event) => setForm((current) => ({ ...current, route: event.target.value }))} /></Field>
          <Field label="Status"><select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option>ACTIVE</option><option>DISABLED</option></select></Field>
        </div>
      </form>
      {actions.map((action) => (
        <article className="action-row" key={action.id}>
          <button className="secondary-button" disabled={action.status === "DISABLED"} onClick={() => onTrigger(action)}>Acionar</button>
          <span><strong>{action.name}</strong><small>{action.route}</small></span>
          <span>{action.manufacturer}{action.relay ? ` / rele ${action.relay}` : ""}</span>
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
  const [data, setData] = useState(emptyData);
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
  const [selectedMosaicKeys, setSelectedMosaicKeys] = useState([]);
  const [selectedCallId, setSelectedCallId] = useState("");
  const [telephony, setTelephony] = useState(emptyTelephony);
  const [tenantTelephony, setTenantTelephony] = useState({});
  const [message, setMessage] = useState("");
  const [deviceForm, setDeviceForm] = useState(emptyDeviceForm);
  const [licenseForm, setLicenseForm] = useState(emptyLicenseForm);
  const [cameraForm, setCameraForm] = useState(emptyCameraForm);
  const [showCameraForm, setShowCameraForm] = useState(false);
  const [actionForm, setActionForm] = useState(emptyActionForm);

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
    const unitRootMatch = pathname.match(/^\/unidades\/([^/]+)$/);
    const unitPeopleMatch = pathname.match(/^\/unidades\/([^/]+)\/pessoas\/([^/]+)\/ver\/([^/]+)$/);
    const unitLoginsMatch = pathname.match(/^\/unidades\/([^/]+)\/logins$/);
    const unitInvitesMatch = pathname.match(/^\/unidades\/([^/]+)\/convites\/([^/]+)$/);

    const selectTenantByLicense = (code) => {
      const license = data.licenses.find((item) => item.code === code || item.id === code || item.id === `license-${code}`);
      if (license?.tenantId) setSelectedTenantId(license.tenantId);
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
  }, [data.licenses, normalizeUnitId]);

  const navigateTo = useCallback((path) => {
    window.history.pushState({}, "", path);
    applyRoute(path);
  }, [applyRoute]);

  const syncNow = useCallback(async () => {
    setSyncState((current) => ({ ...current, status: "syncing", error: "" }));
    try {
      const response = await fetch(`${apiUrl}/api/bootstrap`);
      if (!response.ok) throw new Error(`API ${response.status}`);
      const payload = await response.json();
      const currentTenantId = payload.condominiums.some((item) => item.id === selectedTenantId)
        ? selectedTenantId
        : payload.condominiums[0]?.id || "";
      const extensionResponse = currentTenantId
        ? await fetch(`${apiUrl}/api/extensions/status?tenantId=${encodeURIComponent(currentTenantId)}`).catch(() => null)
        : null;
      const extensionPayload = extensionResponse?.ok ? await extensionResponse.json().catch(() => null) : null;
      if (extensionPayload?.extensions) payload.extensionStatus = extensionPayload.extensions;
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
    }
  }, [selectedTenantId]);

  useEffect(() => {
    void syncNow();
  }, [syncNow]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void syncNow();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [syncNow]);

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
  const tenantActions = useMemo(() => data.actions.filter((action) => action.tenantId === selectedTenant?.id), [data.actions, selectedTenant?.id]);
  const tenantCalls = useMemo(() => data.intercomCalls.filter((call) => !call.tenantId || call.tenantId === selectedTenant?.id), [data.intercomCalls, selectedTenant?.id]);
  const tenantEvents = useMemo(() => (data.accessLogs || []).filter((log) => !log.tenantId || log.tenantId === selectedTenant?.id), [data.accessLogs, selectedTenant?.id]);
  const disconnectedDevices = useMemo(() => tenantDevices.filter((device) => device.status && device.status !== "ONLINE"), [tenantDevices]);
  const selectedPorterCamera = tenantCameras.find((camera) => camera.id === selectedPorterCameraId) || tenantCameras[0];
  const incomingCall = useMemo(() => data.intercomCalls.find((call) => call.status === "RINGING"), [data.intercomCalls]);
  const selectedCall = useMemo(() => data.intercomCalls.find((call) => call.id === selectedCallId), [data.intercomCalls, selectedCallId]);

  useEffect(() => {
    setSelectedMosaicKeys((current) => {
      const available = new Set(tenantMosaicOptions.map((item) => item.key));
      const next = current.filter((key) => available.has(key));
      if (next.length) return next;
      return tenantMosaicOptions.slice(0, 4).map((item) => item.key);
    });
  }, [tenantMosaicOptions]);

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

  const editCamera = useCallback((camera) => {
    setShowCameraForm(true);
    setCameraForm({
      id: camera.id,
      tenantId: camera.tenantId || selectedTenant?.id || "",
      description: camera.description || "",
      type: camera.type === "NVR/DVR" ? "NVR" : camera.type || "NVR",
      manufacturer: camera.manufacturer || "Hikvision",
      host: camera.host || camera.ipAddress || "",
      rtspPort: String(camera.rtspPort || 554),
      httpPort: String(camera.httpPort || 80),
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
    setMessage("Salvando SIP da unidade...");
    const response = await fetch(`${apiUrl}/api/units/${selectedUnit.unitId}/telephony`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(telephony)
    });
    if (!response.ok) {
      setMessage("Falha ao salvar SIP da unidade.");
      return;
    }
    setMessage("SIP da unidade salvo. O app mobile recebe estes dados no login/troca de unidade.");
    await syncNow();
  }

  async function saveTenantTelephony(event) {
    event?.preventDefault();
    if (!selectedTenant) return;
    setMessage("Salvando grupo SIP do condominio...");
    const response = await fetch(`${apiUrl}/api/condominiums/${selectedTenant.id}/telephony`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tenantTelephony)
    });
    if (!response.ok) {
      setMessage("Falha ao salvar grupo SIP.");
      return;
    }
    setMessage("Grupo SIP salvo e propagado para as unidades.");
    await syncNow();
  }

  async function createOrUpdateCondo(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`${apiUrl}/api/condominiums`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: form.get("id"),
        name: form.get("name"),
        document: form.get("document"),
        status: form.get("status"),
        telephonyProvider: form.get("telephonyProvider"),
        sipDomain: form.get("sipDomain"),
        sipWebSocketUrl: form.get("sipWebSocketUrl"),
        sipPorterExtension: form.get("sipPorterExtension"),
        sipPorterPassword: form.get("sipPorterPassword"),
        sipExtensionStart: form.get("sipExtensionStart"),
        sipExtensionEnd: form.get("sipExtensionEnd")
      })
    });
    const saved = await response.json();
    if (saved?.id) {
      setSelectedTenantId(saved.id);
      setCondoFormMode("edit");
      setActiveSection("condoHome");
    }
    setMessage("Condominio salvo.");
    await syncNow();
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
    setMessage("Condominio excluido.");
    await syncNow();
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
        extension: form.get("extension"),
        extensionPassword: form.get("extensionPassword")
      })
    });
    if (!response.ok) {
      setMessage("Falha ao salvar unidade.");
      return;
    }
    const saved = await response.json();
    setSelectedUnitId(saved.unitId);
    setUnitFormMode("edit");
    setMessage("Unidade salva.");
    await syncNow();
  }

  async function deleteUnit(unit) {
    if (!unit || !window.confirm(`Excluir unidade ${unit.unitNumber}?`)) return;
    const response = await fetch(`${apiUrl}/api/units/${unit.unitId}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("Falha ao excluir unidade.");
      return;
    }
    setSelectedUnitId("");
    setUnitFormMode("new");
    setMessage("Unidade excluida.");
    await syncNow();
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
    setSelectedPersonId(saved.id);
    setMessage(`${kind === "RESIDENT" ? "Morador" : kind === "VISITOR" ? "Visitante" : "Prestador"} salvo.`);
    await syncNow();
  }

  async function deletePerson(person) {
    if (!person || !window.confirm(`Excluir ${person.name}?`)) return;
    const response = await fetch(`${apiUrl}/api/people/${person.id}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("Falha ao excluir pessoa.");
      return;
    }
    setSelectedPersonId("new");
    setMessage("Pessoa excluida.");
    await syncNow();
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
    const response = await fetch(`${apiUrl}/api/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deviceForm)
    });
    if (!response.ok) {
      setMessage("Falha ao salvar equipamento.");
      return;
    }
    setDeviceForm(emptyDeviceForm);
    setMessage("Equipamento salvo. Use o Painel de controle para acompanhar conexao/status.");
    await syncNow();
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
    setLicenseForm(emptyLicenseForm);
    setMessage("Licenca salva.");
    await syncNow();
  }

  async function saveCameraForm(event) {
    event.preventDefault();
    const response = await fetch(`${apiUrl}/api/cameras`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...cameraForm, tenantId: cameraForm.tenantId || selectedTenant?.id })
    });
    if (!response.ok) {
      setMessage("Falha ao salvar camera.");
      return;
    }
    setCameraForm({ ...emptyCameraForm, tenantId: selectedTenant?.id || "" });
    setShowCameraForm(false);
    setMessage(cameraForm.id ? "Camera salva." : "Camera(s) salva(s). DVR/NVR multicanal gera um item por canal.");
    await syncNow();
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
    setMessage(removedCount > 1 ? `${removedCount} canais de camera excluidos.` : "Camera excluida.");
    await syncNow();
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
    setActionForm(defaultActionForm());
    setMessage("Acionamento salvo.");
    await syncNow();
  }

  async function deleteAction(action) {
    if (!window.confirm(`Excluir acionamento ${action.name}?`)) return;
    const response = await fetch(`${apiUrl}/api/actions/${action.id}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("Falha ao excluir acionamento.");
      return;
    }
    setMessage("Acionamento excluido.");
    await syncNow();
  }

  async function triggerAction(action) {
    const response = await fetch(`${apiUrl}/api/actions/${action.id}/trigger`, { method: "POST" });
    const result = await response.json();
    setMessage(result.message || `Acionamento ${action.name} enviado.`);
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
    await syncNow();
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
    setSyncState((current) => ({ ...current, status: "synced", error: "Grupo de ramais atualizado.", lastSyncAt: new Date() }));
  }

  function toggleMosaicCamera(key) {
    setSelectedMosaicKeys((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key]);
  }

  useEffect(() => {
    if (activeSection !== "devices" || deviceTab !== "painel" || !selectedTenant?.id) return undefined;
    void refreshDeviceStatus();
    const timer = window.setInterval(() => void refreshDeviceStatus(), 15000);
    return () => window.clearInterval(timer);
  }, [activeSection, deviceTab, selectedTenant?.id]);

  async function answerCall(call) {
    if (!call) return;
    const tenantId = call.tenantId || selectedTenant?.id || "";
    if (tenantId) setSelectedTenantId(tenantId);
    setSelectedCallId(call.id);
    setActiveSection("remotePorter");
    await fetch(`${apiUrl}/api/telephony/calls/${call.id}/answer`, { method: "POST" });
    setMessage(`Chamada da unidade ${call.unitNumber || call.unitId || "-"} em atendimento.`);
    await syncNow();
  }

  async function endCall(call) {
    if (!call) return;
    await fetch(`${apiUrl}/api/telephony/calls/${call.id}/end`, { method: "POST" });
    setSelectedCallId("");
    setMessage("Chamada encerrada.");
    await syncNow();
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
    await fetch(`${apiUrl}/api/credential-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: selectedTenant?.id,
        manufacturer: profile.name,
        target: `${profile.name} - sincronismo manual`,
        credentialType: type,
        total: data.credentials.filter((credential) => credential.tenantId === selectedTenant?.id).length
      })
    });
    setMessage(`Sincronismo ${profile.name} enfileirado.`);
    await syncNow();
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
            {!isResident && <Field label="Credencial"><select name="credentialType" defaultValue={currentPerson.credentialType || "QR_CODE"}><option>QR_CODE</option><option>APP</option><option>FACE</option><option>RFID</option><option>PLATE</option></select></Field>}
            {kind === "PROVIDER" && <Field label="Dias permitidos"><input name="allowedDays" defaultValue={currentPerson.allowedDays || ""} /></Field>}
            {kind === "PROVIDER" && <Field label="Horario permitido"><input name="allowedHours" defaultValue={currentPerson.allowedHours || ""} /></Field>}
            {isVisitor && <Field label="Valido de"><input type="datetime-local" /></Field>}
            {isVisitor && <Field label="Valido ate"><input type="datetime-local" /></Field>}
          </div>
          <div className="toolbar-actions unit-actions"><button type="submit"><Save size={16} /> Salvar {title.toLowerCase()}</button><button className="secondary-button" type="button">Gerar credencial</button>{currentPerson.id && <button className="danger-button" type="button" onClick={() => void deletePerson(currentPerson)}><Trash2 size={16} /> Excluir</button>}</div>
        </form>
        <article className="panel people-panel">
          <div className="resource-toolbar">
            <label className="search-field"><Search size={16} /><input placeholder={`Filtre por ${title.toLowerCase()}`} /></label>
            <button type="button" onClick={() => setSelectedPersonId("new")}><Plus size={16} /> Novo {title.toLowerCase()}</button>
          </div>
          <div className="people-header"><span>Nome</span><span>Documentos</span><span>Celular</span><span>Relacao</span><span>Acoes</span></div>
          {people.map((person) => (
            <div className="person-row" key={person.id}>
              <button className="person-name-cell row-link" onClick={() => setSelectedPersonId(person.id)}><span className="avatar">{person.name?.[0]}</span><div><strong>{person.name}</strong><small>{person.email || person.company || person.authorizedBy || "Sem login"}</small><small>{isResident ? `Permissao: ${person.role}` : person.credentialType}</small></div></button>
              <span>CPF: {person.cpf || "-"}<br />RG: {person.rg || "-"}</span>
              <span>{person.phone || "-"}</span>
              <span>{kind === "PROVIDER" ? person.serviceType || "-" : person.relation || person.accessReason || "-"}</span>
              <div className="row-actions"><button className="compact-action-button secondary-button">Credencial</button><button className="compact-action-button secondary-button">Sincronizar</button><button className="compact-action-button secondary-button" onClick={() => setSelectedPersonId(person.id)}>Editar</button><button className="compact-action-button danger-button" onClick={() => void deletePerson(person)}>Excluir</button></div>
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
                <span><strong>SIP</strong> {selectedTenant?.sipDomain || "-"}</span>
                <span><strong>Ramal portaria</strong> {selectedTenant?.sipPorterExtension || "-"}</span>
                <span><strong>Mobile</strong> Softphone nativo por unidade</span>
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
              <Field label="Modo SIP"><select name="telephonyProvider" defaultValue={condoFormTenant?.telephonyProvider || "DIRECT_SIP"}><option value="DIRECT_SIP">Docker interno Asterisk</option><option value="EXTERNAL_SOFTPHONE">Softphone externo</option></select></Field>
              <Field label="Servidor SIP"><input name="sipDomain" defaultValue={condoFormTenant?.sipDomain || ""} placeholder="192.168.3.27" /></Field>
              <Field label="WebSocket SIP"><input name="sipWebSocketUrl" defaultValue={condoFormTenant?.sipWebSocketUrl || ""} placeholder="ws://192.168.3.27:8088/ws" /></Field>
              <Field label="Ramal portaria"><input name="sipPorterExtension" defaultValue={condoFormTenant?.sipPorterExtension || "9000"} /></Field>
              <Field label="Senha portaria"><input name="sipPorterPassword" type="password" defaultValue={condoFormTenant?.sipPorterPassword || ""} /></Field>
              <Field label="Inicio faixa ramais"><input name="sipExtensionStart" defaultValue={condoFormTenant?.sipExtensionStart || "9000"} /></Field>
              <Field label="Fim faixa ramais"><input name="sipExtensionEnd" defaultValue={condoFormTenant?.sipExtensionEnd || "9999"} /></Field>
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
              ["telefonia", "Telefonia"],
              ["recursos", "Recursos"]
            ].map(([tab, label]) => (
              <button key={tab} className={unitTab === tab ? "active" : ""} onClick={() => setUnitTab(tab)}>{label}</button>
            ))}
          </div>
          {unitTab === "telefonia" ? (
            <form className="panel" onSubmit={saveUnitTelephony}>
              <div className="panel-heading"><h2>Telefonia SIP da unidade {selectedUnit?.unitNumber}</h2><button type="submit"><Save size={16} /> Salvar SIP</button></div>
              <div className="form-grid">
                <Field label="Dominio SIP"><input value={telephony.sipDomain || ""} onChange={(event) => setTelephony((current) => ({ ...current, sipDomain: event.target.value }))} /></Field>
                <Field label="WebSocket SIP da Web"><input value={telephony.sipWebSocketUrl || ""} onChange={(event) => setTelephony((current) => ({ ...current, sipWebSocketUrl: event.target.value }))} /></Field>
                <Field label="Modo de chamada no APK"><select value={telephony.provider || "DIRECT_SIP"} onChange={(event) => setTelephony((current) => ({ ...current, provider: event.target.value }))}><option value="DIRECT_SIP">SIP interno WebRTC</option><option value="EXTERNAL_SOFTPHONE">Softphone externo (Zoiper/Linphone)</option></select></Field>
                <Field label="Transporte nativo mobile"><select value={telephony.sipTransport || "UDP"} onChange={(event) => setTelephony((current) => ({ ...current, sipTransport: event.target.value }))}><option>UDP</option><option>TCP</option><option>TLS</option><option>WS</option><option>WSS</option></select></Field>
                <Field label="Ramal da unidade"><input value={telephony.extension || ""} onChange={(event) => setTelephony((current) => ({ ...current, extension: event.target.value, extensionPassword: current.extensionPassword || `change-me-${event.target.value}` }))} /></Field>
                <Field label="Senha do ramal"><input type="password" value={telephony.extensionPassword || ""} onChange={(event) => setTelephony((current) => ({ ...current, extensionPassword: event.target.value }))} /></Field>
                <Field label="Ramal da portaria"><input value={telephony.porterExtension || ""} onChange={(event) => setTelephony((current) => ({ ...current, porterExtension: event.target.value }))} /></Field>
              </div>
              <div className="form-hint">O APK consulta estes campos pela API e registra o softphone nativo automaticamente.</div>
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
                          <button className="unit-call-button" title="Ligar para apartamento" onClick={(event) => { event.stopPropagation(); setSelectedUnitId(unit.unitId); setUnitFormMode("edit"); setUnitTab("telefonia"); }}><PhoneCall size={18} /></button>
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
              <form className="panel form-panel" key={`${unitFormMode}-${unitFormUnit?.unitId || "new"}`} onSubmit={saveUnitForm}>
                <div className="panel-heading"><h2>{unitFormMode === "new" ? "Nova unidade" : `Geral da unidade ${unitFormUnit?.unitNumber || "-"}`}</h2><Home size={20} /></div>
                <div className="form-grid">
                  <input type="hidden" name="unitId" value={unitFormUnit?.unitId || ""} />
                  <Field label="Unidade"><input name="unitNumber" defaultValue={unitFormUnit?.unitNumber || ""} /></Field>
                  <Field label="Bloco/Torre"><input name="blockName" defaultValue={unitFormUnit?.blockName || ""} /></Field>
                  <Field label="Morador principal"><input name="residentName" defaultValue={unitFormUnit?.residentName || ""} /></Field>
                  <Field label="Proprietario/Responsavel"><input name="responsibleName" defaultValue={unitOwner?.name || unitFormUnit?.responsibleName || ""} /></Field>
                  <Field label="Celular do responsavel"><input defaultValue={unitOwner?.phone || ""} /></Field>
                  <Field label="E-mail/Login"><input defaultValue={unitOwner?.email || ""} /></Field>
                  <Field label="Permissao"><select defaultValue={unitOwner?.role || "RESIDENT"}><option value="CONDO_ADMIN">Administrador</option><option value="PORTER">Porteiro</option><option value="RESIDENT">Usuario normal</option></select></Field>
                  <Field label="Ramal SIP"><input name="extension" defaultValue={unitFormUnit?.telephony?.extension || unitFormUnit?.extension || ""} /></Field>
                  <Field label="Senha do ramal"><input name="extensionPassword" type="password" defaultValue={unitFormUnit?.telephony?.extensionPassword || ""} /></Field>
                </div>
                <div className="toolbar-actions unit-actions">
                  <button type="submit"><Save size={16} /> Salvar unidade</button>
                  <button className="secondary-button" type="button" onClick={() => navigateTo(`/unidades/${selectedUnit?.unitId || selectedUnitId}/pessoas/moradores/ver/${unitOwner?.id || "novo"}`)}>Abrir moradores</button>
                  <button className="secondary-button" type="button" onClick={() => navigateTo(`/unidades/${selectedUnit?.unitId || selectedUnitId}/logins`)}>Logins</button>
                  <button className="secondary-button" type="button" onClick={() => navigateTo(`/unidades/${selectedUnit?.unitId || selectedUnitId}/convites/qrCodes`)}>Convites</button>
                  <button type="button" onClick={() => setUnitTab("telefonia")}><Save size={16} /> SIP</button>
                  {unitFormUnit?.unitId && <button className="danger-button" type="button" onClick={() => void deleteUnit(unitFormUnit)}><Trash2 size={16} /> Excluir unidade</button>}
                </div>
              </form>
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
                    setDeviceForm((current) => ({ ...current, category: event.target.value, manufacturer: category?.manufacturers?.[0] || current.manufacturer }));
                  }}>{data.deviceCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
                  <Field label="Empresa/Fabricante"><select value={deviceForm.manufacturer} onChange={(event) => setDeviceForm((current) => ({ ...current, manufacturer: event.target.value }))}>{(data.deviceCategories.find((category) => category.id === deviceForm.category)?.manufacturers || ["Hikvision", "Control iD", "Intelbras"]).map((name) => <option key={name}>{name}</option>)}</select></Field>
                  <Field label="Descricao"><input value={deviceForm.name} onChange={(event) => setDeviceForm((current) => ({ ...current, name: event.target.value }))} /></Field>
                  <Field label="Modelo"><input value={deviceForm.model} onChange={(event) => setDeviceForm((current) => ({ ...current, model: event.target.value }))} /></Field>
                  <Field label="IP / DDNS"><input value={deviceForm.ipAddress} onChange={(event) => setDeviceForm((current) => ({ ...current, ipAddress: event.target.value }))} /></Field>
                  <Field label="Porta API"><input value={deviceForm.apiPort} onChange={(event) => setDeviceForm((current) => ({ ...current, apiPort: event.target.value }))} /></Field>
                  <Field label="Ramal interfone"><input value={deviceForm.intercomExtension} onChange={(event) => setDeviceForm((current) => ({ ...current, intercomExtension: event.target.value }))} /></Field>
                  <Field label="Tipo interfone"><select value={deviceForm.intercomType} onChange={(event) => setDeviceForm((current) => ({ ...current, intercomType: event.target.value }))}><option>FACIAL</option><option>TELEFONE_IP</option><option>ATA_VOIP</option></select></Field>
                  <button type="submit"><Save size={16} /> Salvar equipamento</button>
                </div>
              </form>
              <article className="panel">
                <div className="panel-heading"><h2>Equipamentos cadastrados</h2><Camera size={20} /></div>
                <div className="simple-list">
                  {data.devices.map((device) => (
                    <div className="simple-row device-row" key={device.id}>
                      <RadioTower size={18} />
                      <div><strong>{device.name}</strong><span>{device.manufacturer} {device.model}</span></div>
                      <span>{device.ipAddress}</span>
                      <span>Ramal {device.intercomExtension}</span>
                      <span className="status">{device.status}</span>
                      <button className="secondary-button" onClick={() => setDeviceForm({
                        id: device.id,
                        category: device.category || "access-control",
                        manufacturer: device.manufacturer || "Hikvision",
                        name: device.name || "",
                        model: device.model || "",
                        ipAddress: device.ipAddress || "",
                        apiPort: String(device.apiPort || 80),
                        intercomExtension: device.intercomExtension || "",
                        intercomType: device.intercomType || "FACIAL",
                        intercomEnabled: Boolean(device.intercomEnabled)
                      })}>Editar</button>
                    </div>
                  ))}
                </div>
                <div className="manufacturer-strip">
                  {data.manufacturerProfiles.map((profile) => (
                    <button className="secondary-button" key={profile.id} onClick={() => setDeviceForm((current) => ({ ...current, manufacturer: profile.name }))}>{profile.name}</button>
                  ))}
                </div>
              </article>
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
          <div className="resource-operational-grid">
            <article className="panel">
              <div className="panel-heading"><h2>Busca rapida</h2><ShieldCheck size={18} /></div>
              <div className="remote-call-summary"><span><strong>{tenantCalls.length}</strong>chamadas ativas</span><span><strong>{tenantEvents.length}</strong>eventos</span></div>
              <div className="porter-filter-grid">{["CPF", "RG", "Placa", "Nome", "Unidade", "Credencial"].map((item) => <button key={item} type="button" className={porterSearchType === item ? "" : "secondary-button"} onClick={() => setPorterSearchType(item)}><Search size={15} /> {item}</button>)}</div>
              <label className="search-field porter-search-input"><Search size={16} /><input value={porterSearchTerm} onChange={(event) => setPorterSearchTerm(event.target.value)} placeholder={`Buscar por ${porterSearchType.toLowerCase()}`} /></label>
              {porterSearchTerm && (
                <div className="simple-list">
                  {porterSearchResults.length ? porterSearchResults.map((item) => (
                    <button className="simple-row row-link" key={item.id || item.unitId} type="button" onClick={() => item.unitId && navigateTo(`/unidades/${item.unitId}`)}>
                      <ShieldCheck size={18} />
                      <div><strong>{item.name || item.residentName || item.guest || item.valueLabel || `Unidade ${item.unitNumber}`}</strong><span>{item.unitNumber ? `Unidade ${item.unitNumber}` : item.cpf || item.rg || item.phone || item.type || "-"}</span></div>
                      <span className="status">{item.kind || item.role || item.status || "OK"}</span>
                    </button>
                  )) : <div className="empty-state">Nenhum resultado para esta busca.</div>}
                </div>
              )}
              <div className="panel-heading compact-heading"><h2>Acionamentos</h2><KeySquare size={18} /></div>
              {tenantActions.length ? (
                <div className="simple-list">
                  {tenantActions.map((action) => (
                    <div className="simple-row" key={action.id}>
                      <KeySquare size={18} />
                      <div><strong>{action.name}</strong><span>{action.manufacturer} - {action.route || "Sem rota"}</span></div>
                      <button className="secondary-button" type="button" disabled={action.status === "DISABLED"} onClick={() => void triggerAction(action)}>Acionar</button>
                    </div>
                  ))}
                </div>
              ) : <div className="empty-state">Nenhum acionamento cadastrado.</div>}
            </article>
            <article className="panel">
              <div className="panel-heading"><h2>Portaria remota</h2><span>{tenantCalls.length} ativas</span></div>
              <div className="webphone-panel">
                <div><strong>Atendimento SIP/WebRTC</strong><span>Configurar servidor, faixa e senha em Condominios. O ramal da unidade fica em Unidades &gt; Telefonia.</span></div>
                <div className="toolbar-actions"><button type="button"><PhoneCall size={16} /> Conectar audio</button><button type="button" className="secondary-button">Desconectar</button></div>
              </div>
              <div className="panel-heading compact-heading"><h2>Imagem da camera</h2><Camera size={18} /></div>
              <CameraPreview camera={selectedPorterCamera} channel={selectedPorterCamera?.channel || 1} />
              {tenantCameras.length ? (
                <div className="camera-channel-bar" aria-label="Cameras do condominio">
                  {tenantCameras.map((camera, index) => (
                    <button
                      key={camera.id}
                      type="button"
                      title={`${camera.description || camera.name} - Canal ${camera.channel || 1}`}
                      className={selectedPorterCamera?.id === camera.id ? "active" : ""}
                      onClick={() => setSelectedPorterCameraId(camera.id)}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>
              ) : <div className="empty-state">Nenhuma camera cadastrada para este condominio.</div>}
              {selectedCall && (
                <div className="active-call-panel">
                  <div>
                    <strong>Atendimento em andamento</strong>
                    <span>Unidade {selectedCall.unitNumber || selectedCall.unitId} - {selectedCall.visitorLabel || selectedCall.targetType}</span>
                  </div>
                  <button className="danger-button" type="button" onClick={() => void endCall(selectedCall)}>Encerrar</button>
                </div>
              )}
              <div className="extensions-status-panel">
                <div className="panel-heading compact-heading"><h2>Ramais do condominio</h2><button className="secondary-button" type="button" onClick={() => void refreshExtensionStatus()}><RefreshCw size={16} /> Atualizar</button></div>
                <div className="extensions-status-list">
                  {data.extensionStatus.map((item) => <span key={item.extension} className={item.status === "Registrado" ? "registered" : ""}><strong>{item.extension}</strong><em>{item.label}</em><small>{item.type} - {item.status}</small></span>)}
                </div>
              </div>
              {tenantCalls.length ? (
                <div className="simple-list">
                  {tenantCalls.map((call) => <div className="simple-row" key={call.id}><PhoneCall size={18} /><div><strong>Unidade {call.unitNumber || call.unitId}</strong><span>{call.visitorLabel || call.targetType} - {formatDateTime(call.createdAt)}</span></div><span className="status">{call.status}</span>{call.status === "RINGING" && <button type="button" onClick={() => void answerCall(call)}>Atender</button>}</div>)}
                </div>
              ) : <div className="empty-state">Nenhuma chamada ativa. As chamadas do facial/interfone aparecem aqui em tempo real.</div>}
              <div className="panel-heading compact-heading"><h2>Eventos em tempo real</h2><ClipboardList size={18} /></div>
              {tenantEvents.length ? (
                <div className="simple-list">
                  {tenantEvents.slice(0, 8).map((event) => <div className="simple-row" key={event.id}><BadgeCheck size={18} /><div><strong>{event.door?.name || event.reason}</strong><span>{event.user?.name || "Portaria"} - {formatDateTime(event.createdAt)}</span></div><span className="status">{event.decision}</span></div>)}
                </div>
              ) : <div className="empty-state">Nenhum evento recebido para este condominio.</div>}
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
                  <div><strong>Atendimento SIP/WebRTC</strong><span>Servidor SIP no cadastro do condominio; ramal/senha da unidade em Unidades &gt; Telefonia.</span></div>
                  <div className="toolbar-actions"><button type="button"><PhoneCall size={16} /> Conectar audio</button><button type="button" className="secondary-button">Desconectar</button></div>
                </div>
                <div className="extensions-status-panel">
                <div className="panel-heading compact-heading"><h2>Ramais do condominio</h2><button className="secondary-button" type="button" onClick={() => void refreshExtensionStatus()}><RefreshCw size={16} /> Atualizar</button></div>
                  <div className="extensions-status-list">
                    {data.extensionStatus.map((item) => <span key={item.extension} className={item.status === "Registrado" ? "registered" : ""}><strong>{item.extension}</strong><em>{item.label}</em><small>{item.type} - {item.status}</small></span>)}
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
          <article className="panel form-panel">
            <div className="panel-heading"><h2>Puxar credenciais do equipamento</h2><BadgeCheck size={20} /></div>
            <div className="form-grid">
              <Field label="Equipamento"><select>{data.devices.map((device) => <option key={device.id} value={device.id}>{device.name} - {device.manufacturer}</option>)}</select></Field>
              <Field label="Condominio"><input readOnly value={selectedTenant?.name || ""} /></Field>
              <Field label="Unidade"><select>{units.map((unit) => <option key={unit.unitId} value={unit.unitId}>Unidade {unit.unitNumber}</option>)}</select></Field>
              <Field label="Tipo de credencial"><select><option>FACE</option><option>RFID</option><option>QR_CODE</option><option>PIN</option><option>PLATE</option><option>APP</option></select></Field>
              <Field label="Direcao"><select><option value="READ">Puxar do equipamento</option><option value="SEND">Enviar para equipamento</option></select></Field>
              <Field label="Destino"><select><option>Morador</option><option>Visitante</option><option>Prestador</option></select></Field>
              <button type="button" onClick={() => void enqueueCredentialSync(data.manufacturerProfiles[0] || { name: "Generico" }, "FACE")}><RefreshCw size={16} /> Iniciar sincronismo</button>
            </div>
            <div className="form-hint">O condominio vem do equipamento selecionado. A unidade filtra para quem a credencial sera vinculada.</div>
          </article>
          <article className="panel">
            <div className="panel-heading"><h2>Credenciais</h2><BadgeCheck size={20} /></div>
            <div className="unit-table header"><span>Pessoa / Unidade</span><span>Tipo</span><span>Identificacao</span><span>Sincronismo</span></div>
            {data.credentials.map((credential) => {
              const person = data.residents.find((item) => item.id === credential.personId);
              const unit = data.units.find((item) => item.unitId === credential.unitId);
              return (
                <div className="unit-table row" key={credential.id}>
                  <span><strong>{person?.name || credential.personId}</strong><small>Unidade {unit?.unitNumber || "-"}</small></span>
                  <span>{credential.type}</span>
                  <span>{credential.valueLabel}</span>
                  <span className={`status ${credential.syncStatus === "PENDING" ? "offline" : ""}`}>{credential.syncStatus}</span>
                </div>
              );
            })}
          </article>
          <article className="panel">
            <div className="panel-heading"><h2>Sincronismo de credenciais</h2><RefreshCw size={20} /></div>
            <div className="sync-job-grid">
              {data.credentialSyncJobs.map((job) => (
                <div className="sync-job-card" key={job.id}>
                  <strong>{job.manufacturer}</strong>
                  <span>{job.target}</span>
                  <small>{job.direction} {job.credentialType} - {job.synced}/{job.total} enviados</small>
                  <em className="status">{job.status}</em>
                </div>
              ))}
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
        <div className="call-notification">
          <PhoneCall size={20} />
          <div>
            <strong>Chamada recebida</strong>
            <span>{data.condominiums.find((item) => item.id === incomingCall.tenantId)?.name || "Condominio"} - Unidade {incomingCall.unitNumber || incomingCall.unitId}</span>
          </div>
          <button type="button" onClick={() => void answerCall(incomingCall)}>Atender</button>
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
                <button key={section.id} className={section.id === activeSection ? "active" : ""} onClick={() => setActiveSection(section.id)}>
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
        <StatusBanner status={syncState.status} error={syncState.error || message} lastSyncAt={syncState.lastSyncAt} />
        {renderContent()}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
