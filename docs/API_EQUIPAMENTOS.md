# API de Equipamentos

Este documento resume os endpoints adicionados para diagnosticar integracoes de equipamentos.

## Fabricantes suportados nesta etapa

- Hikvision: adapter `HIKVISION_ISAPI`
- Intelbras DVR/NVR/cameras: adapter `INTELBRAS_HTTP_RTSP`
- Intelbras facial Bio-T: adapter `INTELBRAS_BIOT_CGI`
- Outros: adapter `GENERIC_TCP`

## Testar conexao do equipamento

```http
GET /api/devices/:deviceId/test
```

Comportamento:

- Hikvision: tenta `GET /ISAPI/System/deviceInfo` com autenticacao Basic/Digest.
- Intelbras DVR/NVR/cameras: tenta uma sequencia de endpoints CGI (`global.cgi`, `magicBox.cgi`, `eventManager.cgi`) e valida TCP quando a API HTTP nao responder.
- Intelbras Bio-T/facial: tenta endpoints CGI seguros de diagnostico e valida TCP quando a API HTTP nao responder.
- Generico: valida conexao TCP no host/porta cadastrados.

## Listar canais do equipamento

```http
GET /api/devices/:deviceId/channels
```

Retorna canais vinculados por cameras cadastradas. Se nao houver cameras, usa `channelCount` do equipamento para montar uma lista esperada.

Paths RTSP padrao:

- Hikvision: `/Streaming/channels/{canal}0{stream}`
- Intelbras: `/cam/realmonitor?channel={canal}&subtype={stream}`

## Receber eventos Intelbras Bio-T

```http
POST /api/intelbras/biot/events
POST /api/intelbras/biot/events/:deviceId
POST /api/devices/:deviceId/intelbras-biot/events
```

Comportamento:

- aceita JSON ou `application/x-www-form-urlencoded`;
- registra o evento em `/api/access/logs`;
- retorna `auth: false` por padrao para nao liberar acesso online sem homologacao;
- para bancada, `INTELBRAS_BIOT_DEFAULT_AUTH=ALLOW` permite responder `auth: true`.

## Acionamento direto

```http
POST /api/actions/:actionId/trigger
POST /api/access/open-door
```

Adapters com comando direto nesta etapa:

- `HIKVISION_ISAPI`: `PUT /ISAPI/AccessControl/RemoteControl/door/:relay`
- `INTELBRAS_BIOT_CGI`: `GET /cgi-bin/accessControl.cgi?action=openDoor&channel=:relay`

O acionamento Intelbras Bio-T deve ser homologado em bancada no SS 3532 MF W antes de uso em portaria real, porque o endpoint exato pode variar por firmware/documentacao fechada da Intelbras.

## Diagnostico do equipamento

```http
GET /api/devices/:deviceId/diagnostics
```

Retorna:

- dados publicos do equipamento;
- adapter detectado;
- base URL da API do equipamento;
- canais;
- diagnosticos das cameras vinculadas.

## Diagnostico da camera

```http
GET /api/cameras/:cameraId/diagnostics
```

Retorna:

- adapter/fabricante;
- canal;
- senha configurada ou nao;
- FFmpeg configurado/disponivel;
- status de sessao HLS;
- URL HLS;
- RTSP mascarado.

## Verificacao realizada

Em 2026-05-31, foi criada uma instancia temporaria da API em `localhost:3334` para validar as rotas sem alterar o servidor local em `3333`.

Resultados:

- `GET /health`: OK.
- Hikvision de teste: adapter detectado e canais esperados gerados com path `/Streaming/channels/101`.
- Intelbras DVR/MHDX de teste: adapter detectado e canais gerados com path `/cam/realmonitor?channel=1&subtype=0`.
- Diagnostico de camera Intelbras: retornou FFmpeg disponivel, HLS ainda nao iniciado, RTSP mascarado e stream key correta.
- Teste de conexao em `127.0.0.1` com portas fechadas retornou falha 502, como esperado para equipamento inexistente.

## Atualizacao 2026-05-31 - Intelbras SS 3532 MF W e MHDX 3116-C

Ponto de restauro:

`C:\projetis\BKPAccess\restore-points\restore-20260531-221152-before-intelbras-integration`

Implementado:

- separacao de adapter Intelbras por familia/modelo;
- Digest Auth corrigido para assinar URLs com query string, necessario para CGI Intelbras;
- probes HTTP/CGI multiplos para MHDX 3116-C;
- probes HTTP/CGI seguros para SS 3532 MF W;
- endpoint tolerante para eventos Bio-T;
- acionamento direto inicial para Bio-T por `accessControl.cgi?action=openDoor`;
- formulario Web com presets Intelbras e vinculo de camera ao equipamento DVR.

Para homologar equipamentos reais, cadastre IP/DDNS, porta API, porta RTSP, usuario, senha e quantidade de canais na tela Equipamentos, depois use o botao `Testar API`.

## Atualizacao 2026-05-31 - arquivos por modelo Intelbras

Ponto de restauro:

`C:\projetis\BKPAccess\restore-points\restore-20260531-231811-before-intelbras-model-files`

Separacao aplicada:

- `apps/api/src/integrations/intelbras/mhdx3116c.js`
  - deteccao do MHDX;
  - defaults do DVR;
  - RTSP `/cam/realmonitor`;
  - endpoints CGI de diagnostico do DVR.
- `apps/api/src/integrations/intelbras/ss3532Mfw.js`
  - deteccao do SS 3532/SS 3542/Bio-T;
  - defaults do facial;
  - endpoints CGI de diagnostico do facial;
  - comando inicial de abertura;
  - parsing de eventos Bio-T;
  - conversao do evento para log de acesso.

O `server.js` ficou responsavel pelas rotas, autenticacao, listas em memoria e chamadas aos adapters, sem manter as regras especificas dos modelos Intelbras no corpo principal.

## Atualizacao 2026-05-31 - campos de modelo para homologacao

Ponto de restauro:

`C:\projetis\BKPAccess\restore-points\restore-20260531-233040-before-intelbras-model-fields`

Alteracao:

- Campo `Modelo homologacao` adicionado/ajustado no cadastro de Equipamentos.
- Campo `Modelo homologacao` adicionado no cadastro de Cameras.
- Para Intelbras, os modelos homologados aparecem em lista de selecao:
  - `SS 3532 MF W` para controle de acesso/facial;
  - `MHDX 3116-C` para DVR/NVR/cameras.
- Ao selecionar o modelo no equipamento, portas/canais padrao sao aplicados para reduzir erro de homologacao.

## Atualizacao 2026-05-31 - sincronizacao com arquivo mobile

Ponto de restauro:

`C:\projetis\BKPAccess\restore-points\restore-20260531-233757-before-mobile-camera-sync`

Regra implementada:

- Toda criacao/edicao/exclusao de camera pela API Web chama a sincronizacao do arquivo mobile.
- Arquivo alvo padrao:
  - `C:\projetis\BKPAccess\condo-access-mobile-novo\src\cameras\mobileCameraStreams.ts`
- Variavel opcional para trocar o destino:
  - `MOBILE_CAMERA_STREAMS_FILE`
- Bloco gerado:
  - `WEB_SYNCED_CAMERA_DEVICES: Device[]`
  - `WEB_SYNCED_CAMERAS: CameraRecord[]`
- Rota manual de sincronizacao:

```http
POST /api/cameras/mobile-file/sync
```

O bloco e delimitado por marcadores `AUTO-GENERATED WEB CAMERA REGISTRY`, para preservar as funcoes manuais do arquivo mobile e substituir apenas a area gerada.

## Atualizacao 2026-05-31 - modelos homologados e persistencia

Ponto de restauro:

`C:\projetis\BKPAccess\restore-points\restore-20260531-234948-before-camera-models-and-password-persistence`

Modelos exibidos no cadastro de equipamentos/cameras:

- Hikvision DVR/NVR: `DS-7616NI-E2 / 16P`
- Hikvision facial: `DS-K1T342MWX`
- Intelbras DVR/NVR: `MHDX 3116-C`
- Intelbras facial: `SS 3532 MF W`

Persistencia:

- Com `DATABASE_URL`, a API salva estado no Postgres em `condo_access_state`.
- Sem `DATABASE_URL`, a API salva estado local em `data/condo-access-state.json`.
- O estado persistido inclui equipamentos, cameras, acionamentos, unidades, pessoas, credenciais e logs.
- Senhas de equipamentos e cameras sao persistidas quando o cadastro e salvo pela API.
- Em producao Railway, conectar o Postgres ao servico da API e deixar `DATABASE_URL` ativo.

Observacao operacional:

- Senhas que ja estavam apenas na memoria antes desta alteracao nao podem ser extraidas pelo `/api/bootstrap`.
- Depois de reiniciar com esta versao, re-salve a senha uma vez nos cadastros existentes para gravar no estado persistente.
