import React from "react";
import { WifiOff } from "lucide-react";
import { formatDateTime } from "../../config/appConfig.jsx";

function StatusBanner({ status, error, lastSyncAt }) {
  if (status !== "offline" && !error) return null;
  return (
    <div className="sync-banner offline">
      <div>
        <WifiOff size={20} />
        <strong>Nao foi possivel atualizar</strong>
        <span>Ultima sincronizacao {formatDateTime(lastSyncAt)}</span>
      </div>
      <small>{error || "Verifique a conexao com a API e tente novamente."}</small>
    </div>
  );
}

export default StatusBanner;
