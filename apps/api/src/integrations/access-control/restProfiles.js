const profiles = [
  {
    id: "hikvision-isapi",
    adapter: "HIKVISION_ISAPI",
    manufacturer: "Hikvision",
    aliases: ["hikvision"],
    models: ["DS-K1T", "DS-K1A", "DS-K260", "DS-K280", "DS-K1H", "DS-KV", "DS-KD"],
    integrationMode: "DIRECT_DEVICE",
    protocols: ["HTTP/ISAPI", "RTSP", "SIP"],
    capabilities: ["diagnostics", "door", "users", "cards", "faces", "events"],
    defaultPort: 80,
    notes: "ISAPI direto no equipamento. Recursos variam conforme firmware e modelo."
  },
  {
    id: "intelbras-biot-cgi",
    adapter: "INTELBRAS_BIOT_CGI",
    manufacturer: "Intelbras",
    aliases: ["intelbras"],
    models: ["SS 3530", "SS 3532", "SS 3540", "SS 3542", "SS 3430", "Bio-T", "CT 500"],
    integrationMode: "DIRECT_DEVICE",
    protocols: ["HTTP/CGI", "RTSP", "SIP"],
    capabilities: ["diagnostics", "door", "users", "cards", "faces", "events"],
    defaultPort: 80,
    notes: "CGI direto nos terminais e controladoras compatíveis."
  },
  {
    id: "dahua-access-cgi",
    adapter: "DAHUA_ACCESS_CGI",
    manufacturer: "Dahua",
    aliases: ["dahua"],
    models: ["ASI", "ASC", "DHI-ASI", "DHI-ASC"],
    integrationMode: "DIRECT_DEVICE",
    protocols: ["HTTP/CGI", "RTSP", "SIP"],
    capabilities: ["diagnostics", "door", "events"],
    defaultPort: 80,
    notes: "CGI direto em terminais ASI e controladoras ASC compatíveis."
  },
  {
    id: "axis-vapix-pacs",
    adapter: "AXIS_VAPIX_PACS",
    manufacturer: "Axis",
    aliases: ["axis"],
    models: ["A1001", "A1601", "A1610", "A1710", "I8016-LVE"],
    integrationMode: "DIRECT_DEVICE",
    protocols: ["HTTP/VAPIX PACS", "RTSP", "SIP"],
    capabilities: ["diagnostics", "door", "users", "credentials", "events"],
    defaultPort: 80,
    notes: "VAPIX Physical Access Control direto. A abertura requer o token da porta."
  },
  {
    id: "suprema-biostar-rest",
    adapter: "SUPREMA_BIOSTAR_REST",
    manufacturer: "Suprema",
    aliases: ["suprema", "biostar"],
    models: ["BioStar 2", "BioStar X", "BioStation", "FaceStation", "CoreStation", "BioEntry"],
    integrationMode: "SERVER_REST",
    protocols: ["HTTPS/REST"],
    capabilities: ["diagnostics", "doors", "users", "faces", "cards", "events"],
    defaultPort: 443,
    notes: "REST via servidor BioStar 2/BioStar X. Nao e acesso REST direto ao terminal."
  }
];

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

export function resolveRestAccessProfile(device = {}) {
  const manufacturer = normalized(device.manufacturer);
  const model = normalized(device.model);
  return profiles.find((profile) =>
    profile.aliases.some((alias) => manufacturer.includes(alias)) &&
    (!model || profile.models.some((candidate) => model.includes(normalized(candidate))))
  ) || profiles.find((profile) => profile.aliases.some((alias) => manufacturer.includes(alias))) || null;
}

export function restAccessDefaults(body = {}, existingDevice = null) {
  const profile = resolveRestAccessProfile({ ...existingDevice, ...body });
  if (!profile) return {};
  return {
    category: body.category || existingDevice?.category || "access-control",
    model: body.model || existingDevice?.model || profile.models[0],
    apiProtocol: body.apiProtocol || existingDevice?.apiProtocol || (profile.integrationMode === "SERVER_REST" ? "https" : "http"),
    apiPort: Number(body.apiPort || existingDevice?.apiPort || profile.defaultPort),
    rtspPort: Number(body.rtspPort || existingDevice?.rtspPort || (profile.integrationMode === "SERVER_REST" ? 0 : 554)),
    channelCount: Number(body.channelCount || existingDevice?.channelCount || 0),
    authMode: body.authMode || existingDevice?.authMode || (profile.adapter === "SUPREMA_BIOSTAR_REST" ? "SESSION" : "DIGEST"),
    integrationMode: profile.integrationMode,
    doorToken: body.doorToken ?? existingDevice?.doorToken ?? ""
  };
}

export function publicRestAccessProfiles() {
  return profiles.map((profile) => ({ ...profile }));
}

