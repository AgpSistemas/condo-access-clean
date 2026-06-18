import assert from "node:assert/strict";
import test from "node:test";

import {
  controlIdDestroyChanged,
  deleteControlIdStoredCredential
} from "./credentials.js";

test("destroy_objects Control iD com changes zero nao conta como exclusao", () => {
  assert.equal(controlIdDestroyChanged({ payload: { changes: 0 } }), false);
  assert.equal(controlIdDestroyChanged({ payload: { changes: 1 } }), true);
});

test("nao confirma exclusao Control iD quando objeto nao foi encontrado", async () => {
  const result = await deleteControlIdStoredCredential({
    device: { id: "device-1" },
    credential: { type: "QR_CODE", value: "ABC123" },
    adapter: "CONTROL_ID_ACCESS",
    login: async () => "session-1",
    loadObjects: async (_device, _session, object) => object === "users" ? [{ id: 88, registration: "person-1" }] : [],
    post: async () => ({ payload: { changes: 0 } }),
    personForCredential: () => ({ id: "person-1" }),
    normalizeType: (type) => type,
    userRegistration: () => "person-1",
    qrCredentialObjects: async () => ["qrcodes"],
    credentialObject: () => "",
    objectValue: (_type, value) => value
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /nada foi removido/);
});

test("confirma exclusao Control iD quando destroy_objects altera registro", async () => {
  const result = await deleteControlIdStoredCredential({
    device: { id: "device-1" },
    credential: { type: "RFID", value: "123" },
    adapter: "CONTROL_ID_ACCESS",
    login: async () => "session-1",
    loadObjects: async (_device, _session, object) => object === "users" ? [{ id: 88, registration: "person-1" }] : [],
    post: async () => ({ payload: { changes: 1 } }),
    personForCredential: () => ({ id: "person-1" }),
    normalizeType: (type) => type,
    userRegistration: () => "person-1",
    qrCredentialObjects: async () => [],
    credentialObject: () => "cards",
    objectValue: (_type, value) => Number(value)
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /excluido/);
});
