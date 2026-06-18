const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function firstExistingPath(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function ffmpegPath() {
  const exeDir = path.dirname(process.execPath);
  return firstExistingPath([
    process.env.CONDO_ACCESS_FFMPEG,
    path.join(exeDir, "ffmpeg.exe"),
    path.join(process.cwd(), "ffmpeg.exe")
  ]) || "ffmpeg";
}

function rtspUrl(device = {}, request = {}) {
  if (request.rtspUrl) return request.rtspUrl;
  const host = String(device.rtspHost || device.apiHost || device.ipAddress || "").replace(/^https?:\/\//i, "").split(/[/:]/)[0];
  const port = Number(device.rtspPort || 554);
  const username = encodeURIComponent(device.username || "admin");
  const password = encodeURIComponent(device.password || "");
  const channel = Math.max(1, Number(request.channel || device.channel || 1));
  const streamPath = String(request.rtspPath || `/Streaming/channels/${channel}02`).replace(/^\/?/, "/");
  if (!host) throw new Error("Host RTSP da camera nao configurado");
  return `rtsp://${username}:${password}@${host}:${port}${streamPath}`;
}

function cameraSnapshot(command = {}) {
  const request = command.request || {};
  const timeoutMs = Number(request.timeoutMs || 15000);
  const args = [
    "-hide_banner",
    "-loglevel", "warning",
    "-rtsp_transport", request.rtspTransport || "tcp",
    "-i", rtspUrl(command.device || {}, request),
    "-frames:v", "1",
    "-q:v", "2",
    "-f", "image2pipe",
    "pipe:1"
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("Timeout ao capturar snapshot RTSP pelo Gateway local"));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`FFmpeg local nao iniciou: ${error.message}`));
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const buffer = Buffer.concat(stdout);
      if (code !== 0 || buffer.length === 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim().slice(0, 400);
        reject(new Error(`FFmpeg local nao gerou snapshot${detail ? `: ${detail}` : ""}`));
        return;
      }
      resolve({
        ok: true,
        status: 200,
        bodyBase64: buffer.toString("base64"),
        contentType: "image/jpeg",
        message: "Snapshot RTSP capturado pelo Gateway local"
      });
    });
  });
}

module.exports = { cameraSnapshot, ffmpegPath, rtspUrl };
