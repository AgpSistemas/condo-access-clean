import assert from "node:assert/strict";
import test from "node:test";
import {
  NICE_LINEAR_DEVICE_TCP_MODE,
  NICE_LINEAR_HTTP_MODE,
  matchesNiceLinear,
  niceLinearDefaults,
  niceLinearEventToAccessLog,
  validateNiceLinearConfiguration
} from "./gateway.js";

test("reconhece fabricantes e modelos Nice/Linear", () => {
  assert.equal(matchesNiceLinear({ manufacturer: "Nice Guarita" }), true);
  assert.equal(matchesNiceLinear({ manufacturer: "Linear HCS" }), true);
  assert.equal(matchesNiceLinear({ manufacturer: "Generico", model: "Modulo Guarita MG3000" }), true);
});

test("aplica perfil TCP iniciado pelo equipamento sem camera ou interfonia", () => {
  const profile = niceLinearDefaults({
    manufacturer: "Nice/Linear",
    model: "Modulo Guarita MG3000",
    ipAddress: "192.168.0.20",
    apiPort: 9000
  });

  assert.equal(profile.niceConnectionMode, NICE_LINEAR_DEVICE_TCP_MODE);
  assert.equal(profile.apiPort, 9000);
  assert.equal(profile.rtspPort, 0);
  assert.equal(profile.channelCount, 0);
  assert.equal(profile.intercomEnabled, false);
  assert.equal(validateNiceLinearConfiguration({ ...profile, ipAddress: "192.168.0.20" }).ok, true);
});

test("aceita gateway HTTP e rejeita porta invalida", () => {
  const profile = niceLinearDefaults({
    manufacturer: "Linear HCS",
    model: "Modulo Guarita IP",
    niceConnectionMode: NICE_LINEAR_HTTP_MODE,
    ipAddress: "192.168.0.21",
    apiPort: 70000
  });

  assert.equal(profile.niceConnectionMode, NICE_LINEAR_HTTP_MODE);
  assert.equal(validateNiceLinearConfiguration({ ...profile, ipAddress: "192.168.0.21" }).ok, false);
});

test("normaliza evento recebido do bridge", () => {
  const log = niceLinearEventToAccessLog({
    id: "nice-1",
    tenantId: "tenant-1",
    manufacturer: "Nice/Linear"
  }, {
    allowed: true,
    personName: "Morador",
    credentialType: "UHF_TAG",
    credentialValue: "ABC123",
    relay: 2
  }, {
    makeId: () => "access-1",
    now: () => "2026-06-13T12:00:00.000Z",
    tenantId: "tenant-default"
  });

  assert.equal(log.decision, "ALLOW");
  assert.equal(log.source, "NICE_LINEAR_GATEWAY");
  assert.equal(log.door.id, 2);
  assert.equal(log.credential.value, "ABC123");
});
