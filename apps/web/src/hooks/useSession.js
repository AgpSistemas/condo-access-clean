import { useCallback, useState } from "react";
import { SESSION_STORAGE_KEY } from "../config/constants.js";
import { logout as logoutRequest } from "../services/authService.js";

function readStoredSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

function useSession() {
  const [session, setSession] = useState(readStoredSession);

  const persistSession = useCallback((nextSession) => {
    setSession(nextSession);
    if (nextSession) window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
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

export { readStoredSession, useSession };
export default useSession;
