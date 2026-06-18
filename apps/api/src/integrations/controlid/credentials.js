function controlIdDestroyChanged(result = {}) {
  const changes = result.payload?.changes;
  return changes === undefined ? true : Number(changes) > 0;
}

async function destroyControlIdObject({ device, session, object, where, post }) {
  const result = await post(device, session, "/destroy_objects.fcgi", { object, where });
  return controlIdDestroyChanged(result);
}

async function deleteControlIdStoredCredential({
  device,
  credential = {},
  adapter,
  login,
  loadObjects,
  post,
  personForCredential,
  normalizeType,
  userRegistration,
  qrCredentialObjects,
  credentialObject,
  objectValue
}) {
  const session = await login(device);
  const person = personForCredential(credential);
  const type = normalizeType(credential.type);
  const registration = userRegistration(credential, person);
  const users = await loadObjects(device, session, "users", { limit: 1000 });
  const user = users.find((item) =>
    String(item.registration || "").trim() === registration ||
    String(item.id) === String(person?.controlIdUserId || credential.personExternalId || "")
  );

  if (type === "FACE") {
    if (!user?.id) throw new Error(`Usuario Control iD ${registration} nao encontrado para excluir a foto`);
    await post(device, session, "/user_destroy_image.fcgi", { user_id: user.id });
    return {
      ok: true,
      deviceId: device.id,
      adapter,
      message: `Face de ${user.name || registration} excluida do Control iD`,
      attempts: [{ label: "Control iD excluir foto", path: "/user_destroy_image.fcgi", ok: true }]
    };
  }

  const candidateObjects = type === "QR_CODE"
    ? await qrCredentialObjects(device, session)
    : [credentialObject(type)];
  const objects = candidateObjects.filter(Boolean);
  if (objects.length) {
    const removedObjects = [];
    for (const object of objects) {
      try {
        const value = objectValue(type, credential.value, object);
        const changed = await destroyControlIdObject({
          device,
          session,
          object,
          where: {
            [object]: object === "pins" && user?.id
              ? { user_id: user.id }
              : { value }
          },
          post
        });
        if (changed) removedObjects.push(object);
      } catch {
        // QR can exist in only one mode; deleting the alternate object is best-effort.
      }
    }
    const attempts = objects.map((object) => ({
      label: `Control iD excluir ${object}`,
      path: `/destroy_objects.fcgi:${object}`,
      ok: removedObjects.includes(object)
    }));
    if (String(credential.source || "").toUpperCase() === "INVITE" && user?.id) {
      try {
        const changed = await destroyControlIdObject({
          device,
          session,
          object: "user_groups",
          where: { user_groups: { user_id: user.id } },
          post
        });
        attempts.push({ label: "Control iD excluir grupo temporario", path: "/destroy_objects.fcgi:user_groups", ok: changed });
      } catch (error) {
        attempts.push({
          label: "Control iD excluir grupo temporario",
          path: "/destroy_objects.fcgi:user_groups",
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao excluir grupo temporario"
        });
      }
      try {
        const changed = await destroyControlIdObject({
          device,
          session,
          object: "users",
          where: { users: { id: user.id } },
          post
        });
        attempts.push({ label: "Control iD excluir usuario temporario", path: "/destroy_objects.fcgi:users", ok: changed });
      } catch (error) {
        attempts.push({
          label: "Control iD excluir usuario temporario",
          path: "/destroy_objects.fcgi:users",
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao excluir usuario temporario"
        });
      }
    }
    return {
      ok: removedObjects.length > 0,
      deviceId: device.id,
      adapter,
      message: removedObjects.length
        ? `${type} excluido do Control iD em ${removedObjects.join(" + ")}`
        : `${type} nao foi localizado no Control iD; nada foi removido do equipamento`,
      attempts
    };
  }

  if (type === "APP" && user?.id) {
    const changed = await destroyControlIdObject({
      device,
      session,
      object: "users",
      where: { users: { id: user.id } },
      post
    });
    return {
      ok: changed,
      deviceId: device.id,
      adapter,
      message: changed
        ? `Usuario ${user.name || registration} excluido do Control iD`
        : `Usuario ${user.name || registration} nao foi removido do Control iD`,
      attempts: [{ label: "Control iD excluir usuario", path: "/destroy_objects.fcgi:users", ok: changed }]
    };
  }

  return {
    ok: false,
    deviceId: device.id,
    adapter,
    message: `Nenhum registro ${type} encontrado para excluir do Control iD`,
    attempts: []
  };
}

export {
  controlIdDestroyChanged,
  deleteControlIdStoredCredential
};
