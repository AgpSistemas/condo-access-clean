import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteHikvisionStoredCredential,
  sendHikvisionStoredCredential
} from "./credentialCrud.js";

function baseDeps(overrides = {}) {
  return {
    requestDevice: async () => ({ status: 200 }),
    fetchPhotoBytes: async () => ({ mimeType: "image/jpeg", buffer: Buffer.from("photo") }),
    personForCredential: () => ({ id: "person-1", cpf: "123.456.789-01", name: "Morador Teste" }),
    unitForId: () => ({ unitNumber: "101" }),
    normalizeType: (type = "APP") => String(type).toUpperCase(),
    ...overrides
  };
}

test("envia usuario e cartao Hikvision por CRUD separado", async () => {
  const calls = [];
  const result = await sendHikvisionStoredCredential(
    { id: "dev-hik" },
    { id: "cred-rfid", type: "RFID", value: "12345" },
    baseDeps({
      requestDevice: async (device, path, options) => {
        calls.push({ device, path, options });
        return { status: 200 };
      }
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.adapter, "HIKVISION_ISAPI");
  assert.equal(calls[0].path, "/ISAPI/AccessControl/UserInfo/Record?format=json");
  assert.equal(calls[1].path, "/ISAPI/AccessControl/CardInfo/Record?format=json");
  assert.equal(JSON.parse(calls[0].options.body).UserInfo.employeeNo, "12345678901");
  assert.equal(JSON.parse(calls[1].options.body).CardInfo.cardNo, "12345");
});

test("exclui face Hikvision usando EmployeeNoList", async () => {
  const calls = [];
  const result = await deleteHikvisionStoredCredential(
    { id: "dev-hik" },
    { id: "cred-face", type: "FACE" },
    baseDeps({
      requestDevice: async (device, path, options) => {
        calls.push({ device, path, options });
        return { status: 200 };
      }
    })
  );

  const body = JSON.parse(calls[0].options.body);

  assert.equal(result.ok, true);
  assert.equal(calls[0].path, "/ISAPI/AccessControl/FaceInfo/Delete?format=json");
  assert.deepEqual(body.FaceInfoDelCond.EmployeeNoList, [{ employeeNo: "12345678901" }]);
});
