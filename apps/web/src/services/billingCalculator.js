function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isActive(record = {}) {
  return !["INACTIVE", "BLOCKED", "CANCELLED"].includes(String(record.status || "").toUpperCase()) &&
    record.active !== false;
}

function calculateCompanyBilling(company = {}, condominiums = [], licenses = []) {
  const companyCondominiums = condominiums.filter((condominium) =>
    condominium.companyId === company.id && isActive(condominium)
  );
  const condominiumIds = new Set(companyCondominiums.map((condominium) => condominium.id));
  const companyLicenses = licenses.filter((license) =>
    isActive(license) &&
    (condominiumIds.has(license.tenantId) || (!license.tenantId && license.companyId === company.id))
  );

  const activeCondominiums = companyCondominiums.length;
  const allocatedExtensions = companyLicenses.reduce(
    (total, license) => total + safeNumber(license.extensionLimit),
    0
  );
  const condominiumQuantity = activeCondominiums;
  const extensionQuantity = company.voipBillingModel === "PACKAGE"
    ? safeNumber(company.maxExtensions)
    : allocatedExtensions;
  const billableExtensions = company.voipBillingModel === "DISABLED"
    ? 0
    : Math.max(0, extensionQuantity - safeNumber(company.includedExtensions));

  const baseSubtotal = safeNumber(company.baseMonthlyPrice);
  const condominiumUnitPrice = safeNumber(company.condominiumUnitPrice);
  const extensionUnitPrice = safeNumber(company.extensionUnitPrice);
  const condominiumSubtotal = condominiumQuantity * condominiumUnitPrice;
  const extensionSubtotal = billableExtensions * extensionUnitPrice;

  return {
    companyId: company.id,
    activeCondominiums,
    condominiumQuantity,
    allocatedExtensions,
    extensionQuantity,
    includedExtensions: safeNumber(company.includedExtensions),
    billableExtensions,
    baseSubtotal,
    condominiumUnitPrice,
    condominiumSubtotal,
    extensionUnitPrice,
    extensionSubtotal,
    total: baseSubtotal + condominiumSubtotal + extensionSubtotal
  };
}

function calculateBillingPortfolio(companies = [], condominiums = [], licenses = []) {
  const summaries = companies.map((company) => ({
    company,
    billing: calculateCompanyBilling(company, condominiums, licenses)
  }));
  const activeSummaries = summaries.filter(({ company }) => isActive(company) && company.billingStatus !== "BLOCKED");

  return {
    summaries,
    activeCompanies: activeSummaries.length,
    activeCondominiums: activeSummaries.reduce((total, item) => total + item.billing.activeCondominiums, 0),
    billableExtensions: activeSummaries.reduce((total, item) => total + item.billing.billableExtensions, 0),
    monthlyTotal: activeSummaries.reduce((total, item) => total + item.billing.total, 0)
  };
}

export { calculateCompanyBilling, calculateBillingPortfolio };
