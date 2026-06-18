import { apiFetch, jsonOptions } from "./api.js";

const savePerson = (payload) => apiFetch("/api/people", jsonOptions("POST", payload));
const deletePerson = (id) => apiFetch(`/api/people/${encodeURIComponent(id)}`, { method: "DELETE" });
const deletePeople = (ids) => apiFetch("/api/people/bulk-delete", jsonOptions("POST", { ids }));
const saveSyndic = (payload) => apiFetch("/api/syndics", jsonOptions("POST", payload));

export { savePerson, deletePerson, deletePeople, saveSyndic };
