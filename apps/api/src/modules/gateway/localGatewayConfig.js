function publicLocalGatewayConfig(config = {}) {
  return {
    id: config.id || "",
    tenantId: config.tenantId || "",
    deviceId: config.deviceId || "",
    enabled: config.enabled !== false,
    mode: config.mode || "LOCAL_GATEWAY",
    label: config.label || "Gateway local",
    createdAt: config.createdAt || "",
    updatedAt: config.updatedAt || ""
  };
}

function localGatewayConfigForDevice(configs = [], device = {}) {
  return configs.find((config) =>
    config.deviceId === device.id &&
    (!device.tenantId || !config.tenantId || config.tenantId === device.tenantId)
  ) || null;
}

function localGatewayEnabledForDevice(configs = [], device = {}) {
  const config = localGatewayConfigForDevice(configs, device);
  if (config) return config.enabled !== false;
  return Boolean(device.useLocalGateway);
}

function stripLocalGatewayDeviceFields(device = {}) {
  const {
    useLocalGateway: _useLocalGateway,
    gatewayConfigId: _gatewayConfigId,
    gatewayMode: _gatewayMode,
    ...cleanDevice
  } = device;
  return cleanDevice;
}

function upsertLocalGatewayConfig(configs = [], device = {}, enabled = false, now = () => new Date().toISOString()) {
  if (!device.id) return null;
  const existing = localGatewayConfigForDevice(configs, device);
  if (!enabled) {
    if (existing) {
      existing.enabled = false;
      existing.updatedAt = now();
      return existing;
    }
    return null;
  }
  if (existing) {
    existing.enabled = true;
    existing.tenantId = device.tenantId || existing.tenantId || "";
    existing.updatedAt = now();
    return existing;
  }
  const config = {
    id: `gateway-config-${device.id}`,
    tenantId: device.tenantId || "",
    deviceId: device.id,
    enabled: true,
    mode: "LOCAL_GATEWAY",
    label: "Gateway local",
    createdAt: now(),
    updatedAt: now()
  };
  configs.push(config);
  return config;
}

function removeLocalGatewayConfig(configs = [], deviceId = "") {
  const removed = [];
  for (let index = configs.length - 1; index >= 0; index -= 1) {
    if (configs[index].deviceId === deviceId) {
      removed.unshift(...configs.splice(index, 1));
    }
  }
  return removed;
}

export {
  localGatewayConfigForDevice,
  localGatewayEnabledForDevice,
  publicLocalGatewayConfig,
  removeLocalGatewayConfig,
  stripLocalGatewayDeviceFields,
  upsertLocalGatewayConfig
};
