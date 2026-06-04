# Contexto de trabalho Condo Access

Este arquivo guarda as decisoes operacionais que devem ser respeitadas em qualquer manutencao do projeto.

## Ambientes oficiais

- API oficial: Railway
- Banco de dados oficial: Railway Postgres
- URL da API: `https://api-production-441f.up.railway.app`
- Web oficial: Netlify
- URL da Web em uso: `https://condoaccess.netlify.app`
- Mobile oficial: app Android em `C:\projetis\BKPAccess\condo-access-mobile-novo`

## Regra principal

Nao trocar o contexto do sistema quando o pedido for pontual.

Se o pedido for no mobile, alterar somente o app mobile e documentacao relacionada. Nao alterar API, Web, banco, rotas, seeds, dados persistidos ou configuracoes de deploy sem pedido explicito.

Se o pedido for na Web, alterar somente a Web. Nao alterar API, banco ou app mobile sem necessidade real e sem registrar a razao.

Se o pedido for na API, alterar somente API e contratos necessarios. Nao alterar telas ou fluxo mobile/web sem pedido explicito.

## API e dados

- A API e o banco sao online no Railway.
- Nao apontar APK, Web ou testes principais para `localhost` por padrao.
- `localhost` deve ser usado apenas em projetos/copia de teste local, nunca como fallback silencioso do app oficial.
- Nao sobrescrever dados de producao.
- Nao alterar dados da API para testar tela, exceto quando o usuario pedir explicitamente.

## Mobile

- O app mobile deve buscar dados na API online por padrao.
- O fallback do app mobile tambem deve apontar para Railway, para evitar APK buscando `localhost` quando variaveis de ambiente nao forem embutidas.
- Na tela inicial do morador, a chamada deve ficar simples: mostrar somente a acao de ligar para a portaria quando disponivel.
- Mensagens de atualizacao devem aparecer somente em falha. Nao exibir "Sincronizando..." ou "Atualizado" continuamente.

## Deploy

- API: Railway. Deploy exige `RAILWAY_API_TOKEN`, `RAILWAY_TOKEN` ou login interativo valido.
- Web: Netlify. Publicar no site `condoaccess`.
- APK: gerar em `C:\projetis\BKPAccess\release`.

## Rotina antes de alterar

1. Ler este arquivo.
2. Confirmar qual projeto deve ser alterado: API, Web ou Mobile.
3. Evitar mudancas fora do escopo.
4. Registrar no final quais arquivos foram alterados.
