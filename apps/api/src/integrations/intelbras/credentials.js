import { INTELBRAS_SS_3532_MF_W_ADAPTER } from "./ss3532Mfw.js";

function unsupportedIntelbrasCredentialResult(device = {}, credential = {}, {
  adapter = INTELBRAS_SS_3532_MF_W_ADAPTER,
  action = "envio",
  normalizeType = (type) => String(type || "APP").toUpperCase()
} = {}) {
  const type = normalizeType(credential.type);
  const isQr = type === "QR_CODE";
  return {
    ok: false,
    deviceId: device.id,
    adapter,
    message: isQr
      ? `QR Code Intelbras Bio-T ainda depende do conector CACO/API autorizado para ${action} fisico`
      : `Credencial ${type} Intelbras ainda depende do conector CACO/API autorizado para ${action} fisico`,
    attempts: []
  };
}

async function sendIntelbrasStoredCredential(device, credential = {}, deps = {}) {
  return unsupportedIntelbrasCredentialResult(device, credential, {
    adapter: deps.adapter,
    normalizeType: deps.normalizeType,
    action: "cadastro"
  });
}

async function deleteIntelbrasStoredCredential(device, credential = {}, deps = {}) {
  return unsupportedIntelbrasCredentialResult(device, credential, {
    adapter: deps.adapter,
    normalizeType: deps.normalizeType,
    action: "exclusao"
  });
}

export {
  deleteIntelbrasStoredCredential,
  sendIntelbrasStoredCredential
};
