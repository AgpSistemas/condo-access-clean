function eventCredentialValue(event = {}) {
  return String(
    event.cardNo ||
    event.credentialValue ||
    event.rawEvent?.qrcode_value ||
    event.rawEvent?.card_value ||
    event.rawEvent?.QRCode ||
    event.rawEvent?.qrCode ||
    ""
  ).trim();
}

function matchingSingleUseInvite(invites = [], event = {}) {
  if (String(event.decision || "").toUpperCase() !== "ALLOW") return null;
  const value = eventCredentialValue(event);
  if (!value) return null;
  return invites.find((invite) =>
    invite.singleUse !== false &&
    !invite.usedAt &&
    String(invite.qrPayload || invite.code || "").trim() === value &&
    (!invite.deviceId || !event.deviceId || invite.deviceId === event.deviceId || invite.deviceId === event.door?.deviceId)
  ) || null;
}

export { eventCredentialValue, matchingSingleUseInvite };
