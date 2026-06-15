function createCommunityArea(body = {}, { makeId, now }) {
  return {
    id: body.id || makeId("common-area"),
    tenantId: body.tenantId || "",
    name: String(body.name || "Area comum").trim(),
    description: String(body.description || "").trim(),
    capacity: Math.max(0, Number(body.capacity || 0)),
    location: String(body.location || "").trim(),
    active: body.active !== false,
    createdAt: body.createdAt || now(),
    updatedAt: now()
  };
}

function createCommunityEvent(body = {}, { makeId, now }) {
  return {
    id: body.id || makeId("community-event"),
    tenantId: body.tenantId || "",
    unitId: body.unitId || "",
    areaId: body.areaId || "",
    name: String(body.name || "Evento").trim(),
    type: String(body.type || "FESTA").trim().toUpperCase(),
    startsAt: body.startsAt || "",
    endsAt: body.endsAt || "",
    hostName: String(body.hostName || "").trim(),
    status: body.status || "CONFIRMED",
    createdAt: body.createdAt || now(),
    updatedAt: now()
  };
}

export { createCommunityArea, createCommunityEvent };
