import * as service from "../services/personService.js";
import { resolveResponse } from "./controllerResponse.js";

const savePersonForm = async (payload) => resolveResponse(await service.savePerson(payload));
const deletePerson = async (id) => resolveResponse(await service.deletePerson(id));
const saveSyndic = async (payload) => resolveResponse(await service.saveSyndic(payload));

export { savePersonForm, deletePerson, saveSyndic };
