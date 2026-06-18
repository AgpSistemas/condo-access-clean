import { apiFetch, jsonOptions } from "./api.js";

const saveCredential = (payload) => apiFetch("/api/credentials", jsonOptions("POST", payload));
const deleteCredential = (id) => apiFetch(`/api/credentials/${encodeURIComponent(id)}`, { method: "DELETE" });
const deleteCredentials = (ids) => apiFetch("/api/credentials/bulk-delete", jsonOptions("POST", { ids }));
const generateCredential = (payload) => apiFetch("/api/credentials/generate", jsonOptions("POST", payload));
const importCredentials = (payload) => apiFetch("/api/credentials/import", jsonOptions("POST", payload));

export { saveCredential, deleteCredential, deleteCredentials, generateCredential, importCredentials };
