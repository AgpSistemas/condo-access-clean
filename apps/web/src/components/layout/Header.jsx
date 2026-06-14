import React from "react";
import { RefreshCw } from "lucide-react";
import Logo from "../../logo.png";

function Header({ activeSection, ActiveIcon, topbarLabel, setActiveSection, syncNow, logout }) {
  return (
    <header className="topbar">
      <div className="titulo">
        {(activeSection === "condoHome" || activeSection === "condoForm") && <button className="secondary-button back-title-button" type="button" onClick={() => setActiveSection("condominiums")}>{"<-"} Voltar</button>}
        <img className="logo" src={Logo} alt="" />
        <h1><ActiveIcon size={28} /> {topbarLabel}</h1>
      </div>
      <div className="toolbar-actions">
        <button onClick={() => void syncNow()}><RefreshCw size={16} /> Sincronizar</button>
        <button className="secondary-button" onClick={() => void logout()}>Sair</button>
      </div>
    </header>
  );
}

export default Header;
