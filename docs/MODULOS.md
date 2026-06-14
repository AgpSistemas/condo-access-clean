# Modulos principais

## API

- `apps/api/src/server.js`: inicializacao, estado compartilhado e composicao das rotas.
- `apps/api/src/integrations/hikvision/parsers.js`: parsing JSON/XML, paginacao, normalizacao de credenciais, faces e eventos Hikvision.
- `apps/api/src/integrations/controlid/vehicleTags.js`: validacao, leitura e escrita de tags UHF Control iD nos modos estendido e padrao.
- `apps/api/src/integrations/controlid/iduhf.js`: perfil homologado, defaults e validacao de rele interno/SecBox/grupo do Control iD iDUHF.
- `apps/api/src/integrations/intelbras/`: adaptadores dos equipamentos Intelbras homologados.
- `apps/api/src/integrations/cameras/cameraProfiles.js`: perfis e configuracoes de streams de cameras.
- `apps/api/src/modules/vehicles/vehicleTagController.js`: sincronismo e remocao da tag veicular no equipamento Control iD.

## Web

- `apps/web/src/App.jsx`: estado principal, navegacao e composicao das telas.
- `apps/web/src/config/appConfig.jsx`: configuracoes, formularios padrao, opcoes homologadas e utilitarios de dados.
- `apps/web/src/components/common.jsx`: componentes compartilhados, login, paginacao e indicadores.
- `apps/web/src/components/cameras.jsx`: visualizacao, mosaico, cadastro de cameras e acionamentos.
- `apps/web/src/pages/telephony/`: modulo de ramais, busca, paginacao e chamada SIP interna.
- `apps/web/src/services/telephonyService.js`: acesso as rotas de telefonia da API.
- `apps/web/src/controllers/telephonyController.js`: tratamento das respostas de telefonia para as paginas.
- `apps/web/src/services/vehicleService.js` e `apps/web/src/controllers/vehicleController.js`: cadastro de veiculos e comandos de tag veicular.

Novas integracoes e componentes devem ser adicionados ao modulo do dominio correspondente. O arquivo principal deve apenas coordenar os modulos.
