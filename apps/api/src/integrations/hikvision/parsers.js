import { randomBytes } from "node:crypto";

export function createHikvisionParsers({ normalizeLookup, normalizeCredentialType, credentialKey, now, tenant }) {
  function tryParseJson(text = "") {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function valueFromKeys(source = {}, keys = []) {
    for (const key of keys) {
      const value = key.split(".").reduce((current, part) => current?.[part], source);
      if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
    }
    return "";
  }

  function recursiveValueFromKeys(source = {}, keys = []) {
    if (!source || typeof source !== "object") return "";
    const direct = valueFromKeys(source, keys);
    if (direct) return direct;
    if (Array.isArray(source)) {
      for (const item of source) {
        const found = recursiveValueFromKeys(item, keys);
        if (found) return found;
      }
      return "";
    }
    for (const value of Object.values(source)) {
      const found = recursiveValueFromKeys(value, keys);
      if (found) return found;
    }
    return "";
  }

  function collectObjectsByKeys(source, keys = [], found = []) {
    if (!source || typeof source !== "object") return found;
    if (Array.isArray(source)) {
      source.forEach((item) => collectObjectsByKeys(item, keys, found));
      return found;
    }
    Object.entries(source).forEach(([key, value]) => {
      if (keys.includes(key) && Array.isArray(value)) {
        value.filter((item) => item && typeof item === "object").forEach((item) => found.push(item));
      }
      collectObjectsByKeys(value, keys, found);
    });
    return found;
  }

  function collectRecordValuesByKeys(source, keys = [], found = []) {
    if (!source || typeof source !== "object") return found;
    if (Array.isArray(source)) {
      source.forEach((item) => collectRecordValuesByKeys(item, keys, found));
      return found;
    }
    Object.entries(source).forEach(([key, value]) => {
      if (keys.includes(key)) {
        if (Array.isArray(value)) {
          value.filter((item) => item && typeof item === "object").forEach((item) => found.push(item));
        } else if (value && typeof value === "object") {
          found.push(value);
        }
      }
      collectRecordValuesByKeys(value, keys, found);
    });
    return found;
  }

  function looksLikeDeviceCredentialRow(record = {}) {
    return Boolean(valueFromKeys(record, [
      "value",
      "cardNo",
      "CardNo",
      "cardNumber",
      "card",
      "password",
      "Password",
      "pin",
      "QRCode",
      "qrCode",
      "plateNo",
      "employeeNoString",
      "employeeNo",
      "userId",
      "UserID",
      "FPID",
      "id",
      "name",
      "employeeName",
      "userName",
      "UserName",
      "CardName",
      "personName",
      "faceURL",
      "faceUrl",
      "photoUrl",
      "URL",
      "url",
      "uri",
      "href"
    ]));
  }

  function findFirstNumberByKeys(source, keys = []) {
    if (!source || typeof source !== "object") return 0;
    if (Array.isArray(source)) {
      for (const item of source) {
        const found = findFirstNumberByKeys(item, keys);
        if (found) return found;
      }
      return 0;
    }
    for (const [key, value] of Object.entries(source)) {
      if (keys.includes(key) && Number.isFinite(Number(value))) return Number(value);
      const found = findFirstNumberByKeys(value, keys);
      if (found) return found;
    }
    return 0;
  }

  function hikvisionSearchBody(rootName, position = 0, maxResults = 30, extra = {}) {
    return JSON.stringify({
      [rootName]: {
        searchID: extra.searchID || `condo-${Date.now()}`,
        searchResultPosition: position,
        maxResults,
        ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "searchID"))
      }
    });
  }

  function hikvisionSearchXmlBody(rootName, position = 0, maxResults = 30, extra = {}) {
    const nodes = {
      searchID: extra.searchID || `condo-${Date.now()}`,
      searchResultPosition: position,
      maxResults,
      ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "searchID"))
    };
    const xml = Object.entries(nodes)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `<${key}>${String(value).replace(/[<>&'"]/g, (char) => ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        "\"": "&quot;"
      })[char])}</${key}>`)
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?><${rootName}>${xml}</${rootName}>`;
  }

  function hikvisionSearchRequestBody(candidate, position, pageSize, searchID) {
    const extra = { searchID, ...(candidate.search || {}) };
    return candidate.bodyFormat === "xml"
      ? hikvisionSearchXmlBody(candidate.rootName, position, pageSize, extra)
      : hikvisionSearchBody(candidate.rootName, position, pageSize, extra);
  }

  function responseSample(text = "") {
    return String(text || "")
      .replace(/token=[^"'&<>\s]+/gi, "token=***")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 360);
  }

  function firstHikvisionImageValue(record = {}) {
    const imageKeys = [
      "photoUrl",
      "photoURL",
      "faceURL",
      "faceUrl",
      "FaceURL",
      "facePicURL",
      "facePicUrl",
      "facePictureURL",
      "facePictureUrl",
      "enrlFaceURL",
      "enrlFaceUrl",
      "enrollFaceURL",
      "enrollFaceUrl",
      "picUrl",
      "picURL",
      "PicUrl",
      "PicURL",
      "pictureURL",
      "pictureUrl",
      "snapPicUrl",
      "snapPicURL",
      "imageURL",
      "imageUrl",
      "URL",
      "url",
      "uri",
      "href"
    ];
    const direct = valueFromKeys(record, imageKeys) || recursiveValueFromKeys(record, imageKeys);
    if (direct && /\.(?:jpe?g|png|webp)(?:@[^?]+)?(?:\?.*)?$/i.test(direct)) return direct;
    if (direct && /\/LOCALS\/pic\/(?:enrlFace|face|snap|FDLib)\//i.test(direct)) return direct;

    const base64Keys = ["faceImage", "faceData", "imageData", "picData", "snapPic", "pictureData"];
    const base64 = valueFromKeys(record, base64Keys) || recursiveValueFromKeys(record, base64Keys);
    if (!base64) return "";
    return base64.startsWith("data:") ? base64 : `data:image/jpeg;base64,${base64.replace(/^data:image\/[a-z]+;base64,/i, "")}`;
  }

  function parseHikvisionEventTime(value = "") {
    const clean = String(value || "").trim();
    if (!clean) return "";
    const parsed = Date.parse(clean);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : clean;
  }

  function hikvisionEventDecision(event = {}) {
    const haystack = [
      event.eventType,
      event.eventName,
      event.name,
      event.currentVerifyMode,
      event.attendanceStatus,
      event.status,
      event.reason
    ].map((value) => String(value || "").toLowerCase()).join(" ");
    if (/(deny|denied|fail|failed|invalid|black|illegal|recus|negad)/i.test(haystack)) return "DENY";
    if (/(allow|allowed|success|valid|open|pass|permit|liber|autoriza)/i.test(haystack)) return "ALLOW";
    return "INFO";
  }

  function normalizeHikvisionEvent(row = {}, device = {}) {
    const serial = valueFromKeys(row, ["serialNo", "SerialNo", "eventID", "eventId", "id"]);
    const userId = valueFromKeys(row, ["employeeNoString", "employeeNo", "userId", "UserID", "cardUserId", "FPID"]);
    const userName = valueFromKeys(row, ["name", "employeeName", "userName", "UserName", "CardName", "personName"]);
    const cardNo = valueFromKeys(row, ["cardNo", "CardNo", "cardNumber"]);
    const createdAt = parseHikvisionEventTime(valueFromKeys(row, ["time", "dateTime", "eventTime", "eventDateTime", "datetime"]));
    const photoUrl = firstHikvisionImageValue(row);
    const reason = valueFromKeys(row, ["eventType", "eventName", "currentVerifyMode", "attendanceStatus", "minor", "major"]) || "Evento Hikvision";
    const idSeed = [device.id, serial, createdAt, userId, cardNo, reason].filter(Boolean).join("-");
    return {
      id: `hikvision-event-${normalizeLookup(idSeed).slice(0, 48) || randomBytes(4).toString("hex")}`,
      tenantId: device.tenantId || tenant.id,
      unitId: "",
      decision: hikvisionEventDecision({ ...row, reason }),
      reason,
      createdAt: createdAt || now(),
      user: { id: userId, name: userName },
      userId,
      userName,
      cardNo,
      door: { id: device.id, name: device.name || "Hikvision", deviceId: device.id, manufacturer: device.manufacturer || "Hikvision" },
      rawEvent: row,
      photoUrl,
      scope: "DEVICE"
    };
  }

  function parseHikvisionEventsResponse(text = "", device = {}) {
    const parsed = tryParseJson(text);
    let rows = [];
    if (parsed) {
      rows = collectObjectsByKeys(parsed, [
        "MatchList",
        "AcsEvent",
        "AcsEventInfo",
        "AccessControllerEvent",
        "EventInfo",
        "Info",
        "events",
        "records"
      ]);
    } else if (text.includes("<")) {
      rows = xmlBlocks(text, ["MatchInfo", "AcsEvent", "AcsEventInfo", "AccessControllerEvent", "Info"]).map((block) => ({
        serialNo: xmlValue(block, ["serialNo", "SerialNo", "eventID", "id"]),
        time: xmlValue(block, ["time", "dateTime", "eventTime", "eventDateTime"]),
        employeeNoString: xmlValue(block, ["employeeNoString", "employeeNo", "userId", "UserID"]),
        name: xmlValue(block, ["name", "employeeName", "userName", "UserName", "CardName"]),
        cardNo: xmlValue(block, ["cardNo", "cardNumber", "CardNo"]),
        eventType: xmlValue(block, ["eventType", "eventName", "minor", "major"])
      })).filter((row) => Object.values(row).some(Boolean));
    } else {
      rows = queryTableRows(text);
    }

    const seen = new Set();
    return rows
      .map((row) => normalizeHikvisionEvent(row, device))
      .filter((event) => {
        const key = normalizeLookup(`${event.door?.deviceId}-${event.createdAt}-${event.userId}-${event.cardNo}-${event.reason}`);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }


  function xmlBlocks(text = "", tagNames = []) {
    const blocks = [];
    tagNames.forEach((tagName) => {
      const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
      let match = pattern.exec(text);
      while (match) {
        blocks.push(match[1]);
        match = pattern.exec(text);
      }
    });
    return blocks;
  }

  function xmlValue(block = "", tagNames = []) {
    for (const tagName of tagNames) {
      const match = block.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
      if (match?.[1]) return match[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    }
    return "";
  }

  function queryTableRows(text = "") {
    const rows = new Map();
    String(text).split(/\r?\n|&/).forEach((line) => {
      const match = line.trim().match(/^([^=]+)=([\s\S]*)$/);
      if (!match) return;
      const key = match[1].trim();
      const value = decodeURIComponent(match[2].trim());
      const rowMatch = key.match(/^(?:table\.)?([^.\[]+)\[(\d+)\]\.(.+)$/i);
      if (!rowMatch) return;
      const rowKey = `${rowMatch[1]}-${rowMatch[2]}`;
      const row = rows.get(rowKey) || {};
      row[rowMatch[3]] = value;
      rows.set(rowKey, row);
    });
    return Array.from(rows.values());
  }

  function deviceCredentialType(rawType = "", fallback = "APP") {
    const value = String(rawType || fallback).toLowerCase();
    if (value.includes("face") || value.includes("facial")) return "FACE";
    if (value.includes("card") || value.includes("cart") || value.includes("rfid") || value.includes("tag")) return "RFID";
    if (value.includes("pin") || value.includes("password") || value.includes("senha")) return "PIN";
    if (value.includes("qr")) return "QR_CODE";
    if (value.includes("plate") || value.includes("placa")) return "PLATE";
    return normalizeCredentialType(fallback);
  }

  function normalizeDeviceCredential(record = {}, source = {}, fallbackType = "APP") {
    const hasFaceImage = Boolean(firstHikvisionImageValue(record) || Number(record.numOfFace || record.faceNum || 0) > 0);
    const inferredFallbackType = hasFaceImage && normalizeCredentialType(fallbackType) === "APP" ? "FACE" : fallbackType;
    const type = deviceCredentialType(
      record.type || record.credentialType || record.cardType || record.Method || record.method,
      inferredFallbackType
    );
    const personName = valueFromKeys(record, ["name", "employeeName", "userName", "UserName", "CardName", "personName", "NickName"]);
    const personExternalId = valueFromKeys(record, ["employeeNoString", "employeeNo", "userId", "UserID", "cardUserId", "UserIDList.0", "FPID", "id"]);
    const photoUrl = firstHikvisionImageValue(record);
    const value = valueFromKeys(record, [
      "value",
      "cardNo",
      "CardNo",
      "cardNumber",
      "card",
      "password",
      "Password",
      "pin",
      "QRCode",
      "qrCode",
      "plateNo",
      "employeeNoString",
      "employeeNo",
      "userId",
      "UserID",
      "FPID",
      "id"
    ]) || `${type}-${personExternalId || personName || randomBytes(3).toString("hex")}`;
    if (!String(value).trim()) return null;
    return {
      id: `${source.kind || type}-${normalizeLookup(value).slice(0, 24)}`,
      type,
      value: String(value).trim(),
      valueLabel: type === "FACE" && personName ? `Face - ${personName}` : String(value).trim(),
      personName,
      personExternalId,
      photoUrl,
      source: source.source || "DEVICE",
      sourceKind: source.kind || fallbackType,
      devicePath: source.path || "",
      raw: record
    };
  }

  function parseDeviceCredentialResponse(text = "", source = {}, fallbackType = "APP") {
    const parsed = tryParseJson(text);
    let rows = [];
    if (parsed) {
      rows = collectRecordValuesByKeys(parsed, [
        "CardInfo",
        "UserInfo",
        "FaceInfo",
        "FaceDataRecord",
        "FDSearchResult",
        "FDMatch",
        "MatchList",
        "MatchInfo",
        "Info",
        "users",
        "cards",
        "faces",
        "records"
      ]).filter(looksLikeDeviceCredentialRow);
      if (!rows.length && looksLikeDeviceCredentialRow(parsed)) rows = [parsed];
    } else if (text.includes("<")) {
      rows = xmlBlocks(text, ["CardInfo", "UserInfo", "FaceInfo", "FaceDataRecord", "FDSearchResult", "FDMatch", "MatchList", "MatchInfo", "Info"]).map((block) => ({
        cardNo: xmlValue(block, ["cardNo", "cardNumber", "CardNo"]),
        employeeNoString: xmlValue(block, ["employeeNoString", "employeeNo", "userId", "UserID", "FPID", "id"]),
        name: xmlValue(block, ["name", "employeeName", "userName", "UserName", "CardName"]),
        password: xmlValue(block, ["password", "Password", "pin"]),
        faceURL: xmlValue(block, ["faceURL", "faceUrl", "FaceURL", "picUrl", "picURL", "URL", "url"]),
        type: source.kind
      })).filter((row) => Object.values(row).some(Boolean));
    } else {
      rows = queryTableRows(text);
    }

    const records = rows
      .map((row) => normalizeDeviceCredential(row, source, fallbackType))
      .filter(Boolean);
    const seen = new Set();
    return records.filter((record) => {
      const key = credentialKey("", record.type, record.value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return {
    tryParseJson,
    valueFromKeys,
    recursiveValueFromKeys,
    collectObjectsByKeys,
    collectRecordValuesByKeys,
    looksLikeDeviceCredentialRow,
    findFirstNumberByKeys,
    hikvisionSearchBody,
    hikvisionSearchXmlBody,
    hikvisionSearchRequestBody,
    responseSample,
    firstHikvisionImageValue,
    parseHikvisionEventTime,
    hikvisionEventDecision,
    normalizeHikvisionEvent,
    parseHikvisionEventsResponse,
    xmlBlocks,
    xmlValue,
    queryTableRows,
    deviceCredentialType,
    normalizeDeviceCredential,
    parseDeviceCredentialResponse
  };
}
