import * as service from "../services/equipmentIntegrationService.js";
import { resolveResponse } from "./controllerResponse.js";

const readEquipmentIntegration = async (deviceId, resource, limit) => resolveResponse(await service.readIntegrationResource(deviceId, resource, limit));
const importEquipmentCredentials = async (deviceId, payload) => resolveResponse(await service.importEquipmentCredentials(deviceId, payload));

export { readEquipmentIntegration, importEquipmentCredentials };
