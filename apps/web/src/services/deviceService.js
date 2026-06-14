import { apiFetch, jsonOptions } from "./api.js";

const saveDevice = (payload) => apiFetch("/api/devices", jsonOptions("POST", payload));
const deleteDevice = (id) => apiFetch(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
const refreshDeviceStatus = (tenantId) => apiFetch(`/api/devices/status?tenantId=${encodeURIComponent(tenantId)}`, { method: "POST" });
const testDevice = (id) => apiFetch(`/api/devices/${encodeURIComponent(id)}/test`);

export { saveDevice, deleteDevice, refreshDeviceStatus, testDevice };
