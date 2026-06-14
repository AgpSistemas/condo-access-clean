import * as service from "../services/telephonyService.js";
import { resolveResponse } from "./controllerResponse.js";

const callUnit = async (payload) => resolveResponse(await service.startPorterCall(payload));
const callExtension = async (payload) => resolveResponse(await service.startExtensionCall(payload));
const notifyMobileCall = async (payload) => resolveResponse(await service.notifyMobileCall(payload));
const fetchCalls = () => service.fetchCalls();
const answerCall = async (id) => resolveResponse(await service.answerCall(id));
const endCall = async (id) => resolveResponse(await service.endCall(id));
const fetchExtensionStatus = (tenantId) => service.fetchExtensionStatus(tenantId);

export { callUnit, callExtension, notifyMobileCall, fetchCalls, answerCall, endCall, fetchExtensionStatus };
