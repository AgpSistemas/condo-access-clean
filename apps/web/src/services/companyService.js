import { apiFetch, jsonOptions } from "./api.js";

const saveCompany = (payload) => apiFetch("/api/companies", jsonOptions("POST", payload));

export { saveCompany };
