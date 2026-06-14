import { useCallback, useEffect, useRef } from "react";

function useAppRouting({
  condominiums,
  licenses,
  units,
  selectedTenantId,
  setSelectedTenantId,
  setSelectedUnitId,
  setUnitFormMode,
  setActiveSection,
  setUnitTab,
  setDeviceTab,
  setPersonSubtab,
  setSelectedPersonId,
  setInviteSubtab
}) {
  const selectedTenantIdRef = useRef(selectedTenantId);

  useEffect(() => {
    selectedTenantIdRef.current = selectedTenantId;
  }, [selectedTenantId]);

  const normalizeUnitId = useCallback((rawUnitId) => {
    if (!rawUnitId) return "";
    const decoded = decodeURIComponent(rawUnitId);
    return units.find((unit) => unit.unitId === decoded || unit.unitId === `unit-${decoded}` || unit.unitNumber === decoded)?.unitId || decoded;
  }, [units]);

  const applyRoute = useCallback((path) => {
    const pathname = path || window.location.pathname;
    const licenseUnitsMatch = pathname.match(/^\/licencas\/([^/]+)\/unidades$/);
    const licenseCamerasMatch = pathname.match(/^\/licencas\/([^/]+)\/configuracaoCameras$/);
    const licenseActionsMatch = pathname.match(/^\/licencas\/([^/]+)\/configuracaoAcionamentos$/);
    const licenseDevicesMatch = pathname.match(/^\/licencas\/([^/]+)\/equipamentos$/);
    const licenseCredentialsMatch = pathname.match(/^\/licencas\/([^/]+)\/credenciais(?:\/importacao)?$/);
    const credentialsMatch = pathname.match(/^\/credenciais(?:\/importacao)?$/);
    const condoCredentialsMatch = pathname.match(/^\/condominios\/([^/]+)\/credenciais(?:\/importacao)?$/);
    const unitRootMatch = pathname.match(/^\/unidades\/([^/]+)$/);
    const unitPeopleMatch = pathname.match(/^\/unidades\/([^/]+)\/pessoas\/([^/]+)\/ver\/([^/]+)$/);
    const unitLoginsMatch = pathname.match(/^\/unidades\/([^/]+)\/logins$/);
    const unitInvitesMatch = pathname.match(/^\/unidades\/([^/]+)\/convites\/([^/]+)$/);

    const selectTenantByLicense = (code) => {
      const license = licenses.find((item) => item.code === code || item.id === code || item.id === `license-${code}`);
      if (license?.tenantId && license.tenantId !== selectedTenantIdRef.current) setSelectedTenantId(license.tenantId);
    };

    if (licenseUnitsMatch || pathname === "/unidades") {
      if (licenseUnitsMatch) selectTenantByLicense(licenseUnitsMatch[1]);
      setSelectedUnitId("");
      setUnitFormMode("edit");
      setActiveSection("units");
      setUnitTab("geral");
      return true;
    }
    if (licenseCamerasMatch || licenseActionsMatch || licenseDevicesMatch) {
      const match = licenseCamerasMatch || licenseActionsMatch || licenseDevicesMatch;
      selectTenantByLicense(match[1]);
      setActiveSection("devices");
      setDeviceTab(licenseCamerasMatch ? "cameras" : licenseActionsMatch ? "actions" : "inicio");
      return true;
    }
    if (licenseCredentialsMatch || credentialsMatch || condoCredentialsMatch) {
      if (licenseCredentialsMatch) selectTenantByLicense(licenseCredentialsMatch[1]);
      if (condoCredentialsMatch) {
        const tenantId = decodeURIComponent(condoCredentialsMatch[1]);
        if (condominiums.some((item) => item.id === tenantId)) setSelectedTenantId(tenantId);
      }
      setActiveSection("credentials");
      return true;
    }
    if (unitRootMatch) {
      setSelectedUnitId(normalizeUnitId(unitRootMatch[1]));
      setUnitFormMode("edit");
      setActiveSection("units");
      setUnitTab("geral");
      return true;
    }
    if (unitPeopleMatch) {
      setSelectedUnitId(normalizeUnitId(unitPeopleMatch[1]));
      setActiveSection("units");
      setUnitTab(unitPeopleMatch[2] === "visitantes" ? "visitantes" : unitPeopleMatch[2] === "prestadores" ? "prestadores" : "moradores");
      setPersonSubtab(unitPeopleMatch[2]);
      setSelectedPersonId(unitPeopleMatch[3]);
      return true;
    }
    if (unitLoginsMatch || unitInvitesMatch) {
      const match = unitLoginsMatch || unitInvitesMatch;
      setSelectedUnitId(normalizeUnitId(match[1]));
      setActiveSection("units");
      setUnitTab(unitLoginsMatch ? "logins" : "convites");
      if (unitInvitesMatch) setInviteSubtab(unitInvitesMatch[2]);
      return true;
    }
    return false;
  }, [condominiums, licenses, normalizeUnitId, setActiveSection, setDeviceTab, setInviteSubtab, setPersonSubtab, setSelectedPersonId, setSelectedTenantId, setSelectedUnitId, setUnitFormMode, setUnitTab]);

  const navigateTo = useCallback((path) => {
    window.history.pushState({}, "", path);
    applyRoute(path);
  }, [applyRoute]);

  useEffect(() => {
    applyRoute(window.location.pathname);
    const onPopState = () => applyRoute(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyRoute]);

  return { applyRoute, navigateTo, normalizeUnitId };
}

export default useAppRouting;
