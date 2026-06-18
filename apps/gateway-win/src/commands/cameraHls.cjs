const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ffmpegPath, rtspUrl } = require("./cameraSnapshot.cjs");

const sessions = new Map();
const rootDir = path.join(os.tmpdir(), "condo-access-gateway-hls");
const idleSessionMs = 60 * 1000;

function safeKey(value = "") {
  return String(value || "camera").replace(/[^a-z0-9_-]/gi, "_");
}

function contentTypeFor(filename = "") {
  if (filename.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (filename.endsWith(".ts")) return "video/mp2t";
  return "application/octet-stream";
}

function streamDir(streamKey = "") {
  return path.join(rootDir, safeKey(streamKey));
}

function cleanupHlsFiles(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith(".m3u8") || file.endsWith(".ts")) {
      fs.rmSync(path.join(dir, file), { force: true });
    }
  }
}

function ensureHlsSession(command = {}) {
  const request = command.request || {};
  const streamKey = request.streamKey || command.deviceId || command.id || "camera";
  const existing = sessions.get(streamKey);
  if (existing?.process && !existing.process.killed && existing.process.exitCode === null) {
    existing.lastAccessAt = Date.now();
    return existing;
  }

  const dir = streamDir(streamKey);
  cleanupHlsFiles(dir);
  const output = path.join(dir, "index.m3u8");
  const args = [
    "-hide_banner",
    "-loglevel", "warning",
    "-rtsp_transport", request.rtspTransport || "tcp",
    "-i", rtspUrl(command.device || {}, request),
    "-an",
    "-c:v", request.transcode === true ? "libx264" : "copy",
    ...(request.transcode === true ? ["-preset", "veryfast", "-tune", "zerolatency", "-pix_fmt", "yuv420p"] : []),
    "-f", "hls",
    "-hls_time", String(request.hlsTime || 1),
    "-hls_list_size", String(request.hlsListSize || 6),
    "-hls_delete_threshold", "2",
    "-hls_allow_cache", "0",
    "-hls_flags", "delete_segments+independent_segments+omit_endlist",
    "-hls_segment_filename", path.join(dir, "segment_%03d.ts"),
    output
  ];
  const child = spawn(ffmpegPath(), args, { windowsHide: true });
  const session = {
    streamKey,
    dir,
    process: child,
    startedAt: Date.now(),
    lastAccessAt: Date.now(),
    lastError: "",
    exitCode: null
  };
  child.stderr.on("data", (chunk) => {
    const message = chunk.toString("utf8").trim();
    if (message) session.lastError = message.slice(-1000);
  });
  child.once("exit", (code) => {
    session.exitCode = code;
    if (sessions.get(streamKey) === session) sessions.delete(streamKey);
  });
  sessions.set(streamKey, session);
  return session;
}

function cleanupIdleSessions() {
  const cutoff = Date.now() - idleSessionMs;
  for (const [streamKey, session] of sessions.entries()) {
    if (session.lastAccessAt >= cutoff) continue;
    try {
      session.process?.kill("SIGTERM");
    } catch {
      // Processo ja encerrou ou nao aceita sinal; a proxima limpeza remove a sessao.
    }
    sessions.delete(streamKey);
  }
}

async function waitForFile(filePath, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function cameraHlsFile(command = {}) {
  const request = command.request || {};
  const filename = String(request.filename || "index.m3u8");
  if (!/^(index\.m3u8|segment_\d+\.ts)$/.test(filename)) {
    throw new Error("Arquivo HLS invalido");
  }
  const session = ensureHlsSession(command);
  session.lastAccessAt = Date.now();
  const filePath = path.join(session.dir, filename);
  const ready = await waitForFile(filePath, filename === "index.m3u8" ? Number(request.timeoutMs || 14000) : Number(request.timeoutMs || 8000));
  if (!ready) {
    throw new Error(session.lastError || `Gateway local ainda nao gerou ${filename}`);
  }
  const buffer = fs.readFileSync(filePath);
  return {
    ok: true,
    status: 200,
    bodyBase64: buffer.toString("base64"),
    contentType: contentTypeFor(filename),
    message: `HLS ${filename} enviado pelo Gateway local`
  };
}

const cleanupTimer = setInterval(cleanupIdleSessions, 30 * 1000);
cleanupTimer.unref?.();

module.exports = { cameraHlsFile };
