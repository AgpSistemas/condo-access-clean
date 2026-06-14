import React, { useEffect, useMemo, useState } from "react";
import { Building2, CreditCard, Landmark, Save, Settings } from "lucide-react";
import { Field } from "../components/common/index.js";
import { calculateBillingPortfolio } from "../services/billingCalculator.js";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

function money(value) {
  return currencyFormatter.format(Number(value || 0));
}

function SettingsPage({ companies, condominiums, licenses, gateway, onSaveBillingProfile }) {
  const portfolio = useMemo(
    () => calculateBillingPortfolio(companies, condominiums, licenses),
    [companies, condominiums, licenses]
  );
  const [selectedCompanyId, setSelectedCompanyId] = useState(companies[0]?.id || "");
  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) || companies[0] || null;
  const [profile, setProfile] = useState({
    billingDueDay: "10",
    defaultPaymentMethod: "PIX",
    billingStatus: "ACTIVE"
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!companies.some((company) => company.id === selectedCompanyId)) {
      setSelectedCompanyId(companies[0]?.id || "");
    }
  }, [companies, selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompany) return;
    setProfile({
      billingDueDay: String(selectedCompany.billingDueDay || 10),
      defaultPaymentMethod: selectedCompany.defaultPaymentMethod || "PIX",
      billingStatus: selectedCompany.billingStatus || "ACTIVE"
    });
  }, [selectedCompany]);

  async function saveProfile(event) {
    event.preventDefault();
    if (!selectedCompany || !onSaveBillingProfile) return;
    setSaving(true);
    try {
      await onSaveBillingProfile(selectedCompany.id, profile);
    } catch {
      // A mensagem de erro e exibida pelo fluxo principal da aplicacao.
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="resource-page billing-page">
      <div className="metrics">
        <article className="metric"><span>Receita mensal prevista</span><strong>{money(portfolio.monthlyTotal)}</strong></article>
        <article className="metric"><span>Empresas faturaveis</span><strong>{portfolio.activeCompanies}</strong></article>
        <article className="metric"><span>Condominios ativos</span><strong>{portfolio.activeCondominiums}</strong></article>
        <article className="metric"><span>Ramais cobrados</span><strong>{portfolio.billableExtensions}</strong></article>
      </div>

      <article className="panel">
        <div className="panel-heading"><h2>Previsao por empresa</h2><Building2 size={20} /></div>
        <div className="billing-company-list">
          {portfolio.summaries.map(({ company, billing }) => (
            <article className="billing-company-card" key={company.id}>
              <header>
                <div><strong>{company.name}</strong><span>{company.billingStatus === "BLOCKED" ? "Cobranca bloqueada" : company.status === "INACTIVE" ? "Empresa inativa" : "Cobranca ativa"}</span></div>
                <strong>{money(billing.total)}</strong>
              </header>
              <div className="billing-breakdown">
                <span>Mensalidade base <strong>{money(billing.baseSubtotal)}</strong></span>
                <span>
                  Condominios ({billing.condominiumQuantity} x {money(billing.condominiumUnitPrice)})
                  <strong>{money(billing.condominiumSubtotal)}</strong>
                </span>
                <span>
                  Ramais ({billing.billableExtensions} x {money(billing.extensionUnitPrice)})
                  <strong>{money(billing.extensionSubtotal)}</strong>
                </span>
              </div>
              <small>
                {billing.activeCondominiums} condominio(s) ativo(s), {billing.allocatedExtensions} ramal(is) liberado(s)
                {billing.includedExtensions ? ` e ${billing.includedExtensions} incluido(s) sem cobranca.` : "."}
              </small>
            </article>
          ))}
          {!companies.length && <div className="empty-state">Nenhuma empresa cadastrada para faturamento.</div>}
        </div>
        <div className="form-hint">
          Em cobranca por uso, a quantidade vem dos condominios ativos e dos ramais liberados nas licencas.
          Em pacote, a quantidade vem do limite contratado.
        </div>
      </article>

      <article className="panel">
        <div className="panel-heading"><h2>Meios de recebimento</h2><CreditCard size={20} /></div>
        <div className="payment-grid">
          {[
            ["PIX", "QR Code e baixa automatica", "Requer gateway"],
            ["Boleto", "Vencimento, multa e conciliacao", "Requer gateway"],
            ["Cartao", "Credito com cobranca recorrente", "Requer gateway"],
            ["Transferencia", "Comprovante e conciliacao manual", "Disponivel manualmente"]
          ].map(([title, description, status]) => (
            <article className="payment-card" key={title}>
              <strong>{title}</strong>
              <span>{description}</span>
              <label>{status}</label>
            </article>
          ))}
        </div>
      </article>

      <form className="panel form-panel" onSubmit={saveProfile}>
        <div className="panel-heading"><h2>Configuracao financeira da empresa</h2><Settings size={20} /></div>
        <div className="form-grid">
          <Field label="Empresa">
            <select value={selectedCompany?.id || ""} onChange={(event) => setSelectedCompanyId(event.target.value)} disabled={!companies.length}>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </Field>
          <Field label="Vencimento">
            <input type="number" min="1" max="31" value={profile.billingDueDay} onChange={(event) => setProfile((current) => ({ ...current, billingDueDay: event.target.value }))} />
          </Field>
          <Field label="Forma padrao">
            <select value={profile.defaultPaymentMethod} onChange={(event) => setProfile((current) => ({ ...current, defaultPaymentMethod: event.target.value }))}>
              <option value="PIX">PIX</option>
              <option value="BOLETO">Boleto</option>
              <option value="CREDIT_CARD">Cartao</option>
              <option value="TRANSFER">Transferencia</option>
            </select>
          </Field>
          <Field label="Status financeiro">
            <select value={profile.billingStatus} onChange={(event) => setProfile((current) => ({ ...current, billingStatus: event.target.value }))}>
              <option value="ACTIVE">Ativa</option>
              <option value="TRIAL">Em teste</option>
              <option value="BLOCKED">Bloqueada</option>
            </select>
          </Field>
          <button type="submit" disabled={!selectedCompany || saving}><Save size={16} /> {saving ? "Salvando..." : "Salvar configuracao"}</button>
        </div>
        <div className={`gateway-status ${gateway?.configured ? "configured" : ""}`}>
          <Landmark size={18} />
          <div>
            <strong>{gateway?.configured ? `Asaas configurado em ${gateway.environment === "production" ? "producao" : "sandbox"}` : "Integracao bancaria ainda nao configurada"}</strong>
            <span>
              {gateway?.configured
                ? gateway.webhookConfigured
                  ? "Chave da API e autenticacao do webhook estao configuradas no servidor."
                  : "A chave da API existe, mas ainda falta configurar a autenticacao do webhook."
                : "Conecte uma conta Asaas no servidor para gerar PIX, boleto e cartao e receber confirmacoes por webhook."}
            </span>
          </div>
        </div>
      </form>
    </section>
  );
}

export default SettingsPage;
