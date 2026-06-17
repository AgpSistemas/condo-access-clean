import { RadioTower } from "lucide-react";

import { Field } from "../common.jsx";
import { apiPath } from "../../services/api.js";
import { GATEWAY_WINDOWS_VERSION, gatewayWindowsZipDownloadPath } from "./gatewayDownload.js";

function GatewayInstallationPanel({
  data,
  selectedTenant,
  selectedTenantId,
  setSelectedTenantId,
  visibleCondominiums,
  gatewayForm,
  setGatewayForm,
  prepareGatewayInstallation,
  copyGatewayInstallCode,
  startLocalGatewayDeviceRegistration,
  formatDateTime
}) {
  const gateway = (data.gateways || []).find((item) => item.tenantId === selectedTenant?.id);
  const installCodeValid = gateway?.installCode && Date.parse(gateway.installCodeExpiresAt || "") > Date.now();

  return (
    <section className="gateway-download-layout">
      <form className="gateway-activation-card" onSubmit={prepareGatewayInstallation}>
        <div className="panel-heading">
          <div><h2>Configurar Gateway local</h2><small>Escolha o condominio e prepare a instalacao. A URL da API ja vem configurada.</small></div>
          <span className={`status ${gateway?.online ? "" : "offline"}`}>{gateway?.online ? "Online" : "Offline"}</span>
        </div>
        <div className="form-grid gateway-config-form">
          <Field label="Condominio">
            <select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)}>
              {visibleCondominiums.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Nome da instalacao">
            <input required value={gatewayForm.label} onChange={(event) => setGatewayForm({ label: event.target.value })} placeholder="Ex.: Portaria principal" />
          </Field>
        </div>
        <div className="gateway-install-action">
          <button type="submit">Preparar instalacao</button>
          <span>O instalador pedira somente o codigo abaixo.</span>
        </div>
      </form>

      <article className="gateway-download-card">
        <div>
          <strong>Condo Access Gateway para Windows</strong>
          <span>{installCodeValid
            ? `Instalacao preparada para ${selectedTenant?.name}. Baixe e informe o codigo exibido abaixo.`
            : "Prepare a instalacao acima para liberar o download vinculado ao condominio."}</span>
        </div>
        {installCodeValid
          ? <a className="gateway-download-button" href={apiPath(gatewayWindowsZipDownloadPath())} download>Baixar Gateway Windows {GATEWAY_WINDOWS_VERSION}</a>
          : <button className="gateway-download-button disabled" type="button" disabled>Prepare para baixar</button>}
      </article>

      {installCodeValid && (
        <article className="gateway-install-code-card">
          <div>
            <strong>Codigo de instalacao</strong>
            <b className="gateway-install-code">{gateway.installCode}</b>
            <span>Valido por 24 horas para {selectedTenant?.name}. Nao e necessario informar URL nem ID do condominio.</span>
          </div>
          <button className="secondary-button" type="button" onClick={() => void copyGatewayInstallCode(gateway.installCode)}>Copiar codigo</button>
        </article>
      )}

      <article className="gateway-activation-card">
        <div className="panel-heading"><h2>Status da instalacao</h2><span className={`status ${gateway?.online ? "" : "offline"}`}>{gateway?.online ? "Online" : "Offline"}</span></div>
        <div className="summary-list">
          <span><strong>Condominio</strong>{selectedTenant?.name || "-"}</span>
          <span><strong>Instalacao</strong>{gateway?.label || "Ainda nao preparada"}</span>
          <span><strong>Computador</strong>{gateway?.hostname || "Ainda nao conectado"}</span>
          <span><strong>Ultima conexao</strong>{gateway?.lastSeenAt ? formatDateTime(gateway.lastSeenAt) : "Aguardando instalacao"}</span>
        </div>
        {gateway?.online && <button type="button" onClick={startLocalGatewayDeviceRegistration}>Cadastrar equipamento local</button>}
        {gateway?.installCode && !installCodeValid && <div className="form-hint">O ultimo codigo expirou. Clique abaixo para preparar outro.</div>}
        {gateway?.installCode && <button className="secondary-button" type="button" onClick={(event) => void prepareGatewayInstallation(event, true)}>Gerar novo codigo</button>}
      </article>

      <article className="panel gateway-setup-guide">
        <div className="panel-heading"><h2>Como conectar equipamentos da rede local</h2><RadioTower size={20} /></div>
        <div className="gateway-setup-steps">
          <span><strong>1. Prepare e instale</strong>Selecione o condominio, prepare a instalacao, baixe e informe apenas o codigo exibido.</span>
          <span><strong>2. Cadastre o IP local</strong>Em Cadastro, informe o IP do equipamento, por exemplo 192.168.1.50, e selecione Gateway local.</span>
          <span><strong>3. Teste o acionamento</strong>Cadastre um acionamento para o equipamento e execute a abertura pelo painel.</span>
        </div>
        <div className="form-hint">O computador da portaria e os equipamentos precisam estar na mesma rede. Nenhuma porta de entrada precisa ser liberada no roteador.</div>
      </article>
    </section>
  );
}

export default GatewayInstallationPanel;
