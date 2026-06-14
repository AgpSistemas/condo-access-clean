/**
 * Contrato do softphone nativo do APK.
 *
 * No Android real, este modulo deve ser implementado com PJSIP, Linphone SDK
 * ou outro SDK SIP nativo. O JavaScript nunca deve guardar regra de registro
 * alem de repassar a configuracao recebida da API.
 */

export function mapApiTelephonyToNativeAccount(unitTelephony) {
  const config = unitTelephony?.telephony || unitTelephony || {};
  const tenant = unitTelephony?.tenant || config.tenant || {};
  const sip = config.sip || {};
  const account = config.account || {};
  const extension = config.extension || account.extension || unitTelephony?.extension;
  return {
    enabled: config.enabled !== false,
    domain: config.sipDomain || sip.domain || tenant.sipDomain,
    webSocketUrl: config.sipWebSocketUrl || sip.webSocketUrl || tenant.sipWebSocketUrl,
    outboundProxy: config.sipOutboundProxy || sip.outboundProxy || "",
    transport: config.sipTransport || "UDP",
    username: extension,
    authUser: extension,
    password: config.extensionPassword || account.password || unitTelephony?.extensionPassword,
    displayName: account.displayName || `Unidade ${unitTelephony?.unitNumber || unitTelephony?.number || extension}`,
    porterExtension: config.porterExtension || sip.porterExtension || tenant.porterExtension,
    defaultAudioRoute: config.defaultAudioRoute || account.defaultAudioRoute || "EARPIECE",
    speakerphoneEnabled: Boolean(config.speakerphoneEnabled || account.speakerphoneEnabled),
    autoRegister: true,
    registrationExpiresSeconds: 300
  };
}

export function selectUnitTelephony(units, unitId, tenantId = "") {
  if (!Array.isArray(units) || units.length === 0) return null;
  const scopedUnits = tenantId ? units.filter((unit) => unit.tenantId === tenantId) : units;
  const candidates = scopedUnits.length ? scopedUnits : units;
  return candidates.find((unit) => unit.unitId === unitId) ||
    candidates.find((unit) => unit.unitNumber === unitId) ||
    candidates[0];
}

export class NativeSoftphone {
  constructor(nativeModule) {
    this.nativeModule = nativeModule;
    this.incomingCall = null;
    this.audioRoute = "EARPIECE";
    this.speakerphoneEnabled = false;
    this.listeners = {
      incomingCall: new Set(),
      callStateChanged: new Set(),
      audioRouteChanged: new Set()
    };
    this.nativeSubscriptions = [];
    this.bindNativeEvents();
  }

  bindNativeEvents() {
    if (!this.nativeModule) return;

    const bind = (eventName, handler) => {
      if (typeof this.nativeModule.addListener === "function") {
        const subscription = this.nativeModule.addListener(eventName, handler);
        if (subscription) this.nativeSubscriptions.push(subscription);
        return;
      }
      if (typeof this.nativeModule.on === "function") {
        this.nativeModule.on(eventName, handler);
      }
    };

    bind("incomingCall", (call) => this.handleIncomingCall(call));
    bind("callStateChanged", (state) => this.handleCallStateChanged(state));
    bind("audioRouteChanged", (state) => this.handleAudioRouteChanged(state));
  }

  emit(eventName, payload) {
    this.listeners[eventName]?.forEach((listener) => listener(payload));
  }

  onIncomingCall(listener) {
    this.listeners.incomingCall.add(listener);
    if (this.incomingCall) listener(this.incomingCall);
    return () => this.listeners.incomingCall.delete(listener);
  }

  onCallStateChange(listener) {
    this.listeners.callStateChanged.add(listener);
    return () => this.listeners.callStateChanged.delete(listener);
  }

  onAudioRouteChange(listener) {
    this.listeners.audioRouteChanged.add(listener);
    listener(this.getAudioRoute());
    return () => this.listeners.audioRouteChanged.delete(listener);
  }

  handleIncomingCall(call = {}) {
    this.incomingCall = {
      id: call.id || call.callId || `incoming-${Date.now()}`,
      from: call.from || call.remoteNumber || call.remoteUri || "",
      displayName: call.displayName || call.remoteName || call.from || "Chamada recebida",
      receivedAt: call.receivedAt || new Date().toISOString(),
      status: "RINGING",
      canAnswer: true,
      canReject: true,
      raw: call
    };
    this.emit("incomingCall", this.incomingCall);
    this.emit("callStateChanged", this.incomingCall);
    return this.incomingCall;
  }

  handleCallStateChanged(state = {}) {
    const status = state.status || state.state || "";
    if (status && this.incomingCall) {
      this.incomingCall = { ...this.incomingCall, ...state, status };
      if (["ENDED", "TERMINATED", "DISCONNECTED", "FAILED"].includes(String(status).toUpperCase())) {
        this.incomingCall = null;
      }
    }
    this.emit("callStateChanged", state);
  }

  handleAudioRouteChanged(state = {}) {
    const route = state.audioRoute || state.route || (state.speakerphoneEnabled ? "SPEAKER" : "EARPIECE");
    this.audioRoute = route === "SPEAKER" ? "SPEAKER" : "EARPIECE";
    this.speakerphoneEnabled = this.audioRoute === "SPEAKER";
    this.emit("audioRouteChanged", this.getAudioRoute());
  }

  getIncomingCall() {
    return this.incomingCall;
  }

  hasIncomingCall() {
    return Boolean(this.incomingCall?.canAnswer);
  }

  getAudioRoute() {
    return {
      audioRoute: this.audioRoute,
      speakerphoneEnabled: this.speakerphoneEnabled
    };
  }

  async setSpeakerphoneEnabled(enabled) {
    const speakerphoneEnabled = Boolean(enabled);
    this.speakerphoneEnabled = speakerphoneEnabled;
    this.audioRoute = speakerphoneEnabled ? "SPEAKER" : "EARPIECE";

    if (typeof this.nativeModule.setSpeakerphoneEnabled === "function") {
      await this.nativeModule.setSpeakerphoneEnabled(speakerphoneEnabled);
    } else if (typeof this.nativeModule.setSpeakerphoneOn === "function") {
      await this.nativeModule.setSpeakerphoneOn(speakerphoneEnabled);
    } else if (typeof this.nativeModule.setAudioRoute === "function") {
      await this.nativeModule.setAudioRoute(this.audioRoute);
    }

    const route = this.getAudioRoute();
    this.emit("audioRouteChanged", route);
    this.emit("callStateChanged", route);
    return route;
  }

  toggleSpeakerphone() {
    return this.setSpeakerphoneEnabled(!this.speakerphoneEnabled);
  }

  useEarpiece() {
    return this.setSpeakerphoneEnabled(false);
  }

  register(unitTelephony) {
    return this.nativeModule.registerAccount(mapApiTelephonyToNativeAccount(unitTelephony));
  }

  registerSelectedUnit(units, unitId, tenantId = "") {
    const selectedUnit = selectUnitTelephony(units, unitId, tenantId);
    if (!selectedUnit) return Promise.reject(new Error("Nenhuma unidade disponivel para registro SIP"));
    return this.register(selectedUnit);
  }

  unregister() {
    return this.nativeModule.unregister();
  }

  callPorter(unitTelephony) {
    const account = mapApiTelephonyToNativeAccount(unitTelephony);
    return this.callExtension(account.porterExtension);
  }

  callExtension(targetExtension) {
    const extension = String(targetExtension || "").trim();
    if (!extension) return Promise.reject(new Error("Ramal de destino nao informado"));
    return Promise.resolve(this.useEarpiece())
      .then(() => this.nativeModule.call(extension, {
        audioRoute: "EARPIECE",
        speakerphoneEnabled: false
      }));
  }

  answer() {
    const result = this.nativeModule.answer(this.incomingCall?.id);
    if (this.incomingCall) {
      this.incomingCall = { ...this.incomingCall, status: "IN_CALL", canAnswer: false, canReject: false };
      this.emit("callStateChanged", this.incomingCall);
    }
    void this.useEarpiece();
    return result;
  }

  answerIncomingCall() {
    return this.answer();
  }

  rejectIncomingCall() {
    const result = typeof this.nativeModule.reject === "function"
      ? this.nativeModule.reject(this.incomingCall?.id)
      : this.nativeModule.hangup(this.incomingCall?.id);
    this.incomingCall = null;
    this.emit("callStateChanged", { status: "REJECTED" });
    return result;
  }

  hangup() {
    const result = this.nativeModule.hangup(this.incomingCall?.id);
    this.incomingCall = null;
    this.emit("callStateChanged", { status: "ENDED" });
    return result;
  }

  dispose() {
    this.nativeSubscriptions.forEach((subscription) => {
      if (typeof subscription.remove === "function") subscription.remove();
      if (typeof subscription.unsubscribe === "function") subscription.unsubscribe();
    });
    this.nativeSubscriptions = [];
    this.listeners.incomingCall.clear();
    this.listeners.callStateChanged.clear();
    this.listeners.audioRouteChanged.clear();
  }
}
