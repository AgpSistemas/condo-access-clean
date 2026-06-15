import assert from "node:assert/strict";
import test from "node:test";
import { openAxisVapixDoor, testAxisVapix } from "../axis/vapixPacs.js";
import { openDahuaAccessDoor } from "../dahua/accessCgi.js";
import { openHikvisionIsapiDoor } from "../hikvision/isapi.js";

test("Axis VAPIX consulta e abre porta usando token", async () => {
  const calls = [];
  const requestDevice = async (_device, path, options) => {
    calls.push({ path, options });
    return { status: 200, body: "{}" };
  };
  await testAxisVapix({}, { requestDevice });
  await openAxisVapixDoor({ doorToken: "Door0" }, {}, { requestDevice });
  assert.equal(calls[0].path, "/vapix/pacs");
  assert.deepEqual(JSON.parse(calls[0].options.body), { "axtdc:GetDoorList": {} });
  assert.deepEqual(JSON.parse(calls[1].options.body), { "tdc:AccessDoor": { Token: "Door0" } });
});

test("Axis VAPIX exige token antes de acionar", async () => {
  await assert.rejects(
    () => openAxisVapixDoor({}, {}, { requestDevice: async () => ({ status: 200 }) }),
    /token VAPIX/
  );
});

test("Dahua e Hikvision usam rotas de abertura dos respectivos modulos", async () => {
  const calls = [];
  const requestDevice = async (_device, path, options) => {
    calls.push({ path, options });
    return { status: 200 };
  };
  await openDahuaAccessDoor({}, 2, { requestDevice });
  await openHikvisionIsapiDoor({}, 1, { requestDevice });
  assert.equal(calls[0].path, "/cgi-bin/accessControl.cgi?action=openDoor&channel=2");
  assert.equal(calls[1].path, "/ISAPI/AccessControl/RemoteControl/door/1");
});

