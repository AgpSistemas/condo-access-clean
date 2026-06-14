import { apiFetch, jsonOptions } from "./api.js";

const saveUnit = (payload) => apiFetch("/api/units", jsonOptions("POST", payload));
const deleteUnit = (id) => apiFetch(`/api/units/${encodeURIComponent(id)}`, { method: "DELETE" });
const saveUnitTelephony = (id, payload) => apiFetch(`/api/units/${encodeURIComponent(id)}/telephony`, jsonOptions("PUT", payload));

export { saveUnit, deleteUnit, saveUnitTelephony };
