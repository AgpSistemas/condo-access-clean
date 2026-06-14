import * as service from "../services/credentialService.js";
import { resolveResponse } from "./controllerResponse.js";

const saveCredentialForm = async (payload) => resolveResponse(await service.saveCredential(payload));
const deleteCredential = async (id) => resolveResponse(await service.deleteCredential(id));
const generateCredential = async (payload) => resolveResponse(await service.generateCredential(payload));
const importCredentials = async (payload) => resolveResponse(await service.importCredentials(payload));

export { saveCredentialForm, deleteCredential, generateCredential, importCredentials };
