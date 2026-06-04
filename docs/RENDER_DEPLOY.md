# Deploy da API no Render

Use o Render para hospedar a API Node/Docker do CondoAccess. O banco continua no Supabase.

## Pre-requisitos

- Conta Render criada.
- Repositorio GitHub/GitLab com este projeto.
- Supabase ja criado e migrado.

## Configuracao recomendada

No Render, crie um `Web Service` a partir do repositorio deste projeto.

Opcoes:

- Runtime: `Docker`
- Dockerfile Path: `./Dockerfile`
- Health Check Path: `/health`
- Plan: `Free` para teste ou pago basico para producao.

O arquivo `render.yaml` na raiz tambem pode ser usado como Blueprint.

## Variaveis de ambiente

Configure no painel do Render:

```env
NODE_ENV=production
DATABASE_URL=postgresql://postgres:SENHA_CODIFICADA@db.ffraqsytpoisvsfdisbc.supabase.co:5432/postgres?sslmode=require
PGSSLMODE=require
SUPABASE_URL=https://ffraqsytpoisvsfdisbc.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_QrFUwz0_yMxRhdDkdk6_ZA_59bx3tGt
EXPOSE_CAMERA_RTSP=false
PUBLIC_HOST=SEU_DOMINIO_RENDER
SIP_DOMAIN=granportalresidency.ddns.net
ASTERISK_PUBLIC_HOST=granportalresidency.ddns.net
ASTERISK_WS_URL=wss://granportalresidency.ddns.net:8089/ws
SIP_DEFAULT_PASSWORD=SUA_SENHA_SIP
```

Importante: se a senha tiver `@`, use `%40` dentro da URL. Exemplo:

Se a senha for `MinhaSenha@2026`, use `MinhaSenha%402026`.

## Validacao

Depois do deploy:

```powershell
curl.exe https://SEU_DOMINIO_RENDER/health
curl.exe https://SEU_DOMINIO_RENDER/api/bootstrap
```

Esperado em `/health`:

```json
{"ok":true,"service":"condo-access-clean-api","storage":"postgres","cameras":10,"devices":3}
```

## Depois que a API Render estiver online

Atualize:

- Netlify Web: `VITE_API_URL=https://SEU_DOMINIO_RENDER`
- Mobile: `EXPO_PUBLIC_API_URL=https://SEU_DOMINIO_RENDER/api`
- Mobile: `EXPO_PUBLIC_GATEWAY_URL=https://SEU_DOMINIO_RENDER`
- Mobile: `EXPO_PUBLIC_STREAM_URL=https://SEU_DOMINIO_RENDER`

Depois gere novo build da Web e novo APK.
