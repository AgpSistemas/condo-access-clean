const CONTROL_ID_IDUHF_MODEL = "iDUHF";
const CONTROL_ID_IDUHF_ACTIONS = ["door", "sec_box"];

function digitsOnly(value = "") {
  return /^[1-9]\d*$/.test(String(value || "").trim());
}

function safePositiveInteger(value = "") {
  if (!digitsOnly(value)) return false;
  return BigInt(String(value).trim()) <= BigInt(Number.MAX_SAFE_INTEGER);
}

function submittedValue(device = {}, existing = {}, key) {
  return Object.prototype.hasOwnProperty.call(device, key) ? device[key] : existing[key];
}

function matchesControlIdIduhf(device = {}) {
  const manufacturer = String(device.manufacturer || "").trim().toLowerCase();
  const model = String(device.model || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  return (manufacturer.includes("control") || manufacturer.includes("controlid")) && model === "iduhf";
}

function controlIdIduhfDefaults(device = {}, existing = {}) {
  const requestedAction = String(device.controlIdAction || existing.controlIdAction || "door").trim();
  const controlIdAction = requestedAction || "door";
  const submittedSecBoxId = submittedValue(device, existing, "controlIdSecBoxId");
  const submittedGroupId = submittedValue(device, existing, "controlIdGroupId");
  return {
    category: "access-control",
    manufacturer: "Control iD",
    model: CONTROL_ID_IDUHF_MODEL,
    apiProtocol: device.apiProtocol || existing.apiProtocol || "http",
    apiPort: Number(device.apiPort || existing.apiPort || 80),
    rtspPort: 0,
    channelCount: 0,
    username: device.username || existing.username || "admin",
    controlIdAction,
    controlIdSecBoxId: controlIdAction === "sec_box"
      ? String(submittedSecBoxId || "").trim()
      : "",
    controlIdGroupId: String(submittedGroupId || "").trim(),
    controlIdUhfMode: device.controlIdUhfMode || existing.controlIdUhfMode || "EXTENDED",
    intercomEnabled: false,
    intercomType: "UHF"
  };
}

function validateControlIdIduhfConfiguration(device = {}) {
  const errors = [];
  const action = String(device.controlIdAction || "door").trim();
  const secBoxId = String(device.controlIdSecBoxId || "").trim();
  const groupId = String(device.controlIdGroupId || "").trim();

  if (!CONTROL_ID_IDUHF_ACTIONS.includes(action)) {
    errors.push("O iDUHF aceita somente rele interno (door) ou modulo externo SecBox (sec_box)");
  }
  if (action === "sec_box" && !digitsOnly(secBoxId)) {
    errors.push("Informe o ID numerico do SecBox/MAE para usar o rele externo do iDUHF");
  }
  if (groupId && !safePositiveInteger(groupId)) {
    errors.push("O ID do grupo de acesso Control iD deve ser um numero inteiro positivo suportado pela integracao");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export {
  CONTROL_ID_IDUHF_ACTIONS,
  CONTROL_ID_IDUHF_MODEL,
  controlIdIduhfDefaults,
  matchesControlIdIduhf,
  validateControlIdIduhfConfiguration
};
