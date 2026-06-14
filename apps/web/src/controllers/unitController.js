import * as service from "../services/unitService.js";
import { resolveResponse } from "./controllerResponse.js";

const saveUnitForm = async (payload) => resolveResponse(await service.saveUnit(payload));
const deleteUnit = async (id) => resolveResponse(await service.deleteUnit(id));
const saveUnitTelephony = async (id, payload) => resolveResponse(await service.saveUnitTelephony(id, payload));

export { saveUnitForm, deleteUnit, saveUnitTelephony };
