import * as service from "../services/vehicleService.js";
import { resolveResponse } from "./controllerResponse.js";

const saveVehicleForm = async (payload) => resolveResponse(await service.saveVehicle(payload));
const deleteVehicle = async (id) => resolveResponse(await service.deleteVehicle(id));
const syncVehicleTag = async (id, deviceId) => resolveResponse(await service.syncVehicleTag(id, deviceId));
const removeVehicleTag = async (id, deviceId) => resolveResponse(await service.removeVehicleTag(id, deviceId));

export { saveVehicleForm, deleteVehicle, syncVehicleTag, removeVehicleTag };
