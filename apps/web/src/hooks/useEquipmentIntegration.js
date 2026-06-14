import { useState } from "react";
import { faceImportSelectionKey, importSelectionBase, sameText } from "../config/appConfig.jsx";
import * as controller from "../controllers/equipmentIntegrationController.js";

const initialIntegration = {
  deviceId: "",
  resource: "events",
  loading: false,
  importing: false,
  error: "",
  updatedAt: "",
  payload: null,
  importReport: null
};

function useEquipmentIntegration({ devices, units, setMessage, refreshApiCache, setData, setActiveSection, setUnitTab, setPersonSubtab }) {
  const [equipmentIntegration, setEquipmentIntegration] = useState(initialIntegration);
  const [equipmentFaceSelections, setEquipmentFaceSelections] = useState({});
  const [equipmentFacePreviewPage, setEquipmentFacePreviewPage] = useState(1);
  const selectedIntegrationDevice = devices.find((device) => device.id === equipmentIntegration.deviceId) || devices[0];

  async function readEquipmentIntegration(resource = equipmentIntegration.resource) {
    const deviceId = equipmentIntegration.deviceId || selectedIntegrationDevice?.id || "";
    if (!deviceId) return setMessage("Cadastre um equipamento antes de ler integracoes.");
    setEquipmentIntegration((current) => ({ ...current, deviceId, resource, loading: true, error: "" }));
    const { response, result } = await controller.readEquipmentIntegration(deviceId, resource, 80);
    if (!response.ok) {
      const error = result.message || "Falha ao ler integracao do equipamento.";
      setEquipmentIntegration((current) => ({ ...current, loading: false, error }));
      return setMessage(error);
    }
    setEquipmentIntegration((current) => ({ ...current, resource, loading: false, error: "", updatedAt: result.generatedAt || new Date().toISOString(), payload: result }));
    const count = Array.isArray(result.records) ? result.records.length : result.summary?.[resource] || 0;
    setMessage(`${result.device?.name || "Equipamento"}: ${count} registro(s) em ${resource}.`);
  }

  function updateEquipmentCredentialSelection(item, patch = {}) {
    const key = faceImportSelectionKey(item);
    setEquipmentFaceSelections((current) => {
      const currentSelection = current[key] || {};
      const unit = patch.unitId ? units.find((candidate) => candidate.unitId === patch.unitId) : null;
      const typedUnit = String(patch.unitNumber || "").trim();
      const clearedUnit = Object.prototype.hasOwnProperty.call(patch, "unitId") && !patch.unitId && !typedUnit ? { unitId: "", unitNumber: "", blockName: "" } : {};
      return { ...current, [key]: { ...importSelectionBase(item, currentSelection), ...patch, ...clearedUnit, ...(unit ? { unitId: unit.unitId, unitNumber: unit.unitNumber || "", blockName: unit.blockName || "" } : {}) } };
    });
  }

  function updateEquipmentCredentialUnit(item, value = "") {
    const clean = String(value || "").trim();
    const unit = units.find((candidate) => sameText(`Unidade ${candidate.unitNumber}${candidate.blockName ? ` - ${candidate.blockName}` : ""}`, clean) || sameText(candidate.unitNumber, clean));
    if (unit) return updateEquipmentCredentialSelection(item, { unitId: unit.unitId });
    const [unitNumber = "", ...blockParts] = clean.replace(/^unidade\s+/i, "").split(/\s+-\s+/);
    updateEquipmentCredentialSelection(item, { unitId: "", unitNumber: unitNumber.trim(), blockName: blockParts.join(" - ").trim() });
  }

  function updateAllEquipmentCredentialSelections(selected, items = []) {
    const visibleKeys = new Set(items.filter((item) => equipmentIntegration.resource !== "faces" || item.payload?.type === "FACE").map(faceImportSelectionKey));
    setEquipmentFaceSelections((current) => Object.fromEntries(Object.entries(current).map(([key, selection]) => [key, visibleKeys.has(key) ? { ...selection, selected } : selection])));
  }

  async function importEquipmentCredentials(dryRun = true, resource = "credentials") {
    const deviceId = equipmentIntegration.deviceId || selectedIntegrationDevice?.id || "";
    if (!deviceId) return setMessage("Selecione um equipamento para buscar credenciais.");
    setEquipmentIntegration((current) => ({ ...current, deviceId, resource, importing: true, error: "" }));
    const { response, result: report } = await controller.importEquipmentCredentials(deviceId, { dryRun, resource, selections: dryRun ? [] : Object.values(equipmentFaceSelections) });
    if (!response.ok) {
      const error = report.message || "Falha ao importar credenciais do equipamento.";
      setEquipmentIntegration((current) => ({ ...current, importing: false, error, importReport: report }));
      return setMessage(error);
    }
    setEquipmentIntegration((current) => ({ ...current, importing: false, updatedAt: report.generatedAt || new Date().toISOString(), importReport: report }));
    if (dryRun) {
      const selections = {};
      (report.items || []).filter((item) => item.payload?.type && item.payload?.value).forEach((item) => {
        selections[faceImportSelectionKey(item)] = importSelectionBase(item, { selected: resource !== "faces" || item.payload?.type === "FACE" });
      });
      setEquipmentFaceSelections(selections);
      setEquipmentFacePreviewPage(1);
    } else {
      const payload = await refreshApiCache();
      if (payload) {
        setData(payload);
        setActiveSection("units");
        setUnitTab("moradores");
        setPersonSubtab("moradores");
      }
    }
    setMessage(dryRun ? `${report.total || 0} credencial(is) encontrada(s) no equipamento para conferencia.` : `Importacao concluida: ${report.credentialsCreated || 0} nova(s), ${report.credentialsUpdated || 0} atualizada(s), ${report.eventsCreated || 0} evento(s) salvo(s).`);
  }

  const readEquipmentIntegrationResource = (resource = equipmentIntegration.resource) => resource === "faces" ? importEquipmentCredentials(true, "faces") : readEquipmentIntegration(resource);

  return {
    equipmentIntegration,
    setEquipmentIntegration,
    equipmentFaceSelections,
    equipmentFacePreviewPage,
    setEquipmentFacePreviewPage,
    selectedIntegrationDevice,
    readEquipmentIntegrationResource,
    updateEquipmentCredentialSelection,
    updateEquipmentCredentialUnit,
    updateAllEquipmentCredentialSelections,
    importEquipmentCredentials
  };
}

export default useEquipmentIntegration;
