import React from "react";
import { BadgeCheck, Building2, Camera, ClipboardList, Home, KeySquare, PhoneCall, RadioTower, ShieldCheck, Users } from "lucide-react";
import { Metric } from "../components/common/index.js";
import { formatDateTime } from "../config/appConfig.jsx";

function CondominiumDashboardPage({ selectedTenant, units, residents, tenantDevices, tenantCameras, tenantCalls, tenantEvents, navigateTo, setActiveSection, setDeviceTab, setCondoFormMode }) {
  const functionCards = [
    ["units", "Unidades", Home, "Cadastro, moradores, telefonia e convites", () => navigateTo("/unidades")],
    ["residents", "Pessoas", Users, "Moradores, visitantes e prestadores", () => setActiveSection("residents")],
    ["devices", "Equipamentos", RadioTower, "Faciais, NVRs, controladoras e SDK", () => { setActiveSection("devices"); setDeviceTab("inicio"); }],
    ["cameras", "Cameras", Camera, "Canais e streams do condominio", () => { setActiveSection("devices"); setDeviceTab("cameras"); }],
    ["actions", "Acionamentos", KeySquare, "Portas, reles e comandos remotos", () => { setActiveSection("devices"); setDeviceTab("actions"); }],
    ["credentials", "Credenciais", BadgeCheck, "Face, QR, RFID e sincronismo", () => setActiveSection("credentials")],
    ["permissions", "Permissoes", ShieldCheck, "Perfis por usuario e rota", () => setActiveSection("permissions")],
    ["resources", "Recursos", ClipboardList, "Modulos habilitados e gateway", () => setActiveSection("resources")]
  ];

  return (
    <section className="dashboard-panel">
      <div className="resource-hero panel">
        <div>
          <span>Painel do condominio</span>
          <h2>{selectedTenant?.name || "-"}</h2>
          <small>{selectedTenant?.document || "Documento nao informado"} - {selectedTenant?.status || "ACTIVE"}</small>
        </div>
        <button type="button" onClick={() => { setCondoFormMode("edit"); setActiveSection("condoForm"); }}><Building2 size={16} /> Editar cadastro</button>
      </div>
      <div className="metrics">
        <Metric icon={Home} label="unidades" value={units.length} />
        <Metric icon={Users} label="pessoas" value={residents.filter((person) => person.tenantId === selectedTenant?.id).length} />
        <Metric icon={RadioTower} label="equipamentos" value={tenantDevices.length} />
        <Metric icon={Camera} label="cameras" value={tenantCameras.length} />
      </div>
      <div className="condo-function-grid">
        {functionCards.map(([id, label, Icon, detail, onClick]) => <button className="condo-function-card" type="button" key={id} onClick={onClick}><Icon size={22} /><strong>{label}</strong><span>{detail}</span></button>)}
      </div>
      <div className="grid">
        <article className="panel">
          <div className="panel-heading"><h2>Eventos do condominio</h2><ClipboardList size={20} /></div>
          {tenantEvents.length ? <div className="simple-list">{tenantEvents.slice(0, 6).map((event) => <div className="simple-row" key={event.id}><BadgeCheck size={18} /><div><strong>{event.door?.name || event.reason}</strong><span>{event.user?.name || "Portaria"} - {formatDateTime(event.createdAt)}</span></div><span className="status">{event.decision || "INFO"}</span></div>)}</div> : <div className="empty-state">Nenhum evento recebido ainda.</div>}
        </article>
        <article className="panel">
          <div className="panel-heading"><h2>Chamadas</h2><PhoneCall size={20} /></div>
          {tenantCalls.length ? <div className="simple-list">{tenantCalls.slice(0, 6).map((call) => <div className="simple-row" key={call.id}><PhoneCall size={18} /><div><strong>Unidade {call.unitNumber || call.unitId}</strong><span>{call.visitorLabel || call.targetType}</span></div><span className="status">{call.status}</span></div>)}</div> : <div className="empty-state">Nenhuma chamada para este condominio.</div>}
        </article>
      </div>
    </section>
  );
}

export default CondominiumDashboardPage;
