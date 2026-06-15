import assert from "node:assert/strict";
import test from "node:test";

import { eventCredentialValue, matchingSingleUseInvite } from "../../modules/invites/lifecycle.js";

test("identifica convite de uso unico por cartao Hikvision aprovado", () => {
  const invite = { id: "invite-1", qrPayload: "123456", deviceId: "device-1", singleUse: true };
  const event = { decision: "ALLOW", cardNo: "123456", deviceId: "device-1" };
  assert.equal(matchingSingleUseInvite([invite], event), invite);
});

test("identifica QR Control iD e ignora convite ja usado ou acesso negado", () => {
  assert.equal(eventCredentialValue({ rawEvent: { qrcode_value: "ABC123" } }), "ABC123");
  const invite = { id: "invite-1", qrPayload: "ABC123", singleUse: true };
  assert.equal(matchingSingleUseInvite([invite], { decision: "DENY", rawEvent: { qrcode_value: "ABC123" } }), null);
  assert.equal(matchingSingleUseInvite([{ ...invite, usedAt: "2026-06-15T12:00:00Z" }], {
    decision: "ALLOW",
    rawEvent: { qrcode_value: "ABC123" }
  }), null);
});
