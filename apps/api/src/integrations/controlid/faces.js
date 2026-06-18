const CONTROL_ID_FACE_IMAGE_PATH = "/user_set_image.fcgi";

function controlIdFacePhotoCandidates(credential = {}, person = null) {
  return [
    credential.photoUrl,
    person?.photoUrl
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

async function fetchControlIdFacePhotoBytes({
  device,
  credential = {},
  person = null,
  fetchPhotoBytes,
  storedPhotoId
}) {
  const photoCandidates = controlIdFacePhotoCandidates(credential, person);
  let lastError = null;

  for (const photoUrl of photoCandidates) {
    try {
      return await fetchPhotoBytes(device, photoUrl);
    } catch (error) {
      lastError = error;
      if (!storedPhotoId(photoUrl)) throw error;
    }
  }

  throw lastError || new Error("Foto facial armazenada nao encontrada");
}

function controlIdFaceImagePath(userId, timestamp) {
  return `${CONTROL_ID_FACE_IMAGE_PATH}?user_id=${encodeURIComponent(userId)}&timestamp=${timestamp}&match=0`;
}

async function uploadControlIdUserImage({
  device,
  session,
  userId,
  photo = {},
  binaryRequest,
  imageExists,
  delay,
  nowSeconds = () => Math.floor(Date.now() / 1000)
}) {
  const attempts = [];
  const pathName = controlIdFaceImagePath(userId, nowSeconds());

  try {
    await binaryRequest(device, session, pathName, {
      body: photo.buffer,
      contentType: "application/octet-stream",
      timeoutMs: 20000
    });
    for (let index = 0; index < 4; index += 1) {
      if (await imageExists(device, session, userId)) {
        return {
          ok: true,
          attempts: [
            { label: "Control iD foto facial", path: pathName, ok: true },
            { label: "Control iD validar foto facial", path: "/user_list_images.fcgi", ok: true }
          ]
        };
      }
      await delay(500);
    }
    attempts.push({
      label: "Control iD foto facial",
      path: pathName,
      ok: false,
      error: "Equipamento respondeu ao upload, mas a foto nao apareceu no usuario"
    });
  } catch (error) {
    attempts.push({
      label: "Control iD foto facial",
      path: pathName,
      ok: false,
      error: error instanceof Error ? error.message : "Falha ao enviar foto facial"
    });
  }

  throw new Error(attempts.at(-1)?.error || "Control iD nao confirmou a foto facial");
}

export {
  CONTROL_ID_FACE_IMAGE_PATH,
  controlIdFaceImagePath,
  fetchControlIdFacePhotoBytes,
  uploadControlIdUserImage
};
