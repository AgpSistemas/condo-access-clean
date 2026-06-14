import test from "node:test";
import assert from "node:assert/strict";
import { calculateCompanyBilling } from "./billingCalculator.js";

test("calcula condominios ativos e ramais liberados por licenca", () => {
  const result = calculateCompanyBilling(
    {
      id: "company-1",
      billingModel: "PER_CONDOMINIUM",
      baseMonthlyPrice: 50,
      condominiumUnitPrice: 99.99,
      voipBillingModel: "PER_EXTENSION",
      includedExtensions: 2,
      extensionUnitPrice: 3
    },
    [
      { id: "condo-1", companyId: "company-1", status: "ACTIVE" },
      { id: "condo-2", companyId: "company-1", status: "ACTIVE" },
      { id: "condo-3", companyId: "company-1", status: "INACTIVE" }
    ],
    [
      { id: "license-1", companyId: "company-1", tenantId: "condo-1", extensionLimit: 10, active: true },
      { id: "license-2", companyId: "company-1", tenantId: "condo-2", extensionLimit: 5, active: true }
    ]
  );

  assert.equal(result.condominiumQuantity, 2);
  assert.equal(result.billableExtensions, 13);
  assert.equal(result.condominiumSubtotal, 199.98);
  assert.equal(result.extensionSubtotal, 39);
  assert.equal(result.total, 288.98);
});

test("pacote usa os limites contratados como quantidade", () => {
  const result = calculateCompanyBilling({
    id: "company-1",
    billingModel: "PACKAGE",
    maxCondominiums: 2,
    condominiumUnitPrice: 100,
    voipBillingModel: "PACKAGE",
    maxExtensions: 100,
    includedExtensions: 10,
    extensionUnitPrice: 3
  });

  assert.equal(result.condominiumSubtotal, 200);
  assert.equal(result.billableExtensions, 90);
  assert.equal(result.extensionSubtotal, 270);
  assert.equal(result.total, 470);
});
