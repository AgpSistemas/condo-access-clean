# Migracao para Supabase

Este projeto ainda nao tinha Supabase configurado. A API atual usa Postgres quando `DATABASE_URL`
existe e cai para arquivo local (`DATA_FILE`) quando nao existe.

Projetos envolvidos:

- API/Web: `C:\projetis\BKPAccess\condo-access-clean`
- Mobile APK: `C:\projetis\BKPAccess\condo-access-mobile-novo`

Backups criados antes da migracao:

- `C:\projetis\BKPAccess\condo-access-clean-backup-20260604-172150`
- `C:\projetis\BKPAccess\condo-access-mobile-novo-backup-20260604-172351`

Projeto Supabase criado:

- URL: `https://ffraqsytpoisvsfdisbc.supabase.co`
- Banco validado: `postgres`
- Tabela inicial criada: `public.condo_access_state`
- Estado migrado do Railway Postgres em `2026-06-04`
- Dados migrados: 3 condominios extras, 4 unidades, 5 moradores, 3 equipamentos,
  10 cameras, 2 credenciais e 31 logs de acesso

## Onde localizar o Supabase

No painel do Supabase:

1. Abra o projeto.
2. Acesse `Project Settings > Database`.
3. Clique em `Connect`.
4. Copie a connection string do `Session pooler`.

Para esta API, o `Session pooler` e o caminho recomendado porque o servidor Node fica ativo e
mantem conexoes persistentes. Use o `Transaction pooler` somente se a API estiver em ambiente
serverless com muitas conexoes curtas.

Formato esperado:

```env
DATABASE_URL=postgresql://postgres.PROJECT_REF:SENHA@aws-0-REGIAO.pooler.supabase.com:5432/postgres?sslmode=require
PGSSLMODE=require
```

Se a senha tiver caracteres especiais, eles precisam ser codificados dentro da URL. Exemplo:

- `@` vira `%40`
- `#` vira `%23`
- `%` vira `%25`

A senha do banco nunca deve ser gravada em arquivo versionado. Use apenas `.env.local`,
variaveis do provedor de deploy ou secrets.

## Banco usado pela API

A API nao usa Prisma, Drizzle ou migrations separadas. O armazenamento atual fica em uma tabela:

```sql
create table if not exists condo_access_state (
  id text primary key,
  state jsonb not null,
  reason text not null default 'update',
  updated_at timestamptz not null default now()
);
```

O registro principal usa `id = 'main'`. Dentro de `state` ficam condominios, unidades,
equipamentos, cameras, credenciais, ramais e logs operacionais.

## Apontar a API para Supabase

No ambiente onde a API roda, configure:

```env
DATABASE_URL=postgresql://postgres.PROJECT_REF:SENHA@aws-0-REGIAO.pooler.supabase.com:5432/postgres?sslmode=require
PGSSLMODE=require
EXPOSE_CAMERA_RTSP=false
PUBLIC_HOST=SEU_DOMINIO_DA_API
SIP_DOMAIN=granportalresidency.ddns.net
ASTERISK_PUBLIC_HOST=granportalresidency.ddns.net
ASTERISK_WS_URL=wss://granportalresidency.ddns.net:8089/ws
SIP_DEFAULT_PASSWORD=CondoAccess@2026
```

Nao configure `DATA_FILE` em producao, a menos que queira migrar automaticamente um arquivo local
existente. Se o Supabase estiver vazio e `DATA_FILE` existir no servidor, a API carrega o arquivo e
salva no Postgres com o motivo `migrated-from-file`.

## Migrar dados atuais

Escolha uma das opcoes abaixo.

Status deste projeto: a migracao foi feita usando `railway run` no servico `Postgres`,
preferindo `DATABASE_PUBLIC_URL` como origem e o `DATABASE_URL` do Supabase em
`apps/api/.env.local` como destino.

### Opcao A: migracao automatica por arquivo

Use quando o estado atual estiver em `data/condo-access-state.json`.

1. Coloque o arquivo no servidor da API.
2. Configure `DATA_FILE` apontando para esse arquivo apenas no primeiro start.
3. Configure `DATABASE_URL` do Supabase.
4. Inicie a API.
5. Confirme que `/health` retorna `"storage":"postgres"`.
6. Remova `DATA_FILE` do ambiente de producao depois da migracao.

### Opcao B: migracao de outro Postgres

Use quando os dados atuais ja estiverem no Postgres do Railway ou em outro Postgres.

Exportar somente a tabela de estado:

```powershell
pg_dump --data-only --column-inserts --table=public.condo_access_state "$env:OLD_DATABASE_URL" > condo_access_state.sql
```

Restaurar no Supabase:

```powershell
psql "$env:SUPABASE_DATABASE_URL" -f condo_access_state.sql
```

Depois, suba a API com `DATABASE_URL` apontando para o Supabase.

## Mobile

O projeto mobile nao conecta no Supabase diretamente. Ele consome a API publica.

Quando a API migrada estiver publicada, atualize no mobile:

```env
EXPO_PUBLIC_API_URL=https://SEU_DOMINIO_DA_API/api
EXPO_PUBLIC_GATEWAY_URL=https://SEU_DOMINIO_DA_API
EXPO_PUBLIC_STREAM_URL=https://SEU_DOMINIO_DA_API
```

Arquivos onde estas URLs aparecem hoje:

- `C:\projetis\BKPAccess\condo-access-mobile-novo\.env.example`
- `C:\projetis\BKPAccess\condo-access-mobile-novo\eas.json`
- `C:\projetis\BKPAccess\condo-access-mobile-novo\src\constants\env.ts`

## Validacao

Validacao local da conexao:

```powershell
node .\scripts\test-supabase-connection.mjs
```

Resultado esperado:

```json
{"ok":true,"database":"postgres","user":"postgres","table":"condo_access_state"}
```

Depois do deploy:

```powershell
curl.exe https://SEU_DOMINIO_DA_API/health
curl.exe https://SEU_DOMINIO_DA_API/api/bootstrap
```

Resultado esperado em `/health`:

```json
{"ok":true,"service":"condo-access-clean-api","storage":"postgres"}
```

Se `storage` vier como `file`, a API nao recebeu `DATABASE_URL`.
Se houver erro de SSL, confirme `?sslmode=require` na URL ou `PGSSLMODE=require`.
