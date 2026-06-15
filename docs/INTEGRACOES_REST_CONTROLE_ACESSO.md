# Integracoes REST de controle de acesso

Os conectores ficam separados em `apps/api/src/integrations/<fabricante>`.
Um fabricante so deve ser marcado como integrado quando existe API oficial
documentada e um fluxo implementado no Condo Access.

## Integracoes diretas

| Fabricante | Modulo | Familias | Recursos |
| --- | --- | --- | --- |
| Hikvision | `hikvision/isapi.js` e `hikvision/parsers.js` | DS-K1T, DS-K1A, DS-K260, DS-K280, DS-K1H, DS-KV/DS-KD | diagnostico, abertura, usuarios, cartoes, faciais e eventos |
| Intelbras | `intelbras/ss3532Mfw.js` | SS 3530/3532/3540/3542, SS 3430, Bio-T e CT 500 compativeis | diagnostico CGI, abertura, usuarios, cartoes, faciais e webhook |
| Dahua | `dahua/accessCgi.js` | ASI e ASC compativeis | diagnostico CGI, abertura e eventos |
| Axis | `axis/vapixPacs.js` | A1001, A1601, A1610, A1710 e I8016-LVE | diagnostico PACS e abertura temporaria por token de porta |
| Control iD | `controlid/` | Linha de acesso Control iD | diagnostico, abertura, usuarios, faciais, credenciais e tags veiculares |

## Integracoes por servidor

| Fabricante | Modulo | Requisito | Recursos |
| --- | --- | --- | --- |
| Suprema | `suprema/biostar.js` | Servidor BioStar 2 2.7.10+ ou BioStar X com API habilitada | login REST e diagnostico de portas; usuarios, credenciais e eventos podem ser ampliados pelo mesmo servidor |

Equipamentos Suprema nao oferecem neste modulo uma API REST direta no terminal.
O endereco cadastrado deve ser o do servidor BioStar.

## Fontes oficiais

- Hikvision OpenAPI/ISAPI: https://open.hikvision.com/
- Axis VAPIX Physical Access Control: https://developer.axis.com/vapix/physical-access-control/
- Axis Door Control Service: https://developer.axis.com/vapix/physical-access-control/door-control-service/
- Suprema BioStar 2 New Local API: https://support.supremainc.com/en/support/solutions/articles/24000047041--biostar-2-api-how-to-use-biostar-2-new-local-api
- Suprema status de portas: https://support.supremainc.com/en/support/solutions/articles/24000093861--biostar-2-api-how-to-view-door-status

## Limites

- Modelos e firmwares podem desabilitar endpoints mesmo dentro da mesma familia.
- SDK fechado, protocolo proprietario ou API dependente de contrato nao deve ser
  apresentado como REST homologado sem documentacao e equipamento para teste.
- A homologacao final exige teste no equipamento real, especialmente para
  cadastro facial, eventos e abertura de porta.
