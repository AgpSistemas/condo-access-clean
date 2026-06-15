import assert from "node:assert/strict";
import test from "node:test";
import {
  controlIdIduhfDefaults,
  validateControlIdIduhfConfiguration
} from "./iduhf.js";

test("aplica as portas e opcoes padrao do perfil iDUHF", () => {
  const profile = controlIdIduhfDefaults({
    manufacturer: "Control iD",
    model: "iDUHF"
  });

  assert.equal(profile.apiProtocol, "http");
  assert.equal(profile.apiPort, 80);
  assert.equal(profile.rtspPort, 0);
  assert.equal(profile.channelCount, 0);
  assert.equal(profile.controlIdAction, "door");
  assert.equal(profile.controlIdUhfMode, "EXTENDED");
  assert.equal(profile.intercomEnabled, false);
});

test("exige o ID do SecBox/MAE quando o rele externo e selecionado", () => {
  const invalid = validateControlIdIduhfConfiguration({
    controlIdAction: "sec_box"
  });
  const valid = validateControlIdIduhfConfiguration({
    controlIdAction: "sec_box",
    controlIdSecBoxId: "65793"
  });

  assert.equal(invalid.ok, false);
  assert.match(invalid.errors[0], /SecBox\/MAE/);
  assert.equal(valid.ok, true);
});

test("aceita grupo vazio ou numerico e rejeita grupo invalido", () => {
  assert.equal(validateControlIdIduhfConfiguration({
    controlIdAction: "door",
    controlIdGroupId: ""
  }).ok, true);
  assert.equal(validateControlIdIduhfConfiguration({
    controlIdAction: "door",
    controlIdGroupId: "12"
  }).ok, true);
  assert.equal(validateControlIdIduhfConfiguration({
    controlIdAction: "door",
    controlIdGroupId: "portaria"
  }).ok, false);
});

test("nao oferece acao de catraca ao iDUHF", () => {
  const profile = controlIdIduhfDefaults({
    manufacturer: "Control iD",
    model: "iDUHF",
    controlIdAction: "catra"
  });
  const result = validateControlIdIduhfConfiguration(profile);

  assert.equal(result.ok, false);
  assert.match(result.errors[0], /aceita somente/);
});

test("permite limpar um grupo salvo anteriormente", () => {
  const profile = controlIdIduhfDefaults({
    manufacturer: "Control iD",
    model: "iDUHF",
    controlIdGroupId: ""
  }, {
    controlIdGroupId: "12"
  });

  assert.equal(profile.controlIdGroupId, "");
});
