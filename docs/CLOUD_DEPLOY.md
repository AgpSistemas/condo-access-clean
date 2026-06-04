# Deploy em nuvem - trustworthy-nourishment

Este roteiro direciona a API para o Railway, a Web para o Netlify e o APK Mobile para consumir os enderecos em nuvem.

## Enderecos usados

- API Railway: `https://api-production-441f.up.railway.app`
- Web Netlify: `https://exquisite-druid-3a77be.netlify.app`
- Mobile: compilar apontando para a API Railway e para a Web Netlify.

## API no Railway

Arquivo criado: `railway.json`.

Configuracao do servico `api` no projeto Railway `trustworthy-nourishment`:

- Root Directory: raiz do repositorio.
- Build Command: `npm --workspace @condo-clean/api run build`
- Start Command: `npm --workspace @condo-clean/api run dev`
- Healthcheck Path: `/health`
- Public Networking: manter dominio `https://api-production-441f.up.railway.app`.

Variaveis recomendadas no Railway:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
EXPOSE_CAMERA_RTSP=false
PUBLIC_HOST=api-production-441f.up.railway.app
SIP_DOMAIN=granportalresidency.ddns.net
ASTERISK_PUBLIC_HOST=granportalresidency.ddns.net
ASTERISK_WS_URL=wss://granportalresidency.ddns.net:8089/ws
SIP_DEFAULT_PASSWORD=CondoAccess@2026
```

No Railway, conecte o servico Postgres ao servico da API para injetar `DATABASE_URL`. A API cria automaticamente a tabela `condo_access_state` e salva nela condominios, equipamentos, cameras, credenciais, ramais e logs operacionais.

Nao configure `FFMPEG_PATH` no Railway. A API usa o pacote `@ffmpeg-installer/ffmpeg` em Linux; caminho Windows como `C:\Program Files...` quebra os streams HLS na nuvem.

Se `DATABASE_URL` nao existir, a API cai no fallback de arquivo (`DATA_FILE`). Esse fallback serve para desenvolvimento local; em producao, usar Postgres. Em nuvem, nao configure `MOBILE_CAMERA_STREAMS_FILE`, porque o arquivo do app mobile existe apenas na maquina de desenvolvimento.

Na primeira subida com Postgres, se a tabela ainda estiver vazia e existir o arquivo antigo de estado (`DATA_FILE`, normalmente `/data/condo-access-state.json`), a API carrega esse arquivo e grava automaticamente no Postgres com motivo `migrated-from-file`.

Validacao apos deploy:

```powershell
curl.exe https://api-production-441f.up.railway.app/health
curl.exe https://api-production-441f.up.railway.app/api/bootstrap
```

O esperado em `/health` e algo como:

```json
{"ok":true,"service":"condo-access-clean-api","storage":"postgres","cameras":4,"devices":1}
```

## Web no Netlify

Arquivo criado: `netlify.toml`.

Configuracao do site no Netlify:

- Base directory: raiz do repositorio.
- Build command: `npm --workspace @condo-clean/web run build`
- Publish directory: `apps/web/dist`
- Variavel: `VITE_API_URL=https://api-production-441f.up.railway.app`
- Redirect SPA: ja definido no `netlify.toml`.

Build local para validar:

```powershell
npm.cmd --workspace @condo-clean/web run build
```

Depois de publicar, abra a URL do Netlify e confirme que a faixa superior mostra `API conectada`. Se mostrar erro, conferir `VITE_API_URL` no Netlify e redeploy.

## APK Mobile para nuvem

O app mobile ja le as variaveis:

- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_GATEWAY_URL`
- `EXPO_PUBLIC_STREAM_URL`
- `EXPO_PUBLIC_WEB_URL`
- `EXPO_PUBLIC_ENABLE_NATIVE_RTSP`

Para build local do APK apontando para a nuvem, execute em `C:\projetis\BKPAccess\condo-access-mobile-novo`:

```powershell
$env:EXPO_PUBLIC_API_URL="https://api-production-441f.up.railway.app/api"
$env:EXPO_PUBLIC_GATEWAY_URL="https://api-production-441f.up.railway.app"
$env:EXPO_PUBLIC_STREAM_URL="https://api-production-441f.up.railway.app"
$env:EXPO_PUBLIC_WEB_URL="https://exquisite-druid-3a77be.netlify.app"
$env:EXPO_PUBLIC_ENABLE_NATIVE_RTSP="false"
npm.cmd run build
```

O APK local sai em `C:\projetis\BKPAccess\release`.

Para build EAS em APK, o perfil atual `preview` ja usa `android.buildType=apk`. Atualize as variaveis do perfil ou use EAS environment/secrets antes de rodar:

```powershell
eas build -p android --profile preview
```

## Ordem segura

1. Fazer deploy da API no Railway.
2. Confirmar `/health` e `/api/bootstrap`.
3. Fazer deploy da Web no Netlify com `VITE_API_URL` apontando para Railway.
4. Confirmar Web conectada na API.
5. Gerar o APK Mobile usando a URL final do Netlify em `EXPO_PUBLIC_WEB_URL`.
6. Cadastrar ou re-salvar senhas de equipamentos na nuvem, porque senha digitada antes do deploy local nao deve ser assumida como presente no ambiente Railway.

## Observacoes de seguranca

- Nao colocar senha de camera, banco, Railway ou Netlify em arquivos versionados.
- O RTSP direto continua oculto por padrao com `EXPOSE_CAMERA_RTSP=false`.
- Acionamentos reais de rele/porta devem ser testados somente com autorizacao no local.

## Desenvolvimento em rede local

Script criado na raiz do projeto:

```powershell
C:\projetis\BKPAccess\condo-access-clean\iniciar-rede-local.cmd
```

Ele detecta o IPv4 da maquina, inicia a API em `0.0.0.0:3333`, inicia a Web em `0.0.0.0:3100` e configura a Web para chamar a API pelo IP da rede local.

Uso:

```cmd
cd /d C:\projetis\BKPAccess\condo-access-clean
iniciar-rede-local.cmd
```

O script abre duas janelas:

- `Condo Access API 3333`
- `Condo Access Web 3100`

Para parar o ambiente local, feche essas duas janelas.

## Deploy Railway 2026-06-01

Depois do reinicio do computador, a autenticacao interativa do Railway continuou expirada, mas o deploy foi refeito usando `RAILWAY_API_TOKEN` somente na sessao do terminal, sem gravar token no projeto.

Deploy publicado:

- Projeto: `trustworthy-nourishment`
- Servico: `api`
- URL: `https://api-production-441f.up.railway.app`
- Deployment ID: `c4729158-7088-4201-a9f5-aab1c272cbf4`
- Mensagem: `Fix FFmpeg fps_mode compatibility 2026-06-01`

Validacoes feitas:

- `/health` respondeu `{"ok":true,"service":"condo-access-clean-api"}` antes da migracao para Postgres.
- `/api/bootstrap` respondeu mantendo os dados cadastrados no volume `/data` antes da migracao para Postgres.
- Stream Intelbras MHDX 3116-C respondeu HLS valido com `#EXTM3U`.
- Stream Hikvision DS-7616NI-E2 / 16P nao retornou mais erro `fps_mode`; ficou em estado de inicializacao, exigindo nova validacao de RTSP/conectividade do equipamento.

Se o CLI perder login novamente, use uma destas opcoes:

```cmd
railway login
```

Ou configurar uma variavel de ambiente valida:

```cmd
set RAILWAY_API_TOKEN=SEU_TOKEN_RAILWAY
```

Depois disso, o deploy da API pode ser feito pela raiz do projeto:

```cmd
railway link --project 72c29bb4-f05e-4b2f-9d03-87d25b5114d7 --environment production --service api
railway up --service api --environment production --message "Condo Access API cloud build"
```

## Ajuste FFmpeg Railway 2026-06-01

O build da API no Railway foi mudado para Docker para instalar FFmpeg do sistema Linux, evitando o binario antigo do pacote `@ffmpeg-installer` que retornava `Unrecognized option 'fps_mode'` e chegou a falhar com `SIGSEGV` em streams Hikvision.

Arquivos de deploy:

```txt
Dockerfile
.dockerignore
railway.json
```

Deploy final validado:

- Deployment ID: `333ae5af-c187-4b93-bd57-c161eaa6864a`
- API: `https://api-production-441f.up.railway.app`
- Resultado: sucesso no Railway.

Validacoes feitas:

- Intelbras MHDX 3116-C gerou HLS com `#EXTM3U`.
- Hikvision DS-7616NI-E2 / 16P gerou HLS com `#EXTM3U` nos canais testados.
- Avisos `deprecated pixel format used` do FFmpeg passaram a ser tratados como nao fatais.

## APK Mobile 2026-06-01

O script `scripts/build-android-release.ps1` do app mobile agora carrega `.env` e `.env.example` antes do Gradle para embutir as URLs externas no APK release.

APK gerado e instalado via USB:

```txt
C:\projetis\BKPAccess\release\condo-access-mobile-android-20260601-0423.apk
```

Validacoes:

- `npm run typecheck` passou.
- `npm run build` passou.
- `adb install -r` retornou `Success`.

Observacao: a captura por ADB ficou preta porque o aparelho estava preso na tela/notification shade do MIUI no momento do teste, mas o processo do app ficou ativo e nao houve `FATAL EXCEPTION` no `logcat`.
