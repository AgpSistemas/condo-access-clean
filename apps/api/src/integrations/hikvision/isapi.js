export const HIKVISION_ISAPI_ADAPTER = "HIKVISION_ISAPI";

export const HIKVISION_ACCESS_MODELS = [
  "DS-K1T342MWX",
  "DS-K1T Series",
  "DS-K1A Series",
  "DS-K260 Series",
  "DS-K280 Series",
  "DS-K1H Series",
  "DS-KV/DS-KD Intercom"
];

export function matchesHikvisionIsapi(device = {}) {
  return String(device.manufacturer || "").toLowerCase().includes("hikvision");
}

export function hikvisionIsapiDefaults(body = {}, existingDevice = null) {
  return {
    category: body.category || existingDevice?.category || "access-control",
    model: body.model || existingDevice?.model || "DS-K1T342MWX",
    apiProtocol: body.apiProtocol || existingDevice?.apiProtocol || "http",
    apiPort: Number(body.apiPort || existingDevice?.apiPort || 80),
    rtspPort: Number(body.rtspPort || existingDevice?.rtspPort || 554),
    intercomEnabled: body.intercomEnabled === undefined ? true : Boolean(body.intercomEnabled),
    intercomType: body.intercomType || existingDevice?.intercomType || "FACIAL"
  };
}

export async function testHikvisionIsapi(device, { requestDevice }) {
  return requestDevice(device, "/ISAPI/System/deviceInfo", { method: "GET" });
}

export async function openHikvisionIsapiDoor(device, relay = 1, { requestDevice }) {
  return requestDevice(device, `/ISAPI/AccessControl/RemoteControl/door/${Number(relay || 1)}`, {
    method: "PUT",
    body: "<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>"
  });
}

