import { apiFetch, jsonOptions } from "./api.js";

const saveLicense = (payload) => apiFetch("/api/licenses", jsonOptions("POST", payload));

export { saveLicense };
