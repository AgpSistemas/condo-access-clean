import * as service from "../services/cameraService.js";
import { resolveResponse } from "./controllerResponse.js";

const saveCameraForm = async (payload) => resolveResponse(await service.saveCamera(payload));
const deleteCamera = async (id) => resolveResponse(await service.deleteCamera(id));
const stopCameraStream = (streamKey) => service.stopCameraStream(streamKey);

export { saveCameraForm, deleteCamera, stopCameraStream };
