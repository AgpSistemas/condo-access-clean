export const AXIS_VAPIX_PACS_ADAPTER = "AXIS_VAPIX_PACS";

export function matchesAxisVapix(device = {}) {
  return String(device.manufacturer || "").toLowerCase().includes("axis") &&
    (device.category === "access-control" || /a1001|a1601|a1610|a1710|i8016/i.test(String(device.model || "")));
}

export async function testAxisVapix(device, { requestDevice }) {
  const result = await requestDevice(device, "/vapix/pacs", {
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({ "axtdc:GetDoorList": {} }),
    timeoutMs: 10000
  });
  return { ...result, matchedEndpoint: "/vapix/pacs axtdc:GetDoorList" };
}

export async function openAxisVapixDoor(device, action = {}, { requestDevice }) {
  const token = String(action.route || action.doorToken || device.doorToken || "").trim();
  if (!token) throw new Error("Informe o token VAPIX da porta no campo rota do acionamento");
  return requestDevice(device, "/vapix/pacs", {
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({ "tdc:AccessDoor": { Token: token } }),
    timeoutMs: 10000
  });
}

