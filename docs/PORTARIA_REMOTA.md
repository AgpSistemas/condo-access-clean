# Portaria Remota

Data: 2026-05-31

## Alteracao: feedback visual de acionamento

Foi adicionado feedback visual quando um comando de acionamento e enviado com sucesso na aba Portaria Remota.

Arquivos alterados:

```txt
apps/web/src/App.jsx
apps/web/src/styles.css
```

## Comportamento

Ao clicar em `Acionar`, a Web chama:

```txt
POST /api/actions/:actionId/trigger
```

Quando a API responde com sucesso (`response.ok`):

- mostra um aviso verde na propria tela da Portaria Remota;
- exibe o nome do acionamento e a rota/portaria;
- aplica uma animacao de entrada no aviso;
- aplica uma pulsacao no botao do acionamento enviado;
- remove o aviso automaticamente depois de alguns segundos.

Quando a API responde com falha:

- nao mostra o efeito de sucesso;
- exibe a mensagem de erro no banner geral do sistema.

## Ponto de restauro

Criado antes da alteracao:

```txt
C:\projetis\BKPAccess\restore-points\restore-20260531-215427-before-portaria-action-feedback
```

Observacao:

- A API estava parada no momento do ponto de restauro porque processos antigos do Android/FFmpeg/Gradle precisaram ser encerrados.
- O ponto preservou `git status` e `git diff`.
- Depois da alteracao, API e Web foram religadas.
- O estado da API foi restaurado a partir do snapshot:

```txt
C:\projetis\BKPAccess\restore-points\restore-20260531-214859-before-portaria-action-feedback\api-bootstrap-current.json
```

Estado restaurado:

```txt
1 condominio
3 unidades
3 pessoas
1 equipamento
4 cameras
1 acionamento
```

## Validacao

Executado:

```txt
npm run build
```

Resultado:

```txt
API: node --check passou
Web: vite build passou
Mobile workspace: node --check passou
```

Tambem confirmado:

```txt
GET http://localhost:3333/health -> 200
GET http://localhost:3100 -> 200
```

Nao foi feito clique real no botao `Acionar` durante a validacao automatizada para evitar envio involuntario de comando ao equipamento.
