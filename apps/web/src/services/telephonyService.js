import { apiFetch, jsonOptions } from "./api.js";

const startPorterCall = (payload) => apiFetch("/api/telephony/porter-call", jsonOptions("POST", payload));
const startExtensionCall = (payload) => apiFetch("/api/telephony/extension-call", jsonOptions("POST", payload));
const notifyMobileCall = (payload) => apiFetch("/api/telephony/mobile-call", jsonOptions("POST", payload));
const fetchCalls = () => apiFetch("/api/telephony/calls");
const answerCall = (id) => apiFetch(`/api/telephony/calls/${encodeURIComponent(id)}/answer`, { method: "POST" });
const endCall = (id) => apiFetch(`/api/telephony/calls/${encodeURIComponent(id)}/end`, { method: "POST" });
const fetchExtensionStatus = (tenantId) => apiFetch(`/api/extensions/status?tenantId=${encodeURIComponent(tenantId)}`);

export { startPorterCall, startExtensionCall, notifyMobileCall, fetchCalls, answerCall, endCall, fetchExtensionStatus };
