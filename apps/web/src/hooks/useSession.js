import { useCallback, useState } from "react";
import { SESSION_STORAGE_KEY } from "../config/constants.js";
import { logout as logoutRequest } from "../services/authService.js";

function normalizeSession(value) {
  if (!value || typeof value !== "object") return null;
  if (!value.user || typeof value.user !== "object") return value;
  return {
    ...value.user,
    accessToken: value.accessToken || value.user.accessToken || "",
    refreshToken: value.refreshToken || value.user.refreshToken || ""
  };
}

function readStoredSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    const session = raw ? normalizeSession(JSON.parse(raw)) : null;
    if (session && raw !== JSON.stringify(session)) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }
    return session;
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

function useSession() {
  const [session, setSession] = useState(readStoredSession);

  const persistSession = useCallback((nextSession) => {
    const normalized = normalizeSession(nextSession);
    setSession(normalized);
    if (normalized) window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(normalized));
    else window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest(session?.accessToken);
    } finally {
      persistSession(null);
    }
  }, [persistSession, session?.accessToken]);

  return { session, persistSession, logout };
}

export { normalizeSession, readStoredSession, useSession };
export default useSession;
