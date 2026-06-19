const { deviceBaseUrl, deviceHttp, postJson } = require("../lib/deviceHttp.cjs");

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
    await deviceHttp({
      device,
      request: {
        method: "PUT",
        path: `/ISAPI/AccessControl/RemoteControl/door/${relay}`,
        contentType: "application/xml",
        body: "<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>",
        timeoutMs: 12000
      }
    });
    return { ok: true, message: `Hikvision acionada no rele ${relay}` };
  }

  if (manufacturer.includes("intelbras")) {
    await deviceHttp({
      device,
      request: {
        method: "GET",
        path: `/cgi-bin/accessControl.cgi?action=openDoor&channel=${relay}`,
        timeoutMs: 12000
      }
    });
    return { ok: true, message: `Intelbras acionada no rele ${relay}` };
  }

  throw new Error(`Fabricante ${device.manufacturer || "desconhecido"} ainda nao suportado pelo Gateway`);
}

module.exports = { openDoor };
