import test from "node:test";
import assert from "node:assert/strict";
import {
  requestGatewayCameraHlsFile,
  requestGatewayCameraSnapshot,
  waitForGatewayCommand
} from "../../modules/gateway/commandResult.js";

test("confirma comando concluido pelo gateway local", async () => {
  const command = { status: "DONE", result: { ok: true, message: "Porta aberta" } };
  const result = await waitForGatewayCommand(command, {
    waitForCommands: async () => undefined
  });

  assert.equal(result.ok, true);
  assert.equal(result.delivered, true);
  assert.equal(result.message, "Porta aberta");
});

test("monta snapshot Hikvision pelo IP privado do equipamento pai", async () => {
  let queuedCommand = null;
  const image = Buffer.from("jpeg-test");
  const result = await requestGatewayCameraSnapshot(
    { id: "camera-1", deviceId: "device-1", tenantId: "tenant-1", ipAddress: "192.168.1.20", channel: 2 },
    { id: "device-1", tenantId: "tenant-1", ipAddress: "192.168.1.10", username: "admin", password: "secret" },
    {
      queueCommand: (device, relay, action, type) => {
        queuedCommand = { device, relay, action, type };
        return {
          status: "DONE",
          result: {
            ok: true,
            bodyBase64: image.toString("base64"),
            contentType: "image/jpeg"
          }
        };
      },
      waitForCommands: async () => undefined
    }
  );

  assert.equal(queuedCommand.type, "CAMERA_SNAPSHOT");
  assert.equal(queuedCommand.device.apiHost, "192.168.1.10");
  assert.equal(queuedCommand.action.request.rtspPath, "/Streaming/channels/201");
  assert.equal(result.buffer.toString(), "jpeg-test");
});

test("monta arquivo HLS Hikvision pelo gateway local", async () => {
  let queuedCommand = null;
  const segment = Buffer.from("ts-segment-test");
  const result = await requestGatewayCameraHlsFile(
    { id: "camera-1", deviceId: "device-1", tenantId: "tenant-1", ipAddress: "192.168.1.20", channel: 1 },
    { id: "device-1", tenantId: "tenant-1", ipAddress: "192.168.1.10", username: "admin", password: "secret", channelCount: 4 },
    "segment_000.ts",
    {
      streamKey: "camera-1--ch-1",
      queueCommand: (device, relay, action, type) => {
        queuedCommand = { device, relay, action, type };
        return {
          status: "DONE",
          result: {
            ok: true,
            bodyBase64: segment.toString("base64"),
            contentType: "video/mp2t"
          }
        };
      },
      waitForCommands: async () => undefined
    }
  );

  assert.equal(queuedCommand.type, "CAMERA_HLS_FILE");
  assert.equal(queuedCommand.device.apiHost, "192.168.1.10");
  assert.equal(queuedCommand.action.request.filename, "segment_000.ts");
  assert.equal(queuedCommand.action.request.streamKey, "camera-1--ch-1");
  assert.equal(result.contentType, "video/mp2t");
  assert.equal(result.buffer.toString(), "ts-segment-test");
});
