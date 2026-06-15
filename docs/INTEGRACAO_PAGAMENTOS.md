# Integracao de pagamentos por licencas e ramais

Pesquisa atualizada em 12 de junho de 2026.

## Recomendacao

Usar o Asaas como primeira integracao brasileira e manter o calculo da fatura dentro do Condo Access.

O Asaas atende o fluxo necessario com:

- cobranca avulsa e assinatura;
- Pix, boleto e cartao;
- `externalReference` para vincular a cobranca a fatura interna;
- webhooks de pagamento e assinatura;
- sandbox;
- multa, juros, desconto, split e Pix Automatico.

Para valores que mudam conforme a quantidade de ramais, a opcao mais previsivel e gerar uma cobranca por competencia. Assinatura fixa deve ser usada somente quando o valor mensal nao variar, ou atualizada antes da geracao da proxima parcela.

## Regra de calculo

Os campos de empresa existentes ja permitem iniciar o motor de faturamento:

```text
subtotalCondominios =
  baseMonthlyPrice +
  (condominiosAtivos * condominiumUnitPrice)

ramaisExcedentes =
  max(0, ramaisAtivos - includedExtensions)

subtotalRamais =
  voipBillingModel == PER_EXTENSION
    ? ramaisExcedentes * extensionUnitPrice
    : 0

total =
  subtotalCondominios +
  subtotalRamais +
  adicionaisDeModulos -
  descontos
```

Regras recomendadas:

- contar apenas licencas e condominios ativos;
- contar ramais configurados e vinculados a uma unidade, portaria ou equipamento;
- gerar um snapshot da quantidade e dos precos no fechamento;
- nunca recalcular uma fatura fechada usando os dados atuais;
- registrar cada componente como item separado da fatura.

## Modelo de dados

Adicionar entidades separadas do cadastro operacional:

- `billing_profiles`: vencimento, forma de pagamento e identificador do cliente no gateway;
- `billing_cycles`: empresa, competencia, data de corte e status;
- `invoices`: total, vencimento, status e IDs externos;
- `invoice_items`: descricao, quantidade, valor unitario, subtotal e origem;
- `payment_events`: eventos recebidos por webhook, com identificador unico para idempotencia.

Exemplo de itens:

```text
Licenca base                         1 x R$ 300,00
Condominios ativos                  3 x R$ 100,00
Ramais incluidos                   20 x R$   0,00
Ramais excedentes                  12 x R$   4,50
Modulo de portaria remota           3 x R$  50,00
```

## Fluxo de integracao

1. Fechar a competencia da empresa.
2. Contar licencas, condominios, modulos e ramais ativos.
3. Salvar a fatura e seus itens.
4. Criar a cobranca no Asaas com `externalReference` igual ao ID da fatura.
5. Salvar `paymentId`, link, linha digitavel ou QR Code.
6. Receber webhooks e atualizar a fatura de forma idempotente.
7. Bloquear recursos somente por uma politica configuravel de inadimplencia, nunca diretamente no primeiro atraso.

## Integracao com as contas bancarias

O fluxo recomendado nao conecta o Condo Access diretamente ao saldo de uma conta bancaria externa:

1. O Condo Access cria a cobranca no Asaas.
2. O cliente paga por Pix, boleto ou cartao.
3. O valor recebido entra no saldo da conta Asaas da AGP.
4. O saldo pode ser transferido para uma conta bancaria cadastrada por Pix ou TED.

As transferencias usam apenas saldo disponivel no Asaas. Elas nao movimentam uma conta externa por Open Finance.

Configuracao segura no Railway:

```text
ASAAS_ENVIRONMENT=sandbox
ASAAS_API_KEY=segredo armazenado somente no servidor
ASAAS_WEBHOOK_TOKEN=token forte e exclusivo do webhook
```

Endpoint publico para cadastrar no webhook do Asaas:

```txt
https://api-production-441f.up.railway.app/api/webhooks/asaas
```

O `authToken` configurado no painel Asaas deve ser exatamente o valor de
`ASAAS_WEBHOOK_TOKEN`. O servidor valida o header `asaas-access-token`, salva
eventos de forma idempotente e atualiza o status da cobranca.

Rotas implementadas:

- `POST /api/billing/charges`: cria cliente e cobranca no Asaas.
- `GET /api/billing/invoices`: lista cobrancas persistidas.
- `POST /api/webhooks/asaas`: recebe confirmacoes do Asaas.

A chave nunca deve ser enviada para a Web/Netlify. O bootstrap informa somente se a integracao esta configurada.

Antes de producao:

- criar e homologar a conta Asaas;
- cadastrar a conta bancaria de destino;
- validar cobrancas e transferencias no sandbox;
- implementar faturas e itens persistentes;
- implementar webhook idempotente;
- proteger as rotas financeiras com autenticacao e autorizacao;
- trocar para `ASAAS_ENVIRONMENT=production` e usar uma chave exclusiva de producao.

Eventos minimos:

- cobranca criada;
- pagamento confirmado/recebido;
- vencida;
- estornada;
- chargeback;
- assinatura alterada ou removida.

## Alternativas pesquisadas

### Stripe Billing

Tem o melhor modelo para precificacao por quantidade, itens de assinatura, faixas e uso medido. E uma boa opcao para expansao internacional. Para uma operacao inicialmente brasileira, exige conferir com cuidado a disponibilidade comercial de Pix Automatico, pois a documentacao atual informa acesso restrito para contas brasileiras.

### Mercado Pago

Oferece assinaturas, cobranca recorrente, Pix, boleto, cartao, tentativas automaticas e webhooks. E uma alternativa valida, mas o Condo Access ainda deve manter o calculo e o snapshot da fatura internamente.

### Pagar.me

Possui API brasileira de pagamentos e recorrencia. Deve entrar na homologacao comercial comparando taxas, prazo de liquidacao, suporte, antifraude e condicoes de boleto/Pix com o Asaas.

## Fontes oficiais

- Asaas, criar cobranca: https://docs.asaas.com/reference/create-new-payment
- Asaas, criar assinatura: https://docs.asaas.com/reference/create-new-subscription
- Asaas, atualizar assinatura: https://docs.asaas.com/reference/update-existing-subscription
- Asaas, webhooks: https://docs.asaas.com/reference/create-new-webhook
- Asaas, conciliacao de cobrancas: https://docs.asaas.com/reference/list-payments
- Stripe, quantidade por assinatura: https://docs.stripe.com/billing/subscriptions/quantities
- Stripe, cobranca por uso: https://docs.stripe.com/billing/subscriptions/usage-based
- Stripe, Pix: https://docs.stripe.com/payments/pix
- Mercado Pago, assinaturas: https://www.mercadopago.com.br/developers/en/docs/subscriptions/overview
- Pagar.me, documentacao: https://docs.pagar.me/
