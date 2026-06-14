import {
  deleteControlIdVehicleTag,
  normalizeControlIdUhfMode,
  upsertControlIdVehicleTag
} from "../../integrations/controlid/vehicleTags.js";

function vehicleTagUserIdentity(vehicle = {}, person = null) {
  if (person) return person;
  return {
    id: vehicle.id,
    name: `Veiculo ${vehicle.plate || vehicle.id}`,
    externalId: `VEHICLE-${vehicle.id}`,
    controlIdUserId: vehicle.tagUserId || ""
  };
}

async function syncVehicleTag({
  vehicle,
  device,
  person,
  adapter,
  controlIdAdapter,
  login,
  loadObjects,
  post,
  ensureUser,
  ensureGroup,
  now
}) {
  if (!vehicle) throw new Error("Veiculo nao encontrado");
  if (!device) throw new Error("Equipamento Control iD nao encontrado");
  if (adapter(device) !== controlIdAdapter) throw new Error("O equipamento selecionado nao utiliza o adapter Control iD");
  if (!String(vehicle.tagValue || "").trim()) throw new Error("Informe o valor da tag veicular");

  const session = await login(device);
  const identity = vehicleTagUserIdentity(vehicle, person);
  const user = await ensureUser(device, session, {
    id: vehicle.id,
    personId: identity.id,
    personExternalId: identity.controlIdUserId || identity.externalId || identity.id,
    personName: identity.name,
    valueLabel: identity.name
  }, identity);
  const groupId = await ensureGroup(device, session, user.id);
  const tag = await upsertControlIdVehicleTag({
    device,
    session,
    userId: user.id,
    value: vehicle.tagValue,
    mode: vehicle.tagMode || device.controlIdUhfMode,
    externalId: vehicle.tagExternalId,
    loadObjects,
    post
  });
  const syncedAt = now();

  return {
    vehiclePatch: {
      tagMode: tag.mode,
      tagDeviceId: device.id,
      tagExternalId: tag.id,
      tagUserId: user.id,
      tagStatus: "SYNCED",
      tagSyncedAt: syncedAt,
      updatedAt: syncedAt
    },
    result: {
      ok: true,
      adapter: controlIdAdapter,
      deviceId: device.id,
      vehicleId: vehicle.id,
      tag: String(tag.value),
      mode: tag.mode,
      object: tag.object,
      groupId,
      syncedAt,
      message: `Tag ${vehicle.tagValue} enviada ao Control iD para o veiculo ${vehicle.plate}`
    }
  };
}

async function removeVehicleTag({
  vehicle,
  device,
  adapter,
  controlIdAdapter,
  login,
  loadObjects,
  post,
  now
}) {
  if (!vehicle) throw new Error("Veiculo nao encontrado");
  if (!device) throw new Error("Equipamento Control iD nao encontrado");
  if (adapter(device) !== controlIdAdapter) throw new Error("O equipamento selecionado nao utiliza o adapter Control iD");
  if (!String(vehicle.tagValue || "").trim()) throw new Error("O veiculo nao possui tag cadastrada");

  const session = await login(device);
  const removed = await deleteControlIdVehicleTag({
    device,
    session,
    userId: vehicle.tagUserId,
    value: vehicle.tagValue,
    mode: normalizeControlIdUhfMode(vehicle.tagMode || device.controlIdUhfMode),
    externalId: vehicle.tagExternalId,
    loadObjects,
    post
  });
  const updatedAt = now();
  return {
    vehiclePatch: {
      tagExternalId: "",
      tagStatus: removed.removed ? "REMOVED" : "NOT_FOUND",
      tagSyncedAt: updatedAt,
      updatedAt
    },
    result: {
      ok: true,
      adapter: controlIdAdapter,
      deviceId: device.id,
      vehicleId: vehicle.id,
      removed: removed.removed,
      message: removed.removed
        ? `Tag ${vehicle.tagValue} removida do Control iD`
        : `Tag ${vehicle.tagValue} nao foi encontrada no Control iD`
    }
  };
}

export { removeVehicleTag, syncVehicleTag };
