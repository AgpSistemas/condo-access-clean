import { apiFetch, readJson } from "./api.js";

function fetchBootstrap() {
  return apiFetch("/api/bootstrap");
}

async function fetchExtensionStatus(tenantId) {
  if (!tenantId) return [];
  const response = await apiFetch(`/api/extensions/status?tenantId=${encodeURIComponent(tenantId)}`);
  if (!response.ok) return [];
  return readJson(response, []);
}

export { fetchBootstrap, fetchExtensionStatus };
