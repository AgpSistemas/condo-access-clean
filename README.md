# Condo Access Clean

Base limpa criada para continuar o projeto por pontos especificos, sem apagar o que ja foi feito no projeto antigo.

## Objetivo

- API como fonte unica das configuracoes de condominio, unidade e SIP.
- Web com navegacao por paginas e configuracao SIP dentro da unidade.
- Mobile recebendo a configuracao da API e usando softphone nativo para registrar e chamar.

## Fluxo de interfonia

1. Administrador configura o SIP na Web, dentro da unidade.
2. API salva os dados da unidade e do condominio.
3. Mobile consulta a API ao logar ou trocar de unidade.
4. Mobile registra o ramal no softphone nativo.
5. Chamadas usam SIP nativo no APK; Web pode usar SIP/WebRTC apenas quando houver WSS valido.

## Rotas Web locais

A Web limpa agora aceita rotas profundas para manter o fluxo parecido com o Condfy:

- `/licencas/861/unidades`
- `/licencas/861/configuracaoCameras`
- `/licencas/861/configuracaoAcionamentos`
- `/licencas/861/equipamentos`
- `/unidades/unit-101/pessoas/moradores/ver/person-master`
- `/unidades/unit-101/pessoas/visitantes/ver/visitor-101-01`
- `/unidades/unit-101/pessoas/prestadores/ver/provider-101-01`
- `/unidades/unit-101/logins`
- `/unidades/unit-101/convites/qrCodes`

## Navegacao

- Dashboard fica enxuto e nao mostra todos os modulos do condominio.
- Portaria Remota fica no menu lateral e permite selecionar o condominio antes do atendimento.
- Configuracoes agrupa Licencas e Pagamentos.
- Condominios abre o contexto do condominio selecionado com Sindico, Unidades, Pessoas, Equipamentos, Credenciais, Permissoes, Recursos e SDK.
- Unidades concentra as funcoes da unidade em abas: Geral, Moradores, Visitantes, Prestadores, Veiculos, Logins, Convites, Telefonia e Recursos.
- A lista de Unidades tem busca por unidade, bloco, morador e ramal; clicar no card abre os dados da unidade.

## Integracoes de equipamentos

A API local expõe perfis de fabricante em `GET /api/manufacturers` para Hikvision, Control iD, Linear HCS, Bravas, Intelbras e Moni Software. A regra adotada é salvar configuracao/credenciais/eventos na API e deixar camera pesada como stream/snapshot sob demanda, sem gravar imagens grandes no banco.

## Cameras no APK

- O VLC reproduz RTSP nativo, mas o APK atual usa `expo-av` e recebe HLS (`.m3u8`) pela API.
- A API local agora expoe `GET /streams/:cameraId/index.m3u8` e converte RTSP para HLS com FFmpeg.
- Se o FFmpeg nao estiver no PATH, informe `FFMPEG_PATH`; neste computador foi validado `C:\Program Files (x86)\Wondershare\Dr.Fone\ffmpeg.exe`.
- A senha RTSP precisa ser cadastrada no formulario de Cameras da Web. A API nao retorna a senha para o frontend; ela fica apenas em memoria no servidor local.
- Quando o app consultar `GET /api/devices/cameras`, cada camera recebe `rtspUrl` apontando para o HLS local, por exemplo `http://192.168.3.27:3333/streams/camera-nvr-canal-01/index.m3u8`.

## Pastas

- `apps/api`: contrato HTTP para configuracao SIP por unidade.
- `apps/web`: interface limpa com paginas/tabs e formulario SIP da unidade.
- `apps/mobile`: camada de softphone nativo e consumo da configuracao SIP.
- `docs`: decisoes tecnicas e proximos passos.
