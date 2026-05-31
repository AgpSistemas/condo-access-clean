/**
 * Contrato do softphone nativo do APK.
 *
 * No Android real, este modulo deve ser implementado com PJSIP, Linphone SDK
 * ou outro SDK SIP nativo. O JavaScript nunca deve guardar regra de registro
 * alem de repassar a configuracao recebida da API.
 */

export function mapApiTelephonyToNativeAccount(unitTelephony) {
  const config = unitTelephony?.telephony || unitTelephony || {};
  return {
    enabled: config.enabled !== false,
    domain: config.sipDomain,
    webSocketUrl: config.sipWebSocketUrl,
    outboundProxy: config.sipOutboundProxy || "",
    transport: config.sipTransport || "UDP",
    username: config.extension,
    authUser: config.extension,
    password: config.extensionPassword,
    displayName: `Unidade ${unitTelephony?.unitNumber || config.extension}`,
    porterExtension: config.porterExtension,
    autoRegister: true,
    registrationExpiresSeconds: 300
  };
}

export function selectUnitTelephony(units, unitId) {
  if (!Array.isArray(units) || units.length === 0) return null;
  return units.find((unit) => unit.unitId === unitId || unit.unitNumber === unitId) || units[0];
}

export class NativeSoftphone {
  constructor(nativeModule) {
    this.nativeModule = nativeModule;
  }

  register(unitTelephony) {
    return this.nativeModule.registerAccount(mapApiTelephonyToNativeAccount(unitTelephony));
  }

  registerSelectedUnit(units, unitId) {
    const selectedUnit = selectUnitTelephony(units, unitId);
    if (!selectedUnit) return Promise.reject(new Error("Nenhuma unidade disponivel para registro SIP"));
    return this.register(selectedUnit);
  }

  unregister() {
    return this.nativeModule.unregister();
  }

  callPorter(unitTelephony) {
    const account = mapApiTelephonyToNativeAccount(unitTelephony);
    return this.nativeModule.call(account.porterExtension);
  }

  answer() {
    return this.nativeModule.answer();
  }

  hangup() {
    return this.nativeModule.hangup();
  }
}
