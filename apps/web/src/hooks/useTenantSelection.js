import { useMemo } from "react";
import { condoSections, sections, settingsSections } from "../config/routes.js";

function useTenantSelection({ data, session, activeSection, selectedTenantId, selectedUnitId, unitSearch, condoFormMode }) {
  const roleSections = session?.role === "PORTER"
    ? sections.filter((section) => ["dashboard", "remotePorter", "telephony"].includes(section.id))
    : session?.role === "RESIDENT"
      ? sections.filter((section) => section.id === "dashboard")
      : sections;
  const allowedSettingsSections = session?.role === "SUPER_ADMIN" ? settingsSections : [];
  const active = [...roleSections, ...condoSections, ...allowedSettingsSections].find((section) => section.id === activeSection) || sections[0];
  const visibleCondominiums = data.condominiums.filter((item) =>
    (!session?.companyId || item.companyId === session.companyId) &&
    (!session?.tenantId || item.id === session.tenantId)
  );
  const selectedTenant = visibleCondominiums.find((item) => item.id === selectedTenantId) || visibleCondominiums[0];
  const sessionCompany = data.companies.find((company) => company.id === session?.companyId) || null;
  const condoFormTenant = condoFormMode === "new" ? null : selectedTenant;
  const units = useMemo(() => data.units.filter((unit) => unit.tenantId === selectedTenant?.id), [data.units, selectedTenant?.id]);
  const filteredUnits = useMemo(() => {
    const term = unitSearch.trim().toLowerCase();
    if (!term) return units;
    return units.filter((unit) => `${unit.unitNumber} ${unit.blockName} ${unit.residentName} ${unit.responsibleName} ${unit.telephony?.extension || unit.extension || ""}`.toLowerCase().includes(term));
  }, [unitSearch, units]);
  const selectedUnit = units.find((unit) => unit.unitId === selectedUnitId) || null;

  return { roleSections, allowedSettingsSections, active, visibleCondominiums, selectedTenant, sessionCompany, condoFormTenant, units, filteredUnits, selectedUnit };
}

export default useTenantSelection;
