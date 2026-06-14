import React from "react";
import { Building2, Home, KeySquare, MoreVertical, Plus, RadioTower, Save, Search, Trash2, Users } from "lucide-react";
import { Pagination } from "../components/common/index.js";

function CondominiumsPage({ search, setSearch, setCondoFormMode, setActiveSection, condoPager, selectedTenantId, setSelectedTenantId, data, navigateTo, deleteCondo }) {
  return (
    <section className="condominiums-page">
      <div className="resource-toolbar">
        <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquise o nome ou documento do condominio" /></label>
        <button type="button" onClick={() => { setCondoFormMode("new"); setActiveSection("condoForm"); }}><Plus size={16} /> Novo condominio</button>
      </div>
      <div className="condo-cards">
        {condoPager.pageItems.map((condo) => (
          <article className={`condo-card clickable-card ${condo.id === selectedTenantId ? "selected" : ""}`} key={condo.id} onClick={() => { setSelectedTenantId(condo.id); setCondoFormMode("edit"); setActiveSection("condoHome"); }}>
            <header>
              <button className="card-title-button" onClick={(event) => { event.stopPropagation(); setSelectedTenantId(condo.id); setCondoFormMode("edit"); setActiveSection("condoHome"); }}>{condo.name}</button>
              <button className="icon-button secondary-button" onClick={(event) => event.stopPropagation()}><MoreVertical size={18} /></button>
            </header>
            <div className="condo-card-body">
              <span><Building2 size={16} /> {data.companies.find((company) => company.id === condo.companyId)?.name || "Sem empresa vinculada"}</span>
              <span><Users size={16} /> {data.units.filter((unit) => unit.tenantId === condo.id).length} unidades</span>
              <span><RadioTower size={16} /> {data.devices.filter((device) => device.tenantId === condo.id).length} equipamentos</span>
              <span><KeySquare size={16} /> Documento {condo.document || "nao informado"}</span>
            </div>
            <footer onClick={(event) => event.stopPropagation()}>
              <button className="secondary-button" onClick={() => { setSelectedTenantId(condo.id); navigateTo(`/licencas/${data.licenses.find((license) => license.tenantId === condo.id)?.code || condo.id}/unidades`); }}><Home size={15} /> Unidades</button>
              <button className="secondary-button" onClick={() => { setSelectedTenantId(condo.id); setCondoFormMode("edit"); setActiveSection("condoForm"); }}><Save size={15} /> Editar</button>
              <button className="danger-button" type="button" onClick={() => void deleteCondo(condo)}><Trash2 size={15} /> Excluir</button>
            </footer>
          </article>
        ))}
      </div>
      <Pagination page={condoPager.page} totalPages={condoPager.totalPages} onPage={condoPager.setPage} />
    </section>
  );
}

export default CondominiumsPage;
