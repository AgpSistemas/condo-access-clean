import fs from "node:fs";
import path from "node:path";

const GATEWAY_WINDOWS_VERSION = "0.4.7";
const GATEWAY_WINDOWS_INSTALLER_FILENAME = "CondoAccessGateway-Setup.exe";
const GATEWAY_WINDOWS_ZIP_FILENAME = `CondoAccessGateway-${GATEWAY_WINDOWS_VERSION}.zip`;

// Procura o artefato em dev e em producao para a mesma rota de download funcionar nos dois ambientes.
function gatewayDownloadPath(filename) {
  return [
    path.join(process.cwd(), "apps", "api", "public", "downloads", filename),
    path.join(process.cwd(), "public", "downloads", filename)
  ].find((candidate) => fs.existsSync(candidate)) || "";
}

function gatewayWindowsInstallerPath() {
  return gatewayDownloadPath(GATEWAY_WINDOWS_INSTALLER_FILENAME);
}

function gatewayWindowsZipPath() {
  return gatewayDownloadPath(GATEWAY_WINDOWS_ZIP_FILENAME);
}

export {
  GATEWAY_WINDOWS_INSTALLER_FILENAME,
  GATEWAY_WINDOWS_VERSION,
  GATEWAY_WINDOWS_ZIP_FILENAME,
  gatewayWindowsInstallerPath,
  gatewayWindowsZipPath
};
