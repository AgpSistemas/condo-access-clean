import { createHash, randomBytes } from "node:crypto";

// Hikvision rejeita employeeNo vazio, alfabetico ou grande demais; sempre geramos um identificador numerico estavel.
function hikvisionEmployeeNoForCredential(credential = {}, person = null, { unitForId = () => null } = {}) {
  const fallbackUnit = credential.unitId && unitForId(credential.unitId)?.unitNumber;
  const source = String(
    credential.personExternalId ||
    credential.externalId ||
    person?.externalId ||
    person?.hikvisionEmployeeNo ||
    person?.cpf ||
    person?.rg ||
    person?.phone ||
    person?.id ||
    credential.personId ||
    credential.id ||
    credential.value ||
    fallbackUnit ||
    randomBytes(4).toString("hex")
  ).trim();
  const numeric = source.replace(/\D+/g, "");
  if (numeric) return numeric.slice(0, 16);
  const hash = createHash("md5").update(source || randomBytes(4).toString("hex")).digest("hex");
  return String(parseInt(hash.slice(0, 8), 16)).slice(0, 10);
}

function hikvisionUserNameForCredential(credential = {}, person = null) {
  return String(person?.name || credential.personName || credential.valueLabel || credential.value || "Usuario").trim().slice(0, 96);
}

// ISAPI espera data local sem fuso explicito; convertemos para o fuso configurado do equipamento/condominio.
function hikvisionLocalDateTime(value = "", fallback = "") {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return fallback;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.DEVICE_TIME_ZONE || "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(parsed));
  const valueFor = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}T${valueFor("hour")}:${valueFor("minute")}:${valueFor("second")}`;
}

// Payload minimo aceito pela ISAPI para criar/atualizar usuario antes de enviar FACE/PIN/cartao.
function hikvisionUserPayload(credential = {}, person = null, employeeNo = "") {
  const payload = {
    employeeNo,
    employeeNoString: employeeNo,
    name: hikvisionUserNameForCredential(credential, person),
    userType: "normal",
    Valid: {
      enable: true,
      beginTime: hikvisionLocalDateTime(credential.validFrom, "2020-01-01T00:00:00"),
      endTime: hikvisionLocalDateTime(credential.validUntil, "2037-12-31T23:59:59"),
      timeType: "local"
    },
    doorRight: "1",
    RightPlan: [{ doorNo: 1, planTemplateNo: "1" }]
  };
  if (credential.type === "PIN" && credential.value) payload.password = String(credential.value);
  return payload;
}

export {
  hikvisionEmployeeNoForCredential,
  hikvisionLocalDateTime,
  hikvisionUserNameForCredential,
  hikvisionUserPayload
};
