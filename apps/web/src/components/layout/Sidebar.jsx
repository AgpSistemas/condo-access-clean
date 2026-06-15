import React from "react";
import Logo from "../../logo.png";

function Sidebar({ session, sessionCompany, primarySections, allowedSettingsSections, condoSections, showCondoMenu, selectedTenant, activeSection, setActiveSection, setResourceTab, setDeviceTab, navigateTo }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={sessionCompany?.logoUrl || Logo} alt={sessionCompany?.name || "Condo Access"} />
        <div><strong>{sessionCompany?.name || "Condo Access"}</strong><span>{session?.role === "SUPER_ADMIN" ? "Gestao geral do sistema" : session?.role === "COMPANY_ADMIN" ? "Gestao da empresa" : session?.role === "CONDO_ADMIN" ? "Gestao do condominio" : session?.role === "PORTER" ? "Painel da portaria" : "Area do morador"}</span></div>
      </div>
      <nav>
        {primarySections.map((section) => {
          const Icon = section.icon;
          return <button key={section.id} className={section.id === activeSection || (section.id === "condominiums" && activeSection === "condoForm") ? "active" : ""} onClick={() => {
            setActiveSection(section.id);
            if (section.id === "remotePorter") setResourceTab("portaria");
          }}><Icon size={18} />{section.label}</button>;
        })}
        {!showCondoMenu && <div className="nav-group">
          <span>Configuracoes</span>
          {allowedSettingsSections.map((section) => {
            const Icon = section.icon;
            return <button key={section.id} className={section.id === activeSection ? "active" : ""} onClick={() => setActiveSection(section.id)}><Icon size={18} />{section.label}</button>;
          })}
        </div>}
        {showCondoMenu && <div className="nav-group">
          <span>{selectedTenant?.name || "Condominio"}</span>
          {condoSections.map((section) => {
            const Icon = section.icon;
            return <button key={section.id} className={section.id === activeSection ? "active" : ""} onClick={() => {
              if (section.id === "units") navigateTo("/unidades");
              else setActiveSection(section.id);
              if (section.id === "devices") setDeviceTab("inicio");
            }}><Icon size={18} />{section.label}</button>;
          })}
        </div>}
      </nav>
    </aside>
  );
}

export default Sidebar;
