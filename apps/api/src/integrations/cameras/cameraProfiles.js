const DEFAULT_STREAM_SETTINGS = {
  rtspTransport: "tcp",
  analyzeDuration: "1000000",
  probeSize: "1000000",
  snapshotScale: "640:-2",
  hlsVideoFilter: "scale=trunc(iw/2)*2:trunc(ih/2)*2",
  hlsTime: "1",
  hlsListSize: "3",
  hlsDeleteThreshold: "1",
  hlsFrameRate: "12",
  hlsKeyframeInterval: "12"
};

function clean(value) {
  return String(value || "").trim().toLowerCase();
}

function numericChannel(camera = {}) {
  return Math.max(1, Number(camera.channel || camera.activeChannels?.[0]?.channel || 1));
}

function streamName(camera = {}) {
  return String(camera.stream || "MAIN").toUpperCase() === "SUB" ? "SUB" : "MAIN";
}

function hikvisionRtspPath(camera = {}) {
  const channel = numericChannel(camera);
  const stream = streamName(camera) === "SUB" ? 2 : 1;
  return `/Streaming/channels/${channel}0${stream}`;
}

function dahuaStyleRtspPath(camera = {}) {
  const channel = numericChannel(camera);
  const subtype = streamName(camera) === "SUB" ? 1 : 0;
  return `/cam/realmonitor?channel=${channel}&subtype=${subtype}`;
}

function univiewRtspPath(camera = {}) {
  const channel = numericChannel(camera);
  const streamOffset = streamName(camera) === "SUB" ? 1 : 0;
  return `/media/video${channel + streamOffset}`;
}

function legacySdpRtspPath(camera = {}) {
  const channel = numericChannel(camera);
  const stream = streamName(camera) === "SUB" ? 1 : 0;
  return `/user=${encodeURIComponent(camera.username || "admin")}_password=${encodeURIComponent(camera.password || "")}_channel=${channel}_stream=${stream}.sdp`;
}

export const CAMERA_PROFILES = [
  {
    id: "hikvision-isapi-rtsp",
    name: "Hikvision ISAPI/RTSP",
    aliases: ["hikvision", "hikvisioncloud"],
    defaultStream: "SUB",
    defaultChannelCount: 16,
    rtspPath: hikvisionRtspPath,
    streamSettings: {
      snapshotScale: "640:-2",
      hlsVideoFilter: "scale=trunc(iw/2)*2:trunc(ih/2)*2"
    }
  },
  {
    id: "intelbras-dahua-rtsp",
    name: "Intelbras/Dahua HTTP RTSP",
    aliases: ["intelbras", "dahua"],
    defaultStream: "SUB",
    defaultChannelCount: 16,
    rtspPath: dahuaStyleRtspPath,
    streamSettings: {
      snapshotScale: "640:-2",
      hlsVideoFilter: "scale=trunc(iw/2)*2:trunc(ih/2)*2"
    }
  },
  {
    id: "uniview-rtsp",
    name: "Uniview RTSP",
    aliases: ["uniview", "univiewcloud"],
    defaultStream: "SUB",
    defaultChannelCount: 16,
    rtspPath: univiewRtspPath,
    streamSettings: {
      snapshotScale: "640:-2"
    }
  },
  {
    id: "cloud-oem-dahua-rtsp",
    name: "OEM Cloud DVR RTSP",
    aliases: ["motorola", "motorolacloud", "tecvoz", "tecvozcloud"],
    defaultStream: "SUB",
    defaultChannelCount: 16,
    rtspPath: dahuaStyleRtspPath,
    streamSettings: {
      snapshotScale: "640:-2"
    }
  },
  {
    id: "legacy-sdp-rtsp",
    name: "DVR legado SDP",
    aliases: ["anko", "trx", "masterdigital", "master digital"],
    defaultStream: "SUB",
    defaultChannelCount: 16,
    rtspPath: legacySdpRtspPath,
    streamSettings: {
      snapshotScale: "640:-2"
    }
  },
  {
    id: "onvif-hikvision-compatible",
    name: "ONVIF/RTSP compativel",
    aliases: ["onvif", "rtsp generico", "generico", "generic"],
    defaultStream: "SUB",
    defaultChannelCount: 1,
    rtspPath: hikvisionRtspPath,
    streamSettings: {
      snapshotScale: "640:-2"
    }
  }
];

export function resolveCameraProfile(camera = {}) {
  const manufacturer = clean(camera.manufacturer);
  const profileId = clean(camera.cameraProfile || camera.profileId || camera.adapter);
  return CAMERA_PROFILES.find((profile) => clean(profile.id) === profileId) ||
    CAMERA_PROFILES.find((profile) => profile.aliases.some((alias) => manufacturer.includes(alias))) ||
    CAMERA_PROFILES.at(-1);
}

export function cameraRtspPathFromProfile(camera = {}) {
  if (camera.rtspPath) return String(camera.rtspPath);
  return resolveCameraProfile(camera).rtspPath(camera);
}

export function cameraStreamSettings(camera = {}) {
  const profile = resolveCameraProfile(camera);
  return {
    ...DEFAULT_STREAM_SETTINGS,
    ...(profile.streamSettings || {}),
    ...(camera.streamSettings || {})
  };
}

export function applyCameraProfileDefaults(camera = {}) {
  const profile = resolveCameraProfile(camera);
  return {
    ...camera,
    cameraProfile: camera.cameraProfile || profile.id,
    stream: camera.stream || profile.defaultStream || "SUB",
    channelCount: Number(camera.channelCount || profile.defaultChannelCount || 1)
  };
}

export function publicCameraProfiles() {
  return CAMERA_PROFILES.map((profile) => ({
    id: profile.id,
    name: profile.name,
    aliases: profile.aliases,
    defaultStream: profile.defaultStream,
    defaultChannelCount: profile.defaultChannelCount,
    streamSettings: {
      ...DEFAULT_STREAM_SETTINGS,
      ...(profile.streamSettings || {})
    }
  }));
}
