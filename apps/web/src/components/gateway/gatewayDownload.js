const GATEWAY_WINDOWS_VERSION = "0.4.6";

function gatewayWindowsZipDownloadPath() {
  return `/api/gateways/download/windows.zip?v=${encodeURIComponent(GATEWAY_WINDOWS_VERSION)}`;
}

export { GATEWAY_WINDOWS_VERSION, gatewayWindowsZipDownloadPath };
