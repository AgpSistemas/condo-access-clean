const railwayApiUrl = "https://api-production-441f.up.railway.app";
const apiUrl = import.meta.env.VITE_API_URL || railwayApiUrl;

const WEB_PORTER_EXTENSION = "9000";
const WEB_PORTER_PASSWORD = "CondoAccess@2026";
const API_CACHE_KEY = "condo-clean-api-cache";
const SESSION_STORAGE_KEY = "condo-clean-session";

export {
  railwayApiUrl,
  apiUrl,
  WEB_PORTER_EXTENSION,
  WEB_PORTER_PASSWORD,
  API_CACHE_KEY,
  SESSION_STORAGE_KEY
};
