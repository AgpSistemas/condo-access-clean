const { deviceBaseUrl, digestHeader, postJson } = require("../lib/deviceHttp.cjs");

async function openDoor(command) {
  const device = command.device || {};
  const manufacturer = String(device.manufacturer || "").toLowerCase();
  const relay = Number(command.relay || device.doorRelay || 1);
  const baseUrl = deviceBaseUrl(device);

  if (manufacturer.includes("control")) {
    const login = await postJson(`${baseUrl}/login.fcgi`, {
      login: device.username || "admin",
      password: device.password || "admin"
    });
    const action = device.controlIdAction || device.openDoorAction || "door";
    const parameters = action === "sec_box"
      ? `id=${device.controlIdSecBoxId || 65792 + relay}, reason=3`
      : `door=${relay}`;
    await postJson(`${baseUrl}/execute_actions.fcgi?session=${encodeURIComponent(String(login.session))}`, {
      actions: [{ action, parameters }]
    });
    return { ok: true, message: `Control iD acionado no rele ${relay}` };
  }

  if (manufacturer.includes("hikvision")) {
    const url = `${baseUrl}/ISAPI/AccessControl/RemoteControl/door/${relay}`;
    const headers = await digestHeader(url, "PUT", device.username || "admin", device.password || "");
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/xml", ...headers },
      body: "<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>",
      signal: AbortSignal.timeout(12000)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Hikvision respondeu ${response.status}: ${text.slice(0, 300)}`);
    return { ok: true, message: `Hikvision acionada no rele ${relay}` };
  }

  if (manufacturer.includes("intelbras")) {
    const url = `${baseUrl}/cgi-bin/accessControl.cgi?action=openDoor&channel=${relay}`;
    const headers = await digestHeader(url, "GET", device.username || "admin", device.password || "");
    const response = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(12000) });
    const text = await response.text();
    if (!response.ok) throw new Error(`Intelbras respondeu ${response.status}: ${text.slice(0, 300)}`);
    return { ok: true, message: `Intelbras acionada no rele ${relay}` };
  }

  throw new Error(`Fabricante ${device.manufacturer || "desconhecido"} ainda nao suportado pelo Gateway`);
}

module.exports = { openDoor };
