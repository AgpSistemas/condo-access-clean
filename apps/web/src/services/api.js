import { apiUrl } from "../config/constants.js";

function apiPath(path) {
  return `${apiUrl}${path}`;
}

let apiPendingRequests = 0;

function notifyApiPending() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("condo-api-pending", {
    detail: { pending: apiPendingRequests }
  }));
}

function apiFetch(path, options) {
  apiPendingRequests += 1;
  notifyApiPending();
  return fetch(apiPath(path), options).finally(() => {
    apiPendingRequests = Math.max(0, apiPendingRequests - 1);
    notifyApiPending();
  });
}

async function readJson(response, fallback = {}) {
  return response.json().catch(() => fallback);
}

async function apiRequest(path, options = {}) {
  const response = await apiFetch(path, options);
  const result = await readJson(response);
  if (!response.ok) {
    const error = new Error(result?.message || `Falha na requisicao (${response.status}).`);
    error.status = response.status;
    error.payload = result;
    throw error;
  }
  return result;
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

export { apiUrl, apiPath, apiFetch, apiRequest, readJson, jsonOptions };
