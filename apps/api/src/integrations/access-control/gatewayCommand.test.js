import test from "node:test";
import assert from "node:assert/strict";
import {
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

test("monta snapshot Hikvision pelo IP privado da camera", async () => {
  let queuedCommand = null;
  const image = Buffer.from("jpeg-test");
  const result = await requestGatewayCameraSnapshot(
    { id: "camera-1", tenantId: "tenant-1", ipAddress: "192.168.1.20", channel: 2 },
    { id: "device-1", tenantId: "tenant-1", username: "admin", password: "secret" },
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

  assert.equal(queuedCommand.type, "DEVICE_HTTP");
  assert.equal(queuedCommand.device.apiHost, "192.168.1.20");
  assert.equal(queuedCommand.action.request.path, "/ISAPI/Streaming/channels/201/picture");
  assert.equal(result.buffer.toString(), "jpeg-test");
});
