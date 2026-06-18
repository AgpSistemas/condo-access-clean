import assert from "node:assert/strict";
import test from "node:test";

import { upsertControlIdVehicleTag } from "./vehicleTags.js";

test("atualiza tag Control iD existente usando create_or_modify_objects", async () => {
  const calls = [];
  const tag = await upsertControlIdVehicleTag({
    device: { controlIdUhfMode: "EXTENDED" },
    session: "session-1",
    userId: 123,
    value: "ABCD1234",
    loadObjects: async () => [{ id: 77, value: "ABCD1234", user_id: 123 }],
    post: async (_device, _session, pathName, body) => {
      calls.push({ pathName, body });
      return { payload: {} };
    }
  });

  assert.equal(calls[0].pathName, "/create_or_modify_objects.fcgi");
  assert.equal(calls[0].body.object, "uhf_tags");
  assert.deepEqual(calls[0].body.values, [{ id: 77, value: "ABCD1234", user_id: 123 }]);
  assert.equal(tag.id, 77);
});

test("cria tag Control iD nova usando create_objects", async () => {
  const calls = [];
  const tag = await upsertControlIdVehicleTag({
    device: { controlIdUhfMode: "EXTENDED" },
    session: "session-1",
    userId: 123,
    value: "ABCD1234",
    loadObjects: async () => [],
    post: async (_device, _session, pathName, body) => {
      calls.push({ pathName, body });
      return { payload: { ids: [88] } };
    }
  });

  assert.equal(calls[0].pathName, "/create_objects.fcgi");
  assert.equal(calls[0].body.object, "uhf_tags");
  assert.equal(tag.id, 88);
});
