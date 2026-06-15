function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPublicInvitePage({
  invite,
  origin,
  toMobileInvite,
  unitForId,
  invitePublicUrl,
  invitePublicPath,
  normalizeLookup,
  timeZone = "America/Sao_Paulo"
}) {
  const mobileInvite = toMobileInvite(invite, origin);
  const inviteUnit = unitForId(invite.unitId);
  const dateOptions = { dateStyle: "short", timeStyle: "short", timeZone };
  const validFrom = mobileInvite.validFrom ? new Date(mobileInvite.validFrom).toLocaleString("pt-BR", dateOptions) : "";
  const validUntil = mobileInvite.validUntil ? new Date(mobileInvite.validUntil).toLocaleString("pt-BR", dateOptions) : "";
  const qrUrl = mobileInvite.qrCodeUrl || `${invitePublicUrl(origin, mobileInvite.code)}/qr.png`;
  const unitLabel = inviteUnit
    ? `${inviteUnit.blockName ? `${inviteUnit.blockName} - ` : ""}Unidade ${inviteUnit.unitNumber || inviteUnit.unitId}`
    : mobileInvite.unit?.id || "-";
  const statusClass = normalizeLookup(mobileInvite.status || "Ativo").includes("ativ") ? "active" : "inactive";

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0b5f55">
  <title>Convite Condo Access</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: Inter, Arial, sans-serif; background: radial-gradient(circle at top, #d8f1eb 0, #edf6f4 38%, #f7faf9 100%); color: #15342f; }
    main { width: min(100%, 560px); margin: 0 auto; padding: 22px 14px 34px; }
    .brand { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 5px 0 18px; color: #0b5f55; font-size: 15px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .brand-mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; background: #0b5f55; color: #fff; font-size: 18px; box-shadow: 0 8px 18px rgba(11, 95, 85, .22); }
    .card { overflow: hidden; background: rgba(255, 255, 255, .96); border: 1px solid rgba(135, 178, 169, .35); border-radius: 24px; box-shadow: 0 22px 55px rgba(20, 73, 65, .14); }
    .hero { padding: 26px 24px 20px; text-align: center; background: linear-gradient(145deg, #0b5f55, #168878); color: #fff; }
    .eyebrow { margin: 0 0 8px; font-size: 12px; font-weight: 800; letter-spacing: .15em; text-transform: uppercase; opacity: .8; }
    h1 { margin: 0; font-size: clamp(26px, 7vw, 34px); line-height: 1.1; }
    .guest { margin: 10px 0 0; font-size: 18px; font-weight: 700; }
    .status { display: inline-flex; align-items: center; gap: 7px; margin-top: 15px; padding: 7px 12px; border-radius: 999px; font-size: 13px; font-weight: 800; }
    .status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 4px rgba(255, 255, 255, .16); }
    .status.active { background: rgba(216, 255, 238, .18); color: #d8ffee; }
    .status.inactive { background: rgba(255, 224, 224, .18); color: #ffe0e0; }
    .content { padding: 22px; }
    .instruction { margin: 0 auto 16px; max-width: 380px; color: #526c67; text-align: center; line-height: 1.5; }
    .qr-shell { width: min(100%, 390px); margin: 0 auto; padding: 16px; border: 2px solid #b9ddd5; border-radius: 22px; background: #fff; box-shadow: inset 0 0 0 7px #f1f8f6, 0 12px 28px rgba(20, 73, 65, .1); }
    .qr { display: block; width: 100%; aspect-ratio: 1; object-fit: contain; }
    .scan-label { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 15px 0 0; color: #0b5f55; font-size: 13px; font-weight: 800; }
    .scan-label::before, .scan-label::after { content: ""; width: 30px; height: 1px; background: #b9d8d1; }
    .details { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 22px; }
    .detail { min-width: 0; padding: 13px 14px; border: 1px solid #dcebe7; border-radius: 14px; background: #f7fbfa; }
    .detail.wide { grid-column: 1 / -1; }
    .detail span { display: block; margin-bottom: 4px; color: #718984; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .detail strong { display: block; overflow-wrap: anywhere; color: #1d433c; font-size: 15px; line-height: 1.35; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 18px; }
    .button { display: flex; align-items: center; justify-content: center; min-height: 48px; padding: 12px 14px; border: 1px solid #0b5f55; border-radius: 14px; color: #0b5f55; font-weight: 800; text-decoration: none; }
    .button.primary { background: #0b5f55; color: #fff; }
    button.button { width: 100%; background: #fff; font: inherit; cursor: pointer; }
    .location-result { min-height: 18px; margin: 10px 0 0; color: #607a75; font-size: 12px; text-align: center; }
    .code { margin: 18px 0 0; color: #77908b; font-family: monospace; font-size: 12px; text-align: center; overflow-wrap: anywhere; }
    .footer { margin: 16px 0 0; color: #79908c; font-size: 12px; line-height: 1.5; text-align: center; }
    @media (max-width: 420px) {
      main { padding: 12px 9px 24px; }
      .brand { margin-bottom: 12px; }
      .card { border-radius: 20px; }
      .hero { padding: 23px 17px 18px; }
      .content { padding: 17px 14px 20px; }
      .qr-shell { padding: 12px; border-radius: 18px; }
      .details, .actions { grid-template-columns: 1fr; }
      .detail.wide { grid-column: auto; }
    }
    @media print {
      body { background: #fff; }
      main { padding: 0; }
      .brand, .actions, .footer { display: none; }
      .card { border: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <main>
    <div class="brand"><span class="brand-mark">CA</span> Condo Access</div>
    <section class="card">
      <header class="hero">
        <p class="eyebrow">Convite de acesso</p>
        <h1>${escapeHtml(mobileInvite.unit?.tenant?.name || "Condominio")}</h1>
        <p class="guest">${escapeHtml(mobileInvite.guestName)}</p>
        <span class="status ${statusClass}">${escapeHtml(mobileInvite.status || "Ativo")}</span>
      </header>
      <div class="content">
        <p class="instruction">Aproxime este QR Code da camera do leitor facial para liberar o acesso.</p>
        <div class="qr-shell"><img class="qr" src="${escapeHtml(qrUrl)}" alt="QR Code do convite"></div>
        <p class="scan-label">Apresente no leitor</p>
        <div class="details">
          <div class="detail wide"><span>Destino</span><strong>${escapeHtml(unitLabel)}</strong></div>
          <div class="detail"><span>Entrada</span><strong>${escapeHtml(mobileInvite.door?.name || "Entrada")}</strong></div>
          ${validFrom ? `<div class="detail"><span>Inicio</span><strong>${escapeHtml(validFrom)}</strong></div>` : ""}
          ${validUntil ? `<div class="detail wide"><span>Valido ate</span><strong>${escapeHtml(validUntil)}</strong></div>` : ""}
        </div>
        <div class="actions">
          <a class="button primary" href="${escapeHtml(qrUrl)}" download="convite-condo-access.png">Salvar QR Code</a>
          <button class="button" type="button" onclick="window.print()">Imprimir convite</button>
          <button class="button" id="share-location" type="button">Compartilhar localizacao</button>
        </div>
        <p class="location-result" id="location-result">${invite.location?.capturedAt ? "Localizacao compartilhada com o condominio." : "Compartilhamento opcional e somente com sua autorizacao."}</p>
        <p class="code">Codigo do convite: ${escapeHtml(mobileInvite.code)}</p>
      </div>
    </section>
    <p class="footer">Convite pessoal e intransferivel. Utilize somente dentro do periodo autorizado.</p>
  </main>
  <script>
    const locationButton = document.getElementById("share-location");
    const locationResult = document.getElementById("location-result");
    locationButton?.addEventListener("click", () => {
      if (!navigator.geolocation) {
        locationResult.textContent = "Localizacao nao suportada neste navegador.";
        return;
      }
      locationButton.disabled = true;
      locationResult.textContent = "Solicitando permissao de localizacao...";
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          const response = await fetch("${invitePublicPath(mobileInvite.code)}/location", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy
            })
          });
          if (!response.ok) throw new Error("Falha ao registrar");
          locationResult.textContent = "Localizacao compartilhada com o condominio.";
        } catch {
          locationResult.textContent = "Nao foi possivel registrar a localizacao.";
          locationButton.disabled = false;
        }
      }, () => {
        locationResult.textContent = "Permissao de localizacao nao concedida.";
        locationButton.disabled = false;
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
  </script>
</body>
</html>`;
}
