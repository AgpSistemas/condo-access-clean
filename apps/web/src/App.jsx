import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Invitation, Inviter, Registerer, RegistererState, SessionState, UserAgent } from "sip.js";
import {
  Activity,
  BadgeCheck,
  Building2,
  Camera,
  Car,
  ClipboardList,
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
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
  UserPlus,
  Users,
} from "lucide-react";

import {
  WEB_PORTER_EXTENSION,
  WEB_PORTER_PASSWORD,
  condoSections,
  equipmentIntegrationResources,
  parsePositiveInteger,
  geocodeAddressFields,
  emptyTelephony,
  normalizeWebSocketForWebPhone,
  credentialPhotoUrl,
  equipmentPreviewPhotoUrl,
  callTime,
  unitExtension,
  resolveCallUnit,
  emptyDeviceForm,
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
  faceImportSelectionKey
} from "./config/appConfig.jsx";
import {
  PersonAvatar,
  Field,
  Pagination,
  Metric,
  LocalLogin,
  ChangePassword
} from "./components/common.jsx";
import { usePagination as usePaged } from "./hooks/usePagination.js";
import {
  cameraStreamKey,
  cameraSnapshotUrl,
  cameraChannels,
  cameraMosaicLabel,
  groupCameraDevices,
  CameraPreview,
  CameraTile,
  CameraConfig,
  ActionConfig
} from "./components/cameras.jsx";
import { useSession } from "./hooks/useSession.js";
import useBootstrapData from "./hooks/useBootstrapData.js";
import useAppRouting from "./hooks/useAppRouting.js";
import useEquipmentIntegration from "./hooks/useEquipmentIntegration.js";
import useTenantSelection from "./hooks/useTenantSelection.js";
import DashboardPage from "./pages/DashboardPage.jsx";
import CondominiumDashboardPage from "./pages/CondominiumDashboardPage.jsx";
import CondominiumsPage from "./pages/CondominiumsPage.jsx";
import CondominiumFormPage from "./pages/CondominiumFormPage.jsx";
import AppShell from "./components/layout/AppShell.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import SdkPage from "./pages/SdkPage.jsx";
import { TelephonyPage } from "./pages/telephony/index.js";
import * as deviceController from "./controllers/deviceController.js";
import * as cameraController from "./controllers/cameraController.js";
import * as actionController from "./controllers/actionController.js";
import * as telephonyController from "./controllers/telephonyController.js";
import * as vehicleController from "./controllers/vehicleController.js";
import { apiFetch } from "./services/api.js";

function App() {
  const { session, persistSession, logout } = useSession();
  const [activeSection, setActiveSection] = useState("dashboard");
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
  const [resourceConfigForm, setResourceConfigForm] = useState({});
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
  const [supportAlert, setSupportAlert] = useState("");
  const [actionFeedback, setActionFeedback] = useState(null);
  const [deviceForm, setDeviceForm] = useState(emptyDeviceForm);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [cameraForm, setCameraForm] = useState(emptyCameraForm);
  const [showCameraForm, setShowCameraForm] = useState(false);
  const [actionForm, setActionForm] = useState(emptyActionForm);
  const [credentialForm, setCredentialForm] = useState(emptyCredentialForm);
  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm);
  const [vehicleTagBusyId, setVehicleTagBusyId] = useState("");
  const [credentialImportRows, setCredentialImportRows] = useState([]);
  const [credentialImportReport, setCredentialImportReport] = useState(null);
  const [credentialImportFile, setCredentialImportFile] = useState("");
  const [porterReportDate, setPorterReportDate] = useState(() => new Date().toISOString().slice(0, 10));
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

  const { data, setData, syncState, refreshApiCache, syncNow } = useBootstrapData({
    accessToken: session?.accessToken,
    selectedTenantId,
    setSelectedTenantId,
    setSelectedUnitId,
    setTelephony,
    setTenantTelephony
  });

  useEffect(() => {
    if (!actionFeedback) return undefined;
    const timer = window.setTimeout(() => setActionFeedback(null), 4200);
    return () => window.clearTimeout(timer);
  }, [actionFeedback]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(""), 4200);
    return () => window.clearTimeout(timer);
  }, [message]);

  const {
    roleSections,
    allowedSettingsSections,
    active,
    visibleCondominiums,
    selectedTenant,
    sessionCompany,
    condoFormTenant,
    units,
    filteredUnits,
    selectedUnit
  } = useTenantSelection({
    data,
    session,
    activeSection,
    selectedTenantId,
    selectedUnitId,
    unitSearch,
    condoFormMode
  });

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
        logBuiltinEnabled: false,
        logConfiguration: false,
        logLevel: "error",
        transportOptions: { server: webSocketUrl },
        sessionDescriptionHandlerFactoryOptions: {
          constraints: { audio: true, video: false }
        },
        delegate: {
          onInvite(invitation) {
            webPhoneSessionRef.current = invitation;
            webPhoneUserAgentRef.current = userAgent;
            webPhoneRegistererRef.current = registerer;
            webPhoneTenantRef.current = tenantForPhone.id;
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
              void apiFetch("/api/telephony/mobile-call", {
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

  const { navigateTo } = useAppRouting({
    condominiums: data.condominiums,
    licenses: data.licenses,
    units: data.units,
    selectedTenantId,
    setSelectedTenantId,
    setSelectedUnitId,
    setUnitFormMode,
    setActiveSection,
    setUnitTab,
    setDeviceTab,
    setPersonSubtab,
    setSelectedPersonId,
    setInviteSubtab
  });

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

  useEffect(() => {
    setVehicleForm({ ...emptyVehicleForm, unitId: selectedUnit?.unitId || "" });
  }, [selectedUnit?.unitId]);

  const filteredCondos = visibleCondominiums.filter((item) => `${item.name} ${item.document}`.toLowerCase().includes(search.toLowerCase()));
  const condoPager = usePaged(filteredCondos, 12);
  const unitPager = usePaged(filteredUnits, 12);
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
  const controlIdDevices = useMemo(() => tenantDevices.filter((device) => device.adapter === "CONTROL_ID_ACCESS" || String(device.manufacturer || "").toLowerCase().includes("control")), [tenantDevices]);
  const tenantCredentials = useMemo(() => data.credentials.filter((credential) => credential.tenantId === selectedTenant?.id), [data.credentials, selectedTenant?.id]);
  const tenantActions = useMemo(() => data.actions.filter((action) => action.tenantId === selectedTenant?.id), [data.actions, selectedTenant?.id]);
  const selectedTenantLicense = useMemo(() => data.licenses.find((license) => license.tenantId === selectedTenant?.id && license.active !== false), [data.licenses, selectedTenant?.id]);
  const selectedTenantCompany = useMemo(() => data.companies.find((company) => company.id === selectedTenant?.companyId) || null, [data.companies, selectedTenant?.companyId]);
  const tenantResources = useMemo(() => {
    const contractedIds = new Set(Array.isArray(selectedTenantCompany?.resourceIds)
      ? selectedTenantCompany.resourceIds
      : data.resources.map((resource) => resource.id));
    const enabledIds = new Set(Array.isArray(selectedTenantLicense?.resourceIds)
      ? selectedTenantLicense.resourceIds
      : data.resources.filter((resource) => resource.enabled !== false).map((resource) => resource.id));
    return data.resources.map((resource) => ({
      ...resource,
      contracted: contractedIds.has(resource.id),
      enabled: contractedIds.has(resource.id) && enabledIds.has(resource.id)
    }));
  }, [data.resources, selectedTenantCompany, selectedTenantLicense]);
  const selectedResource = tenantResources.find((resource) => resource.id === resourceConfig);
  const tenantCalls = useMemo(() => data.intercomCalls.filter((call) => !call.tenantId || call.tenantId === selectedTenant?.id), [data.intercomCalls, selectedTenant?.id]);
  const activeTenantCalls = useMemo(() => tenantCalls.filter((call) => !["ENDED", "MISSED", "FAILED"].includes(call.status)), [tenantCalls]);
  const tenantEvents = useMemo(() => (data.accessLogs || []).filter((log) => !log.tenantId || log.tenantId === selectedTenant?.id), [data.accessLogs, selectedTenant?.id]);
  const disconnectedDevices = useMemo(() => tenantDevices.filter((device) => device.status && device.status !== "ONLINE"), [tenantDevices]);
  const {
    equipmentIntegration,
    setEquipmentIntegration,
    equipmentFaceSelections,
    equipmentFacePreviewPage,
    setEquipmentFacePreviewPage,
    selectedIntegrationDevice,
    readEquipmentIntegrationResource,
    updateEquipmentCredentialSelection,
    updateEquipmentCredentialUnit,
    updateAllEquipmentCredentialSelections,
    importEquipmentCredentials
  } = useEquipmentIntegration({
    devices: tenantDevices,
    units,
    setMessage,
    refreshApiCache,
    setData,
    setActiveSection,
    setUnitTab,
    setPersonSubtab
  });
  const equipmentPreviewItems = (equipmentIntegration.importReport?.items || [])
    .filter((item) => equipmentIntegration.resource !== "faces" || item.payload?.type === "FACE");
  const equipmentPreviewPageSize = 25;
  const equipmentPreviewTotalPages = Math.max(1, Math.ceil(equipmentPreviewItems.length / equipmentPreviewPageSize));
  const equipmentPreviewSafePage = Math.min(equipmentFacePreviewPage, equipmentPreviewTotalPages);
  const equipmentPreviewPageItems = equipmentPreviewItems.slice(
    (equipmentPreviewSafePage - 1) * equipmentPreviewPageSize,
    equipmentPreviewSafePage * equipmentPreviewPageSize
  );
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
    if (porterSearchType === "Placa") {
      return data.vehicles.filter(inTenant).filter((vehicle) => `${vehicle.plate} ${vehicle.tagValue} ${vehicle.brand} ${vehicle.model}`.toLowerCase().includes(term)).slice(0, 8);
    }
    return data.residents.filter(inTenant).filter((person) => {
      const source = porterSearchType === "CPF" ? person.cpf : porterSearchType === "RG" ? person.rg : `${person.name} ${person.email} ${person.phone} ${person.cpf} ${person.rg}`;
      return String(source || "").toLowerCase().includes(term);
    }).slice(0, 8);
  }, [data.credentials, data.residents, data.units, data.vehicles, porterSearchTerm, porterSearchType, selectedTenant?.id]);

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

  async function callExtensionFromWeb(target) {
    const extension = String(target?.extension || target?.targetExtension || "").trim();
    if (!extension) {
      setMessage("Ramal de destino nao informado.");
      return;
    }

    const unit = target?.unit || units.find((item) => unitExtension(item) === extension) || null;
    const targetLabel = target?.label || (unit ? unitDisplay(unit) : `Ramal ${extension}`);

    try {
      const { response: callResponse, result: callRecord } = await telephonyController.callExtension({
        tenantId: selectedTenant?.id || unit?.tenantId,
        unitId: unit?.unitId || target?.unitId || "",
        unitNumber: unit?.unitNumber || "",
        targetExtension: extension,
        targetLabel,
        targetType: target?.type || (unit ? "UNIT" : "EXTENSION"),
        deviceId: target?.deviceId || "",
        sourceExtension: selectedTenant?.sipPorterExtension || WEB_PORTER_EXTENSION,
        sourceLabel: "Portaria Web"
      });
      if (!callResponse.ok) {
        setMessage(callRecord?.message || `Nao foi possivel ligar para o ramal ${extension}.`);
        return;
      }
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
        setMessage("Audio da portaria ainda nao conectado para realizar a chamada.");
        return;
      }

      const domain = selectedTenant?.sipDomain || "granportalresidency.ddns.net";
      const targetUri = UserAgent.makeURI(`sip:${extension}@${domain}`);
      if (!targetUri) {
        setMessage(`Ramal ${extension} invalido.`);
        return;
      }

      const inviter = new Inviter(userAgent, targetUri, {
        sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } }
      });
      webPhoneSessionRef.current = inviter;
      setWebPhone((current) => ({
        ...current,
        status: "CALLING",
        diagnostic: `Chamando ${targetLabel} no ramal ${extension}`,
        incomingLabel: `Ligando para ${targetLabel}`,
        remoteIdentity: extension
      }));
      inviter.stateChange.addListener((state) => {
        if (state === SessionState.Established) {
          attachWebPhoneAudio(inviter);
          setWebPhone((current) => ({ ...current, status: "IN_CALL", diagnostic: `Em chamada com ${targetLabel}` }));
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
      setMessage(`Ligando para ${targetLabel} no ramal ${extension}.`);
    } catch (error) {
      setWebPhone((current) => ({
        ...current,
        status: webPhoneRegistererRef.current ? "REGISTERED" : "ERROR",
        diagnostic: error instanceof Error ? error.message : "Falha ao ligar para o ramal"
      }));
      setMessage(error instanceof Error ? error.message : "Falha ao ligar para o ramal.");
    }
  }

  async function callUnitFromPorter(unit) {
    if (!unit) return;
    selectPorterUnit(unit);
    const extension = unit.telephony?.extension || unit.extension || "";
    if (!extension) {
      setMessage(`Unidade ${unit.unitNumber || unit.unitId || "-"} sem ramal cadastrado.`);
      return;
    }
    await callExtensionFromWeb({ extension, label: unitDisplay(unit), type: "UNIT", unit });
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
    const response = await apiFetch(`/api/units/${selectedUnit.unitId}/telephony`, {
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
    const response = await apiFetch(`/api/condominiums/${selectedTenant.id}/telephony`, {
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
    const response = await apiFetch("/api/condominiums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: form.get("id"),
        companyId: form.get("companyId"),
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
      const errorMessage = saved.message || "Falha ao salvar condominio.";
      setMessage(errorMessage);
      if (response.status === 409 && /limite|contato|suporte/i.test(errorMessage)) {
        setSupportAlert(`${errorMessage} Entre em contato com o suporte para ampliar a licenca.`);
      }
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
    const response = await apiFetch(`/api/condominiums/${condo.id}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setMessage(result.message || "Falha ao excluir condominio.");
      return;
    }
    setSelectedTenantId("");
    setCondoFormMode("new");
    const payload = await refreshApiCache();
    if (payload) setData(payload);
    setMessage("Condominio e todos os dados vinculados foram excluidos.");
  }

  async function saveUnitForm(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await apiFetch("/api/units", {
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
    const response = await apiFetch(`/api/units/${unit.unitId}`, { method: "DELETE" });
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
      vehicles: current.vehicles.filter((vehicle) => vehicle.unitId !== unit.unitId),
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
    const response = await apiFetch("/api/people", {
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
        email: form.get("residentEmail"),
        relation: form.get("relation"),
        role: form.get("role"),
        authorizedBy: form.get("authorizedBy"),
        accessReason: form.get("accessReason"),
        vehiclePlate: form.get("vehiclePlate"),
        credentialType: form.get("credentialType"),
        allowedDays: form.get("allowedDays"),
        allowedHours: form.get("allowedHours"),
        newPassword: form.get("newPassword")
      })
    });
    if (!response.ok) {
      setMessage("Falha ao salvar pessoa.");
      return;
    }
    const saved = await response.json();
    setData((current) => {
      const exists = current.residents.some((person) => person.id === saved.id);
      const nextResidents = exists
        ? current.residents.map((person) => person.id === saved.id ? saved : person)
        : [saved, ...current.residents];
      const principal = nextResidents.find((person) =>
        person.unitId === saved.unitId &&
        (person.kind || "RESIDENT") === "RESIDENT" &&
        ["Responsavel", "Proprietario"].includes(person.relation)
      ) || nextResidents.find((person) => person.unitId === saved.unitId && (person.kind || "RESIDENT") === "RESIDENT");
      return {
        ...current,
        residents: nextResidents,
        units: current.units.map((unit) => unit.unitId === saved.unitId && principal
          ? { ...unit, residentId: principal.id, residentName: principal.name, responsibleName: principal.name }
          : unit)
      };
    });
    setSelectedPersonId(saved.id);
    setMessage(`${kind === "RESIDENT" ? "Morador" : kind === "VISITOR" ? "Visitante" : "Prestador"} salvo.`);
    void refreshApiCache();
  }

  async function saveVehicleForm(event) {
    event.preventDefault();
    if (!selectedUnit) return;
    const { response, result: saved } = await vehicleController.saveVehicleForm({
      ...vehicleForm,
      tenantId: selectedTenant?.id,
      unitId: selectedUnit.unitId
    });
    if (!response.ok) {
      setMessage(saved.message || "Falha ao salvar veiculo.");
      return;
    }
    setData((current) => {
      const exists = current.vehicles.some((vehicle) => vehicle.id === saved.id);
      return {
        ...current,
        vehicles: exists
          ? current.vehicles.map((vehicle) => vehicle.id === saved.id ? saved : vehicle)
          : [saved, ...current.vehicles]
      };
    });
    setVehicleForm({ ...emptyVehicleForm, unitId: selectedUnit.unitId });
    setMessage("Veiculo salvo.");
    void refreshApiCache();
  }

  async function deleteVehicle(vehicle) {
    if (!window.confirm(`Excluir o veiculo ${vehicle.plate}?`)) return;
    const { response } = await vehicleController.deleteVehicle(vehicle.id);
    if (!response.ok) {
      setMessage("Falha ao excluir veiculo.");
      return;
    }
    setData((current) => ({
      ...current,
      vehicles: current.vehicles.filter((item) => item.id !== vehicle.id)
    }));
    if (vehicleForm.id === vehicle.id) setVehicleForm({ ...emptyVehicleForm, unitId: selectedUnit?.unitId || "" });
    setMessage("Veiculo excluido.");
    void refreshApiCache();
  }

  async function syncVehicleControlIdTag(vehicle) {
    const deviceId = vehicle.tagDeviceId || controlIdDevices[0]?.id || "";
    if (!deviceId) return setMessage("Cadastre ou selecione um equipamento Control iD para enviar a tag.");
    setVehicleTagBusyId(vehicle.id);
    const { response, result } = await vehicleController.syncVehicleTag(vehicle.id, deviceId);
    setVehicleTagBusyId("");
    if (!response.ok) return setMessage(result.message || "Falha ao enviar tag veicular.");
    if (result.vehicle) {
      setData((current) => ({ ...current, vehicles: current.vehicles.map((item) => item.id === result.vehicle.id ? result.vehicle : item) }));
      setVehicleForm((current) => current.id === result.vehicle.id ? { ...emptyVehicleForm, ...result.vehicle } : current);
    }
    setMessage(result.message || "Tag veicular enviada ao Control iD.");
  }

  async function removeVehicleControlIdTag(vehicle) {
    const deviceId = vehicle.tagDeviceId || controlIdDevices[0]?.id || "";
    if (!deviceId) return setMessage("Equipamento Control iD da tag nao encontrado.");
    if (!window.confirm(`Remover a tag ${vehicle.tagValue} do Control iD?`)) return;
    setVehicleTagBusyId(vehicle.id);
    const { response, result } = await vehicleController.removeVehicleTag(vehicle.id, deviceId);
    setVehicleTagBusyId("");
    if (!response.ok) return setMessage(result.message || "Falha ao remover tag veicular.");
    if (result.vehicle) {
      setData((current) => ({ ...current, vehicles: current.vehicles.map((item) => item.id === result.vehicle.id ? result.vehicle : item) }));
      setVehicleForm((current) => current.id === result.vehicle.id ? { ...emptyVehicleForm, ...result.vehicle } : current);
    }
    setMessage(result.message || "Tag veicular removida do Control iD.");
  }

  async function saveSyndic(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await apiFetch("/api/syndics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: selectedTenant?.id,
        personId: form.get("personId"),
        syndicRole: form.get("syndicRole"),
        mandateStart: form.get("mandateStart"),
        mandateEnd: form.get("mandateEnd"),
        role: form.get("role")
      })
    });
    const saved = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(saved.message || "Falha ao salvar sindico.");
      return;
    }
    setData((current) => ({
      ...current,
      residents: current.residents.map((person) => person.tenantId === saved.tenantId
        ? { ...person, isSyndic: person.id === saved.id, ...(person.id === saved.id ? saved : {}) }
        : person)
    }));
    setMessage("Sindico atualizado.");
    void refreshApiCache();
  }

  async function saveCondoStaff(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await apiFetch("/api/condominium-staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: selectedTenant?.id,
        name: form.get("name"),
        email: form.get("email"),
        phone: form.get("phone"),
        cpf: form.get("cpf"),
        rg: form.get("rg"),
        role: form.get("role"),
        syndicRole: form.get("syndicRole"),
        mandateStart: form.get("mandateStart"),
        mandateEnd: form.get("mandateEnd"),
        newPassword: form.get("newPassword")
      })
    });
    const saved = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(saved.message || "Falha ao salvar colaborador do condominio.");
      return;
    }
    setData((current) => ({
      ...current,
      residents: [saved, ...current.residents.filter((person) => person.id !== saved.id)].map((person) =>
        saved.isSyndic && person.tenantId === saved.tenantId && person.id !== saved.id
          ? { ...person, isSyndic: false }
          : person
      )
    }));
    event.currentTarget.reset();
    setMessage(saved.role === "PORTER" ? "Porteiro cadastrado." : "Sindico cadastrado.");
    void refreshApiCache();
  }

  async function deletePerson(person) {
    if (!person || !window.confirm(`Excluir ${person.name}?`)) return;
    const response = await apiFetch(`/api/people/${person.id}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("Falha ao excluir pessoa.");
      return;
    }
    setSelectedPersonId("new");
    setData((current) => {
      const nextResidents = current.residents.filter((item) => item.id !== person.id);
      const principal = nextResidents.find((item) => item.unitId === person.unitId && (item.kind || "RESIDENT") === "RESIDENT");
      return {
        ...current,
        residents: nextResidents,
        credentials: current.credentials.filter((credential) => credential.personId !== person.id),
        units: current.units.map((unit) => unit.unitId === person.unitId
          ? { ...unit, residentId: principal?.id || "", residentName: principal?.name || "", responsibleName: principal?.name || "" }
          : unit)
      };
    });
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
    const response = await apiFetch("/api/credentials", {
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
    setMessage(result.syncStatus === "SYNCED" ? "Credencial criada e enviada ao equipamento." : `Credencial criada. ${result.syncMessage || "Falha ao enviar ao equipamento."}`);
    void refreshApiCache();
  }

  async function handleFacePhotoFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setMessage("Selecione uma imagem JPG ou PNG.");
      event.target.value = "";
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setMessage("A imagem original deve ter no maximo 8 MB.");
      event.target.value = "";
      return;
    }

    try {
      const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Falha ao ler imagem"));
        reader.readAsDataURL(file);
      });
      const image = await new Promise((resolve, reject) => {
        const nextImage = new Image();
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error("Imagem invalida"));
        nextImage.src = source;
      });
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const sourceX = Math.max(0, Math.floor((image.naturalWidth - side) / 2));
      const sourceY = Math.max(0, Math.floor((image.naturalHeight - side) / 2));
      const outputSize = Math.min(720, side);
      const canvas = document.createElement("canvas");
      canvas.width = outputSize;
      canvas.height = outputSize;
      const context = canvas.getContext("2d");
      context.drawImage(image, sourceX, sourceY, side, side, 0, 0, outputSize, outputSize);
      const photoUrl = canvas.toDataURL("image/jpeg", 0.82);
      if (photoUrl.length > 1000000) {
        setMessage("A foto ficou muito grande. Selecione uma imagem mais simples ou com menor resolucao.");
        return;
      }
      setCredentialForm((current) => ({ ...current, type: "FACE", photoUrl }));
      setMessage("Foto facial preparada. Salve a credencial para enviar ao equipamento.");
    } catch {
      setMessage("Nao foi possivel preparar a foto facial.");
    } finally {
      event.target.value = "";
    }
  }

  async function deleteCredential(credential) {
    if (!credential?.id) return;
    if (!window.confirm(`Excluir credencial ${credential.valueLabel || credential.value || credential.type}?`)) return;
    const response = await apiFetch(`/api/credentials/${encodeURIComponent(credential.id)}`, { method: "DELETE" });
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
    setMessage(result.event?.ok ? "Credencial excluida do sistema e do equipamento." : `Credencial excluida do sistema. ${result.event?.message || "Falha ao excluir no equipamento."}`);
    void refreshApiCache();
  }

  async function generateCredentialForPerson(person, type = person?.credentialType || "APP", options = {}) {
    if (!person?.id) return;
    const response = await apiFetch("/api/credentials/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: person.tenantId || selectedTenant?.id,
        unitId: person.unitId,
        personId: person.id,
        credentialType: type,
        deviceId: options.deviceId || "",
        photoUrl: options.photoUrl || ""
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
    setMessage(result.syncStatus === "SYNCED"
      ? `Credencial ${result.type} criada e enviada ao equipamento para ${person.name}.`
      : `Credencial ${result.type} criada para ${person.name}. ${result.syncMessage || "Falha ao enviar ao equipamento."}`);
    void refreshApiCache();
  }

  async function handleCredentialImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readImportRows(file);
      setCredentialImportRows(rows);
      setCredentialImportFile(file.name);
      const response = await apiFetch("/api/credentials/import", {
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
    const response = await apiFetch("/api/credentials/import", {
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

  async function saveDeviceForm(event) {
    event.preventDefault();
    const payload = {
      ...deviceForm,
      tenantId: deviceForm.tenantId || selectedTenant?.id || ""
    };
    const { response, result: saved } = await deviceController.saveDeviceForm(payload);
    if (!response.ok) {
      setMessage(saved?.message || "Falha ao salvar equipamento.");
      return;
    }
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

    const { response, result } = await deviceController.deleteDevice(device.id);
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

  async function saveCompanyForm(event) {
    event.preventDefault();
    const response = await apiFetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(companyForm)
    });
    const saved = await response.json().catch(() => null);
    if (!response.ok) {
      const errorMessage = saved?.message || "Falha ao salvar empresa e plano.";
      setMessage(errorMessage);
      if (response.status === 409 && /limite/i.test(errorMessage)) {
        setSupportAlert(`${errorMessage} Entre em contato com o suporte para alterar o contrato.`);
      }
      return;
    }
    setData((current) => {
      const exists = current.companies.some((company) => company.id === saved.id);
      const allowedIds = new Set(saved.resourceIds || []);
      return {
        ...current,
        companies: exists
          ? current.companies.map((company) => company.id === saved.id ? saved : company)
          : [saved, ...current.companies],
        licenses: current.licenses.map((license) => {
          const tenantData = current.condominiums.find((condo) => condo.id === license.tenantId);
          return license.companyId === saved.id || tenantData?.companyId === saved.id
            ? { ...license, companyId: saved.id, resourceIds: (license.resourceIds || []).filter((id) => allowedIds.has(id)) }
            : license;
        })
      };
    });
    setCompanyForm(emptyCompanyForm);
    setMessage(saved.temporaryPassword
      ? `Empresa salva. Login: ${saved.login}. Senha temporaria: ${saved.temporaryPassword}`
      : "Empresa e plano comercial atualizados.");
    void refreshApiCache();
  }

  async function saveCompanyBillingProfile(companyId, profile) {
    const company = data.companies.find((item) => item.id === companyId);
    if (!company) throw new Error("Empresa nao encontrada.");
    const response = await apiFetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...company, ...profile, id: company.id })
    });
    const saved = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(saved?.message || "Falha ao salvar configuracao financeira.");
      setMessage(error.message);
      throw error;
    }
    setData((current) => ({
      ...current,
      companies: current.companies.map((item) => item.id === saved.id ? saved : item)
    }));
    setMessage("Configuracao financeira atualizada.");
    void refreshApiCache();
    return saved;
  }

  async function generateCompanyCharge(companyId, billingType) {
    const response = await apiFetch("/api/billing/charges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, billingType })
    });
    const invoice = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(invoice?.message || "Falha ao gerar cobranca.");
      setMessage(error.message);
      throw error;
    }
    setData((current) => ({
      ...current,
      billingInvoices: [invoice, ...(current.billingInvoices || []).filter((item) => item.id !== invoice.id)]
    }));
    setMessage("Cobranca gerada no Asaas.");
    return invoice;
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
    const { response, result } = await cameraController.saveCameraForm(payload);
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
    const { response, result } = await cameraController.deleteCamera(camera.id);
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
    const { response, result: saved } = await actionController.saveActionForm({ ...actionForm, tenantId: actionForm.tenantId || selectedTenant?.id, relay: Number(actionForm.relay || 1) });
    if (!response.ok) {
      setMessage("Falha ao salvar acionamento.");
      return;
    }
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
    const { response } = await actionController.deleteAction(action.id);
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
    const { response, result } = await actionController.triggerAction(action.id);
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
    const { response, result } = await deviceController.refreshDeviceStatus(selectedTenant.id);
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
    const { response, result } = await deviceController.testDeviceIntegration(device.id);
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

  async function refreshExtensionStatus() {
    if (!selectedTenant?.id) return;
    const response = await apiFetch(`/api/extensions/status?tenantId=${encodeURIComponent(selectedTenant.id)}`);
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
        apiFetch("/api/telephony/calls").catch(() => null),
        selectedTenant?.id
          ? apiFetch(`/api/extensions/status?tenantId=${encodeURIComponent(selectedTenant.id)}`).catch(() => null)
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
      const response = await apiFetch(`/api/access/logs?tenantId=${encodeURIComponent(selectedTenant.id)}&limit=80${sinceParam}`);
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
    const response = await apiFetch(`/api/access/logs?tenantId=${encodeURIComponent(selectedTenant.id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=1000`);
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
    if (activeSection !== "telephony" || !selectedTenant?.id) return;
    void refreshExtensionStatus();
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
      const response = await apiFetch(`/api/actions/${action.id}/trigger`, { method: "POST" });
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
      const response = await apiFetch(`/api/telephony/calls/${call.id}/answer`, { method: "POST" });
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
    const response = await apiFetch(`/api/telephony/calls/${call.id}/answer`, { method: "POST" });
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
    const response = await apiFetch(`/api/telephony/calls/${call.id}/end`, { method: "POST" });
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
    const response = await apiFetch(`/api/resources/${resource.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: selectedTenant?.id, enabled })
    });
    const saved = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage(saved?.message || "Falha ao atualizar recurso da licenca.");
      return;
    }
    if (saved?.licenseId) {
      setData((current) => {
        const nextLicense = {
          id: saved.licenseId,
          tenantId: selectedTenant?.id,
          name: selectedTenant?.name || "Licenca do condominio",
          active: true,
          resourceIds: saved.resourceIds
        };
        return {
          ...current,
          licenses: current.licenses.some((license) => license.id === saved.licenseId)
            ? current.licenses.map((license) => license.id === saved.licenseId ? { ...license, resourceIds: saved.resourceIds } : license)
            : [nextLicense, ...current.licenses]
        };
      });
    }
    setMessage(`Recurso ${resource.name} ${enabled ? "habilitado" : "desabilitado"}.`);
    void refreshApiCache();
  }

  function openResourceConfiguration(resource) {
    const saved = data.resourceConfigurations.find((item) => item.tenantId === selectedTenant?.id && item.resourceId === resource.id);
    setResourceConfigForm({ ...defaultResourceSettings(resource.id), ...(saved?.settings || resource.configuration || {}) });
    setResourceConfig(resource.id);
  }

  async function saveResourceConfiguration(event) {
    event.preventDefault();
    if (!selectedTenant || !resourceConfig) return;
    const response = await apiFetch(`/api/resources/${encodeURIComponent(resourceConfig)}/configuration`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: selectedTenant.id, settings: resourceConfigForm })
    });
    const saved = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage(saved?.message || "Falha ao salvar configuracao do modulo.");
      return;
    }
    setData((current) => ({
      ...current,
      resourceConfigurations: [
        saved,
        ...current.resourceConfigurations.filter((item) => !(item.tenantId === saved.tenantId && item.resourceId === saved.resourceId))
      ]
    }));
    setMessage(`Configuracao de ${selectedResource?.name || resourceConfig} salva.`);
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
    if (resource === "vehicleTags") {
      return [
        <span><strong>{record.valueLabel || record.value}</strong><small>{record.mode === "STANDARD" ? "Modo padrao (cards)" : "Modo estendido (uhf_tags)"}</small></span>,
        <span><strong>{record.personName || "Sem nome"}</strong><small>{record.personExternalId || "-"}</small></span>,
        record.deviceId || selectedIntegrationDevice?.name || "-",
        <span className="status">CONTROL ID</span>
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
  if (session.mustChangePassword) {
    return <ChangePassword session={session} onChanged={persistSession} />;
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
        <form className="panel form-panel" autoComplete="off" key={`${kind}-${currentPerson.id || "new"}-${selectedUnit?.unitId || "all"}`} onSubmit={(event) => savePersonForm(event, kind, currentPerson)}>
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
            {isResident && <Field label="E-mail/Login"><input name="residentEmail" autoComplete="one-time-code" defaultValue={currentPerson.email || ""} /></Field>}
            {isResident && <Field label="Relacao"><select name="relation" defaultValue={currentPerson.relation || "Responsavel"}><option>Proprietario</option><option>Morador</option><option>Responsavel</option><option>Responsavel financeiro</option></select></Field>}
            {isResident && <Field label="Permissao"><select name="role" defaultValue={currentPerson.role || "RESIDENT"}><option value="CONDO_ADMIN">Administrador</option><option value="PORTER">Porteiro</option><option value="RESIDENT">Usuario normal</option></select></Field>}
            {isResident && <Field label="Nova senha"><input name="newPassword" type="password" autoComplete="new-password" placeholder="Preencha apenas para alterar" /></Field>}
            {isVisitor && <Field label="Autorizado por"><input name="authorizedBy" defaultValue={currentPerson.authorizedBy || selectedUnit?.residentName || ""} /></Field>}
            {isVisitor && <Field label="Motivo"><input name="accessReason" defaultValue={currentPerson.accessReason || ""} /></Field>}
            {isVisitor && <Field label="Placa"><input name="vehiclePlate" defaultValue={currentPerson.vehiclePlate || ""} /></Field>}
            <Field label={isResident ? "Credencial padrao" : "Credencial"}><select name="credentialType" defaultValue={currentPerson.credentialType || (isResident ? "APP" : "QR_CODE")}><option>APP</option><option>FACE</option><option>RFID</option><option>QR_CODE</option><option>PIN</option><option>PLATE</option></select></Field>
            {isResident && <Field label="Facial do equipamento"><input readOnly value={currentPersonFace ? `${currentPersonFace.valueLabel || currentPersonFace.value} (${currentPersonFace.source || "equipamento"})` : "Nenhuma facial importada"} /></Field>}
            {isResident && currentPersonFace && <div className="current-person-face"><PersonAvatar name={currentPerson.name} photoUrl={credentialPhotoUrl(currentPersonFace, currentPerson)} /><span><strong>Foto facial importada</strong><small>{currentPersonFace.syncStatus || "DEVICE"}</small></span></div>}
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
          {people.map((person) => {
            const face = data.credentials.find((credential) => credential.personId === person.id && credential.type === "FACE");
            return (
              <div className="person-row" key={person.id}>
                <button className="person-name-cell row-link" onClick={() => setSelectedPersonId(person.id)}><PersonAvatar name={person.name} photoUrl={credentialPhotoUrl(face, person)} /><div><strong>{person.name}</strong><small>{person.email || person.company || person.authorizedBy || "Sem login"}</small><small>{isResident ? `Permissao: ${person.role || "RESIDENT"} - Face ${face ? "importada" : "pendente"}` : person.credentialType}</small></div></button>
                <span>CPF: {person.cpf || "-"}<br />RG: {person.rg || "-"}</span>
                <span>{person.phone || "-"}</span>
                <span>{kind === "PROVIDER" ? person.serviceType || "-" : person.relation || person.accessReason || "-"}</span>
                <div className="row-actions"><button className="compact-action-button secondary-button" onClick={() => void generateCredentialForPerson(person, person.credentialType || (isResident ? "APP" : "QR_CODE"))}>Credencial</button><button className="compact-action-button secondary-button" onClick={() => { setCredentialForm({ ...emptyCredentialForm, tenantId: person.tenantId, unitId: person.unitId, personId: person.id, type: "FACE" }); setActiveSection("credentials"); }}>Face</button><button className="compact-action-button secondary-button" onClick={() => setSelectedPersonId(person.id)}>Editar</button><button className="compact-action-button danger-button" onClick={() => void deletePerson(person)}>Excluir</button></div>
              </div>
            );
          })}
        </article>
      </section>
    );
  }

  function renderContent() {
    if (activeSection === "dashboard") {
      return <DashboardPage selectedTenant={selectedTenant} selectedTenantId={selectedTenantId} setSelectedTenantId={setSelectedTenantId} visibleCondominiums={visibleCondominiums} units={units} tenantDevices={tenantDevices} tenantCameras={tenantCameras} tenantCalls={tenantCalls} tenantEvents={tenantEvents} syncState={syncState} openCameras={() => { setActiveSection("devices"); setDeviceTab("cameras"); }} openTelephony={() => setActiveSection("telephony")} />;
    }

    if (activeSection === "telephony") {
      return <TelephonyPage selectedTenant={selectedTenant} units={units} extensionStatus={data.extensionStatus} webPhone={webPhone} onCallExtension={callExtensionFromWeb} onHangup={hangupWebPhone} />;
    }

    if (activeSection === "condoHome") {
      return <CondominiumDashboardPage selectedTenant={selectedTenant} units={units} residents={data.residents} tenantDevices={tenantDevices} tenantCameras={tenantCameras} tenantCalls={tenantCalls} tenantEvents={tenantEvents} navigateTo={navigateTo} setActiveSection={setActiveSection} setDeviceTab={setDeviceTab} setCondoFormMode={setCondoFormMode} />;
    }

    if (activeSection === "condominiums") {
      return <CondominiumsPage search={search} setSearch={setSearch} setCondoFormMode={setCondoFormMode} setActiveSection={setActiveSection} condoPager={condoPager} selectedTenantId={selectedTenantId} setSelectedTenantId={setSelectedTenantId} data={data} navigateTo={navigateTo} deleteCondo={deleteCondo} />;
    }

    if (activeSection === "condoForm") {
      return <CondominiumFormPage mode={condoFormMode} tenant={condoFormTenant} data={data} condoGeo={condoGeo} setCondoGeo={setCondoGeo} onSave={createOrUpdateCondo} onGeocode={geocodeCondoForm} onUpdateTotal={updateCondoTotal} />;
    }

    if (activeSection === "units") {
      const unitLogins = data.unitLogins.filter((login) => login.unitId === selectedUnit?.unitId);
      const unitVehicles = data.vehicles.filter((vehicle) => vehicle.unitId === selectedUnit?.unitId);
      const unitInvites = data.unitInvites.filter((invite) => invite.unitId === selectedUnit?.unitId && (inviteSubtab !== "qrCodes" || invite.type === "QR_CODE"));
      const owner = data.residents.find((person) => person.unitId === selectedUnit?.unitId && person.kind === "RESIDENT") || data.residents.find((person) => person.unitId === selectedUnit?.unitId);
      const unitOwner = unitFormMode === "new" ? null : owner;
      const showUnitTabs = Boolean(selectedUnit && unitFormMode !== "new");
      const renderUnitForm = (isNew = false) => {
        const targetUnit = isNew ? null : selectedUnit;
        const targetOwner = isNew ? null : unitOwner;
        return (
          <form className="panel form-panel" autoComplete="off" key={`${isNew ? "new" : "edit"}-${targetUnit?.unitId || "unit"}`} onSubmit={saveUnitForm}>
            <div className="panel-heading"><h2>{isNew ? "Nova unidade" : `Geral da unidade ${targetUnit?.unitNumber || "-"}`}</h2><Home size={20} /></div>
            <div className="form-grid">
              <input type="hidden" name="unitId" value={targetUnit?.unitId || ""} />
              <Field label="Unidade"><input name="unitNumber" defaultValue={targetUnit?.unitNumber || ""} /></Field>
              <Field label="Bloco/Torre"><input name="blockName" defaultValue={targetUnit?.blockName || ""} /></Field>
              <Field label="Morador principal"><input name="residentName" defaultValue={targetUnit?.residentName || ""} /></Field>
              <Field label="Proprietario/Responsavel"><input name="responsibleName" defaultValue={targetOwner?.name || targetUnit?.responsibleName || ""} /></Field>
              <Field label="CPF do morador"><input name="residentCpf" defaultValue={targetOwner?.cpf || ""} /></Field>
              <Field label="RG do morador"><input name="residentRg" defaultValue={targetOwner?.rg || ""} /></Field>
              <Field label="Celular do responsavel"><input name="residentPhone" defaultValue={targetOwner?.phone || ""} /></Field>
              <Field label="E-mail/Login"><input name="residentEmail" autoComplete="one-time-code" defaultValue={targetOwner?.email || ""} /></Field>
              <Field label="Relacao"><select name="residentRelation" defaultValue={targetOwner?.relation || "Responsavel"}><option>Proprietario</option><option>Morador</option><option>Responsavel</option><option>Responsavel financeiro</option></select></Field>
              <Field label="Ramal"><input name="extension" defaultValue={targetUnit?.telephony?.extension || targetUnit?.extension || ""} /></Field>
            </div>
            <div className="toolbar-actions unit-actions">
              <button type="submit"><Save size={16} /> Salvar unidade</button>
              {!isNew && <button className="secondary-button" type="button" onClick={() => setUnitTab("moradores")}>Abrir moradores</button>}
              {!isNew && <button className="secondary-button" type="button" onClick={() => setUnitTab("logins")}>Logins</button>}
              {!isNew && <button className="secondary-button" type="button" onClick={() => setUnitTab("convites")}>Convites</button>}
              {isNew && <button className="secondary-button" type="button" onClick={() => setUnitFormMode("edit")}>Cancelar</button>}
              {!isNew && targetUnit?.unitId && <button className="danger-button" type="button" onClick={() => void deleteUnit(targetUnit)}><Trash2 size={16} /> Excluir unidade</button>}
            </div>
          </form>
        );
      };
      return (
        <section className="unit-detail">
          <div className="breadcrumb-bar">
            <button className="breadcrumb-link" type="button" onClick={() => navigateTo("/unidades")}>Voltar</button>
            <strong>{selectedTenant?.name || "Condominio"} &gt; Unidades{selectedUnit ? ` > ${selectedUnit.unitNumber}` : ""}</strong>
          </div>
          {showUnitTabs && <div className="subtabs unit-main-tabs">
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
          </div>}
          {showUnitTabs && unitTab === "geral" ? (
            renderUnitForm(false)
          ) : showUnitTabs && unitTab === "telefonia" ? (
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
          ) : showUnitTabs && unitTab === "moradores" ? (
            renderPersonRegistry("RESIDENT", "Morador", true)
          ) : showUnitTabs && unitTab === "visitantes" ? (
            renderPersonRegistry("VISITOR", "Visitante", true)
          ) : showUnitTabs && unitTab === "prestadores" ? (
            renderPersonRegistry("PROVIDER", "Prestador", true)
          ) : showUnitTabs && unitTab === "veiculos" ? (
            <section className="people-layout">
              <form className="panel form-panel" onSubmit={saveVehicleForm}>
                <div className="panel-heading"><h2>{vehicleForm.id ? "Editar veiculo" : "Novo veiculo"}</h2><Car size={20} /></div>
                <div className="form-grid">
                  <Field label="Morador"><select value={vehicleForm.personId} onChange={(event) => setVehicleForm((current) => ({ ...current, personId: event.target.value }))}><option value="">Sem responsavel definido</option>{data.residents.filter((person) => person.unitId === selectedUnit.unitId && (person.kind || "RESIDENT") === "RESIDENT").map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
                  <Field label="Tipo"><select value={vehicleForm.type} onChange={(event) => setVehicleForm((current) => ({ ...current, type: event.target.value }))}><option value="CARRO">Carro</option><option value="MOTO">Moto</option><option value="UTILITARIO">Utilitario</option><option value="OUTRO">Outro</option></select></Field>
                  <Field label="Placa"><input required value={vehicleForm.plate} onChange={(event) => setVehicleForm((current) => ({ ...current, plate: event.target.value.toUpperCase() }))} /></Field>
                  <Field label="Marca"><input value={vehicleForm.brand} onChange={(event) => setVehicleForm((current) => ({ ...current, brand: event.target.value }))} /></Field>
                  <Field label="Modelo"><input value={vehicleForm.model} onChange={(event) => setVehicleForm((current) => ({ ...current, model: event.target.value }))} /></Field>
                  <Field label="Cor"><input value={vehicleForm.color} onChange={(event) => setVehicleForm((current) => ({ ...current, color: event.target.value }))} /></Field>
                  <Field label="Leitor Control iD"><select value={vehicleForm.tagDeviceId || ""} onChange={(event) => {
                    const device = controlIdDevices.find((item) => item.id === event.target.value);
                    setVehicleForm((current) => ({ ...current, tagDeviceId: event.target.value, tagMode: device?.controlIdUhfMode || current.tagMode || "EXTENDED" }));
                  }}><option value="">Selecione o equipamento</option>{controlIdDevices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></Field>
                  <Field label="Modo da tag"><select value={vehicleForm.tagMode || "EXTENDED"} onChange={(event) => setVehicleForm((current) => ({ ...current, tagMode: event.target.value }))}><option value="EXTENDED">UHF estendido (hexadecimal)</option><option value="STANDARD">UHF padrao (cartao numerico)</option></select></Field>
                  <Field label="Tag veicular"><input value={vehicleForm.tagValue || ""} onChange={(event) => setVehicleForm((current) => ({ ...current, tagValue: event.target.value.toUpperCase() }))} placeholder={vehicleForm.tagMode === "STANDARD" ? "Ex.: 123.45678" : "Ex.: E28068940000501A2B3C4D5E"} /></Field>
                  <Field label="Observacoes"><input value={vehicleForm.notes} onChange={(event) => setVehicleForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
                </div>
                <div className="toolbar-actions unit-actions">
                  <button type="submit"><Save size={16} /> Salvar veiculo</button>
                  {vehicleForm.id && <button className="secondary-button" type="button" onClick={() => setVehicleForm({ ...emptyVehicleForm, unitId: selectedUnit.unitId })}>Cancelar edicao</button>}
                </div>
              </form>
              <article className="panel people-panel">
                <div className="panel-heading"><h2>Veiculos da unidade</h2><Car size={20} /></div>
                <div className="unit-table header vehicle-table"><span>Placa / Tipo</span><span>Veiculo</span><span>Responsavel</span><span>Acoes</span></div>
                {unitVehicles.map((vehicle) => {
                  const person = data.residents.find((item) => item.id === vehicle.personId);
                  return (
                    <div className="unit-table row vehicle-table" key={vehicle.id}>
                      <span><strong>{vehicle.plate}</strong><small>{vehicle.type}</small></span>
                      <span><strong>{[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "-"}</strong><small>{vehicle.color || "Cor nao informada"}</small><small>{vehicle.tagValue ? `Tag ${vehicle.tagValue} - ${vehicle.tagStatus || "PENDING"}` : "Sem tag veicular"}</small></span>
                      <span>{person?.name || "Nao informado"}</span>
                      <div className="row-actions">
                        {vehicle.tagValue && <button className="compact-action-button secondary-button" type="button" disabled={vehicleTagBusyId === vehicle.id} onClick={() => void syncVehicleControlIdTag(vehicle)}>Enviar tag</button>}
                        {vehicle.tagValue && vehicle.tagStatus === "SYNCED" && <button className="compact-action-button secondary-button" type="button" disabled={vehicleTagBusyId === vehicle.id} onClick={() => void removeVehicleControlIdTag(vehicle)}>Remover tag</button>}
                        <button className="compact-action-button secondary-button" type="button" onClick={() => setVehicleForm({ ...emptyVehicleForm, ...vehicle })}>Editar</button>
                        <button className="compact-action-button danger-button" type="button" onClick={() => void deleteVehicle(vehicle)}>Excluir</button>
                      </div>
                    </div>
                  );
                })}
                {!unitVehicles.length && <div className="empty-state">Nenhum veiculo cadastrado nesta unidade.</div>}
              </article>
            </section>
          ) : showUnitTabs && unitTab === "logins" ? (
            <article className="panel people-panel">
              <div className="resource-toolbar">
                <label className="search-field"><Search size={16} /><input placeholder="Filtre por nome" /></label>
              </div>
              <div className="unit-table header login-history-table"><span>Usuario / Perfil</span><span>Login</span><span>Logout</span><span>Situacao</span></div>
              {unitLogins.map((login) => (
                <div className="unit-table row login-history-table" key={login.id}>
                  <span><strong>{login.guest}</strong><small>{login.profile}</small></span>
                  <span>{formatDateTime(login.loginAt || login.sentAt)}<small>{login.sentTo}</small></span>
                  <span>{login.logoutAt ? formatDateTime(login.logoutAt) : "-"}</span>
                  <span className="status">{login.status}</span>
                </div>
              ))}
              {!unitLogins.length && <div className="empty-state">Nenhum login registrado para esta unidade.</div>}
            </article>
          ) : showUnitTabs && unitTab === "convites" ? (
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
          ) : showUnitTabs && unitTab === "recursos" ? (
            <article className="panel">
              <div className="panel-heading"><h2>Recursos da unidade</h2><ClipboardList size={20} /></div>
              <div className="summary-list">
                <span><strong>Moradores</strong>{data.residents.filter((person) => person.unitId === selectedUnit.unitId && (person.kind || "RESIDENT") === "RESIDENT").length}</span>
                <span><strong>Veiculos</strong>{unitVehicles.length}</span>
                <span><strong>Credenciais</strong>{data.credentials.filter((credential) => credential.unitId === selectedUnit.unitId).length}</span>
                <span><strong>Ramal</strong>{selectedUnit.telephony?.extension || selectedUnit.extension || "-"}</span>
              </div>
            </article>
          ) : (
            <section className={`unit-directory-grid ${unitFormMode === "new" ? "" : "full-width"}`}>
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
              {unitFormMode === "new" && renderUnitForm(true)}
            </section>
          )}
        </section>
      );
    }

    if (activeSection === "syndic") {
      const tenantResidents = data.residents.filter((person) => person.tenantId === selectedTenant?.id && (person.kind || "RESIDENT") === "RESIDENT");
      const tenantStaff = data.residents.filter((person) => person.tenantId === selectedTenant?.id && person.kind === "STAFF");
      const syndicCandidates = [...tenantResidents, ...tenantStaff.filter((person) => person.role === "CONDO_ADMIN")];
      const syndic = syndicCandidates.find((person) => person.isSyndic) || null;
      const syndicFace = data.credentials.find((credential) => credential.personId === syndic?.id && credential.type === "FACE");
      return (
        <section className="staff-page">
          <form className="panel form-panel" key={`staff-${selectedTenant?.id || "tenant"}`} onSubmit={saveCondoStaff}>
            <div className="panel-heading"><h2>Cadastrar sindico ou porteiro</h2><UserPlus size={20} /></div>
            <div className="form-grid">
              <Field label="Condominio"><select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)}>{visibleCondominiums.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
              <Field label="Funcao"><select name="role" defaultValue="PORTER"><option value="PORTER">Porteiro</option><option value="CONDO_ADMIN">Sindico</option></select></Field>
              <Field label="Nome completo"><input name="name" required /></Field>
              <Field label="E-mail/Login"><input name="email" type="email" required /></Field>
              <Field label="Celular"><input name="phone" /></Field>
              <Field label="CPF"><input name="cpf" /></Field>
              <Field label="RG"><input name="rg" /></Field>
              <Field label="Cargo do sindico"><select name="syndicRole" defaultValue="SINDICO"><option>SINDICO</option><option>SUBSINDICO</option><option>CONSELHEIRO</option><option>ADMINISTRADORA</option></select></Field>
              <Field label="Inicio do mandato"><input name="mandateStart" type="date" /></Field>
              <Field label="Fim do mandato"><input name="mandateEnd" type="date" /></Field>
              <Field label="Senha inicial"><input name="newPassword" type="password" placeholder="Padrao temporario se vazio" /></Field>
              <button type="submit"><Save size={16} /> Salvar cadastro</button>
            </div>
            <div className="form-hint">Cadastros gerais do condominio nao ficam vinculados a uma unidade.</div>
          </form>
          <form className="panel form-panel" key={`${selectedTenant?.id || "tenant"}-${syndic?.id || "none"}`} onSubmit={saveSyndic}>
            <div className="panel-heading"><h2>Definir sindico</h2><ShieldCheck size={20} /></div>
            <div className="form-grid">
              <Field label="Condominio"><select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)}>{visibleCondominiums.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
              <Field label="Pessoa"><select name="personId" required defaultValue={syndic?.id || ""}><option value="">Selecione</option>{syndicCandidates.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
              <Field label="Cargo"><select name="syndicRole" defaultValue={syndic?.syndicRole || "SINDICO"}><option>SINDICO</option><option>SUBSINDICO</option><option>CONSELHEIRO</option><option>ADMINISTRADORA</option></select></Field>
              <Field label="Inicio do mandato"><input name="mandateStart" type="date" defaultValue={syndic?.mandateStart || ""} /></Field>
              <Field label="Fim do mandato"><input name="mandateEnd" type="date" defaultValue={syndic?.mandateEnd || ""} /></Field>
              <Field label="Permissao"><select name="role" defaultValue={syndic?.role || "CONDO_ADMIN"}><option value="CONDO_ADMIN">Administrador do condominio</option><option value="PORTER">Porteiro</option><option value="RESIDENT">Usuario normal</option></select></Field>
              <button type="submit"><Save size={16} /> Salvar sindico</button>
            </div>
            <div className="form-hint">Esta tela define quem e sindico/subsindico e quais permissoes administrativas essa pessoa tera.</div>
          </form>
          <article className="panel people-panel staff-list-panel">
            <div className="panel-heading"><h2>Equipe do condominio</h2><span>{tenantStaff.length} cadastro(s)</span></div>
            <div className="people-header"><span>Nome</span><span>Documentos</span><span>Celular</span><span>Funcao</span><span>Status</span></div>
            {tenantStaff.map((person) => (
              <div className="person-row" key={person.id}>
                <div className="person-name-cell"><PersonAvatar name={person.name} photoUrl={credentialPhotoUrl(data.credentials.find((credential) => credential.personId === person.id && credential.type === "FACE"), person)} /><div><strong>{person.name}</strong><small>{person.email || "-"}</small><small>{selectedTenant?.name}</small></div></div>
                <span>CPF: {person.cpf || "-"}<br />RG: {person.rg || "-"}</span>
                <span>{person.phone || "-"}</span>
                <span>{person.role === "PORTER" ? "Porteiro" : person.syndicRole || "Sindico"}</span>
                <span className="status">{person.isSyndic ? "Sindico atual" : "Ativo"}</span>
              </div>
            ))}
            {!tenantStaff.length && <div className="empty-state">Nenhum sindico ou porteiro cadastrado na area geral.</div>}
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
                  <Field label={isNiceLinearManufacturer(deviceForm.manufacturer) && deviceForm.niceConnectionMode !== "HTTP_GATEWAY" ? "IP de origem do equipamento" : "IP / DDNS"}><input value={deviceForm.ipAddress} onChange={(event) => setDeviceForm((current) => ({ ...current, ipAddress: event.target.value }))} /></Field>
                  <Field label="Protocolo API"><select value={deviceForm.apiProtocol} onChange={(event) => setDeviceForm((current) => ({ ...current, apiProtocol: event.target.value }))}><option value="http">HTTP</option><option value="https">HTTPS</option><option value="tcp">TCP iniciado pelo equipamento</option></select></Field>
                  <Field label={isNiceLinearManufacturer(deviceForm.manufacturer) && deviceForm.niceConnectionMode !== "HTTP_GATEWAY" ? "Porta de escuta TCP" : "Porta API"}><input required={isNiceLinearManufacturer(deviceForm.manufacturer)} value={deviceForm.apiPort} onChange={(event) => setDeviceForm((current) => ({ ...current, apiPort: event.target.value.replace(/\D/g, "") }))} /></Field>
                  <Field label="Porta RTSP"><input value={deviceForm.rtspPort} onChange={(event) => setDeviceForm((current) => ({ ...current, rtspPort: event.target.value }))} /></Field>
                  <Field label="Canais esperados"><input value={deviceForm.channelCount} onChange={(event) => setDeviceForm((current) => ({ ...current, channelCount: event.target.value }))} placeholder="Ex.: 4, 8, 16" /></Field>
                  {!isNiceLinearManufacturer(deviceForm.manufacturer) && <Field label="Usuario"><input value={deviceForm.username} onChange={(event) => setDeviceForm((current) => ({ ...current, username: event.target.value }))} /></Field>}
                  {(!isNiceLinearManufacturer(deviceForm.manufacturer) || deviceForm.niceConnectionMode === "HTTP_GATEWAY") && <Field label={isNiceLinearManufacturer(deviceForm.manufacturer) ? "Token do gateway" : "Senha"}><input type="password" autoComplete="new-password" value={deviceForm.password} onChange={(event) => setDeviceForm((current) => ({ ...current, password: event.target.value }))} placeholder={deviceForm.id ? "Preencha para alterar" : ""} /></Field>}
                  {deviceForm.manufacturer === "Control iD" && <Field label="Acionamento Control iD"><select value={deviceForm.controlIdAction || "door"} onChange={(event) => setDeviceForm((current) => ({ ...current, controlIdAction: event.target.value, controlIdSecBoxId: event.target.value === "sec_box" ? current.controlIdSecBoxId : "" }))}>{controlIdActionOptions(deviceForm.model).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>}
                  {deviceForm.manufacturer === "Control iD" && deviceForm.controlIdAction === "sec_box" && <Field label="ID do SecBox / MAE"><input inputMode="numeric" pattern="[0-9]+" required value={deviceForm.controlIdSecBoxId || ""} onChange={(event) => setDeviceForm((current) => ({ ...current, controlIdSecBoxId: event.target.value.replace(/\D/g, "") }))} placeholder="Ex.: 65793" /></Field>}
                  {deviceForm.manufacturer === "Control iD" && <Field label="Grupo de acesso (standalone)"><input inputMode="numeric" pattern="[0-9]*" value={deviceForm.controlIdGroupId || ""} onChange={(event) => setDeviceForm((current) => ({ ...current, controlIdGroupId: event.target.value.replace(/\D/g, "") }))} placeholder="Opcional. Ex.: 1" /></Field>}
                  {deviceForm.manufacturer === "Control iD" && deviceForm.model === "iDUHF" && <Field label="Modo do leitor UHF"><select value={deviceForm.controlIdUhfMode || "EXTENDED"} onChange={(event) => setDeviceForm((current) => ({ ...current, controlIdUhfMode: event.target.value }))}><option value="EXTENDED">Estendido - objeto uhf_tags, ate 96 bits</option><option value="STANDARD">Padrao - objeto cards/Wiegand</option></select></Field>}
                  {deviceForm.manufacturer === "Control iD" && controlIdProfileGuidance(deviceForm) && <div className="form-hint">{controlIdProfileGuidance(deviceForm)}</div>}
                  {isNiceLinearManufacturer(deviceForm.manufacturer) && <Field label="Modo de conexao Nice/Linear"><select value={deviceForm.niceConnectionMode || "DEVICE_CONNECTS_TCP"} onChange={(event) => setDeviceForm((current) => ({
                    ...current,
                    niceConnectionMode: event.target.value,
                    apiProtocol: event.target.value === "HTTP_GATEWAY" ? "http" : "tcp",
                    apiPort: event.target.value === "HTTP_GATEWAY" && !current.apiPort ? "80" : current.apiPort
                  }))}><option value="DEVICE_CONNECTS_TCP">Equipamento conecta ao Condo Access</option><option value="HTTP_GATEWAY">Bridge HTTP local</option></select></Field>}
                  {isNiceLinearManufacturer(deviceForm.manufacturer) && <Field label="ID / serial no sistema Nice"><input value={deviceForm.niceDeviceId || ""} onChange={(event) => setDeviceForm((current) => ({ ...current, niceDeviceId: event.target.value }))} placeholder="Opcional para identificar o modulo" /></Field>}
                  {isNiceLinearManufacturer(deviceForm.manufacturer) && deviceForm.niceConnectionMode === "HTTP_GATEWAY" && <Field label="Rota de saude do bridge"><input value={deviceForm.niceGatewayHealthPath || "/health"} onChange={(event) => setDeviceForm((current) => ({ ...current, niceGatewayHealthPath: event.target.value }))} /></Field>}
                  {isNiceLinearManufacturer(deviceForm.manufacturer) && deviceForm.niceConnectionMode === "HTTP_GATEWAY" && <Field label="Rota de abertura do bridge"><input value={deviceForm.niceGatewayOpenPath || "/api/nice-linear/open"} onChange={(event) => setDeviceForm((current) => ({ ...current, niceGatewayOpenPath: event.target.value }))} /></Field>}
                  {isNiceLinearManufacturer(deviceForm.manufacturer) && <div className="form-hint">{niceLinearProfileGuidance(deviceForm)}</div>}
                  {!(deviceForm.manufacturer === "Control iD" && deviceForm.model === "iDUHF") && !isNiceLinearManufacturer(deviceForm.manufacturer) && <Field label="Ramal interfone"><input value={deviceForm.intercomExtension} onChange={(event) => setDeviceForm((current) => ({ ...current, intercomExtension: event.target.value }))} /></Field>}
                  {!(deviceForm.manufacturer === "Control iD" && deviceForm.model === "iDUHF") && !isNiceLinearManufacturer(deviceForm.manufacturer) && <Field label="Tipo interfone"><select value={deviceForm.intercomType} onChange={(event) => setDeviceForm((current) => ({ ...current, intercomType: event.target.value }))}><option>FACIAL</option><option>UHF</option><option>TELEFONE_IP</option><option>ATA_VOIP</option></select></Field>}
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
                        controlIdAction: device.controlIdAction || "door",
                        controlIdSecBoxId: device.controlIdSecBoxId || "",
                        controlIdGroupId: device.controlIdGroupId || "",
                        controlIdUhfMode: device.controlIdUhfMode || "EXTENDED",
                        niceConnectionMode: device.niceConnectionMode || "DEVICE_CONNECTS_TCP",
                        niceGatewayHealthPath: device.niceGatewayHealthPath || "/health",
                        niceGatewayOpenPath: device.niceGatewayOpenPath || "/api/nice-linear/open",
                        niceDeviceId: device.niceDeviceId || "",
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
                    <small>{selectedTenant?.name} - leitura de eventos, credenciais, horarios, faciais, tags veiculares e usuarios</small>
                  </div>
                  <button className="secondary-button" type="button" disabled={equipmentIntegration.loading || equipmentIntegration.importing || !selectedIntegrationDevice} onClick={() => void readEquipmentIntegrationResource(equipmentIntegration.resource)}>
                    <RefreshCw size={16} /> Atualizar leitura
                  </button>
                </div>
                <div className="form-grid">
                  <Field label="Equipamento">
                    <select value={equipmentIntegration.deviceId || selectedIntegrationDevice?.id || ""} onChange={(event) => {
                      setEquipmentIntegration((current) => ({ ...current, deviceId: event.target.value, payload: null, importReport: null, error: "", updatedAt: "" }));
                      setEquipmentFaceSelections({});
                      setEquipmentFacePreviewPage(1);
                    }}>
                      {tenantDevices.map((device) => <option key={device.id} value={device.id}>{device.name} - {device.manufacturer} {device.model}</option>)}
                    </select>
                  </Field>
                  <Field label="Ultima leitura"><input readOnly value={equipmentIntegration.updatedAt ? formatDateTime(equipmentIntegration.updatedAt) : "Ainda nao executada"} /></Field>
                </div>
                <div className="equipment-read-actions">
                  {equipmentIntegrationResources.map(([resource, label, Icon]) => (
                    <button key={resource} type="button" className={equipmentIntegration.resource === resource ? "" : "secondary-button"} disabled={equipmentIntegration.loading || equipmentIntegration.importing || !selectedIntegrationDevice} onClick={() => void readEquipmentIntegrationResource(resource)}>
                      <Icon size={16} /> {label}
                    </button>
                  ))}
                </div>
                {["credentials", "faces", "vehicleTags"].includes(equipmentIntegration.resource) && <div className="toolbar-actions unit-actions">
                  <button className="secondary-button" type="button" disabled={equipmentIntegration.importing || !selectedIntegrationDevice} onClick={() => void importEquipmentCredentials(true, equipmentIntegration.resource)}>
                    <Search size={16} /> {equipmentIntegration.resource === "faces" ? "Atualizar previa facial" : equipmentIntegration.resource === "vehicleTags" ? "Previa tags veiculares" : "Previa credenciais do equipamento"}
                  </button>
                  <button type="button" disabled={equipmentIntegration.importing || !(equipmentIntegration.importReport?.total || equipmentIntegration.payload?.summary?.credentials)} onClick={() => void importEquipmentCredentials(false, equipmentIntegration.resource)}>
                    <Save size={16} /> Importar para o banco
                  </button>
                </div>}
                {equipmentIntegration.error && <div className="form-hint">{equipmentIntegration.error}</div>}
                {!tenantDevices.length && <div className="empty-state">Nenhum equipamento cadastrado neste condominio.</div>}
              </article>

              {!(equipmentIntegration.resource === "faces" && equipmentIntegration.importReport) && <article className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Resultado da leitura</h2>
                    <small>{equipmentIntegration.payload?.message || "Selecione uma leitura para consultar os dados consolidados."}</small>
                  </div>
                </div>
                <div className="integration-summary-grid">
                  {equipmentIntegrationResources.map(([resource, label, Icon]) => (
                    <button key={resource} type="button" className={equipmentIntegration.resource === resource ? "integration-summary-card active" : "integration-summary-card"} onClick={() => void readEquipmentIntegrationResource(resource)} disabled={equipmentIntegration.loading || equipmentIntegration.importing || !selectedIntegrationDevice}>
                      <Icon size={18} />
                      <span><strong>{equipmentIntegration.payload?.summary?.[resource] ?? 0}</strong>{label}</span>
                    </button>
                  ))}
                </div>
                {(equipmentIntegration.payload?.records || []).length > 0 && (
                  <div>
                    <div className="unit-table header integration-table"><span>Registro</span><span>Vinculo</span><span>Origem</span><span>Status</span></div>
                    {(equipmentIntegration.payload.records || []).map((record) => (
                      <div className="unit-table row integration-table" key={record.id || `${equipmentIntegration.resource}-${record.value || record.name}`}>
                        {integrationRecordCells(record, equipmentIntegration.resource)}
                      </div>
                    ))}
                  </div>
                )}
              </article>}


              {equipmentIntegration.importReport && (
                <article className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>{equipmentIntegration.resource === "faces" && equipmentIntegration.importReport.dryRun ? "Previa de cadastros faciais" : equipmentIntegration.resource === "vehicleTags" && equipmentIntegration.importReport.dryRun ? "Previa de tags veiculares" : "Importacao do equipamento"}</h2>
                      <small>{equipmentIntegration.resource === "faces" && equipmentIntegration.importReport.dryRun
                        ? "Confira as fotos, marque quem sera importado e digite ou escolha a unidade."
                        : equipmentIntegration.resource === "vehicleTags" && equipmentIntegration.importReport.dryRun
                          ? "Tags sem veiculo local serao salvas como veiculos pendentes para informar placa e unidade."
                          : equipmentIntegration.importReport.message || "Relatorio de credenciais lidas no equipamento."}</small>
                    </div>
                    <span className="status">{equipmentIntegration.importReport.dryRun ? "PREVIA" : "IMPORTADO"}</span>
                  </div>
                  <div className="import-report">
                    <span><strong>{equipmentIntegration.importReport.total || 0}</strong>lidas</span>
                    <span><strong>{equipmentIntegration.importReport.valid || 0}</strong>validas</span>
                    <span><strong>{equipmentIntegration.importReport.duplicates || 0}</strong>duplicadas</span>
                    <span><strong>{equipmentIntegration.importReport.unitsCreated || 0}</strong>unidades novas</span>
                    <span><strong>{equipmentIntegration.resource === "vehicleTags" ? equipmentIntegration.importReport.vehiclesCreated || 0 : equipmentIntegration.importReport.credentialsCreated || 0}</strong>novas</span>
                    <span><strong>{equipmentIntegration.resource === "vehicleTags" ? equipmentIntegration.importReport.vehiclesUpdated || 0 : equipmentIntegration.importReport.credentialsUpdated || 0}</strong>atualizadas</span>
                  </div>
                  {(equipmentIntegration.importReport.items || []).length ? (
                    <div className="face-import-review">
                      <datalist id="equipment-unit-options">
                        {units.map((unit) => <option key={unit.unitId} value={`Unidade ${unit.unitNumber}${unit.blockName ? ` - ${unit.blockName}` : ""}`} />)}
                      </datalist>
                      <div className="unit-table header credential-review-table">
                        <label className="check-cell"><input type="checkbox" checked={equipmentPreviewItems.length > 0 && equipmentPreviewItems.every((item) => equipmentFaceSelections[faceImportSelectionKey(item)]?.selected !== false)} onChange={(event) => updateAllEquipmentCredentialSelections(event.target.checked, equipmentIntegration.importReport.items || [])} />Importar</label>
                        <span>Credencial</span><span>Facial</span><span>Pessoa</span><span>Unidade</span>
                      </div>
                      {equipmentPreviewPageItems.map((item) => {
                        const key = faceImportSelectionKey(item);
                        const selection = equipmentFaceSelections[key] || {};
                        const selected = selection.selected !== false;
                        const selectedUnit = units.find((unit) => unit.unitId === selection.unitId);
                        const unitValue = selectedUnit
                          ? `Unidade ${selectedUnit.unitNumber}${selectedUnit.blockName ? ` - ${selectedUnit.blockName}` : ""}`
                          : [selection.unitNumber, selection.blockName].filter(Boolean).join(" - ");
                        const photoUrl = equipmentPreviewPhotoUrl(
                          equipmentIntegration.deviceId || selectedIntegrationDevice?.id || "",
                          item.payload?.photoUrl || ""
                        );
                        return (
                          <div className="unit-table row credential-review-table" key={key}>
                            <label className="check-cell"><input type="checkbox" checked={selected} onChange={(event) => updateEquipmentCredentialSelection(item, { selected: event.target.checked })} /></label>
                            <span><strong>{item.payload?.type || "-"}</strong><small>{item.payload?.valueLabel || item.payload?.value || "-"}</small></span>
                            <span className="credential-face-cell">
                              <PersonAvatar name={item.payload?.personName || item.payload?.valueLabel || item.payload?.value || "Face"} photoUrl={photoUrl} />
                              <small>{photoUrl ? "Foto facial" : "Sem foto facial"}</small>
                            </span>
                            <span>{item.payload?.personName || item.personId || "Sem nome"}</span>
                            <input list="equipment-unit-options" value={unitValue} placeholder="Digite ou escolha a unidade" onChange={(event) => updateEquipmentCredentialUnit(item, event.target.value)} />
                          </div>
                        );
                      })}
                      <Pagination page={equipmentPreviewSafePage} totalPages={equipmentPreviewTotalPages} onPage={setEquipmentFacePreviewPage} />
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
                  {visibleCondominiums.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
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
          <article className="panel porter-actions-strip">
            <div className="panel-heading compact-heading">
              <h2>Acionamentos do condominio</h2>
              <span>{tenantActions.filter((action) => action.status !== "DISABLED").length} ativo(s)</span>
            </div>
            <div className="porter-action-grid porter-action-grid-horizontal">
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
          </article>
          <div className="resource-operational-grid remote-porter-layout">
            <article className="panel porter-attendance-panel">
              <div className="porter-quick-search">
                <div className="panel-heading compact-heading"><h2>Busca rapida</h2><ShieldCheck size={18} /></div>
                <div className="remote-call-summary"><span><strong>{activeTenantCalls.length}</strong>chamadas ativas</span><span><strong>{tenantCalls.length}</strong>no historico</span></div>
                <div className="porter-filter-grid">{["CPF", "RG", "Placa", "Nome", "Unidade", "Credencial"].map((item) => <button key={item} type="button" className={porterSearchType === item ? "" : "secondary-button"} onClick={() => setPorterSearchType(item)}><Search size={15} /> {item}</button>)}</div>
                <label className="search-field porter-search-input"><Search size={16} /><input value={porterSearchTerm} onChange={(event) => setPorterSearchTerm(event.target.value)} placeholder={`Buscar por ${porterSearchType.toLowerCase()}`} /></label>
                {porterSearchTerm.trim() && <div className="porter-quick-results">
                  {porterSearchResults.map((result) => {
                    const unitId = result.unitId || result.id;
                    const resultUnit = data.units.find((unit) => unit.unitId === unitId);
                    return <button key={`${porterSearchType}-${result.id}`} type="button" onClick={() => resultUnit && selectPorterUnit(resultUnit)}><strong>{result.name || result.valueLabel || unitDisplay(result)}</strong><small>{resultUnit ? unitDisplay(resultUnit) : result.email || result.type || "Sem unidade vinculada"}</small></button>;
                  })}
                  {!porterSearchResults.length && <div className="empty-state">Nenhum resultado encontrado.</div>}
                </div>}
              </div>
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
            <div><span>Central por condominio</span><h2>{selectedTenant?.name || "-"}</h2><small>{tenantResources.filter((item) => item.enabled).length} de {tenantResources.length} recursos ativos na licenca</small></div>
            <Field label="Condominio"><select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)}>{visibleCondominiums.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
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
                    <h2>{selectedResource?.name || "Configuracao do recurso"}</h2>
                    <button className="secondary-button" onClick={() => { setResourceConfig(""); setResourceConfigForm({}); }}>Voltar</button>
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
                  {!["cameras", "actions"].includes(resourceConfig) && (
                    <form className="form-grid resource-config-form" onSubmit={saveResourceConfiguration}>
                      {(resourceConfigurationFields[resourceConfig] || []).map((field) => (
                        <Field key={field.id} label={field.label}>
                          {field.type === "boolean" ? (
                            <select
                              value={String(resourceConfigForm[field.id] ?? field.defaultValue)}
                              onChange={(event) => setResourceConfigForm((current) => ({ ...current, [field.id]: event.target.value === "true" }))}
                            >
                              <option value="true">Sim</option>
                              <option value="false">Nao</option>
                            </select>
                          ) : field.type === "select" ? (
                            <select
                              value={resourceConfigForm[field.id] ?? field.defaultValue}
                              onChange={(event) => setResourceConfigForm((current) => ({ ...current, [field.id]: event.target.value }))}
                            >
                              {field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                          ) : (
                            <input
                              type={field.type}
                              value={resourceConfigForm[field.id] ?? field.defaultValue}
                              onChange={(event) => setResourceConfigForm((current) => ({ ...current, [field.id]: event.target.value }))}
                            />
                          )}
                        </Field>
                      ))}
                      {(resourceConfigurationFields[resourceConfig] || []).length ? (
                        <button type="submit"><Save size={16} /> Salvar configuracao</button>
                      ) : (
                        <div className="empty-state">Este modulo usa apenas a liberacao da licenca.</div>
                      )}
                    </form>
                  )}
                </div>
              )}
              <div className="resource-module-list">
                {tenantResources.map((item) => (
                  <div className="resource-module-row" key={item.id}>
                    <input type="checkbox" checked={item.enabled} disabled={!item.contracted} onChange={(event) => void toggleResource(item, event.target.checked)} />
                    <span><strong>{item.name}</strong><small>{item.group} - {item.description}</small></span>
                    <div className="resource-row-actions">
                      {item.configurable && item.contracted && <button className="secondary-button" onClick={() => openResourceConfiguration(item)}>Configurar</button>}
                      <em>{!item.contracted ? "Nao contratado" : item.enabled ? "Ativo" : "Disponivel"}</em>
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
      const tenantFaces = tenantCredentials.filter((credential) => credential.type === "FACE");
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
              <Field label="Equipamento alvo"><select value={credentialForm.deviceId} onChange={(event) => setCredentialForm((current) => ({ ...current, deviceId: event.target.value }))}><option value="">Primeiro equipamento compativel</option>{tenantDevices.map((device) => <option key={device.id} value={device.id}>{device.name} - {device.manufacturer}</option>)}</select></Field>
              {credentialForm.type === "FACE" && <div className="face-photo-upload">
                <PersonAvatar name={data.residents.find((person) => person.id === credentialForm.personId)?.name || "Face"} photoUrl={credentialForm.photoUrl} />
                <Field label="Foto facial para enviar ao equipamento"><input type="file" accept="image/jpeg,image/png" onChange={handleFacePhotoFile} /></Field>
                <div className="form-hint">Use uma foto frontal, bem iluminada e com apenas uma pessoa. A imagem sera recortada e convertida para JPG. O envio facial esta implementado para Hikvision e Control iD.</div>
              </div>}
              <button type="submit" disabled={credentialForm.type === "FACE" && !credentialForm.photoUrl}><Save size={16} /> Salvar credencial</button>
              <button className="secondary-button" type="button" disabled={credentialForm.type === "FACE" && !credentialForm.photoUrl} onClick={() => credentialForm.personId && void generateCredentialForPerson(data.residents.find((person) => person.id === credentialForm.personId), credentialForm.type, credentialForm)}><Plus size={16} /> Gerar automatico</button>
            </div>
            <div className="form-hint">Para FACE, selecione uma foto e o equipamento alvo. APP, QR e PIN podem gerar o identificador automaticamente. RFID e placa podem ser importados por planilha ou digitados aqui.</div>
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
            <div className="panel-heading">
              <div>
                <h2>Faciais importadas</h2>
                <small>Faciais do equipamento, inclusive as que ainda precisam ser vinculadas a uma unidade.</small>
              </div>
              <span className="status">{tenantFaces.length} facial(is)</span>
            </div>
            <div className="unit-table header"><span>Foto / Pessoa</span><span>Origem</span><span>Unidade</span><span>Sincronismo</span></div>
            {tenantFaces.map((credential) => {
              const person = data.residents.find((item) => item.id === credential.personId);
              const unit = data.units.find((item) => item.unitId === credential.unitId);
              const credentialName = person?.name || credential.personName || credential.personId || "Sem pessoa";
              return (
                <div className="unit-table row" key={`face-${credential.id}`}>
                  <span className="credential-person-cell"><PersonAvatar name={credentialName} photoUrl={credentialPhotoUrl(credential, person)} /><span><strong>{credentialName}</strong><small>{credential.valueLabel || credential.value || "Facial"}</small></span></span>
                  <span>{credential.source || "LOCAL"}<small>{credential.devicePath || "Equipamento"}</small></span>
                  <span>{unit ? `Unidade ${unit.unitNumber}` : "Sem unidade vinculada"}</span>
                  <span className={`status ${credential.syncStatus === "PENDING" || credential.syncStatus === "ERROR" ? "offline" : ""}`}>{credential.syncStatus || "PENDING"}</span>
                </div>
              );
            })}
            {!tenantFaces.length && <div className="empty-state">Nenhuma facial importada para este condominio.</div>}
          </article>
          <article className="panel">
            <div className="panel-heading"><h2>Credenciais</h2><BadgeCheck size={20} /></div>
            <div className="unit-table header"><span>Foto / Pessoa</span><span>Tipo</span><span>Identificacao</span><span>Sincronismo</span></div>
            {tenantCredentials.map((credential) => {
              const person = data.residents.find((item) => item.id === credential.personId);
              const unit = data.units.find((item) => item.unitId === credential.unitId);
              const credentialName = person?.name || credential.personName || credential.personId || "Sem pessoa";
              const credentialPhoto = credentialPhotoUrl(credential, person);
              return (
                <div className="unit-table row" key={credential.id}>
                  <span className="credential-person-cell"><PersonAvatar name={credentialName} photoUrl={credentialPhoto} /><span><strong>{credentialName}</strong><small>Unidade {unit?.unitNumber || "-"}</small></span></span>
                  <span>{credential.type}</span>
                  <span>{credential.valueLabel}</span>
                  <span className={`status ${credential.syncStatus === "PENDING" || credential.syncStatus === "ERROR" ? "offline" : ""}`}>{credential.syncStatus}</span>
                  <div className="row-actions"><button className="compact-action-button secondary-button" onClick={() => setCredentialForm({ ...emptyCredentialForm, ...credential })}>Editar</button><button className="compact-action-button danger-button" onClick={() => void deleteCredential(credential)}>Excluir</button></div>
                </div>
              );
            })}
            {!tenantCredentials.length && <div className="empty-state">Nenhuma credencial cadastrada para este condominio.</div>}
          </article>
          <article className="panel">
            <div className="panel-heading"><h2>Sincronismo de credenciais</h2><RefreshCw size={20} /></div>
            <div className="form-hint">O equipamento recebe credenciais somente nos eventos de criacao e exclusao.</div>
            <div className="sync-job-grid">
              {data.credentialSyncJobs.map((job) => (
                <div className="sync-job-card" key={job.id}>
                  <strong>{job.manufacturer}</strong>
                  <span>{job.target}</span>
                  <small>{job.direction} {job.credentialType} - {job.synced}/{job.total} enviados, {job.errors} erro(s)</small>
                  {(job.results || []).slice(0, 3).map((result) => (
                    <small key={`${job.id}-${result.credentialId}`} className={result.ok ? "" : "error-text"}>{result.ok ? "OK" : "Erro"}: {result.message || result.adapter}</small>
                  ))}
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
        <SettingsPage
          companies={data.companies}
          condominiums={data.condominiums}
          licenses={data.licenses}
          invoices={data.billingInvoices}
          gateway={data.billingGateway}
          onSaveBillingProfile={saveCompanyBillingProfile}
          onGenerateCharge={generateCompanyCharge}
        />
      );
    }

    if (activeSection === "companies") {
      return (
        <section className="company-plan-page">
          <form className="panel form-panel" onSubmit={saveCompanyForm}>
            <div className="panel-heading"><h2>{companyForm.id ? "Editar empresa e plano" : "Nova empresa e plano"}</h2><Building2 size={20} /></div>
            <div className="form-grid">
              <Field label="Empresa"><input value={companyForm.name} onChange={(event) => setCompanyForm((current) => ({ ...current, name: event.target.value }))} required /></Field>
              <Field label="CNPJ/Documento"><input value={companyForm.document} onChange={(event) => setCompanyForm((current) => ({ ...current, document: event.target.value }))} /></Field>
              <Field label="Status"><select value={companyForm.status} onChange={(event) => setCompanyForm((current) => ({ ...current, status: event.target.value }))}><option value="ACTIVE">Ativa</option><option value="INACTIVE">Inativa</option></select></Field>
              <Field label="Responsavel"><input value={companyForm.contactName} onChange={(event) => setCompanyForm((current) => ({ ...current, contactName: event.target.value }))} /></Field>
              <Field label="E-mail"><input type="email" value={companyForm.contactEmail} onChange={(event) => setCompanyForm((current) => ({ ...current, contactEmail: event.target.value }))} /></Field>
              <Field label="Telefone"><input value={companyForm.contactPhone} onChange={(event) => setCompanyForm((current) => ({ ...current, contactPhone: event.target.value }))} /></Field>
              <Field label="Login da empresa"><input required value={companyForm.login} onChange={(event) => setCompanyForm((current) => ({ ...current, login: event.target.value }))} placeholder="empresa@dominio.com" /></Field>
              <Field label="Logo da empresa"><input value={companyForm.logoUrl} onChange={(event) => setCompanyForm((current) => ({ ...current, logoUrl: event.target.value }))} placeholder="https://..." /></Field>
              <div className="form-hint">Novas empresas recebem a senha temporaria 123456 e devem troca-la no primeiro acesso.</div>
              <Field label="Cobranca dos condominios"><select value={companyForm.billingModel} onChange={(event) => setCompanyForm((current) => ({ ...current, billingModel: event.target.value }))}><option value="PER_CONDOMINIUM">Por condominio</option><option value="PACKAGE">Pacote de condominios</option></select></Field>
              <Field label="Limite de condominios"><input type="number" min="1" value={companyForm.maxCondominiums} onChange={(event) => setCompanyForm((current) => ({ ...current, maxCondominiums: event.target.value }))} /></Field>
              <Field label="Mensalidade base"><input type="number" min="0" step="0.01" value={companyForm.baseMonthlyPrice} onChange={(event) => setCompanyForm((current) => ({ ...current, baseMonthlyPrice: event.target.value }))} /></Field>
              <Field label="Valor por condominio"><input type="number" min="0" step="0.01" value={companyForm.condominiumUnitPrice} onChange={(event) => setCompanyForm((current) => ({ ...current, condominiumUnitPrice: event.target.value }))} /></Field>
              <Field label="Cobranca VoIP"><select value={companyForm.voipBillingModel} onChange={(event) => setCompanyForm((current) => ({ ...current, voipBillingModel: event.target.value }))}><option value="PER_EXTENSION">Por ramal</option><option value="PACKAGE">Pacote de ramais</option><option value="DISABLED">Sem VoIP</option></select></Field>
              <Field label="Ramais incluidos"><input type="number" min="0" value={companyForm.includedExtensions} onChange={(event) => setCompanyForm((current) => ({ ...current, includedExtensions: event.target.value }))} /></Field>
              <Field label="Limite total de ramais"><input type="number" min="0" value={companyForm.maxExtensions} onChange={(event) => setCompanyForm((current) => ({ ...current, maxExtensions: event.target.value }))} /></Field>
              <Field label="Valor por ramal"><input type="number" min="0" step="0.01" value={companyForm.extensionUnitPrice} onChange={(event) => setCompanyForm((current) => ({ ...current, extensionUnitPrice: event.target.value }))} /></Field>
            </div>
            <div className="module-license-grid">
              {data.resources.map((resource) => (
                <label className="module-license-option" key={resource.id}>
                  <input
                    type="checkbox"
                    checked={companyForm.resourceIds.includes(resource.id)}
                    onChange={(event) => setCompanyForm((current) => ({
                      ...current,
                      resourceIds: event.target.checked
                        ? [...new Set([...current.resourceIds, resource.id])]
                        : current.resourceIds.filter((id) => id !== resource.id)
                    }))}
                  />
                  <span><strong>{resource.name}</strong><small>{resource.group}</small></span>
                </label>
              ))}
            </div>
            <div className="form-actions">
              <button type="submit"><Save size={16} /> Salvar empresa e plano</button>
              {companyForm.id && <button className="secondary-button" type="button" onClick={() => setCompanyForm(emptyCompanyForm)}>Cancelar edicao</button>}
            </div>
          </form>

          <article className="panel">
            <div className="panel-heading"><h2>Empresas clientes</h2><span className="toolbar-note">{data.companies.length} cadastrada(s)</span></div>
            <div className="company-card-grid">
              {data.companies.map((company) => {
                const companyCondos = data.condominiums.filter((condo) => condo.companyId === company.id);
                const allocatedExtensions = data.licenses.filter((license) => license.companyId === company.id && license.active !== false).reduce((total, license) => total + Number(license.extensionLimit || 0), 0);
                return (
                  <article className="company-plan-card" key={company.id}>
                    <header><strong>{company.name}</strong><em>{company.status === "INACTIVE" ? "Inativa" : "Ativa"}</em></header>
                    <span>Login: <strong>{company.login || "-"}</strong></span>
                    <span>Condominios: <strong>{companyCondos.length}/{company.maxCondominiums}</strong></span>
                    <span>Modulos contratados: <strong>{company.resourceIds?.length || 0}</strong></span>
                    <span>VoIP: <strong>{company.voipBillingModel === "PACKAGE" ? "Pacote" : company.voipBillingModel === "DISABLED" ? "Desativado" : "Por ramal"}</strong></span>
                    <span>Ramais: <strong>{allocatedExtensions}/{company.maxExtensions || "sem teto"}</strong></span>
                    <span>Mensalidade base: <strong>R$ {Number(company.baseMonthlyPrice || 0).toFixed(2)}</strong></span>
                    <button className="secondary-button" type="button" onClick={() => setCompanyForm({
                      ...emptyCompanyForm,
                      ...company,
                      maxCondominiums: String(company.maxCondominiums || 1),
                      baseMonthlyPrice: String(company.baseMonthlyPrice || 0),
                      condominiumUnitPrice: String(company.condominiumUnitPrice || 0),
                      includedExtensions: String(company.includedExtensions || 0),
                      maxExtensions: String(company.maxExtensions || 0),
                      extensionUnitPrice: String(company.extensionUnitPrice || 0),
                      resourceIds: company.resourceIds || []
                    })}>Editar contrato</button>
                  </article>
                );
              })}
              {!data.companies.length && <div className="empty-state">Cadastre a primeira empresa cliente e defina o pacote comercial.</div>}
            </div>
          </article>
        </section>
      );
    }

    return <SdkPage manufacturerProfiles={data.manufacturerProfiles} />;
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
  const primarySections = showCondoMenu ? roleSections.filter((section) => section.id !== "condominiums") : roleSections;

  return (
    <AppShell
      notifications={{ incomingCall, incomingCallTenant, incomingCallUnit, rejectIncomingCall, answerCall, message, supportAlert, setSupportAlert, disconnectedDevices, openDisconnectedDevices: () => { setActiveSection("devices"); setDeviceTab("painel"); } }}
      sidebar={{ session, sessionCompany, primarySections, allowedSettingsSections, condoSections, showCondoMenu, selectedTenant, activeSection, setActiveSection, setResourceTab, setDeviceTab, navigateTo }}
      header={{ activeSection, ActiveIcon, topbarLabel, setActiveSection, syncNow, logout }}
      syncState={syncState}
    >
      {renderContent()}
    </AppShell>
  );
}

export default App;
