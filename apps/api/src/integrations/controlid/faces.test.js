import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchControlIdFacePhotoBytes,
  uploadControlIdUserImage
} from "./faces.js";

test("busca foto da pessoa quando a referencia armazenada da credencial esta quebrada", async () => {
  const calls = [];
  const photo = await fetchControlIdFacePhotoBytes({
    device: { id: "device-1" },
    credential: { photoUrl: "credential-photo:broken" },
    person: { photoUrl: "data:image/jpeg;base64,abc" },
    storedPhotoId: (photoUrl) => String(photoUrl).startsWith("credential-photo:"),
    fetchPhotoBytes: async (_device, photoUrl) => {
      calls.push(photoUrl);
      if (photoUrl === "credential-photo:broken") throw new Error("Foto facial armazenada nao encontrada");
      return { mimeType: "image/jpeg", buffer: Buffer.from("ok") };
    }
  });

  assert.deepEqual(calls, ["credential-photo:broken", "data:image/jpeg;base64,abc"]);
  assert.equal(photo.buffer.toString(), "ok");
});

test("envia foto facial Control iD somente pelo endpoint oficial fcgi", async () => {
  const calls = [];
  const result = await uploadControlIdUserImage({
    device: { id: "device-1" },
    session: "session-1",
    userId: 88,
    photo: { buffer: Buffer.from("jpg") },
    nowSeconds: () => 123,
    delay: async () => {},
    imageExists: async () => true,
    binaryRequest: async (_device, _session, pathName, options) => {
      calls.push({ pathName, options });
      return { ok: true };
    }
  });

  assert.equal(calls[0].pathName, "/user_set_image.fcgi?user_id=88&timestamp=123&match=0");
  assert.equal(calls[0].options.contentType, "application/octet-stream");
  assert.equal(result.ok, true);
});
