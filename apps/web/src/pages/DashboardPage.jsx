import React from "react";
import { Activity, BadgeCheck, Camera, ClipboardList, Home, PhoneCall, RadioTower } from "lucide-react";
import { Field, Metric } from "../components/common/index.js";
import { formatDateTime } from "../config/appConfig.jsx";

function DashboardPage({ selectedTenant, selectedTenantId, setSelectedTenantId, visibleCondominiums, units, tenantDevices, tenantCameras, tenantCalls, tenantEvents, syncState, openCameras, openTelephony }) {
  return (
    <section className="dashboard-panel">
      <div className="resource-hero panel">
        <div>
          <span>Dashboard do condominio</span>
          <h2>{selectedTenant?.name || "-"}</h2>
          <small>{selectedTenant?.document || "Documento nao informado"} - {selectedTenant?.status || "ACTIVE"}</small>
        </div>
        <Field label="Condominio"><select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)}>{visibleCondominiums.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      </div>
      <div className="metrics">
        <Metric icon={Home} label="unidades" value={units.length} />
        <Metric icon={RadioTower} label="equipamentos" value={tenantDevices.length} />
        <Metric icon={Camera} label="cameras" value={tenantCameras.length} />
        <Metric icon={PhoneCall} label="chamadas ativas" value={tenantCalls.length} />
      </div>
      <div className="dashboard-quick-actions">
        <button type="button" onClick={openCameras}><Camera size={18} /> Abrir cameras</button>
        <button type="button" onClick={openTelephony}><PhoneCall size={18} /> Ligar para um ramal</button>
      </div>
      <div className="grid">
        <article className="panel">
          <div className="panel-heading"><h2>Operacao</h2><Activity size={20} /></div>
          <div className="summary-list">
            <span><strong>API</strong> {syncState.status === "offline" ? "Offline" : "Conectada"}</span>
            <span><strong>Ramal portaria</strong> {selectedTenant?.sipPorterExtension || "-"}</span>
            <span><strong>Mobile</strong> Chamada por unidade</span>
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading"><h2>Fila da portaria</h2><PhoneCall size={20} /></div>
          {tenantCalls.length ? <div className="simple-list">{tenantCalls.slice(0, 5).map((call) => <div className="simple-row" key={call.id}><PhoneCall size={18} /><div><strong>Unidade {call.unitNumber || call.unitId}</strong><span>{call.visitorLabel || call.targetType}</span></div><span className="status">{call.status}</span></div>)}</div> : <div className="empty-state">Nenhuma chamada ativa. Chamadas do facial/interfone aparecem aqui em tempo real.</div>}
        </article>
        <article className="panel">
          <div className="panel-heading"><h2>Eventos recentes</h2><ClipboardList size={20} /></div>
          {tenantEvents.length ? <div className="simple-list">{tenantEvents.slice(0, 5).map((event) => <div className="simple-row" key={event.id}><BadgeCheck size={18} /><div><strong>{event.door?.name || event.reason}</strong><span>{event.user?.name || "Portaria"} - {formatDateTime(event.createdAt)}</span></div><span className="status">{event.decision || "INFO"}</span></div>)}</div> : <div className="empty-state">Nenhum evento recebido ainda.</div>}
        </article>
      </div>
    </section>
  );
}

export default DashboardPage;
