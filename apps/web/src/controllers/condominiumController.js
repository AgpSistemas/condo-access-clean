import * as service from "../services/condominiumService.js";
import { resolveResponse } from "./controllerResponse.js";

const createOrUpdateCondo = async (payload) => resolveResponse(await service.saveCondominium(payload));
const deleteCondo = async (id) => resolveResponse(await service.deleteCondominium(id));
const saveTenantTelephony = async (id, payload) => resolveResponse(await service.saveCondominiumTelephony(id, payload));

export { createOrUpdateCondo, deleteCondo, saveTenantTelephony };
