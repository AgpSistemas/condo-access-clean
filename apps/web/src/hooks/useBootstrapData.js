import { useCallback, useEffect, useRef, useState } from "react";
import { API_CACHE_KEY } from "../config/constants.js";
import { emptyTelephony, normalizeBootstrap, readCachedBootstrap } from "../config/appConfig.jsx";
import { fetchBootstrap, fetchExtensionStatus } from "../services/bootstrapService.js";

function useBootstrapData({ accessToken, selectedTenantId, setSelectedTenantId, setSelectedUnitId, setTelephony, setTenantTelephony }) {
  const [data, setData] = useState(readCachedBootstrap);
  const [syncState, setSyncState] = useState({ status: "idle", error: "", lastSyncAt: null });
  const syncInFlightRef = useRef(false);
  const selectedTenantIdRef = useRef(selectedTenantId);

  useEffect(() => {
    selectedTenantIdRef.current = selectedTenantId;
  }, [selectedTenantId]);

  const storeApiCache = useCallback((payload) => {
    const normalized = normalizeBootstrap(payload);
    try {
      window.localStorage.setItem(API_CACHE_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        payload: normalized
      }));
    } catch {
      // A aplicacao continua operando mesmo quando o navegador bloqueia o cache.
    }
    return normalized;
  }, []);

  const refreshApiCache = useCallback(async () => {
    try {
      const response = await fetchBootstrap();
      if (!response.ok) return null;
      return storeApiCache(await response.json());
    } catch {
      return null;
    }
  }, [storeApiCache]);

  const syncNow = useCallback(async ({ silent = false } = {}) => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    if (!silent) setSyncState((current) => ({ ...current, status: "syncing", error: "" }));
    try {
      const response = await fetchBootstrap();
      if (!response.ok) throw new Error(`API ${response.status}`);
      const payload = normalizeBootstrap(await response.json());
      const currentTenantId = payload.condominiums.some((item) => item.id === selectedTenantIdRef.current)
        ? selectedTenantIdRef.current
        : payload.condominiums[0]?.id || "";
      const extensionPayload = await fetchExtensionStatus(currentTenantId).catch(() => null);
      if (extensionPayload?.extensions) payload.extensionStatus = extensionPayload.extensions;
      storeApiCache(payload);
      setData(payload);
      const nextTenant = payload.condominiums[0];
      const nextUnit = payload.units[0];
      setSelectedTenantId((current) => payload.condominiums.some((item) => item.id === current) ? current : nextTenant?.id || "");
      setSelectedUnitId((current) => current && payload.units.some((item) => item.unitId === current) ? current : "");
      setTenantTelephony(nextTenant || {});
      setTelephony(nextUnit?.telephony || emptyTelephony);
      setSyncState({ status: "synced", error: "", lastSyncAt: new Date() });
    } catch (error) {
      setSyncState({ status: "offline", error: error instanceof Error ? error.message : "API indisponivel", lastSyncAt: new Date() });
    } finally {
      syncInFlightRef.current = false;
    }
  }, [setSelectedTenantId, setSelectedUnitId, setTelephony, setTenantTelephony, storeApiCache]);

  useEffect(() => {
    void syncNow();
  }, [syncNow]);

  useEffect(() => {
    if (accessToken) void syncNow({ silent: true });
  }, [accessToken, syncNow]);

  return { data, setData, syncState, refreshApiCache, syncNow };
}

export default useBootstrapData;
