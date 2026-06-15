import assert from "node:assert/strict";
import test from "node:test";
import { resolveRestAccessProfile, restAccessDefaults } from "./restProfiles.js";

test("resolve fabricantes REST de controle de acesso", () => {
  assert.equal(resolveRestAccessProfile({ manufacturer: "Axis", model: "A1601" }).adapter, "AXIS_VAPIX_PACS");
  assert.equal(resolveRestAccessProfile({ manufacturer: "Suprema", model: "BioStar 2" }).adapter, "SUPREMA_BIOSTAR_REST");
  assert.equal(resolveRestAccessProfile({ manufacturer: "Dahua", model: "ASI7213" }).adapter, "DAHUA_ACCESS_CGI");
});

test("aplica defaults de servidor para BioStar", () => {
  const defaults = restAccessDefaults({ manufacturer: "Suprema", model: "BioStar 2" });
  assert.equal(defaults.apiProtocol, "https");
  assert.equal(defaults.apiPort, 443);
  assert.equal(defaults.authMode, "SESSION");
  assert.equal(defaults.integrationMode, "SERVER_REST");
});
