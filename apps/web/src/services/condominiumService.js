import { apiFetch, jsonOptions } from "./api.js";

const saveCondominium = (payload) => apiFetch("/api/condominiums", jsonOptions("POST", payload));
const deleteCondominium = (id) => apiFetch(`/api/condominiums/${encodeURIComponent(id)}`, { method: "DELETE" });
const saveCondominiumTelephony = (id, payload) => apiFetch(`/api/condominiums/${encodeURIComponent(id)}/telephony`, jsonOptions("PUT", payload));

export { saveCondominium, deleteCondominium, saveCondominiumTelephony };
