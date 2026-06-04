# Intelbras - Equipamentos e APIs

Pesquisa inicial para homologacao Intelbras no Condo Access.

Ponto de restauro criado antes da documentacao:

`C:\projetis\BKPAccess\restore-points\restore-20260531-220725-before-intelbras-research`

Data da pesquisa: 2026-05-31.

## Fontes consultadas

- Produto SS 3532 MF W: `https://www.intelbras.com/pt-br/controlador-de-acesso-facial-ss-3532-mf-w`
- Manual SS 3532 MF W / SS 3542 MF W: `https://manuais.intelbras.com.br/manual-interface-web-linha-bio-t/manual-usuario-pt-BR/manual_SS35x2_MF_W.html`
- Manual Interface Web Bio-T: `https://manuais.intelbras.com.br/manual-interface-web-linha-bio-t/pt-BR/manual_SS3532_SS3542_MF_pt-BR.html`
- Datasheet SS 3532 MF W: `https://backend.intelbras.com/sites/default/files/2026-04/Datasheet%20SS%203532%20MF%20W.pdf`
- Portal de integracao Intelbras: `https://intelbras-caco-api.intelbras.com.br/`
- Nova plataforma de documentacao Intelbras, exige login: `https://integracao.intelbras.com.br/`
- Produto MHDX 3116-C: `https://www.intelbras.com/pt-br/gravador-de-video-inteligente-com-design-compacto-mhdx-3116-c`
- Manual MHDX 3116-C: `https://backend.intelbras.com/sites/default/files/2023-12/Manual_MHDX_3116C_02-23_site.pdf`
- HTTP API V3.59 Intelbras DVR: `https://botminio.apps.intelbras.com.br/dvr/HTTP_API_V3_59_Intelbras.pdf`
- Forum oficial Intelbras sobre RTSP DVR/NVR: `https://forum.intelbras.com.br/viewtopic.php?t=50085`

## SS 3532 MF W

Classe sugerida:

- `ACCESS_FACE_TERMINAL`
- `SIP_FACIAL_TERMINAL`
- `ACCESS_DOOR_MODULE` quando usar rele local ou modulo XR 2201

Capacidades publicas confirmadas:

- Controlador facial da linha Bio-T.
- Operacao stand-alone, online/offline ou controlado por software.
- Integracao API/CGI indicada no datasheet.
- Suporte API indicado no datasheet.
- Interface web com CGI habilitavel/desabilitavel.
- ONVIF habilitavel/desabilitavel na interface web.
- SIP padrao com codecs G.711a, G.711u e H.264.
- Acionamento via DTMF por SIP-INFO ou RFC 2833.
- Eventos e operacao online/offline pela API Intelbras de integracao Bio-T/CACO.

Observacao importante:

O portal antigo da API Intelbras (`intelbras-caco-api.intelbras.com.br`) informa que a documentacao migrou para uma nova plataforma. A nova plataforma redireciona para login da Conta Intelbras. Portanto, os endpoints completos da API de integracao Bio-T devem ser obtidos com acesso autorizado da Intelbras ou via suporte tecnico/parceiro.

Configuracoes a validar no equipamento:

- Habilitar `CGI` na interface web.
- Habilitar `ONVIF` apenas se for usar descoberta/video via ONVIF.
- Confirmar porta HTTP ou HTTPS.
- Confirmar usuario/senha admin ou usuario especifico de integracao.
- Verificar firmware instalado, porque o datasheet cita recursos condicionados a versao.

Uso recomendado no Condo Access:

1. Implementar adapter `INTELBRAS_BIOT_CGI` separado do adapter de DVR.
2. Comecar por diagnostico de conectividade e capacidades.
3. Homologar abertura remota de porta em bancada antes de usar em portaria real.
4. Homologar POST/eventos antes de sincronizar pessoas/credenciais.
5. Tratar biometria facial como dado sensivel LGPD: armazenar o minimo necessario e nunca expor foto/template em logs.

Fluxos provaveis para homologacao:

- Diagnostico HTTP/HTTPS: testar login, `CGI` ativo e resposta do equipamento.
- Eventos: configurar o SS para reportar eventos a um endpoint local do Condo Access.
- Modo online: o controlador envia tentativa de acesso ao servidor e aguarda autorizacao.
- Abertura: pode ser via API/CGI quando disponivel no firmware ou via SIP/DTMF conforme configuracao.

Pontos ainda dependentes da documentacao fechada:

- Contrato exato de cadastro/edicao/remocao de usuarios.
- Contrato exato de face, cartao, senha, QR Code e controles.
- Endpoint oficial de abertura remota do SS 3532 MF W.
- Assinatura exata dos callbacks de eventos da API Bio-T/CACO.

## MHDX 3116-C

Classe sugerida:

- `VIDEO_DVR`
- `VIDEO_CHANNEL` para cada canal exposto ao sistema

Capacidades publicas confirmadas:

- DVR Multi HD com 16 canais.
- Suporta HTTP, HTTPS, TCP/IP, RTSP, ONVIF, SNMP, Intelbras DDNS, Intelbras Cloud, Multicast, POS e RTMP.
- Porta TCP padrao: `37777`.
- Porta HTTP padrao: `80`.
- Porta HTTPS padrao: `443`.
- Porta POS padrao: `38800`.
- Porta RTSP padrao: `554`.
- CGI pode ser habilitado/desabilitado nos servicos basicos do DVR.
- ONVIF pode ser habilitado/desabilitado.

RTSP padrao Intelbras DVR/NVR:

```txt
rtsp://USUARIO:SENHA@HOST:PORTA_RTSP/cam/realmonitor?channel=CANAL&subtype=STREAM
```

Parametros:

- `channel`: canal iniciando em `1`.
- `subtype=0`: stream principal.
- `subtype=1`: stream extra/secundario.
- `PORTA_RTSP`: normalmente `554`, ou a porta externa redirecionada no roteador.

Exemplo:

```txt
rtsp://admin:senha@192.168.1.50:554/cam/realmonitor?channel=1&subtype=0
rtsp://admin:senha@192.168.1.50:554/cam/realmonitor?channel=1&subtype=1
```

HTTP API V3.59 - endpoints uteis para diagnostico:

```txt
GET /cgi-bin/global.cgi?action=getCurrentTime
GET /cgi-bin/magicBox.cgi?action=getDeviceType
GET /cgi-bin/magicBox.cgi?action=getSystemInfoNew
GET /cgi-bin/magicBox.cgi?action=getVendor
GET /cgi-bin/magicBox.cgi?action=getSoftwareVersion
GET /cgi-bin/magicBox.cgi?action=getDeviceClass
GET /cgi-bin/configManager.cgi?action=getConfig&name=Network
GET /cgi-bin/eventManager.cgi?action=getExposureEvents
```

Snapshot/stream HTTP:

```txt
GET /cgi-bin/snapshot.cgi?channel=1
GET /cgi-bin/mjpg/video.cgi?channel=1&subtype=1
```

Observacoes:

- Para video ao vivo no Condo Access, o caminho preferencial deve ser RTSP convertido para HLS pela API local.
- MJPEG HTTP pode depender de codec/configuracao e geralmente funciona melhor no stream extra.
- A API usa numeracao de canal em requisicao iniciando em `1`.
- Em algumas respostas internas, a numeracao pode iniciar em `0`; isso deve ficar encapsulado no adapter.

Uso recomendado no Condo Access:

1. Manter adapter `INTELBRAS_HTTP_RTSP` para DVR/NVR/cameras IP com HTTP API V3.x.
2. No teste do equipamento, tentar mais de um endpoint de diagnostico.
3. No cadastro de cameras, gerar canais 1 a 16 com path `/cam/realmonitor`.
4. Preferir `subtype=1` no mobile quando o link externo for limitado.
5. Exibir diagnostico claro quando RTSP, HTTP ou CGI estiverem desabilitados.

Checklist de homologacao do MHDX 3116-C:

- Confirmar firmware instalado.
- Confirmar porta HTTP interna/externa.
- Confirmar porta RTSP interna/externa.
- Confirmar se CGI esta habilitado.
- Confirmar se ONVIF esta habilitado, se necessario.
- Testar `GET /cgi-bin/global.cgi?action=getCurrentTime`.
- Testar RTSP canal 1 principal e secundario.
- Testar RTSP canal 16 principal e secundario.
- Validar HLS gerado no sistema em web e mobile.

## Decisao tecnica inicial

Nao misturar os dois equipamentos no mesmo adapter:

- `INTELBRAS_HTTP_RTSP`: video, DVR/NVR/cameras IP, RTSP e HTTP API V3.x.
- `INTELBRAS_BIOT_CGI`: acesso facial Bio-T, eventos, credenciais, abertura e SIP/DTMF quando aplicavel.

Isso evita que comandos de controle de acesso sejam tratados como camera e permite regras de seguranca mais rigidas para dados biometricos.

## Implementacao inicial no sistema

Ponto de restauro:

`C:\projetis\BKPAccess\restore-points\restore-20260531-221152-before-intelbras-integration`

Alteracoes aplicadas:

- API detecta Intelbras `SS 3532 MF W` e equipamentos de controle de acesso como `INTELBRAS_BIOT_CGI`.
- API detecta Intelbras `MHDX 3116-C` e equipamentos de cameras como `INTELBRAS_HTTP_RTSP`.
- MHDX usa RTSP `/cam/realmonitor?channel=CANAL&subtype=STREAM`.
- Teste do MHDX tenta endpoints CGI de hora, tipo, sistema, fabricante e eventos.
- Teste do SS 3532 tenta endpoints CGI de hora, tipo, classe, versao e rede.
- Eventos Bio-T podem entrar por `/api/intelbras/biot/events/:deviceId`.
- Acionamento Bio-T inicial usa `/cgi-bin/accessControl.cgi?action=openDoor&channel=RELE`.
- Web recebeu presets de cadastro para `MHDX 3116-C` e `SS 3532 MF W`.

Cuidados de homologacao:

- O retorno de eventos Bio-T nao autoriza acesso online por padrao.
- Abertura por Bio-T deve ser testada primeiro em bancada ou fora de horario operacional.
- Para DVR/MHDX, validar RTSP principal e substream antes de liberar no mobile.

## Separacao fisica por arquivo

Ponto de restauro:

`C:\projetis\BKPAccess\restore-points\restore-20260531-231811-before-intelbras-model-files`

Arquivos criados:

- `apps/api/src/integrations/intelbras/mhdx3116c.js`
- `apps/api/src/integrations/intelbras/ss3532Mfw.js`

Objetivo:

- impedir mistura de regras entre DVR e facial;
- permitir homologar cada equipamento com checklist proprio;
- deixar novos modelos Intelbras entrarem por novos arquivos, sem crescer o `server.js`;
- manter o `server.js` apenas como camada de rota/orquestracao.

Regra daqui para frente:

- novo DVR/NVR Intelbras deve ganhar arquivo proprio quando tiver endpoint, porta, codec ou fluxo diferente;
- novo facial/controlador Intelbras deve ganhar arquivo proprio quando tiver evento, abertura, biometria ou autorizacao online diferente;
- apenas funcoes comuns e seguras devem ser compartilhadas pela API principal.

## Campos de homologacao na interface

Ponto de restauro:

`C:\projetis\BKPAccess\restore-points\restore-20260531-233040-before-intelbras-model-fields`

Regra aplicada:

- Em Equipamentos, o campo `Modelo homologacao` mostra `SS 3532 MF W` e `MHDX 3116-C` em lista de selecao conforme a categoria/fabricante.
- Em Cameras, o campo `Modelo homologacao` permite escolher `MHDX 3116-C` para DVR/NVR Intelbras.
- Quando o tipo for facial Intelbras, o campo deve permitir `SS 3532 MF W`.
- A lista salva deve exibir fabricante e modelo para facilitar conferencia durante a homologacao.
