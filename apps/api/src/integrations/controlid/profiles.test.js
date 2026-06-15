import assert from "node:assert/strict";
import test from "node:test";
import {
  controlIdActionParameters,
  controlIdDeviceDefaults,
  controlIdProfileForModel,
  validateControlIdConfiguration
} from "./profiles.js";

test("mapeia os principais modelos da Linha de Acesso", () => {
  assert.equal(controlIdProfileForModel("iDAccess Pro").defaultAction, "sec_box");
  assert.equal(controlIdProfileForModel("iDFace Max").defaultAction, "door");
  assert.equal(controlIdProfileForModel("iDBlock Next").defaultAction, "catra");
  assert.equal(controlIdProfileForModel("iDBox").maxDoor, 4);
});

test("aplica defaults de API sem RTSP a todos os modelos Control iD", () => {
  const profile = controlIdDeviceDefaults({
    manufacturer: "Control iD",
    model: "iDFace"
  });

  assert.equal(profile.apiProtocol, "http");
  assert.equal(profile.apiPort, 80);
  assert.equal(profile.rtspPort, 0);
  assert.equal(profile.channelCount, 0);
  assert.equal(profile.controlIdAction, "sec_box");
});

test("valida a acao permitida por modelo", () => {
  assert.equal(validateControlIdConfiguration({
    model: "iDBlock",
    controlIdAction: "door"
  }).ok, false);
  assert.equal(validateControlIdConfiguration({
    model: "iDAccess",
    controlIdAction: "door"
  }).ok, true);
});

test("gera os parametros oficiais para porta, SecBox e catraca", () => {
  assert.deepEqual(controlIdActionParameters({
    model: "iDBox",
    controlIdAction: "door"
  }, 9), { action: "door", parameters: "door=4" });

  assert.deepEqual(controlIdActionParameters({
    model: "iDFace",
    controlIdAction: "sec_box",
    controlIdSecBoxId: "65793"
  }), { action: "sec_box", parameters: "id=65793, reason=3" });

  assert.deepEqual(controlIdActionParameters({
    model: "iDBlock",
    controlIdAction: "catra"
  }, 2), { action: "catra", parameters: "relay=2" });
});
