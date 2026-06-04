export const INTELBRAS_MHDX_3116C_ADAPTER = "INTELBRAS_HTTP_RTSP";

export function matchesMhdx3116c(device = {}) {
  const manufacturer = String(device.manufacturer || "").toLowerCase();
  const model = String(device.model || device.deviceType || device.type || "").toLowerCase();
  return manufacturer.includes("intelbras") && (
    model.includes("mhdx 3116-c") ||
    model.includes("mhdx 3116") ||
    model.includes("mhdx") ||
    device.category === "cameras"
  );
}

export function mhdx3116cDefaults(body = {}, existingDevice = null) {
  return {
    category: body.category || existingDevice?.category || "cameras",
    model: body.model || existingDevice?.model || "MHDX 3116-C",
    apiPort: Number(body.apiPort || existingDevice?.apiPort || 80),
    rtspPort: Number(body.rtspPort || existingDevice?.rtspPort || 554),
    channelCount: Number(body.channelCount || existingDevice?.channelCount || 16),
    intercomEnabled: false
  };
}

export function mhdx3116cRtspPath(camera = {}) {
  const channel = Number(camera.channel || camera.activeChannels?.[0]?.channel || 1);
  const isSubStream = String(camera.stream || "MAIN").toUpperCase() === "SUB";
  return `/cam/realmonitor?channel=${channel}&subtype=${isSubStream ? 1 : 0}`;
}

export async function testMhdx3116c(device, { tryHttpCandidates, checkTcpDevice }) {
  const candidates = [
    { label: "Hora atual", path: "/cgi-bin/global.cgi?action=getCurrentTime" },
    { label: "Tipo do dispositivo", path: "/cgi-bin/magicBox.cgi?action=getDeviceType" },
    { label: "Sistema", path: "/cgi-bin/magicBox.cgi?action=getSystemInfoNew" },
    { label: "Sistema legado", path: "/cgi-bin/magicBox.cgi?action=getSystemInfo" },
    { label: "Fabricante", path: "/cgi-bin/magicBox.cgi?action=getVendor" },
    { label: "Eventos expostos", path: "/cgi-bin/eventManager.cgi?action=getExposureEvents" }
  ];

  try {
    return await tryHttpCandidates(device, candidates);
  } catch (error) {
    const tcp = await checkTcpDevice(device);
    if (tcp.online) {
      return {
        ok: true,
        status: 200,
        partial: true,
        attempts: error?.attempts || [],
        body: `Conexao TCP OK. CGI Intelbras MHDX nao confirmou dados: ${error instanceof Error ? error.message : "falha desconhecida"}`
      };
    }
    throw error;
  }
}

