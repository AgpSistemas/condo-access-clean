import { apiFetch, jsonOptions } from "./api.js";

const saveVehicle = (payload) => apiFetch("/api/vehicles", jsonOptions("POST", payload));
const deleteVehicle = (id) => apiFetch(`/api/vehicles/${encodeURIComponent(id)}`, { method: "DELETE" });
const syncVehicleTag = (id, deviceId) => apiFetch(`/api/vehicles/${encodeURIComponent(id)}/control-id-tag/sync`, jsonOptions("POST", { deviceId }));
const removeVehicleTag = (id, deviceId) => apiFetch(`/api/vehicles/${encodeURIComponent(id)}/control-id-tag`, jsonOptions("DELETE", { deviceId }));

export { saveVehicle, deleteVehicle, syncVehicleTag, removeVehicleTag };
