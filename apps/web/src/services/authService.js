import { apiRequest, jsonOptions } from "./api.js";

async function login(credentials) {
  return apiRequest("/api/auth/login", jsonOptions("POST", credentials));
}

async function changePassword(payload) {
  return apiRequest("/api/auth/change-password", jsonOptions("POST", payload));
}

async function logout(accessToken) {
  if (!accessToken) return;
  await apiRequest("/api/auth/logout", jsonOptions("POST", { accessToken }));
}

export { login, changePassword, logout };
