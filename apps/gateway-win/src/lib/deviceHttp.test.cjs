const test = require("node:test");
const assert = require("node:assert/strict");
const { deviceHttp } = require("./deviceHttp.cjs");

test("DEVICE_HTTP decodifica bodyBase64 antes de enviar ao equipamento", async () => {
  const originalFetch = global.fetch;
  const sentBodies = [];
  global.fetch = async (_url, options = {}) => {
    sentBodies.push(options.body);
    return {
      ok: true,
      status: 200,
      headers: {
        get: () => ""
      },
      arrayBuffer: async () => Buffer.from("{}")
    };
  };

  try {
    const body = Buffer.from("imagem-binaria");
    const result = await deviceHttp({
      device: {
        apiHost: "192.168.1.10",
        apiPort: 80,
        username: "admin",
        password: "secret",
        authMode: "BASIC"
      },
      request: {
        path: "/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json",
        method: "POST",
        contentType: "multipart/form-data; boundary=test",
        bodyBase64: body.toString("base64")
      }
    });

    assert.equal(result.ok, true);
    assert.equal(Buffer.isBuffer(sentBodies[1]), true);
    assert.equal(sentBodies[1].toString("utf8"), "imagem-binaria");
  } finally {
    global.fetch = originalFetch;
  }
});

test("DEVICE_HTTP permite requisicao Control iD sem Authorization HTTP", async () => {
  const originalFetch = global.fetch;
  const sentHeaders = [];
  global.fetch = async (_url, options = {}) => {
    sentHeaders.push(options.headers || {});
    return {
      ok: true,
      status: 200,
      headers: {
        get: () => "application/json"
      },
      arrayBuffer: async () => Buffer.from('{"session":"abc"}')
    };
  };

  try {
    const result = await deviceHttp({
      device: {
        apiHost: "192.168.1.20",
        apiPort: 80,
        username: "admin",
        password: "secret"
      },
      request: {
        path: "/login.fcgi",
        method: "POST",
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ login: "admin", password: "secret" }),
        skipHttpAuth: true
      }
    });

    assert.equal(result.ok, true);
    assert.equal(sentHeaders.length, 1);
    assert.equal(sentHeaders[0].Authorization, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});
