const CONTROL_ID_UHF_EXTENDED = "EXTENDED";
const CONTROL_ID_UHF_STANDARD = "STANDARD";

function normalizeControlIdUhfMode(value = CONTROL_ID_UHF_EXTENDED) {
  return String(value || CONTROL_ID_UHF_EXTENDED).trim().toUpperCase() === CONTROL_ID_UHF_STANDARD
    ? CONTROL_ID_UHF_STANDARD
    : CONTROL_ID_UHF_EXTENDED;
}

function controlIdStandardTagValue(value = "") {
  const clean = String(value || "").trim();
  const parts = clean.match(/^(\d+)[.,](\d+)$/);
  let parsed;
  if (parts) {
    parsed = (BigInt(parts[1]) * 4294967296n) + BigInt(parts[2]);
  } else if (/^\d+$/.test(clean)) {
    parsed = BigInt(clean);
  } else {
    throw new Error("Tag UHF padrao deve conter apenas numeros ou usar formato facility.cartao");
  }
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Tag UHF padrao excede o limite numerico seguro desta integracao");
  }
  return Number(parsed);
}

function controlIdExtendedTagValue(value = "") {
  const clean = String(value || "")
    .trim()
    .replace(/^0x/i, "")
    .replace(/[\s:-]/g, "")
    .toUpperCase();
  if (!/^[0-9A-F]{1,24}$/.test(clean)) {
    throw new Error("Tag UHF estendida deve ser hexadecimal e possuir no maximo 96 bits (24 caracteres)");
  }
  return clean;
}

function normalizeControlIdVehicleTag(value = "", mode = CONTROL_ID_UHF_EXTENDED) {
  const normalizedMode = normalizeControlIdUhfMode(mode);
  return {
    mode: normalizedMode,
    object: normalizedMode === CONTROL_ID_UHF_STANDARD ? "cards" : "uhf_tags",
    value: normalizedMode === CONTROL_ID_UHF_STANDARD
      ? controlIdStandardTagValue(value)
      : controlIdExtendedTagValue(value)
  };
}

function controlIdCreateOrModifyBody(object = "", id, value = {}) {
  return {
    object,
    values: [{
      ...(id ? { id } : {}),
      ...value
    }]
  };
}

function controlIdModifyBody(object = "", id, value = {}) {
  return {
    object,
    values: value,
    where: { [object]: { id } }
  };
}

function isControlIdInvalidCommand(error) {
  return /invalid command/i.test(String(error?.message || error || ""));
}

function controlIdVehicleTagRecords(snapshot = {}, device = {}) {
  const objects = snapshot.objects || {};
  const users = objects.users || [];
  const usersById = new Map(users.map((user) => [String(user.id), user]));
  const mode = normalizeControlIdUhfMode(device.controlIdUhfMode);
  const object = mode === CONTROL_ID_UHF_STANDARD ? "cards" : "uhf_tags";

  return (objects[object] || []).map((row) => {
    const user = usersById.get(String(row.user_id || row.userId || ""));
    const value = String(row.value ?? row.card_value ?? "").trim();
    return {
      id: `CONTROLID-VEHICLE-TAG-${object}-${String(row.id || value)}`,
      externalId: row.id || "",
      type: "VEHICLE_TAG",
      mode,
      object,
      value,
      valueLabel: mode === CONTROL_ID_UHF_STANDARD ? `Tag UHF padrao ${value}` : `Tag UHF ${value}`,
      personName: user?.name || "",
      personExternalId: user?.registration || String(user?.id || row.user_id || ""),
      source: "CONTROL_ID",
      sourceKind: object,
      deviceId: device.id || "",
      devicePath: `/load_objects.fcgi:${object}`,
      raw: row
    };
  }).filter((record) => record.value);
}

async function upsertControlIdVehicleTag({
  device,
  session,
  userId,
  value,
  mode,
  externalId = "",
  loadObjects,
  post
}) {
  const normalized = normalizeControlIdVehicleTag(value, mode || device.controlIdUhfMode);
  const records = await loadObjects(device, session, normalized.object, { limit: 1000 });
  const existing = records.find((record) =>
    (externalId && String(record.id) === String(externalId)) ||
    String(record.value) === String(normalized.value)
  );
  if (existing && String(existing.user_id) !== String(userId)) {
    throw new Error(`A tag ${value} ja pertence a outro usuario no Control iD`);
  }

  const objectValue = {
    value: normalized.value,
    user_id: userId
  };

  if (existing?.id) {
    try {
      await post(
        device,
        session,
        "/create_or_modify_objects.fcgi",
        controlIdCreateOrModifyBody(normalized.object, existing.id, objectValue)
      );
      return {
        id: existing.id,
        ...normalized
      };
    } catch (error) {
      if (!isControlIdInvalidCommand(error)) throw error;
      await post(
        device,
        session,
        "/modify_objects.fcgi",
        controlIdModifyBody(normalized.object, existing.id, objectValue)
      );
      return {
        id: existing.id,
        ...normalized
      };
    }
  }

  const result = await post(device, session, "/create_objects.fcgi", {
    object: normalized.object,
    values: [objectValue]
  });

  return {
    id: result.payload?.ids?.[0] || "",
    ...normalized
  };
}

async function deleteControlIdVehicleTag({
  device,
  session,
  userId,
  value,
  mode,
  externalId = "",
  loadObjects,
  post
}) {
  const normalized = normalizeControlIdVehicleTag(value, mode || device.controlIdUhfMode);
  const records = await loadObjects(device, session, normalized.object, { limit: 1000 });
  const existing = records.find((record) =>
    (externalId && String(record.id) === String(externalId)) ||
    (String(record.value) === String(normalized.value) && (!userId || String(record.user_id) === String(userId)))
  );
  if (!existing?.id) return { removed: false, ...normalized };

  await post(device, session, "/destroy_objects.fcgi", {
    object: normalized.object,
    where: {
      [normalized.object]: { id: existing.id }
    }
  });
  return { removed: true, id: existing.id, ...normalized };
}

export {
  CONTROL_ID_UHF_EXTENDED,
  CONTROL_ID_UHF_STANDARD,
  controlIdVehicleTagRecords,
  deleteControlIdVehicleTag,
  normalizeControlIdUhfMode,
  normalizeControlIdVehicleTag,
  upsertControlIdVehicleTag
};
