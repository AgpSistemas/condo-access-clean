import { apiFetch, jsonOptions } from "./api.js";

const readIntegrationResource = (deviceId, resource, limit = 80) => apiFetch(`/api/devices/${encodeURIComponent(deviceId)}/integration/${encodeURIComponent(resource)}?limit=${limit}`);
const importEquipmentCredentials = (deviceId, payload) => apiFetch(`/api/devices/${encodeURIComponent(deviceId)}/integration/credentials/import`, jsonOptions("POST", payload));

export { readIntegrationResource, importEquipmentCredentials };
