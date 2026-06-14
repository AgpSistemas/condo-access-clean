import * as service from "../services/deviceService.js";
import { resolveResponse } from "./controllerResponse.js";

const saveDeviceForm = async (payload) => resolveResponse(await service.saveDevice(payload));
const deleteDevice = async (id) => resolveResponse(await service.deleteDevice(id));
const refreshDeviceStatus = async (tenantId) => resolveResponse(await service.refreshDeviceStatus(tenantId));
const testDeviceIntegration = async (id) => resolveResponse(await service.testDevice(id));

export { saveDeviceForm, deleteDevice, refreshDeviceStatus, testDeviceIntegration };
