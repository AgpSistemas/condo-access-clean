# Modulos principais

## API

- `apps/api/src/server.js`: inicializacao, estado compartilhado e composicao das rotas.
- `apps/api/src/integrations/hikvision/parsers.js`: parsing JSON/XML, paginacao, normalizacao de credenciais, faces e eventos Hikvision.
- `apps/api/src/integrations/intelbras/`: adaptadores dos equipamentos Intelbras homologados.
- `apps/api/src/integrations/cameras/cameraProfiles.js`: perfis e configuracoes de streams de cameras.

## Web

- `apps/web/src/App.jsx`: estado principal, navegacao e composicao das telas.
- `apps/web/src/config/appConfig.jsx`: configuracoes, formularios padrao, opcoes homologadas e utilitarios de dados.
- `apps/web/src/components/common.jsx`: componentes compartilhados, login, paginacao e indicadores.
- `apps/web/src/components/cameras.jsx`: visualizacao, mosaico, cadastro de cameras e acionamentos.

Novas integracoes e componentes devem ser adicionados ao modulo do dominio correspondente. O arquivo principal deve apenas coordenar os modulos.
