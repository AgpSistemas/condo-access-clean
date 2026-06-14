import Hls from "hls.js";
import React, { useEffect, useRef, useState } from "react";
import { Camera, Plus, RadioTower, Save, Trash2 } from "lucide-react";
import { apiUrl, homologatedModelOptions, intelbrasCameraDefaults } from "../config/appConfig.jsx";
import { Field } from "./common.jsx";
import { stopCameraStream } from "../services/cameraService.js";

function cameraStreamKey(camera, channel) {
  if (!camera) return "";
  const selectedChannel = Number(channel || camera.channel || camera.activeChannels?.[0]?.channel || 1);
  return selectedChannel ? `${camera.id}--ch-${selectedChannel}` : camera.id;
}

function cameraSnapshotUrl(camera, channel) {
  if (!camera) return "";
  const selectedChannel = Number(channel || camera.channel || camera.activeChannels?.[0]?.channel || 1);
  return `${apiUrl}/api/cameras/${camera.id}/snapshot.jpg?channel=${selectedChannel}`;
}

function cameraChannels(camera) {
  const channels = camera?.activeChannels?.length
    ? camera.activeChannels
    : [{ channel: camera?.channel || 1, description: camera?.description || "Canal 1" }];
  return channels
    .map((item) => ({ channel: Number(item.channel || 1), description: item.description || `Canal ${item.channel || 1}` }))
    .sort((a, b) => a.channel - b.channel);
}

function cameraMosaicLabel(item) {
  const base = item.camera.groupName || item.camera.description || item.camera.name || "Camera";
  return `${base.slice(0, 14)} C${item.channel}`;
}


function groupCameraDevices(cameras) {
  const groups = new Map();
  cameras.forEach((camera) => {
    const key = camera.deviceId || camera.groupId || `${camera.tenantId || ""}-${camera.host || camera.ipAddress || ""}-${camera.rtspPort || ""}-${camera.type || ""}-${camera.manufacturer || ""}`;
    if (!groups.has(key)) {
      groups.set(key, { ...camera, id: camera.id, groupKey: key, activeChannels: [], groupedIds: [] });
    }
    const group = groups.get(key);
    group.groupedIds.push(camera.id);
    const sourceChannels = camera.activeChannels?.length
      ? camera.activeChannels
      : [{ channel: camera.channel || group.activeChannels.length + 1, description: camera.description || camera.name }];
    sourceChannels.forEach((channel) => {
      const channelNumber = Number(channel.channel || 1);
      if (!group.activeChannels.some((item) => Number(item.channel) === channelNumber)) {
        group.activeChannels.push({ channel: channelNumber, description: channel.description || `Canal ${channelNumber}` });
      }
    });
  });

  return Array.from(groups.values()).map((camera) => ({
    ...camera,
    activeChannels: cameraChannels(camera)
  }));
}

function CameraPreview({ camera, channel, onFrameClick, frameLabel }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState("Carregando camera...");
  const selectedChannel = Number(channel || camera?.channel || camera?.activeChannels?.[0]?.channel || 1);
  const streamKey = cameraStreamKey(camera, selectedChannel);
  const streamUrl = camera ? `${apiUrl}/streams/${streamKey}/index.m3u8` : "";

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return undefined;

    let hls = null;
    let fallbackTimer = null;
    let usingFallback = false;
    const fallbackDelayMs = 25000;

    setStatus("Abrindo stream HLS da API local...");

    function markConnected() {
      setStatus("Stream conectado");
    }

    function startHlsFallback(reason = "timeout") {
      if (usingFallback) return;
      usingFallback = true;

      if (!Hls.isSupported()) {
        setStatus(reason === "timeout" ? "Aguardando player nativo do navegador..." : "Navegador sem suporte HLS. Abra pelo botao HLS ou VLC.");
        return;
      }

      setStatus("Abrindo stream com fallback HLS.js...");
      video.removeAttribute("src");
      video.load();

      hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 10,
        liveSyncDurationCount: 2
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        markConnected();
        void video.play().catch(() => undefined);
      });
      hls.on(Hls.Events.FRAG_BUFFERED, markConnected);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setStatus("Reconectando stream HLS...");
          hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          setStatus("Recuperando decodificacao do video...");
          hls.recoverMediaError();
          return;
        }
        setStatus("Falha ao carregar. Verifique senha RTSP e FFmpeg.");
      });
    }

    function handleLoadedMetadata() {
      markConnected();
      void video.play().catch(() => undefined);
    }

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("playing", markConnected);
    const handleVideoError = () => startHlsFallback("error");

    video.addEventListener("error", handleVideoError);

    video.src = streamUrl;
    video.load();
    void video.play().catch(() => undefined);

    fallbackTimer = window.setTimeout(() => {
      if (video.readyState < 2) startHlsFallback();
    }, fallbackDelayMs);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("playing", markConnected);
      video.removeEventListener("error", handleVideoError);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
      if (streamKey) {
        void stopCameraStream(streamKey).catch(() => undefined);
      }
    };
  }, [streamKey, streamUrl]);

  if (!camera) {
    return <div className="empty-state">Selecione uma camera do condominio.</div>;
  }

  const failed = status.startsWith("Falha") || status.startsWith("Nao foi possivel");
  const connected = status === "Stream conectado";
  const previewImageUrl = cameraSnapshotUrl(camera, selectedChannel);

  return (
    <div className="camera-preview">
      <div
        className={`camera-preview-frame ${connected ? "connected" : "loading"} ${failed ? "failed" : ""} ${onFrameClick ? "clickable" : ""}`}
        role={onFrameClick ? "button" : undefined}
        tabIndex={onFrameClick ? 0 : undefined}
        onClick={onFrameClick}
        onKeyDown={(event) => {
          if (onFrameClick && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onFrameClick();
          }
        }}
        aria-label={frameLabel}
      >
        <img className="camera-preview-snapshot" src={previewImageUrl} alt={camera.description || camera.name || "Camera"} />
        <video ref={videoRef} controls muted playsInline autoPlay />
        <span className={`camera-live-badge ${connected ? "online" : failed ? "offline" : ""}`}>
          {connected ? "AO VIVO" : failed ? "Falha ao carregar" : "Carregando"}
        </span>
      </div>
      <div className="camera-preview-meta">
        <strong>{camera.description || camera.name}</strong>
        <span>{camera.host}:{camera.rtspPort} - Canal {selectedChannel}</span>
        <small>{status}</small>
      </div>
      <div className="camera-preview-actions">
        <a className="secondary-button" href={`${apiUrl}/api/cameras/${camera.id}/vlc.m3u`} download><Camera size={16} /> Abrir no VLC</a>
        <a className="secondary-button" href={streamUrl} target="_blank" rel="noreferrer"><Camera size={16} /> HLS</a>
      </div>
    </div>
  );
}

function CameraTile({ camera, channel, description, index, onSelect }) {
  const videoRef = useRef(null);
  const selectedChannel = Number(channel || camera?.channel || camera?.activeChannels?.[0]?.channel || index + 1);
  const streamKey = cameraStreamKey(camera, selectedChannel);
  const streamUrl = camera ? `${apiUrl}/streams/${streamKey}/index.m3u8` : "";
  const snapshotUrl = cameraSnapshotUrl(camera, selectedChannel);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return undefined;

    let hls = null;
    let mounted = true;

    setStatus("loading");

    function markReady() {
      if (mounted) setStatus("online");
    }

    function markFailed() {
      if (mounted) setStatus("offline");
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.load();
      void video.play().catch(markFailed);
    } else if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 4,
        liveSyncDurationCount: 2,
        maxBufferLength: 8
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().then(markReady).catch(markFailed));
      hls.on(Hls.Events.FRAG_BUFFERED, markReady);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        markFailed();
      });
    } else {
      markFailed();
    }

    video.addEventListener("playing", markReady);
    video.addEventListener("error", markFailed);

    return () => {
      mounted = false;
      video.removeEventListener("playing", markReady);
      video.removeEventListener("error", markFailed);
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
      if (streamKey) {
        void stopCameraStream(streamKey).catch(() => undefined);
      }
    };
  }, [streamKey, streamUrl]);

  if (!camera) return null;

  return (
    <button className={`camera-tile live-tile tile-tone-${index % 4}`} type="button" onClick={onSelect}>
      <img className="camera-tile-snapshot" src={snapshotUrl} alt={description || camera.description || camera.name || `Camera ${index + 1}`} loading="eager" />
      <video ref={videoRef} className="camera-tile-video" muted playsInline autoPlay />
      <span className="camera-tile-channel">Canal {selectedChannel}</span>
      <span className={`camera-tile-live ${status}`}>{status === "online" ? "AO VIVO" : status === "offline" ? "Falha" : "Carregando"}</span>
      <strong>{description || camera.description || camera.name || `Camera ${index + 1}`}</strong>
    </button>
  );
}


function CameraConfig({ cameras, devices = [], form, setForm, showForm, onSave, onEdit, onNew, onDelete }) {
  const isMultiChannel = form.type === "DVR" || form.type === "NVR";
  const cameraModelOptions = homologatedModelOptions(form.manufacturer, form.type);
  return (
    <section className="config-stack">
      {showForm && <form className="nested-form" onSubmit={onSave}>
        <div className="panel-heading compact-heading">
          <h2>{form.id ? "Editar camera" : "Nova camera"}</h2>
          <div className="toolbar-actions compact-actions">
            {form.id && <button className="secondary-button" type="button" onClick={onNew}><Plus size={16} /> Nova</button>}
            <button type="submit"><Save size={16} /> Salvar camera</button>
          </div>
        </div>
        <div className="form-hint">Cadastre Camera IP como canal unico, ou DVR/NVR multicanal como um equipamento com lista de canais. A API entrega HLS por canal para Web/APK e mantem RTSP sob demanda.</div>
        <div className="form-grid">
          <Field label="Equipamento"><select name="deviceId" value={form.deviceId || ""} onChange={(event) => {
            const device = devices.find((item) => item.id === event.target.value);
            setForm((current) => ({
              ...current,
              deviceId: event.target.value,
              manufacturer: device?.manufacturer || current.manufacturer,
              model: device?.model || current.model,
              type: device?.category === "cameras" ? "DVR" : current.type,
              host: device?.ipAddress || current.host,
              rtspPort: String(device?.rtspPort || current.rtspPort),
              httpPort: String(device?.apiPort || current.httpPort),
              username: device?.username || current.username,
              channelCount: String(device?.channelCount || current.channelCount),
              channelDescription: current.channelDescription || device?.name || ""
            }));
          }}><option value="">Sem vinculo</option>{devices.filter((device) => device.category === "cameras" || device.channelCount).map((device) => <option key={device.id} value={device.id}>{device.name} - {device.model || device.manufacturer}</option>)}</select></Field>
          <Field label="Descricao"><input name="description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></Field>
          <Field label="Fabricante"><select name="manufacturer" value={form.manufacturer} onChange={(event) => setForm((current) => ({ ...current, manufacturer: event.target.value, ...intelbrasCameraDefaults(current.type, event.target.value) }))}><option>Hikvision</option><option>Intelbras</option><option>Uniview</option><option>Tecvoz</option><option>Motorola</option><option>Anko</option><option>Master Digital</option><option>TRX</option><option>ONVIF</option><option>RTSP Generico</option><option>Control iD</option><option>Linear HCS</option><option>Bravas</option><option>SIM Next Cloud</option><option>Generico</option></select></Field>
          <Field label="Modelo homologacao">{cameraModelOptions.length
            ? <select name="model" value={form.model || ""} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}><option value="">Selecione o modelo</option>{cameraModelOptions.map((model) => <option key={model} value={model}>{model}</option>)}</select>
            : <input name="model" value={form.model || ""} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} placeholder="Modelo do equipamento" />}</Field>
          <Field label="Tipo"><select name="type" value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value, channelCount: event.target.value === "CAMERA_IP" ? "1" : current.channelCount || "16", ...intelbrasCameraDefaults(event.target.value, current.manufacturer) }))}><option value="CAMERA_IP">Camera IP</option><option value="DVR">DVR multicanal</option><option value="NVR">NVR multicanal</option><option value="VIDEO_PORTEIRO">Video porteiro</option><option value="FACIAL">Facial</option><option value="CLOUD">Cloud</option></select></Field>
          <Field label="IP / DDNS"><input name="host" value={form.host} onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))} /></Field>
          <Field label="Porta RTSP"><input name="rtspPort" value={form.rtspPort} onChange={(event) => setForm((current) => ({ ...current, rtspPort: event.target.value }))} /></Field>
          <Field label="Porta HTTP"><input name="httpPort" value={form.httpPort} onChange={(event) => setForm((current) => ({ ...current, httpPort: event.target.value }))} /></Field>
          <Field label="Path RTSP"><input name="rtspPath" value={form.rtspPath || ""} onChange={(event) => setForm((current) => ({ ...current, rtspPath: event.target.value }))} placeholder="/Streaming/channels/101" /></Field>
          <Field label="Usuario"><input name="username" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} /></Field>
          <Field label="Senha"><input name="password" type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} /></Field>
          <Field label="Canal inicial"><input name="channel" value={form.channel} onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value }))} /></Field>
          <Field label="Quantidade de canais"><input name="channelCount" disabled={form.id || !isMultiChannel} value={isMultiChannel ? form.channelCount : "1"} onChange={(event) => setForm((current) => ({ ...current, channelCount: event.target.value }))} /></Field>
          <Field label="Descricao base"><input name="channelDescription" value={form.channelDescription} onChange={(event) => setForm((current) => ({ ...current, channelDescription: event.target.value }))} placeholder="Ex.: NVR portaria, garagem, torre A" /></Field>
          <Field label="Stream"><select name="stream" value={form.stream} onChange={(event) => setForm((current) => ({ ...current, stream: event.target.value }))}><option value="MAIN">Principal</option><option value="SUB">Substream</option></select></Field>
          <Field label="Proporcao"><select name="aspectRatio" value={form.aspectRatio} onChange={(event) => setForm((current) => ({ ...current, aspectRatio: event.target.value }))}><option value="WIDESCREEN">16:9</option><option value="STANDARD">4:3</option><option value="PORTRAIT">Vertical</option></select></Field>
          <Field label="Metodo no app"><select name="loadMethod" value={form.loadMethod} onChange={(event) => setForm((current) => ({ ...current, loadMethod: event.target.value }))}><option value="SNAPSHOT_TEMPO_REAL">RTSP tempo real</option><option value="HLS_GATEWAY">HLS pela API</option><option value="CLOUD">Cloud/fabricante</option></select></Field>
          <Field label="Captura de foto"><select name="photoCaptureEnabled" value={form.photoCaptureEnabled ? "true" : "false"} onChange={(event) => setForm((current) => ({ ...current, photoCaptureEnabled: event.target.value === "true" }))}><option value="false">Desativada</option><option value="true">Ativada</option></select></Field>
        </div>
      </form>}
      {cameras.length ? (
        <div className="camera-card-grid">
          {cameras.map((camera) => (
            <article className="config-card camera-card" key={camera.id}>
              <header>
                <div>
                  <strong>{camera.description || camera.name}</strong>
                  <span>{camera.manufacturer} {camera.model || ""} - {camera.type}</span>
                </div>
                <span className={`status ${camera.status === "ONLINE" ? "" : "offline"}`}>{camera.status === "ONLINE" ? "Online" : "Offline"}</span>
              </header>
              <div className="summary-list">
                <span><strong>Host</strong>{camera.host || camera.ipAddress || "-"}</span>
                <span><strong>Portas</strong>RTSP {camera.rtspPort} / HTTP {camera.httpPort}</span>
                <span><strong>Canais ativos</strong>{cameraChannels(camera).length}</span>
                <span><strong>Stream</strong>{camera.stream}</span>
                <span><strong>Metodo</strong>{camera.loadMethod}</span>
                <span><strong>RTSP no APK</strong>{camera.passwordSet ? "Pronto" : "Salvar senha"}</span>
              </div>
              <div className="channel-list">
                {cameraChannels(camera).map((channel) => <em key={channel.channel}>Canal {channel.channel} - {channel.description || camera.groupName || "sem descricao"}</em>)}
              </div>
              <div className="toolbar-actions compact-actions">
                <button className="secondary-button" onClick={() => onEdit(camera)}>Editar camera</button>
                <button className="danger-button" type="button" onClick={() => onDelete(camera)}><Trash2 size={16} /> Excluir</button>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="empty-state">Nenhuma camera cadastrada neste condominio.</div>}
    </section>
  );
}

function ActionConfig({ actions, devices, form, setForm, onSave, onEdit, onTrigger, onDelete }) {
  const selectedDevice = devices.find((device) => device.id === form.deviceId);
  return (
    <section className="config-stack">
      <form className="nested-form" onSubmit={onSave}>
        <div className="panel-heading compact-heading">
          <h2>{form.id ? "Editar acionamento" : "Novo acionamento"}</h2>
          <button type="submit"><Save size={16} /> Salvar acionamento</button>
        </div>
        <div className="form-hint">
          {devices.length
            ? `Equipamentos disponiveis neste condominio: ${devices.length}. ${selectedDevice ? `Configurando ${selectedDevice.name}.` : "Selecione um equipamento para vincular o rele/porta."}`
            : "Nenhum equipamento cadastrado neste condominio. Cadastre o equipamento antes de configurar acionamentos."}
        </div>
        <div className="form-grid">
          <Field label="Nome"><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
          <Field label="Equipamento"><select value={form.deviceId} onChange={(event) => {
            const device = devices.find((item) => item.id === event.target.value);
            setForm((current) => ({ ...current, deviceId: event.target.value, manufacturer: device?.manufacturer || current.manufacturer }));
          }}><option value="">{devices.length ? "Selecione o equipamento" : "Sem equipamento neste condominio"}</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name} - {device.manufacturer} - {device.ipAddress || "sem IP"}</option>)}</select></Field>
          <Field label="Rele / porta"><input value={form.relay} onChange={(event) => setForm((current) => ({ ...current, relay: event.target.value }))} /></Field>
          <Field label="Rota"><input value={form.route} onChange={(event) => setForm((current) => ({ ...current, route: event.target.value }))} /></Field>
          <Field label="Status"><select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option>ACTIVE</option><option>DISABLED</option></select></Field>
        </div>
      </form>
      <div className="equipment-choice-list">
        {devices.length ? devices.map((device) => (
          <button
            key={device.id}
            className={form.deviceId === device.id ? "" : "secondary-button"}
            type="button"
            onClick={() => setForm((current) => ({ ...current, deviceId: device.id, manufacturer: device.manufacturer || current.manufacturer }))}
          >
            <RadioTower size={16} />
            <span><strong>{device.name}</strong><small>{device.manufacturer} - {device.ipAddress || "sem IP"} - {device.passwordSet ? "senha salva" : "sem senha"}</small></span>
          </button>
        )) : <div className="empty-state">Cadastre primeiro os equipamentos do condominio.</div>}
      </div>
      {actions.map((action) => (
        <article className="action-row" key={action.id}>
          <button className="secondary-button" disabled={action.status === "DISABLED"} onClick={() => onTrigger(action)}>Acionar</button>
          <span><strong>{action.name}</strong><small>{action.route}</small></span>
          <span>{devices.find((device) => device.id === action.deviceId)?.name || action.manufacturer}{action.relay ? ` / rele ${action.relay}` : ""}</span>
          <span className="status offline">{action.status === "DISABLED" ? "Desabilitado" : "Ativo"}</span>
          <button className="secondary-button" onClick={() => onEdit(action)}>Editar</button>
          <button className="danger-button" type="button" onClick={() => onDelete(action)}><Trash2 size={16} /> Excluir</button>
        </article>
      ))}
    </section>
  );
}

export {
  cameraStreamKey,
  cameraSnapshotUrl,
  cameraChannels,
  cameraMosaicLabel,
  groupCameraDevices,
  CameraPreview,
  CameraTile,
  CameraConfig,
  ActionConfig
};
