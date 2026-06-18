import { randomBytes } from "node:crypto";
import {
  hikvisionEmployeeNoForCredential,
  hikvisionUserNameForCredential,
  hikvisionUserPayload
} from "./credentials.js";

const HIKVISION_ADAPTER = "HIKVISION_ISAPI";

async function hikvisionTryJsonWrites(device, attempts = [], { requestDevice }) {
  const errors = [];
  for (const attempt of attempts) {
    try {
      const result = await requestDevice(device, attempt.path, {
        method: attempt.method || "POST",
        body: JSON.stringify(attempt.body),
        contentType: "application/json",
        timeoutMs: attempt.timeoutMs || 12000
      });
      return {
        ok: true,
        status: result.status,
        path: attempt.path,
        label: attempt.label,
        message: `${attempt.label} respondeu ${result.status}`,
        attempts: [{ label: attempt.label, path: attempt.path, ok: true, status: result.status }]
      };
    } catch (error) {
      errors.push({
        label: attempt.label,
        path: attempt.path,
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao enviar para Hikvision"
      });
    }
  }
  return {
    ok: false,
    message: errors.at(-1)?.error || "Nenhum endpoint Hikvision aceitou a credencial",
    attempts: errors
  };
}

async function ensureHikvisionCredentialUser(device, credential = {}, person = null, employeeNo = "", deps = {}) {
  const userInfo = hikvisionUserPayload(credential, person, employeeNo);
  return hikvisionTryJsonWrites(device, [
    {
      label: "Hikvision usuario Record",
      path: "/ISAPI/AccessControl/UserInfo/Record?format=json",
      method: "POST",
      body: { UserInfo: userInfo }
    },
    {
      label: "Hikvision usuario SetUp",
      path: "/ISAPI/AccessControl/UserInfo/SetUp?format=json",
      method: "PUT",
      body: { UserInfo: userInfo }
    }
  ], deps);
}

async function deleteHikvisionFaceByEmployeeNo(device, employeeNo = "", deps = {}) {
  if (!employeeNo) {
    return { ok: true, attempts: [] };
  }
  return hikvisionTryJsonWrites(device, [
    {
      label: "Hikvision excluir face EmployeeNoList",
      path: "/ISAPI/AccessControl/FaceInfo/Delete?format=json",
      method: "PUT",
      body: { FaceInfoDelCond: { EmployeeNoList: [{ employeeNo }] } }
    },
    {
      label: "Hikvision excluir face employeeNoList",
      path: "/ISAPI/AccessControl/FaceInfo/Delete?format=json",
      method: "PUT",
      body: { FaceInfoDelCond: { employeeNoList: [{ employeeNo }] } }
    }
  ], deps);
}

function dataUrlImageBuffer(dataUrl = "") {
  const match = String(dataUrl).match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1] || "image/jpeg",
    buffer: Buffer.from(match[2], "base64")
  };
}

function storedFacePhotoId(photoUrl = "") {
  const match = String(photoUrl || "").trim().match(/^credential-photo:(.+)$/);
  return match?.[1] || "";
}

function multipartPartHeader(name, filename = "", contentType = "") {
  const lines = [`Content-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ""}`];
  if (contentType) lines.push(`Content-Type: ${contentType}`);
  return `${lines.join("\r\n")}\r\n\r\n`;
}

function hikvisionFaceMultipartBody(faceInfo = {}, photo = {}, imageField = "FaceImage") {
  const boundary = `----CondoAccessFace${randomBytes(8).toString("hex")}`;
  const faceRecord = JSON.stringify({
    faceLibType: faceInfo.faceLibType || "blackFD",
    FDID: faceInfo.FDID || "1",
    FPID: faceInfo.FPID,
    name: faceInfo.name
  });
  const chunks = [
    Buffer.from(`--${boundary}\r\n${multipartPartHeader("FaceDataRecord", "FaceDataRecord.json", "application/json")}`, "utf8"),
    Buffer.from(faceRecord, "utf8"),
    Buffer.from(`\r\n--${boundary}\r\n${multipartPartHeader(imageField, "face.jpg", photo.mimeType || "image/jpeg")}`, "utf8"),
    photo.buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
  ];
  return {
    boundary,
    buffer: Buffer.concat(chunks)
  };
}

async function hikvisionMultipartFaceWrite(device, faceInfo = {}, photo = {}, imageField = "FaceImage", { requestDevice }) {
  const pathName = "/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json";
  const label = `Hikvision FDLib multipart (${imageField})`;
  const multipart = hikvisionFaceMultipartBody(faceInfo, photo, imageField);
  const result = await requestDevice(device, pathName, {
    method: "POST",
    bodyBase64: multipart.buffer.toString("base64"),
    contentType: `multipart/form-data; boundary=${multipart.boundary}`,
    timeoutMs: 15000
  });
  return {
    ok: true,
    status: result.status,
    message: `Upload facial multipart respondeu ${result.status}`,
    attempts: [{ label, path: pathName, ok: true, status: result.status }]
  };
}

async function hikvisionTryMultipartFaceWrite(device, faceInfo = {}, photoUrl = "", deps = {}) {
  const pathName = "/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json";
  const attempts = [];
  try {
    const photo = await deps.fetchPhotoBytes(device, photoUrl);
    const maxBytes = Number(process.env.HIKVISION_FACE_UPLOAD_MAX_BYTES || 900000);
    if (photo.buffer.length > maxBytes) throw new Error(`Foto facial maior que ${maxBytes} bytes`);
    for (const imageField of ["FaceImage", "img"]) {
      try {
        const result = await hikvisionMultipartFaceWrite(device, faceInfo, photo, imageField, deps);
        return { ...result, attempts: [...attempts, ...(result.attempts || [])] };
      } catch (error) {
        attempts.push({
          label: `Hikvision FDLib multipart (${imageField})`,
          path: pathName,
          ok: false,
          error: error instanceof Error ? error.message : "Falha no upload facial multipart"
        });
      }
    }
  } catch (error) {
    attempts.push({
      label: "Hikvision carregar foto para multipart",
      path: pathName,
      ok: false,
      error: error instanceof Error ? error.message : "Falha no upload facial multipart"
    });
  }
  return {
    ok: false,
    message: attempts.at(-1)?.error || "Falha no upload facial multipart",
    attempts
  };
}

async function sendHikvisionStoredCredential(device, credential = {}, deps = {}) {
  const person = deps.personForCredential(credential);
  const employeeNo = hikvisionEmployeeNoForCredential(credential, person, { unitForId: deps.unitForId });
  const userResult = await ensureHikvisionCredentialUser(device, credential, person, employeeNo, deps);
  if (!userResult.ok) {
    return {
      ok: false,
      deviceId: device.id,
      adapter: HIKVISION_ADAPTER,
      message: `Usuario Hikvision ${employeeNo}: ${userResult.message}`,
      attempts: userResult.attempts || []
    };
  }

  const type = deps.normalizeType(credential.type);
  if (type === "APP") {
    return {
      ok: true,
      deviceId: device.id,
      adapter: HIKVISION_ADAPTER,
      message: `Usuario Hikvision ${employeeNo} enviado`,
      attempts: userResult.attempts || []
    };
  }

  if (type === "PIN") {
    return {
      ok: true,
      deviceId: device.id,
      adapter: HIKVISION_ADAPTER,
      message: `PIN do usuario Hikvision ${employeeNo} enviado`,
      attempts: userResult.attempts || []
    };
  }

  if (["RFID", "QR_CODE"].includes(type)) {
    const cardInfo = {
      employeeNo,
      employeeNoString: employeeNo,
      cardNo: String(credential.value || "").trim(),
      cardType: "normalCard"
    };
    const cardResult = await hikvisionTryJsonWrites(device, [
      {
        label: "Hikvision cartao Record",
        path: "/ISAPI/AccessControl/CardInfo/Record?format=json",
        method: "POST",
        body: { CardInfo: cardInfo }
      },
      {
        label: "Hikvision cartao SetUp",
        path: "/ISAPI/AccessControl/CardInfo/SetUp?format=json",
        method: "PUT",
        body: { CardInfo: cardInfo }
      },
      {
        label: "Hikvision cartao SetUp lista",
        path: "/ISAPI/AccessControl/CardInfo/SetUp?format=json",
        method: "PUT",
        body: { CardInfo: [cardInfo] }
      }
    ], deps);
    return {
      ...cardResult,
      deviceId: device.id,
      adapter: HIKVISION_ADAPTER,
      message: cardResult.ok
        ? `${type === "QR_CODE" ? "QR Code" : "Cartao"} ${cardInfo.cardNo} enviado para ${employeeNo}`
        : cardResult.message,
      attempts: [...(userResult.attempts || []), ...(cardResult.attempts || [])]
    };
  }

  if (type === "FACE") {
    const photoUrl = String(credential.photoUrl || person?.photoUrl || "").trim();
    if (!photoUrl) {
      return {
        ok: false,
        deviceId: device.id,
        adapter: HIKVISION_ADAPTER,
        message: "Facial sem foto vinculada para enviar ao Hikvision",
        attempts: userResult.attempts || []
      };
    }
    const faceInfo = {
      employeeNo,
      employeeNoString: employeeNo,
      FPID: employeeNo,
      name: hikvisionUserNameForCredential(credential, person),
      faceLibType: "blackFD",
      faceURL: photoUrl,
      URL: photoUrl
    };
    const cleanupResult = await deleteHikvisionFaceByEmployeeNo(device, employeeNo, deps);
    const multipartResult = await hikvisionTryMultipartFaceWrite(device, faceInfo, photoUrl, deps);
    if (multipartResult.ok) {
      return {
        ...multipartResult,
        deviceId: device.id,
        adapter: HIKVISION_ADAPTER,
        message: `Face de ${employeeNo} enviada`,
        attempts: [...(userResult.attempts || []), ...(cleanupResult.attempts || []), ...(multipartResult.attempts || [])]
      };
    }
    const requiresBinaryUpload = Boolean(storedFacePhotoId(photoUrl) || dataUrlImageBuffer(photoUrl));
    if (requiresBinaryUpload) {
      return {
        ...multipartResult,
        deviceId: device.id,
        adapter: HIKVISION_ADAPTER,
        message: `Usuario ${employeeNo} cadastrado, mas a foto nao foi aceita pela Hikvision: ${multipartResult.message}`,
        attempts: [...(userResult.attempts || []), ...(cleanupResult.attempts || []), ...(multipartResult.attempts || [])]
      };
    }
    const faceResult = await hikvisionTryJsonWrites(device, [
      {
        label: "Hikvision face Record",
        path: "/ISAPI/AccessControl/FaceInfo/Record?format=json",
        method: "POST",
        body: { FaceInfo: faceInfo }
      },
      {
        label: "Hikvision FDLib FaceDataRecord",
        path: "/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json",
        method: "POST",
        body: { FaceDataRecord: faceInfo }
      }
    ], deps);
    return {
      ...faceResult,
      deviceId: device.id,
      adapter: HIKVISION_ADAPTER,
      message: faceResult.ok ? `Face de ${employeeNo} enviada` : faceResult.message,
      attempts: [...(userResult.attempts || []), ...(cleanupResult.attempts || []), ...(multipartResult.attempts || []), ...(faceResult.attempts || [])]
    };
  }

  return {
    ok: false,
    deviceId: device.id,
    adapter: HIKVISION_ADAPTER,
    message: `Tipo ${type} ainda nao possui envio Hikvision homologado`,
    attempts: userResult.attempts || []
  };
}

async function deleteHikvisionStoredCredential(device, credential = {}, deps = {}) {
  const person = deps.personForCredential(credential);
  const employeeNo = hikvisionEmployeeNoForCredential(credential, person, { unitForId: deps.unitForId });
  const type = deps.normalizeType(credential.type);
  const attempts = type === "FACE"
    ? [
      {
        label: "Hikvision excluir face EmployeeNoList",
        path: "/ISAPI/AccessControl/FaceInfo/Delete?format=json",
        method: "PUT",
        body: { FaceInfoDelCond: { EmployeeNoList: [{ employeeNo }] } }
      },
      {
        label: "Hikvision excluir face employeeNoList",
        path: "/ISAPI/AccessControl/FaceInfo/Delete?format=json",
        method: "PUT",
        body: { FaceInfoDelCond: { employeeNoList: [{ employeeNo }] } }
      }
    ]
    : type === "RFID"
      ? [{
          label: "Hikvision excluir cartao",
          path: "/ISAPI/AccessControl/CardInfo/Delete?format=json",
          method: "PUT",
          body: { CardInfoDelCond: { CardNoList: [{ cardNo: String(credential.value || "").trim() }] } }
        }]
      : [{
          label: "Hikvision excluir usuario",
          path: "/ISAPI/AccessControl/UserInfo/Delete?format=json",
          method: "PUT",
          body: { UserInfoDelCond: { EmployeeNoList: [{ employeeNo }] } }
        }];
  const result = await hikvisionTryJsonWrites(device, attempts, deps);
  return {
    ...result,
    deviceId: device.id,
    adapter: HIKVISION_ADAPTER,
    message: result.ok ? `Credencial ${type} excluida do equipamento` : result.message
  };
}

export {
  deleteHikvisionStoredCredential,
  sendHikvisionStoredCredential
};
