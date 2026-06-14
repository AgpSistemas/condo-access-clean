import React from "react";
import { Building2, Save, Search } from "lucide-react";
import { Field } from "../components/common/index.js";
import { condoTotalUnits } from "../config/appConfig.jsx";

function CondominiumFormPage({ mode, tenant, data, condoGeo, setCondoGeo, onSave, onGeocode, onUpdateTotal }) {
  return (
    <section className="condo-form-page">
      <form className="panel form-panel" key={`${mode}-${tenant?.id || "new"}`} onSubmit={onSave}>
        <div className="panel-heading"><h2>Cadastro do condominio</h2><Building2 size={20} /></div>
        <div className="form-grid">
          <input type="hidden" name="id" value={tenant?.id || ""} />
          <Field label="Empresa cliente"><select name="companyId" defaultValue={tenant?.companyId || ""}><option value="">Sem empresa vinculada</option>{data.companies.filter((company) => company.status !== "INACTIVE" || company.id === tenant?.companyId).map((company) => <option key={company.id} value={company.id}>{company.name} ({data.condominiums.filter((condo) => condo.companyId === company.id).length}/{company.maxCondominiums})</option>)}</select></Field>
          <Field label="Nome"><input name="name" defaultValue={tenant?.name || ""} /></Field>
          <Field label="Documento"><input name="document" defaultValue={tenant?.document || ""} /></Field>
          <Field label="Status"><select name="status" defaultValue={tenant?.status || "ACTIVE"}><option>ACTIVE</option><option>INACTIVE</option></select></Field>
          <Field label="Tipo"><select name="structureType" defaultValue={tenant?.structureType || "VERTICAL"}><option value="VERTICAL">Vertical</option><option value="HORIZONTAL">Horizontal</option></select></Field>
          <Field label="Andares / quadras"><input name="structureGroupCount" type="number" min="1" defaultValue={tenant?.structureGroupCount || ""} onChange={onUpdateTotal} /></Field>
          <Field label="Aps por andar / quadra"><input name="unitsPerGroup" type="number" min="1" defaultValue={tenant?.unitsPerGroup || ""} onChange={onUpdateTotal} /></Field>
          <Field label="Quantidade de unidades"><input name="totalUnits" type="number" min="0" readOnly defaultValue={condoTotalUnits(tenant) || ""} /></Field>
          <Field label="Endereco"><input name="address" defaultValue={tenant?.address || ""} /></Field>
          <Field label="Numero"><input name="addressNumber" defaultValue={tenant?.addressNumber || ""} /></Field>
          <Field label="Cidade"><input name="city" defaultValue={tenant?.city || ""} /></Field>
          <Field label="Estado"><input name="state" maxLength="2" defaultValue={tenant?.state || ""} /></Field>
          <Field label="Latitude"><input name="latitude" value={condoGeo.latitude} onChange={(event) => setCondoGeo((current) => ({ ...current, latitude: event.target.value }))} /></Field>
          <Field label="Longitude"><input name="longitude" value={condoGeo.longitude} onChange={(event) => setCondoGeo((current) => ({ ...current, longitude: event.target.value }))} /></Field>
          <Field label="Gerar unidades"><label className="checkbox-row"><input name="generateUnits" type="checkbox" defaultChecked={mode === "new" || Boolean(tenant?.structureGroupCount && tenant?.unitsPerGroup)} /> Criar apartamentos/unidades automaticamente</label></Field>
          <input type="hidden" name="telephonyProvider" value={tenant?.telephonyProvider || "DIRECT_SIP"} />
          <input type="hidden" name="sipDomain" value={tenant?.sipDomain || ""} />
          <input type="hidden" name="sipWebSocketUrl" value={tenant?.sipWebSocketUrl || ""} />
          <input type="hidden" name="sipExtensionStart" value={tenant?.sipExtensionStart || "9100"} />
          <input type="hidden" name="sipExtensionEnd" value={tenant?.sipExtensionEnd || "9199"} />
          <Field label="Ramal da portaria"><input name="sipPorterExtension" defaultValue={tenant?.sipPorterExtension || "9000"} /></Field>
          <button className="secondary-button" type="button" onClick={onGeocode}><Search size={16} /> Buscar geolocalizacao</button>
          <button type="submit"><Save size={16} /> Salvar condominio</button>
        </div>
      </form>
    </section>
  );
}

export default CondominiumFormPage;
