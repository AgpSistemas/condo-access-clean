export const DAHUA_ACCESS_CGI_ADAPTER = "DAHUA_ACCESS_CGI";

export function matchesDahuaAccess(device = {}) {
  const manufacturer = String(device.manufacturer || "").toLowerCase();
  const model = String(device.model || "").toLowerCase();
  return manufacturer.includes("dahua") && (device.category === "access-control" || /asi|asc/.test(model));
}

export async function testDahuaAccess(device, { tryHttpCandidates, checkTcpDevice }) {
  try {
    return await tryHttpCandidates(device, [
      { label: "Tipo do dispositivo", path: "/cgi-bin/magicBox.cgi?action=getDeviceType" },
      { label: "Versao de software", path: "/cgi-bin/magicBox.cgi?action=getSoftwareVersion" },
      { label: "Configuracao de acesso", path: "/cgi-bin/configManager.cgi?action=getConfig&name=AccessControl" }
    ], 10000);
  } catch (error) {
    const tcp = await checkTcpDevice(device);
    if (!tcp.online) throw error;
    return { ok: true, status: 200, partial: true, attempts: error?.attempts || [], body: "TCP online; CGI precisa ser habilitado ou autenticado." };
  }
}

export async function openDahuaAccessDoor(device, relay = 1, { requestDevice }) {
  return requestDevice(device, `/cgi-bin/accessControl.cgi?action=openDoor&channel=${Number(relay || 1)}`, {
    method: "GET",
    timeoutMs: 10000
  });
}

