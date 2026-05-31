# Interfonia

## Decisao principal

O APK deve usar softphone nativo. O navegador so usa SIP/WebRTC quando o servidor SIP tiver WebSocket seguro com certificado publico valido.

## Configuracao por unidade

Campos salvos na API:

- `tenantId`: condominio.
- `unitId`: unidade.
- `sipDomain`: dominio/IP do Issabel/Asterisk.
- `sipWebSocketUrl`: usado pela Web quando houver WebRTC.
- `sipTransport`: `UDP`, `TCP`, `TLS`, `WS` ou `WSS`.
- `extension`: ramal da unidade.
- `extensionPassword`: senha do ramal.
- `porterExtension`: ramal da portaria.
- `enabled`: habilita/desabilita telefonia da unidade.

## Mobile

O app mobile recebe esses campos e registra o ramal nativamente. O modulo nativo deve expor:

- `registerAccount(config)`;
- `unregister()`;
- `call(extension)`;
- `answer()`;
- `hangup()`;
- eventos `registration`, `incomingCall`, `callState`.

## Web

A Web configura e diagnostica. Para chamada dentro do navegador, exige:

- pagina em HTTPS;
- Asterisk/Issabel com `wss://dominio:8089/ws`;
- certificado publico valido;
- ramal WebRTC com codec e DTLS/SRTP corretos.

