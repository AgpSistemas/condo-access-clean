import * as authService from "../services/authService.js";

const authenticate = (credentials) => authService.login(credentials);
const redefinePassword = (payload) => authService.changePassword(payload);
const endSession = (accessToken) => authService.logout(accessToken);

export { authenticate, redefinePassword, endSession };
