import assert from "node:assert/strict";
import test from "node:test";
import { createControlIdClient } from "./client.js";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => payload === "" ? "" : JSON.stringify(payload)
  };
}

test("faz login e pagina load_objects usando sessao na query string", async () => {
  const calls = [];
  const client = createControlIdClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/login.fcgi")) return response({ session: "abc" });
      const body = JSON.parse(options.body);
      return response({
        users: body.offset === 0 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }]
      });
    },
    createTimeout: () => ({ signal: undefined, done() {} })
  });

  const device = { ipAddress: "192.0.2.10", apiPort: 80, password: "secret" };
  const session = await client.login(device);
  const users = await client.loadObjects(device, session, "users", { limit: 2 });

  assert.equal(session, "abc");
  assert.deepEqual(users.map((user) => user.id), [1, 2, 3]);
  assert.match(calls[1].url, /load_objects\.fcgi\?session=abc$/);
  assert.equal(JSON.parse(calls[2].options.body).offset, 2);
});

test("abre iDBlock com o parametro de rele documentado", async () => {
  const calls = [];
  const client = createControlIdClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return url.endsWith("/login.fcgi") ? response({ session: "abc" }) : response({});
    },
    createTimeout: () => ({ signal: undefined, done() {} })
  });

  await client.openDoor({
    ipAddress: "192.0.2.11",
    apiPort: 80,
    username: "admin",
    password: "secret",
    model: "iDBlock",
    controlIdAction: "catra"
  }, 1);

  assert.deepEqual(JSON.parse(calls[1].options.body), {
    actions: [{ action: "catra", parameters: "relay=1" }]
  });
});
