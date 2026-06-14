import { apiFetch, jsonOptions } from "./api.js";

const saveAction = (payload) => apiFetch("/api/actions", jsonOptions("POST", payload));
const deleteAction = (id) => apiFetch(`/api/actions/${encodeURIComponent(id)}`, { method: "DELETE" });
const triggerAction = (id) => apiFetch(`/api/actions/${encodeURIComponent(id)}/trigger`, { method: "POST" });
const saveResource = (id, payload) => apiFetch(`/api/resources/${encodeURIComponent(id)}`, jsonOptions("PUT", payload));
const saveResourceConfiguration = (id, payload) => apiFetch(`/api/resources/${encodeURIComponent(id)}/configuration`, jsonOptions("PUT", payload));

export { saveAction, deleteAction, triggerAction, saveResource, saveResourceConfiguration };
