export async function waitForGatewayCommand(command, {
  waitForCommands,
  timeoutMs = 18000
} = {}) {
  if (!command) {
    return { ok: false, delivered: false, queued: false, message: "Gateway local nao configurado" };
  }

  await waitForCommands([command], timeoutMs);
  if (["PENDING", "DELIVERED"].includes(command.status)) {
    return {
      ok: false,
      delivered: false,
      queued: true,
      message: "Gateway local nao confirmou o comando dentro do tempo limite"
    };
  }

  if (command.status === "ERROR" || command.result?.ok === false) {
    return {
      ok: false,
      delivered: false,
      queued: false,
      message: command.result?.message || "Gateway local informou falha no comando"
    };
  }

  return {
    ok: true,
    delivered: true,
    queued: false,
    message: command.result?.message || "Gateway local confirmou o comando",
    result: command.result || {}
  };
}

export async function requestGatewayCameraSnapshot(camera, device, {
  queueCommand,
  waitForCommands,
  timeoutMs = 20000
} = {}) {
  const channel = Math.max(1, Number(camera.channel || camera.activeChannels?.[0]?.channel || 1));
  const channelId = `${channel}01`;
  const localTarget = {
    ...device,
    ...camera,
    id: device.id,
    tenantId: device.tenantId,
    apiHost: camera.apiHost || camera.ipAddress || camera.host || device.apiHost || device.ipAddress,
    apiPort: Number(camera.apiPort || camera.httpPort || device.apiPort || 80),
    apiProtocol: camera.apiProtocol || device.apiProtocol || "http",
    username: camera.username || device.username,
    password: camera.password || device.password
  };
  const command = queueCommand(localTarget, 1, {
    request: {
      path: `/ISAPI/Streaming/channels/${channelId}/picture`,
      method: "GET",
      timeoutMs,
      responseType: "base64"
    }
  }, "DEVICE_HTTP");
  const outcome = await waitForGatewayCommand(command, { waitForCommands, timeoutMs: timeoutMs + 5000 });
  if (!outcome.ok) throw new Error(outcome.message);
  const bodyBase64 = outcome.result?.bodyBase64 || "";
  if (!bodyBase64) throw new Error("Gateway local nao retornou a imagem da camera");
  return {
    buffer: Buffer.from(bodyBase64, "base64"),
    contentType: outcome.result?.contentType || "image/jpeg"
  };
}
