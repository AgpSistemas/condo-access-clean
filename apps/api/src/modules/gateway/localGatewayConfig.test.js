import test from "node:test";
import assert from "node:assert/strict";
import {
  localGatewayEnabledForDevice,
  stripLocalGatewayDeviceFields,
  upsertLocalGatewayConfig
} from "./localGatewayConfig.js";

test("remove campos de gateway do cadastro bruto do equipamento", () => {
  const clean = stripLocalGatewayDeviceFields({
    id: "device-1",
    name: "Hikvision",
    useLocalGateway: true,
    gatewayConfigId: "legacy",
    gatewayMode: "LOCAL_GATEWAY"
  });

  assert.deepEqual(clean, { id: "device-1", name: "Hikvision" });
});

test("config separada controla se o equipamento usa gateway local", () => {
  const configs = [];
  const device = { id: "device-1", tenantId: "tenant-1" };

  assert.equal(localGatewayEnabledForDevice(configs, device), false);

  upsertLocalGatewayConfig(configs, device, true, () => "2026-01-01T00:00:00.000Z");
  assert.equal(localGatewayEnabledForDevice(configs, device), true);

  upsertLocalGatewayConfig(configs, device, false, () => "2026-01-01T00:01:00.000Z");
  assert.equal(localGatewayEnabledForDevice(configs, device), false);
});

test("mantem compatibilidade com equipamentos legados que ainda tem useLocalGateway", () => {
  assert.equal(localGatewayEnabledForDevice([], { id: "device-legacy", useLocalGateway: true }), true);
});
