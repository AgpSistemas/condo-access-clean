# Interfonia Condo Access

## Servidor Asterisk

- Dominio SIP: `granportalresidency.ddns.net`
- WebRTC/WSS: `wss://granportalresidency.ddns.net:8089/ws`
- SIP normal: `granportalresidency.ddns.net:5060` via UDP
- Senha padrao dos ramais: `CondoAccess@2026`
- Certificado: Let's Encrypt em `/etc/letsencrypt/live/granportalresidency.ddns.net`
- Hook de renovacao do Asterisk: `/etc/letsencrypt/renewal-hooks/deploy/asterisk-cert.sh`

O Asterisk publica o WebSocket SIP no caminho `/ws`. Se alguem digitar `/sw`, a API normaliza para `/ws`, mas os clientes SIP/WebRTC devem usar `/ws`.

## Plano de ramais

| Faixa | Transporte | Uso |
| --- | --- | --- |
| `9000-9099` | SIP UDP normal | Portaria, faciais, telefones IP e equipamentos |
| `9100-9299` | WebRTC WSS | Navegador, app e sistema Condo Access |
| `9300-9399` | WebRTC WSS | Reserva para app/navegador |

Ramal de portaria padrao:

```text
9000
```

Teste de eco:

```text
600
```

Qualquer ramal `9XXX` pode chamar outro ramal `9XXX`. Exemplo: um WebRTC `9100` pode chamar a portaria SIP `9000`; um telefone IP `9001` pode chamar uma unidade WebRTC `9100`.

## Configuracao no sistema

Variaveis principais:

```env
SIP_DOMAIN=granportalresidency.ddns.net
ASTERISK_PUBLIC_HOST=granportalresidency.ddns.net
ASTERISK_WS_URL=wss://granportalresidency.ddns.net:8089/ws
SIP_DEFAULT_PASSWORD=CondoAccess@2026
EXPO_PUBLIC_SIP_DOMAIN=granportalresidency.ddns.net
EXPO_PUBLIC_SIP_WEBSOCKET_URL=wss://granportalresidency.ddns.net:8089/ws
EXPO_PUBLIC_SIP_DEFAULT_PASSWORD=CondoAccess@2026
```

Defaults recomendados para condominios:

```text
Ramal portaria: 9000
Inicio faixa ramais WebRTC: 9100
Fim faixa ramais WebRTC: 9199
```

## Configuracao de equipamentos SIP normais

Use esta base para telefone IP, facial, ATA ou equipamento de portaria:

```text
Servidor/Proxy/Registrar: granportalresidency.ddns.net
Porta SIP: 5060
Transporte: UDP
Usuario/Auth ID: numero do ramal
Ramal/Extension: numero do ramal
Senha: CondoAccess@2026
DTMF: RFC2833/RFC4733
Codecs: G.711 u-law, G.711 a-law
STUN: desabilitado no equipamento, salvo necessidade especifica
```

Exemplo portaria:

```text
Usuario: 9000
Senha: CondoAccess@2026
Servidor: granportalresidency.ddns.net
Porta: 5060 UDP
```

## Configuracao WebRTC

Clientes WebRTC devem usar:

```text
WebSocket: wss://granportalresidency.ddns.net:8089/ws
Dominio SIP: granportalresidency.ddns.net
Usuario/Auth ID: ramal 9100-9299 ou 9300-9399
Senha: CondoAccess@2026
Codecs: Opus, G.711 u-law, G.711 a-law
Media: DTLS/SRTP
ICE: habilitado
```

## Portas no roteador

Encaminhar para a VM `192.168.0.200`:

```text
TCP 8089        -> 192.168.0.200:8089  WebRTC/WSS
UDP 5060        -> 192.168.0.200:5060  SIP normal
UDP 10000-10100 -> 192.168.0.200       RTP/audio
TCP 80          -> 192.168.0.200:80    renovacao Let's Encrypt
```

A porta `80` fica fechada fora do periodo de renovacao, mas o redirecionamento deve permanecer no roteador para o Certbot abrir temporariamente a porta e renovar o certificado.

## Comandos uteis no servidor

```bash
sudo systemctl status asterisk
sudo asterisk -rx "http show status"
sudo asterisk -rx "pjsip show transports"
sudo asterisk -rx "pjsip show endpoints"
sudo asterisk -rx "pjsip show contacts"
sudo asterisk -rx "pjsip show registrations"
sudo certbot renew --dry-run
```

Ver um ramal especifico:

```bash
sudo asterisk -rx "pjsip show endpoint 9000"
sudo asterisk -rx "pjsip show endpoint 9100"
```

## Observacoes

- O retorno HTTP `501 Not Implemented` em `https://granportalresidency.ddns.net:8089/ws` e normal quando acessado por navegador ou `curl`, porque o endpoint espera upgrade WebSocket SIP.
- Nextcloud foi removido. A renovacao do certificado agora e feita pelo Certbot do Ubuntu.
- O arquivo principal do plano de ramais no servidor e `/etc/asterisk/pjsip_condo_webrtc.conf`.
