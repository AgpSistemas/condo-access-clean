# Integracoes de Dispositivos

Documento vivo para mapear fabricantes, classes de dispositivos, APIs e regras de integracao do Condo Access.

## Regra operacional

Antes de qualquer alteracao de codigo, configuracao ou contrato de API:

1. Gerar ponto de restauro em `C:\projetis\BKPAccess\restore-points`.
2. Preservar estado vivo da API em `api-bootstrap-current.json` quando a API local estiver online.
3. Preservar `git status`, `git diff` e dump do Postgres quando disponivel.
4. Depois da alteracao, documentar o que foi feito e como validar.

Ponto criado antes deste documento:

`C:\projetis\BKPAccess\restore-points\restore-20260531-211922-before-device-api-docs`

## Fontes oficiais e prioridade

Prioridade de pesquisa:

1. Documentacao oficial do fabricante.
2. Manual oficial do modelo.
3. Portal tecnico ou SDK oficial.
4. Forum oficial do fabricante.
5. Fontes de comunidade apenas como pista, nunca como contrato final.

## Classes de dispositivos

### Video

Inclui cameras IP, DVR, NVR, video porteiro IP e canais internos de gravador.

Contrato interno sugerido:

- `VIDEO_CAMERA_IP`
- `VIDEO_DVR`
- `VIDEO_NVR`
- `VIDEO_INTERCOM`
- `VIDEO_CHANNEL`

Funcoes minimas:

- detectar fabricante/modelo;
- testar porta HTTP/API;
- testar porta RTSP;
- listar canais esperados;
- montar RTSP por canal;
- converter para HLS pela API local;
- snapshot sob demanda;
- diagnostico de FFmpeg e codec.

### Controle de acesso

Inclui facial, controladora, leitora, biometria, QR, RFID, PIN, catraca e modulo de porta.

Contrato interno sugerido:

- `ACCESS_FACE_TERMINAL`
- `ACCESS_CONTROLLER`
- `ACCESS_READER`
- `ACCESS_TURNSTILE`
- `ACCESS_DOOR_MODULE`

Funcoes minimas:

- testar autenticacao;
- cadastrar/alterar/remover pessoa;
- cadastrar face/cartao/PIN/QR;
- abrir porta/rele;
- coletar eventos/logs;
- sincronizar credenciais;
- diagnostico por dispositivo.

### Telefonia/interfonia

Inclui video porteiro SIP, facial com SIP, porteiro IP e ramais vinculados a unidades.

Contrato interno sugerido:

- `SIP_INTERCOM`
- `SIP_FACIAL_TERMINAL`
- `SIP_PORTER_EXTENSION`

Funcoes minimas:

- registrar dados SIP do dispositivo;
- testar dominio/porta/WebSocket quando houver;
- mapear ramal de portaria e ramal de unidade;
- registrar chamada e evento de atendimento.

## Fabricantes pesquisados

### Hikvision

Fonte oficial principal:

- Portal tecnico Hikvision TPP para ISAPI/OTAP: `https://tpp.hikvision.com/download/`
- Boletim oficial de URLs RTSP/HTTP Hikvision: `https://www.hikvision.com/content/dam/hikvision/ca/bulletin/technical-bulletin/technical-article/tb_rtsp_and_http_urls_120915us.pdf`

Protocolos:

- ISAPI via HTTP/HTTPS para informacoes, configuracoes, eventos e alguns comandos.
- RTSP para video ao vivo.
- ONVIF pode ser fallback de descoberta/video em alguns modelos.

RTSP Hikvision:

```txt
rtsp://USER:PASS@HOST:RTSP_PORT/Streaming/channels/{CANAL}0{STREAM}
```

Onde:

- `STREAM=1`: main stream.
- `STREAM=2`: sub stream.
- canal 1 main: `/Streaming/channels/101`.
- canal 2 main: `/Streaming/channels/201`.
- canal 1 sub: `/Streaming/channels/102`.

Exemplo validado no projeto:

```txt
DS-7616NI-E2 / 16P
HTTP externo: 8083
RTSP externo: 1026
Server externo: 8003

Canal 1:
rtsp://admin:******@granportalresidency.ddns.net:1026/Streaming/channels/101
```

Status no sistema:

- Adapter atual: `HIKVISION_ISAPI`.
- RTSP/HLS por canal ja funciona para o NVR testado.
- API local converte RTSP para HLS em `/streams/:cameraKey/index.m3u8`.
- Ajuste aplicado no FFmpeg para NVR antigo: FPS variavel e aviso do FFmpeg nao deve virar erro fatal.

Pendencias:

- Buscar guias ISAPI especificos por modelo no TPP.
- Implementar discovery de capacidades por `/ISAPI/System/deviceInfo` e endpoints de capabilities.
- Separar cameras Hikvision, NVR Hikvision e controle de acesso Hikvision em adapters filhos.

### HiLook

Fonte oficial principal:

- Pagina oficial de produtos HiLook dentro da Hikvision: `https://www.hikvision.com/us-en/products/hilook/`

Observacao:

- HiLook e linha de entrada da Hikvision.
- Deve iniciar usando adapter compativel com Hikvision, mas com deteccao de capacidades por modelo.

RTSP esperado:

```txt
rtsp://USER:PASS@HOST:554/Streaming/channels/101
rtsp://USER:PASS@HOST:554/Streaming/channels/102
```

Pendencias:

- Validar modelos HiLook reais, principalmente DVR/NVR de entrada.
- Confirmar se todos os modelos aceitam ISAPI ou apenas RTSP/ONVIF.

### Intelbras

Fontes oficiais principais:

- HTTP API V3.35 Intelbras: `https://botminio.apps.intelbras.com.br/sdk-api/HTTP%20API%20V3.35_Intelbras.pdf`
- HTTP API V3.59 Intelbras DVR: `https://botminio.apps.intelbras.com.br/dvr/HTTP_API_V3_59_Intelbras.pdf`
- Manuais Intelbras por modelo em `https://manuais.intelbras.com.br/`
- Pesquisa especifica SS 3532 MF W e MHDX 3116-C: `docs/INTELBRAS_EQUIPAMENTOS.md`

Protocolos:

- HTTP API para produtos de video compativeis.
- RTSP para video ao vivo.
- Autenticacao Digest em muitos modelos.
- ONVIF como fallback quando habilitado.

RTSP Intelbras:

```txt
rtsp://USER:PASS@HOST:RTSP_PORT/cam/realmonitor?channel={CANAL}&subtype={SUBTYPE}
```

Onde:

- `subtype=0`: main stream.
- `subtype=1`: sub stream 1.
- `channel`: canal iniciando em 1.

Endpoints uteis documentados:

```txt
/cgi-bin/magicBox.cgi?action=getDeviceType
/cgi-bin/magicBox.cgi?action=getSystemInfoNew
/cgi-bin/magicBox.cgi?action=getVendor
/cgi-bin/magicBox.cgi?action=getSoftwareVersion
/cgi-bin/magicBox.cgi?action=getDeviceClass
/cgi-bin/ptz.cgi?action=start&code=...
```

Status no sistema:

- Adapter atual: `INTELBRAS_HTTP_RTSP`.
- Regra RTSP ja existe no codigo para `/cam/realmonitor`.
- Teste HTTP atual usa endpoint de sistema, mas deve evoluir para mais de uma tentativa.

Pendencias:

- Separar Intelbras video antigo/novo por versao de HTTP API.
- Identificar quais linhas Mibo/consumer nao possuem API publica.
- Mapear controladores de acesso Intelbras por modelo antes de prometer sincronismo facial/RFID.

### Control iD

Fontes oficiais principais:

- Documentacao oficial API Access Control Devices: `https://www.controlid.com.br/docs/access-api-en/`
- Produto iDFace: `https://www.controlid.com.br/en/access-control/idface/`
- Exemplos oficiais GitHub linkados pela documentacao Control iD.

Protocolos:

- REST API via TCP/IP.
- Endpoints `.fcgi`.
- Sessao por login.
- Modos Standalone, Online Pro/Enterprise, Monitor e Push.

Endpoints e objetos principais:

```txt
/login.fcgi
/logout.fcgi
/load_objects.fcgi
/create_objects.fcgi
/modify_objects.fcgi
/create_or_modify_objects.fcgi
/destroy_objects.fcgi
/execute_actions.fcgi
```

Objetos/funcoes:

- usuarios;
- regras de acesso;
- logs;
- faces;
- cartoes;
- PIN/senha;
- QR Code;
- abertura remota de porta/catraca;
- modo Push/Monitor.

Status no sistema:

- Adapter proprio implementado: `CONTROL_ID_ACCESS`.
- Perfil de modelo pronto no cadastro: `iDUHF`.
- Instalacao observada em 12 de junho de 2026: firmware `V5.18.3`, hardware `0N0100/0033B6`.
- Interface web validada com usuarios, tags, horarios, relatorios, sincronizacao e abertura remota.
- Nao deve ser tratado como camera RTSP comum.
- Sessao, leitura de usuarios/credenciais/faces/eventos e teste de conexao implementados.
- Criacao e exclusao de usuarios, RFID, PIN, QR Code e foto facial implementadas.
- Leitura, envio e exclusao de tags veiculares UHF implementados.
- Modo UHF estendido usa `uhf_tags` com valor hexadecimal de ate 96 bits.
- Modo UHF padrao usa `cards` com valor numerico/Wiegand.
- Abertura remota do iDUHF usa `door` para o rele interno.
- Abertura por `sec_box` fica disponivel somente para o modulo externo SecBox/MAE e exige o ID numerico do modulo.
- A opcao de catraca nao e oferecida para o perfil iDUHF, pois pertence a familia iDBlock.
- Vinculo opcional ao grupo de acesso configurado no cadastro do equipamento.

Perfil padrao do iDUHF:

| Campo | Padrao | Regra |
| --- | --- | --- |
| API | `http`, porta `80` | API REST `.fcgi` com sessao |
| RTSP | porta `0` | iDUHF nao entra como camera |
| Canais | `0` | nao gera canais de video |
| Usuario | `admin` | senha deve ser cadastrada por instalacao |
| Acionamento | `door` | rele ligado diretamente ao iDUHF |
| SecBox/MAE | vazio | preencher somente ao selecionar `sec_box` |
| Grupo de acesso | vazio | opcional; recomendado no modo standalone |
| UHF | `EXTENDED` | usa `uhf_tags`; modo `STANDARD` usa `cards` |
| Interfonia | desabilitada | perfil veicular, sem ramal SIP |

Quando usar grupo de acesso:

- No modo standalone, preencha o ID de um grupo/departamento que ja tenha `group_access_rules`, portais e horarios configurados. O sincronismo adiciona o usuario a `user_groups`.
- Deixe vazio no modo online Pro/Enterprise, quando a autorizacao for decidida pelo servidor.
- Regra direta por `user_access_rules` deve ficar restrita a excecoes; o fluxo por grupo e o recomendado pela documentacao oficial.

Quando usar SecBox:

- Use `door` quando a fechadura, cancela ou rele estiver conectado diretamente ao iDUHF.
- Use `sec_box` apenas para o rele externo MAE/SecBox.
- Informe o ID retornado/configurado pelo equipamento. O sistema nao usa mais o numero do rele como substituto silencioso para esse ID.

Pendencias:

- Executar gravacao e exclusao controladas de uma tag de teste no iDUHF antes da liberacao em producao.
- Confirmar o grupo e as regras de acesso existentes no equipamento.
- Verificar particularidades iDFace Lite/Pro, limite de faces e SIP.

## Adapters recomendados

```txt
HIKVISION_VIDEO_RTSP
HIKVISION_ISAPI_VIDEO
HIKVISION_ISAPI_ACCESS
HILOOK_VIDEO_RTSP
INTELBRAS_HTTP_VIDEO
INTELBRAS_RTSP_VIDEO
INTELBRAS_ACCESS
CONTROL_ID_ACCESS
GENERIC_ONVIF_VIDEO
GENERIC_RTSP_VIDEO
GENERIC_TCP_DEVICE
```

## Proximos fabricantes/classes a pesquisar

- Linear HCS: controle de acesso, receptores, controle remoto, veicular.
- Nice/Linear/Peccinin: portoes, modulos e acionamentos.
- Bravas: controladoras e reles.
- Dahua: video, NVR/DVR, controle de acesso.
- PPA: automacao de portao.
- HDL/Intelbras coletiva: interfonia condominial.
- Issabel/Asterisk: telefonia SIP e eventos.

## Checklist de homologacao por modelo

Para cada modelo real:

1. Fabricante e modelo exato.
2. Classe do dispositivo.
3. Firmware.
4. IP/DDNS.
5. Portas HTTP/HTTPS/RTSP/Server/SIP.
6. Autenticacao: Basic, Digest, token, sessao ou proprietaria.
7. Endpoint de teste de identidade/modelo.
8. Endpoint de video ou stream RTSP.
9. Endpoint de abertura remota.
10. Endpoint de cadastro de pessoa/credencial.
11. Endpoint de logs/eventos.
12. Limites: faces, cartoes, usuarios, conexoes RTSP, canais.
13. Resultado de teste no sistema.

## Registro desta alteracao

Data: 2026-05-31

Feito:

- Criado este documento inicial de pesquisa e padronizacao.
- Registrada a regra obrigatoria de ponto de restauro antes de modificacoes.
- Documentado o adapter Hikvision usado no DS-7616NI-E2 / 16P.
- Documentadas bases oficiais iniciais para Hikvision, HiLook, Intelbras e Control iD.
- Criada lista de adapters recomendados por classe de dispositivo.

Validacao:

- Ponto de restauro criado antes da modificacao.
- Pesquisa feita em fontes oficiais/publicas dos fabricantes.
- Documento salvo em `docs/INTEGRACOES_DISPOSITIVOS.md`.
