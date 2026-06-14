import * as service from "../services/actionService.js";
import { resolveResponse } from "./controllerResponse.js";

const saveActionForm = async (payload) => resolveResponse(await service.saveAction(payload));
const deleteAction = async (id) => resolveResponse(await service.deleteAction(id));
const triggerAction = async (id) => resolveResponse(await service.triggerAction(id));
const toggleResource = async (id, payload) => resolveResponse(await service.saveResource(id, payload));
const saveResourceConfiguration = async (id, payload) => resolveResponse(await service.saveResourceConfiguration(id, payload));

export { saveActionForm, deleteAction, triggerAction, toggleResource, saveResourceConfiguration };
