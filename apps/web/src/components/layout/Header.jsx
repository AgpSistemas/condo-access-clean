import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import Logo from "../../logo.png";

function Header({ activeSection, ActiveIcon, topbarLabel, setActiveSection, syncNow, logout }) {
  const [apiPending, setApiPending] = useState(0);
  const apiBusy = apiPending > 0;

  useEffect(() => {
    function handlePending(event) {
      setApiPending(Number(event.detail?.pending || 0));
    }
    window.addEventListener("condo-api-pending", handlePending);
    return () => window.removeEventListener("condo-api-pending", handlePending);
  }, []);

  return (
    <header className="topbar">
      <style>{`
        @keyframes condo-api-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .api-spin { animation: condo-api-spin 0.8s linear infinite; }
      `}</style>
      <div className="titulo">
        {(activeSection === "condoHome" || activeSection === "condoForm") && <button className="secondary-button back-title-button" type="button" onClick={() => setActiveSection("condominiums")}>{"<-"} Voltar</button>}
        <img className="logo" src={Logo} alt="" />
        <h1><ActiveIcon size={28} /> {topbarLabel}</h1>
      </div>
      <div className="toolbar-actions">
        <button onClick={() => void syncNow()} disabled={apiBusy}>
          <RefreshCw className={apiBusy ? "api-spin" : ""} size={16} />
          {apiBusy ? "Processando..." : "Sincronizar"}
        </button>
        <button className="secondary-button" onClick={() => void logout()}>Sair</button>
      </div>
    </header>
  );
}

export default Header;
