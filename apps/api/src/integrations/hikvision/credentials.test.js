import test from "node:test";
import assert from "node:assert/strict";
import { hikvisionEmployeeNoForCredential } from "./credentials.js";

test("gera employeeNo distinto para pessoas diferentes na mesma unidade", () => {
  const unitForId = () => ({ unitNumber: "101" });
  const first = hikvisionEmployeeNoForCredential(
    { id: "credential-face-a", unitId: "unit-101", type: "FACE", value: "FACE-A" },
    { id: "person-alpha", name: "Pessoa A" },
    { unitForId }
  );
  const second = hikvisionEmployeeNoForCredential(
    { id: "credential-face-b", unitId: "unit-101", type: "FACE", value: "FACE-B" },
    { id: "person-beta", name: "Pessoa B" },
    { unitForId }
  );

  assert.match(first, /^\d{1,16}$/);
  assert.match(second, /^\d{1,16}$/);
  assert.notEqual(first, second);
  assert.notEqual(first, "101");
  assert.notEqual(second, "101");
});

test("mantem CPF como prioridade quando informado", () => {
  const employeeNo = hikvisionEmployeeNoForCredential(
    { id: "credential-face", unitId: "unit-101", type: "FACE" },
    { id: "person-alpha", cpf: "123.456.789-01" },
    { unitForId: () => ({ unitNumber: "101" }) }
  );

  assert.equal(employeeNo, "12345678901");
});
