import { apiFetch, jsonOptions } from "./api.js";

const saveCamera = (payload) => apiFetch("/api/cameras", jsonOptions("POST", payload));
const deleteCamera = (id) => apiFetch(`/api/cameras/${encodeURIComponent(id)}`, { method: "DELETE" });
const stopCameraStream = (streamKey) => apiFetch(`/streams/${encodeURIComponent(streamKey)}`, { method: "DELETE", keepalive: true });

export { saveCamera, deleteCamera, stopCameraStream };
