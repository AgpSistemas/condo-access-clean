import React from "react";
import { ClipboardList, Save, ServerCog } from "lucide-react";

function SdkPage({ manufacturerProfiles }) {
  return (
    <section className="resource-page">
      <article className="panel">
        <div className="panel-heading"><h2>SDK equipamentos</h2><ServerCog size={20} /></div>
        <div className="manufacturer-grid">
          {manufacturerProfiles.map((profile) => <article className="manufacturer-card" key={profile.id}><div><strong>{profile.name}</strong><span>{profile.families.join(" / ")}</span></div><div className="tag-list">{profile.protocols.map((item) => <em key={item}>{item}</em>)}</div><small>Portas padrao: {profile.defaultPorts.join(", ")}</small><small>Credenciais: {profile.credentialTypes.join(", ")}</small><p>{profile.notes}</p></article>)}
        </div>
      </article>
      <article className="panel">
        <div className="panel-heading"><h2>Checklist de integracao</h2><ClipboardList size={20} /></div>
        <div className="resource-checklist">{["Nao salvar imagem pesada na API", "Usar URL/stream e snapshot sob demanda", "Fila para credenciais faciais", "Gateway local para equipamentos sem API HTTP", "Webhooks/eventos para atualizar status em tempo real"].map((item) => <span key={item}><Save size={16} /> {item}</span>)}</div>
      </article>
    </section>
  );
}

export default SdkPage;
