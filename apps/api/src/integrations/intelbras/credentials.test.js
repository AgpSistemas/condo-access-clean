import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteIntelbrasStoredCredential,
  sendIntelbrasStoredCredential
} from "./credentials.js";
import { INTELBRAS_SS_3532_MF_W_ADAPTER } from "./ss3532Mfw.js";

const deps = {
  adapter: INTELBRAS_SS_3532_MF_W_ADAPTER,
  normalizeType: (type = "APP") => String(type).toUpperCase()
};

test("envio Intelbras Bio-T nao retorna sucesso fisico sem conector autorizado", async () => {
  const result = await sendIntelbrasStoredCredential(
    { id: "dev-intelbras" },
    { id: "cred-qr", type: "QR_CODE" },
    deps
  );

  assert.equal(result.ok, false);
  assert.equal(result.adapter, INTELBRAS_SS_3532_MF_W_ADAPTER);
  assert.match(result.message, /conector CACO\/API autorizado/);
});

test("exclusao Intelbras Bio-T nao retorna sucesso fisico sem conector autorizado", async () => {
  const result = await deleteIntelbrasStoredCredential(
    { id: "dev-intelbras" },
    { id: "cred-face", type: "FACE" },
    deps
  );

  assert.equal(result.ok, false);
  assert.equal(result.adapter, INTELBRAS_SS_3532_MF_W_ADAPTER);
  assert.match(result.message, /exclusao fisico/);
});
