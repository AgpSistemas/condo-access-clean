# Cronograma de Melhorias

Analise feita em 2026-05-31 sobre:

- Web/API: `C:\projetis\BKPAccess\condo-access-clean`
- Mobile novo: `C:\projetis\BKPAccess\condo-access-mobile-novo`
- Celular ADB: conectado e autorizado; Hik-Connect e ISIC Lite instalados.

## Diagnostico rapido

O projeto principal esta em uma fase boa de prototipo operacional: API local, Web administrativa, cadastro de condominios/unidades/equipamentos/cameras, HLS via FFmpeg e acionamento Hikvision ISAPI basico. O mobile novo compila em TypeScript e ja consome cameras, acionamentos, convites, manutencao e telefonia SIP/WebRTC.

As maiores melhorias agora sao:

1. Separar prototipo local de produto persistente.
2. Formalizar o contrato API-Web-Mobile.
3. Melhorar o fluxo real de cameras baseado no que Hik-Connect e ISIC Lite fazem bem.
4. Proteger credenciais, logs e operacao de equipamentos.
5. Organizar Git/build antes de mudancas grandes no mobile.

## Fase 0 - Controle e base segura

Prazo sugerido: 1 a 2 dias.

Objetivo: deixar o projeto pronto para evoluir sem perder historico.

Acoes:

- Criar `.gitignore` no mobile novo antes do primeiro commit, ignorando `node_modules/`, `.expo/`, `build/`, logs, APKs gerados e caches do Android.
- Fazer primeiro commit do mobile com somente codigo fonte, configs necessarias e lockfile.
- Criar branch por frente: `codex/git-hygiene-mobile`, `codex/api-contract`, `codex/camera-flow`.
- Documentar variaveis de ambiente em `.env.example` para API, Web e Mobile.
- Padronizar IPs locais (`192.168.3.27`) em variaveis de ambiente, sem valor fixo dentro do codigo.

Entregaveis:

- Git do mobile limpo.
- Primeiro commit do mobile.
- Checklist de build local.

## Fase 1 - Contrato da API e dados persistentes

Prazo sugerido: 3 a 5 dias.

Objetivo: tirar o sistema da memoria do Node e preparar para uso real.

Acoes:

- Criar camada de armazenamento para condominios, unidades, pessoas, dispositivos, cameras, acionamentos, convites e logs.
- Comecar simples com SQLite/PostgreSQL e migrations.
- Definir DTOs/contratos para rotas usadas pelo mobile:
  - `/api/auth/login`
  - `/api/devices`
  - `/api/devices/cameras`
  - `/api/access/open-door`
  - `/api/access/logs`
  - `/api/telephony/config`
  - `/api/telephony/calls`
  - `/streams/:cameraId/index.m3u8`
- Adicionar validacao de entrada para POST/PUT/PATCH.
- Adicionar testes de contrato para as rotas principais.

Entregaveis:

- Dados sobrevivem ao restart da API.
- Mobile e Web documentados contra o mesmo contrato.
- Testes basicos de API.

## Fase 2 - Cameras: fluxo similar a Hik-Connect e ISIC Lite

Prazo sugerido: 5 a 8 dias.

Objetivo: melhorar UX e estabilidade de camera no Web e APK.

Observacoes coletadas por ADB:

- Hik-Connect usa lista por dispositivo, canais horizontais, status por canal, "expandir" para N canais e entrada de reproducao ao vivo recente.
- ISIC Lite usa dashboard com grupo do dispositivo, botao "play all", menu por dispositivo, miniaturas em grade e botao flutuante para adicionar/configurar.
- Ambos priorizam dispositivo > canais > abrir ao vivo, em vez de listar cameras soltas.

Acoes:

- Reorganizar Web e Mobile para mostrar "equipamento" como entidade principal e canais como filhos.
- Exibir status por canal: online, offline, carregando, sem senha, FFmpeg indisponivel.
- Criar mosaico com selecao de 1, 4, 9 e 16 canais.
- Implementar "play all" por DVR/NVR.
- Criar "recentes" no mobile e Web: ultimos canais abertos.
- Criar diagnostico de stream por camera:
  - RTSP montado com senha mascarada.
  - FFmpeg encontrado ou ausente.
  - ultima tentativa e ultimo erro.
  - tempo ate primeiro segmento HLS.
- Melhorar fallback:
  - Mobile usa HLS por padrao.
  - RTSP nativo via VLC fica opt-in.
  - Web usa HLS nativo quando possivel e HLS.js como fallback.

Entregaveis:

- Tela de cameras com UX por dispositivo/canal.
- Diagnostico claro para instalador.
- Fluxo de mosaico mais parecido com apps de referencia.

## Fase 3 - Integracoes Hikvision e Intelbras

Prazo sugerido: 7 a 12 dias.

Objetivo: transformar perfis de fabricante em conectores reais.

Acoes Hikvision:

- Consolidar ISAPI para teste de dispositivo, info, status e abertura remota.
- Adicionar descoberta/validacao de canais quando o equipamento permitir.
- Separar credenciais de camera e credenciais de acesso.
- Criar fila de comandos para abertura e sincronismo.

Acoes Intelbras:

- Mapear modelos por protocolo: RTSP, HTTP/CGI, porta 37777/SDK quando aplicavel.
- Comecar com cameras/DVR/NVR via RTSP/HLS.
- Criar adapter `intelbras` separado do adapter `hikvision`.
- Registrar eventos e falhas com fabricante/modelo.

Entregaveis:

- Interface comum de adapter:
  - `testConnection`
  - `listChannels`
  - `buildStreamUrl`
  - `openDoor`
  - `syncCredentials`
- Dois adapters iniciais: Hikvision e Intelbras.

## Fase 4 - Mobile operacional

Prazo sugerido: 5 a 8 dias.

Objetivo: deixar o APK confiavel em campo.

Acoes:

- Remover IP fixo de `src/constants/env.ts` e usar build profiles/QR de configuracao.
- Criar tela de diagnostico no app:
  - API conectada.
  - STREAM_URL.
  - ramal SIP.
  - permissao de audio/camera/notificacao.
  - teste de camera HLS.
- Tratar queda de rede com cache local de dados essenciais.
- Melhorar mensagens para morador e instalador.
- Testar Android real com Hikvision/Intelbras offline e online.

Entregaveis:

- APK com diagnostico.
- Build repetivel.
- Guia de instalacao no celular.

## Fase 5 - Seguranca e operacao

Prazo sugerido: 5 a 10 dias.

Objetivo: preparar para condominio real.

Acoes:

- Autenticacao real com roles/permissoes.
- Criptografar ou proteger senhas de SIP, RTSP e equipamentos.
- Nao retornar senha para frontend.
- Auditar todos os acionamentos: quem, quando, porta, resultado, origem.
- Rate limit para acionamentos.
- Logs estruturados por tenant.
- Backups e exportacao de configuracao.

Entregaveis:

- Auditoria minima de operacao.
- Modelo de permissao por perfil.
- Politica de credenciais.

## Fase 6 - Qualidade, instalacao e homologacao

Prazo sugerido: 5 a 7 dias.

Objetivo: fechar ciclo de testes com equipamentos reais.

Acoes:

- Testes automatizados de API.
- Testes manuais guiados no Web e APK.
- Playbook de homologacao por condominio:
  - cadastrar condominio.
  - cadastrar DVR/NVR.
  - validar canais.
  - abrir mosaico.
  - cadastrar acionamento.
  - testar abertura remota.
  - testar chamada SIP.
- Medir latencia do stream e estabilidade.
- Criar relatorio de falhas por equipamento.

Entregaveis:

- Checklist de homologacao.
- Relatorio por modelo de equipamento.
- Versao candidata para piloto.

## Roteiro ADB para mapear Hik-Connect e ISIC Lite

ADB foi encontrado em:

`C:\Users\Maycon\AppData\Local\Android\Sdk\platform-tools\adb.exe`

Pacotes identificados:

- Hik-Connect: `com.connect.enduser`
- Hikvision Convergence: `com.hikvision.convergence`
- ISIC Lite: `com.intelbras.isiclite`
- AMT Remoto Intelbras: `br.com.intelbras.amtremotomobile`

Proximos passos de mapeamento:

1. Gravar fluxo assistido de 30 a 60 segundos por app.
2. Exportar hierarquia de tela em cada passo importante.
3. Anotar telas:
   - lista de dispositivos.
   - canais.
   - play ao vivo.
   - expandir/mosaico.
   - menu do dispositivo.
   - eventos/notificacoes.
4. Comparar com nossas telas Web/Mobile.
5. Transformar cada diferenca em tarefa de UX/API.

Limites importantes:

- Nao da para ler dados internos dos apps comerciais com `run-as`, pois eles nao sao debuggable.
- Captura de rede pode ser limitada por HTTPS/certificate pinning.
- O melhor caminho e mapear comportamento visual/fluxo e integrar nossos equipamentos por protocolos oficiais ou RTSP/HTTP locais.

## Prioridade recomendada

1. Git hygiene do mobile.
2. Persistencia real da API.
3. Contrato API-Mobile-Web.
4. Cameras por dispositivo/canal com diagnostico.
5. Adapters Hikvision/Intelbras.
6. Segurança e auditoria.
7. Homologacao em campo.
