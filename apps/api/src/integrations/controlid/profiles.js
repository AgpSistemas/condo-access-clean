const CONTROL_ID_ACCESS_ADAPTER = "CONTROL_ID_ACCESS";

const CONTROL_ID_MODEL_PROFILES = [
  {
    model: "iDAccess",
    aliases: ["idaccess"],
    actions: ["door"],
    defaultAction: "door",
    maxDoor: 2,
    features: ["RFID", "PIN", "BIOMETRIA"]
  },
  {
    model: "iDAccess Pro",
    aliases: ["idaccesspro"],
    actions: ["sec_box"],
    defaultAction: "sec_box",
    features: ["RFID", "PIN", "BIOMETRIA"]
  },
  {
    model: "iDAccess Nano",
    aliases: ["idaccessnano"],
    actions: ["sec_box"],
    defaultAction: "sec_box",
    features: ["RFID", "PIN", "BIOMETRIA"]
  },
  {
    model: "iDFit",
    aliases: ["idfit"],
    actions: ["door"],
    defaultAction: "door",
    maxDoor: 2,
    features: ["RFID", "PIN", "BIOMETRIA"]
  },
  {
    model: "iDFlex",
    aliases: ["idflex"],
    actions: ["sec_box"],
    defaultAction: "sec_box",
    features: ["RFID", "PIN", "BIOMETRIA"]
  },
  {
    model: "iDBlock",
    aliases: ["idblock", "idblocknext"],
    actions: ["catra", "open_collector"],
    defaultAction: "catra",
    features: ["RFID", "PIN", "BIOMETRIA", "CATRACA"]
  },
  {
    model: "iDBox",
    aliases: ["idbox"],
    actions: ["door"],
    defaultAction: "door",
    maxDoor: 4,
    features: ["RFID", "PIN"]
  },
  {
    model: "iDUHF",
    aliases: ["iduhf"],
    actions: ["door", "sec_box"],
    defaultAction: "door",
    maxDoor: 1,
    features: ["RFID", "UHF_TAG"],
    uhf: true
  },
  {
    model: "iDFace",
    aliases: ["idface", "idfacelite", "idfacepro"],
    actions: ["sec_box"],
    defaultAction: "sec_box",
    features: ["FACE", "RFID", "QR_CODE", "PIN"]
  },
  {
    model: "iDFace Max",
    aliases: ["idfacemax"],
    actions: ["door", "sec_box"],
    defaultAction: "door",
    maxDoor: 1,
    features: ["FACE", "RFID", "QR_CODE", "PIN"]
  }
];

function normalizedText(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isControlIdDevice(device = {}) {
  const manufacturer = normalizedText(device.manufacturer);
  return manufacturer.includes("controlid") || manufacturer === "control";
}

function controlIdProfileForModel(model = "") {
  const normalizedModel = normalizedText(model);
  if (!normalizedModel) return null;
  return CONTROL_ID_MODEL_PROFILES.find((profile) =>
    profile.aliases.includes(normalizedModel) || normalizedText(profile.model) === normalizedModel
  ) || null;
}

function matchesControlIdDevice(device = {}) {
  return isControlIdDevice(device) && Boolean(controlIdProfileForModel(device.model));
}

function submittedValue(device = {}, existing = {}, key) {
  return Object.prototype.hasOwnProperty.call(device, key) ? device[key] : existing[key];
}

function controlIdDeviceDefaults(device = {}, existing = {}) {
  const profile = controlIdProfileForModel(device.model || existing.model);
  if (!profile) return {};

  const requestedAction = String(
    submittedValue(device, existing, "controlIdAction") || profile.defaultAction
  ).trim();
  const controlIdAction = requestedAction || profile.defaultAction;
  const submittedSecBoxId = submittedValue(device, existing, "controlIdSecBoxId");
  const submittedGroupId = submittedValue(device, existing, "controlIdGroupId");

  return {
    category: "access-control",
    manufacturer: "Control iD",
    model: profile.model,
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
    controlIdUhfMode: profile.uhf
      ? device.controlIdUhfMode || existing.controlIdUhfMode || "EXTENDED"
      : "STANDARD",
    intercomEnabled: profile.model.startsWith("iDFace")
      ? Boolean(submittedValue(device, existing, "intercomEnabled"))
      : false,
    intercomType: profile.model.startsWith("iDFace") ? "FACIAL" : profile.uhf ? "UHF" : "ACCESS"
  };
}

function positiveInteger(value = "") {
  return /^[1-9]\d*$/.test(String(value || "").trim());
}

function safePositiveInteger(value = "") {
  if (!positiveInteger(value)) return false;
  return BigInt(String(value).trim()) <= BigInt(Number.MAX_SAFE_INTEGER);
}

function validateControlIdConfiguration(device = {}) {
  const errors = [];
  const profile = controlIdProfileForModel(device.model);
  if (!profile) {
    errors.push(`Modelo Control iD nao suportado: ${device.model || "nao informado"}`);
    return { ok: false, errors };
  }

  const action = String(device.controlIdAction || profile.defaultAction).trim();
  const secBoxId = String(device.controlIdSecBoxId || "").trim();
  const groupId = String(device.controlIdGroupId || "").trim();

  if (!profile.actions.includes(action)) {
    errors.push(`O modelo ${profile.model} aceita somente: ${profile.actions.join(", ")}`);
  }
  if (action === "sec_box" && !positiveInteger(secBoxId)) {
    errors.push(`Informe o ID numerico do SecBox/MAE para usar o acionamento do ${profile.model}`);
  }
  if (groupId && !safePositiveInteger(groupId)) {
    errors.push("O ID do grupo de acesso Control iD deve ser um numero inteiro positivo suportado pela integracao");
  }

  return { ok: errors.length === 0, errors };
}

function controlIdActionParameters(device = {}, relay = 1) {
  const profile = controlIdProfileForModel(device.model);
  const action = String(device.controlIdAction || profile?.defaultAction || "door").trim();

  if (profile && !profile.actions.includes(action)) {
    throw new Error(`Acionamento ${action} nao e suportado pelo modelo ${profile.model}`);
  }
  if (action === "sec_box") {
    const secBoxId = String(device.controlIdSecBoxId || "").trim();
    if (!positiveInteger(secBoxId)) {
      throw new Error("ID do SecBox/MAE nao configurado para este equipamento Control iD");
    }
    return { action, parameters: `id=${secBoxId}, reason=3` };
  }
  if (action === "catra") {
    const selectedRelay = Math.max(1, Math.min(2, Number(relay) || 1));
    return { action, parameters: `relay=${selectedRelay}` };
  }
  if (action === "open_collector") {
    return { action, parameters: "" };
  }

  const maxDoor = profile?.maxDoor || Number.MAX_SAFE_INTEGER;
  const door = Math.max(1, Math.min(maxDoor, Number(relay) || 1));
  return { action: "door", parameters: `door=${door}` };
}

function publicControlIdProfiles() {
  return CONTROL_ID_MODEL_PROFILES.map(({ aliases, ...profile }) => ({ ...profile }));
}

export {
  CONTROL_ID_ACCESS_ADAPTER,
  CONTROL_ID_MODEL_PROFILES,
  controlIdActionParameters,
  controlIdDeviceDefaults,
  controlIdProfileForModel,
  isControlIdDevice,
  matchesControlIdDevice,
  publicControlIdProfiles,
  validateControlIdConfiguration
};
