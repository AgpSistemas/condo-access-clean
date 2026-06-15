import {
  controlIdDeviceDefaults,
  validateControlIdConfiguration
} from "./profiles.js";

const CONTROL_ID_IDUHF_MODEL = "iDUHF";
const CONTROL_ID_IDUHF_ACTIONS = ["door", "sec_box"];

function matchesControlIdIduhf(device = {}) {
  const manufacturer = String(device.manufacturer || "").trim().toLowerCase();
  const model = String(device.model || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  return (manufacturer.includes("control") || manufacturer.includes("controlid")) && model === "iduhf";
}

function controlIdIduhfDefaults(device = {}, existing = {}) {
  return controlIdDeviceDefaults({ ...device, model: CONTROL_ID_IDUHF_MODEL }, existing);
}

function validateControlIdIduhfConfiguration(device = {}) {
  return validateControlIdConfiguration({ ...device, model: CONTROL_ID_IDUHF_MODEL });
}

export {
  CONTROL_ID_IDUHF_ACTIONS,
  CONTROL_ID_IDUHF_MODEL,
  controlIdIduhfDefaults,
  matchesControlIdIduhf,
  validateControlIdIduhfConfiguration
};
