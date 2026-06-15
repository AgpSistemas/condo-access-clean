# Integracao Control iD - Linha de Acesso

Esta pasta concentra a implementacao da API REST `.fcgi` usada pelos
equipamentos de controle de acesso da Control iD.

## Arquivos

- `client.js`: login, sessao, requisicoes JSON/binarias, paginacao de objetos,
  snapshot, diagnostico e abertura remota.
- `profiles.js`: modelos suportados, recursos, defaults, validacao e formato
  das acoes por equipamento.
- `vehicleTags.js`: tags veiculares nos modos UHF estendido e padrao.
- `iduhf.js`: compatibilidade com o perfil antigo especifico do iDUHF.

## Modelos e acionamentos

| Modelo | Acionamento suportado |
| --- | --- |
| iDAccess / iDFit | `door` |
| iDAccess Pro / iDAccess Nano / iDFlex | `sec_box` |
| iDBlock | `catra` e `open_collector` |
| iDBox | `door`, ate 4 portas |
| iDUHF | `door` interno ou `sec_box` externo |
| iDFace | `sec_box` |
| iDFace Max | `door` interno ou `sec_box` externo |

O `sec_box` exige o ID numerico do modulo. No iDBlock, o comando `catra`
usa `relay=1` ou `relay=2`, preservando o numero de rele recebido pela
aplicacao.

## Endpoints usados

```text
/login.fcgi
/logout.fcgi
/system_information.fcgi
/load_objects.fcgi
/create_objects.fcgi
/create_or_modify_objects.fcgi
/destroy_objects.fcgi
/execute_actions.fcgi
/user_set_image.fcgi
/user_destroy_image.fcgi
```

## Referencias oficiais

- https://www.controlid.com.br/docs/access-api-en/
- https://www.controlid.com.br/docs/access-api-en/session-management/do-login/
- https://www.controlid.com.br/docs/access-api-en/objects/load-objects/
- https://www.controlid.com.br/docs/access-api-en/actions/remote-door-and-turnstile-opening/
- https://www.controlid.com.br/docs/access-api-en/particularities-of-the-products/particularities-control-id-terminals/
- https://www.controlid.com.br/docs/access-api-en/particularities-of-the-products/custom-signals-idface-max/
- https://github.com/controlid/Exemplos-dedicados-a-linha-Acesso
