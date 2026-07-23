# Prompt para criar a tabela analitica PCP - Estoque sem giro

Voce e um engenheiro de dados senior. Preciso criar uma tabela analitica no PostgreSQL para alimentar um dashboard PCP de "Estoque sem giro". Essa tabela sera atualizada de hora em hora por um processo rodando em uma VPS. Nao crie dashboard neste momento. Foque somente no desenho da tabela, nos calculos e na query/rotina de carga.

## Objetivo

Criar uma tabela analitica consolidada, com uma linha por SKU e loja, contendo o estoque atual, ultima venda valida, dias sem giro, valor estimado do estoque parado, media mensal de venda, cobertura em meses e classificacoes comerciais do produto.

A tabela deve permitir consultas rapidas do dashboard com filtros por:

- periodo sem giro: 30, 60, 90 e acima de 90 dias;
- loja;
- categoria;
- linha;
- genero;
- cobertura de estoque: entre 6 e 12 meses, entre 12 e 24 meses, acima de 24 meses;
- referencia/produto/SKU.

## Nome sugerido da tabela

```sql
pcp_estoque_sem_giro_analitico
```

## Granularidade

A tabela deve ter uma linha por:

```text
product_sku + branch_code
```

Ou seja, o mesmo SKU pode aparecer em varias lojas, uma linha para cada loja onde existe estoque positivo.

## Tabelas de origem

Usar as tabelas abaixo:

```text
prd_saldo
produtos
branches
transacoes
transacao_itens
produto_analitico
```

## Campos esperados na tabela final

Criar, no minimo, os seguintes campos:

```text
product_sku
product_code
reference_code
reference_name
product_name
descricao
colecao
categoria
linha
genero
branch_code
branch_name
quantidade_estoque
ultima_venda
dias_sem_giro
preco_medio_365d
valor_estoque
quantidade_vendida_180d
media_mensal_180d
cobertura_meses
faixa_sem_giro
faixa_cobertura
captured_at
calculated_at
```

## Regras de estoque atual

O estoque atual deve vir da tabela `prd_saldo`.

Como existem varias capturas ao longo do tempo, considerar somente a captura mais recente por:

```text
product_sku + branch_code + stock_code
```

Depois, somar o estoque por:

```text
product_sku + product_code + branch_code
```

Usar apenas estoque positivo:

```sql
COALESCE(stock, 0) > 0
```

Campo final:

```text
quantidade_estoque = soma do stock mais recente
captured_at = maior captured_at considerado no grupo
```

## Regras de venda valida

Para calcular ultima venda, media mensal e preco medio, considerar somente vendas validas em:

```text
transacoes + transacao_itens
```

Join:

```sql
transacoes.branch_code = transacao_itens.branch_code
AND transacoes.transaction_code = transacao_itens.transaction_code
```

Filtros obrigatorios:

```sql
t.status = 4
AND ti.seller_code != 1
AND COALESCE(ti.quantity, 0) > 0
AND (t.customer_code IS NULL OR t.customer_code < 110000000)
```

Excluir operacoes que nao sao vendas:

```text
140, 76, 25, 26, 27, 273, 44, 240, 241, 242, 243, 244, 245, 239, 238, 237, 236
```

Excluir devolucoes:

```text
1, 46, 192, 604, 802, 900, 905, 9041
```

Regra SQL:

```sql
AND (t.operation_code IS NULL OR t.operation_code NOT IN (...operacoes_excluidas...))
AND (t.operation_code IS NULL OR t.operation_code NOT IN (...operacoes_de_devolucao...))
```

## Calculo de ultima venda

Calcular a ultima venda valida por:

```text
product_code + branch_code
```

Formula:

```sql
ultima_venda = MAX(t.transaction_date)
```

Se nunca houve venda valida para aquele produto naquela loja, `ultima_venda` deve ficar nula.

## Calculo de dias sem giro

Calcular:

```sql
dias_sem_giro = CURRENT_DATE - ultima_venda
```

Se `ultima_venda` for nula, usar um valor alto para indicar que nunca girou:

```sql
dias_sem_giro = 9999
```

Regra sugerida:

```sql
COALESCE((CURRENT_DATE - ultima_venda), 9999)::int
```

## Faixa sem giro

Criar um campo textual `faixa_sem_giro`:

```text
menos_30
30_59
60_89
90
acima_90
nunca_vendeu
```

Regra:

```sql
CASE
  WHEN ultima_venda IS NULL THEN 'nunca_vendeu'
  WHEN dias_sem_giro < 30 THEN 'menos_30'
  WHEN dias_sem_giro < 60 THEN '30_59'
  WHEN dias_sem_giro < 90 THEN '60_89'
  WHEN dias_sem_giro = 90 THEN '90'
  ELSE 'acima_90'
END
```

O dashboard deve conseguir filtrar assim:

```text
30 dias sem girar: dias_sem_giro >= 30
60 dias sem girar: dias_sem_giro >= 60
90 dias sem girar: dias_sem_giro >= 90
Acima de 90 dias: dias_sem_giro >= 91
```

## Calculo de preco medio vendido em 365 dias

Calcular o preco medio de venda dos ultimos 365 dias por:

```text
product_code
```

Nao precisa separar por loja neste primeiro momento, para evitar preco zerado em loja com pouca venda.

Formula:

```sql
preco_medio_365d = SUM(net_value) / NULLIF(SUM(quantity), 0)
```

Filtro:

```sql
transaction_date >= CURRENT_DATE - INTERVAL '365 days'
```

Usar somente vendas validas conforme regras acima.

Se nao houver venda nos ultimos 365 dias, o preco medio pode ficar nulo ou zero. Preferir nulo na tabela, mas no `valor_estoque` tratar como zero.

## Calculo de valor do estoque

Calcular:

```sql
valor_estoque = quantidade_estoque * preco_medio_365d
```

Se `preco_medio_365d` for nulo:

```sql
valor_estoque = 0
```

Regra:

```sql
COALESCE(quantidade_estoque * preco_medio_365d, 0)
```

Observacao importante: esse valor e uma estimativa com base em preco medio vendido. Se existir tabela confiavel de custo ou preco vigente no ERP, ela pode substituir esse calculo no futuro.

## Calculo de venda media mensal em 180 dias

Calcular quantidade vendida nos ultimos 180 dias por:

```text
product_code + branch_code
```

Formula:

```sql
quantidade_vendida_180d = SUM(quantity)
media_mensal_180d = SUM(quantity) / 6
```

Filtro:

```sql
transaction_date >= CURRENT_DATE - INTERVAL '180 days'
```

Usar somente vendas validas conforme regras acima.

## Calculo de cobertura em meses

Calcular:

```sql
cobertura_meses = quantidade_estoque / media_mensal_180d
```

Se `media_mensal_180d` for zero ou nula, `cobertura_meses` deve ficar nula.

Regra:

```sql
CASE
  WHEN media_mensal_180d > 0 THEN quantidade_estoque / media_mensal_180d
  ELSE NULL
END
```

## Faixa de cobertura

Criar campo textual `faixa_cobertura`:

```text
sem_media
menos_6
6_12
12_24
acima_24
```

Regra:

```sql
CASE
  WHEN cobertura_meses IS NULL THEN 'sem_media'
  WHEN cobertura_meses < 6 THEN 'menos_6'
  WHEN cobertura_meses < 12 THEN '6_12'
  WHEN cobertura_meses < 24 THEN '12_24'
  ELSE 'acima_24'
END
```

O dashboard deve conseguir filtrar:

```text
Entre 6 e 12 meses: cobertura_meses >= 6 AND cobertura_meses < 12
Entre 12 e 24 meses: cobertura_meses >= 12 AND cobertura_meses < 24
Acima de 24 meses: cobertura_meses >= 24 OR cobertura_meses IS NULL
```

## Dados do produto

Trazer de `produtos`:

```text
product_sku
product_code
reference_code
reference_name
product_name
```

Campo `descricao`:

```sql
COALESCE(reference_name, product_name, product_sku)
```

Filtrar preferencialmente produto acabado:

```sql
(p.is_finished_product = true OR p.is_finished_product IS NULL)
```

## Classificacoes comerciais

Trazer de `produto_analitico`, usando join por:

```sql
produto_analitico.product_code = produtos.product_code
```

Campos:

```text
class_categoria -> categoria
class_linha -> linha
class_genero -> genero
class_colecao -> colecao
```

Tratar strings vazias e ponto como nulo:

```sql
NULLIF(TRIM(campo), '')
```

E idealmente ignorar:

```text
'.'
```

## Dados de loja

Trazer de `branches`:

```text
branch_code
branch_name
```

Join:

```sql
branches.branch_code = prd_saldo.branch_code
```

Se `branch_name` for nulo, usar:

```text
Filial {branch_code}
```

## Regras para carga horaria

A rotina da VPS deve atualizar essa tabela de hora em hora.

Pode ser feito com:

1. Criar tabela temporaria com o resultado novo.
2. Criar indices na temporaria, se necessario.
3. Trocar os dados da tabela final em transacao.

Estrategia simples:

```sql
BEGIN;
TRUNCATE TABLE pcp_estoque_sem_giro_analitico;
INSERT INTO pcp_estoque_sem_giro_analitico (...)
SELECT ...;
COMMIT;
```

Se o volume for grande e o dashboard nao puder ver a tabela vazia durante a carga, usar estrategia de tabela staging:

```text
pcp_estoque_sem_giro_analitico_staging
```

Fluxo:

```sql
DROP TABLE IF EXISTS pcp_estoque_sem_giro_analitico_staging;
CREATE TABLE pcp_estoque_sem_giro_analitico_staging AS SELECT ...;
CREATE INDEX ... ON pcp_estoque_sem_giro_analitico_staging (...);
BEGIN;
ALTER TABLE pcp_estoque_sem_giro_analitico RENAME TO pcp_estoque_sem_giro_analitico_old;
ALTER TABLE pcp_estoque_sem_giro_analitico_staging RENAME TO pcp_estoque_sem_giro_analitico;
DROP TABLE pcp_estoque_sem_giro_analitico_old;
COMMIT;
```

## Indices recomendados

Criar indices para acelerar filtros do dashboard:

```sql
CREATE INDEX idx_pcp_esg_dias ON pcp_estoque_sem_giro_analitico (dias_sem_giro);
CREATE INDEX idx_pcp_esg_branch ON pcp_estoque_sem_giro_analitico (branch_code);
CREATE INDEX idx_pcp_esg_sku ON pcp_estoque_sem_giro_analitico (product_sku);
CREATE INDEX idx_pcp_esg_product_code ON pcp_estoque_sem_giro_analitico (product_code);
CREATE INDEX idx_pcp_esg_reference ON pcp_estoque_sem_giro_analitico (reference_code);
CREATE INDEX idx_pcp_esg_categoria ON pcp_estoque_sem_giro_analitico (categoria);
CREATE INDEX idx_pcp_esg_linha ON pcp_estoque_sem_giro_analitico (linha);
CREATE INDEX idx_pcp_esg_genero ON pcp_estoque_sem_giro_analitico (genero);
CREATE INDEX idx_pcp_esg_cobertura ON pcp_estoque_sem_giro_analitico (cobertura_meses);
CREATE INDEX idx_pcp_esg_calculated_at ON pcp_estoque_sem_giro_analitico (calculated_at);
```

Indice composto recomendado para a tela principal:

```sql
CREATE INDEX idx_pcp_esg_dashboard
ON pcp_estoque_sem_giro_analitico (dias_sem_giro, branch_code, categoria, linha, genero);
```

## Consultas que a tabela precisa responder bem

Resumo por faixa de dias:

```sql
SELECT
  COUNT(DISTINCT product_sku) as sku_count,
  SUM(quantidade_estoque) as quantidade,
  SUM(valor_estoque) as valor
FROM pcp_estoque_sem_giro_analitico
WHERE dias_sem_giro >= :dias
  AND filtros opcionais...
```

Top 10 SKUs:

```sql
SELECT
  product_sku,
  reference_code,
  descricao,
  colecao,
  MAX(dias_sem_giro) as dias_sem_giro,
  SUM(quantidade_estoque) as quantidade,
  SUM(valor_estoque) as valor
FROM pcp_estoque_sem_giro_analitico
WHERE dias_sem_giro >= :dias
  AND filtros opcionais...
GROUP BY product_sku, reference_code, descricao, colecao
ORDER BY dias_sem_giro DESC, valor DESC
LIMIT 10;
```

Distribuicao por loja para os SKUs do Top 10:

```sql
SELECT
  product_sku,
  branch_code,
  branch_name,
  SUM(quantidade_estoque) as quantidade
FROM pcp_estoque_sem_giro_analitico
WHERE product_sku IN (:top_skus)
  AND dias_sem_giro >= :dias
  AND filtros opcionais...
GROUP BY product_sku, branch_code, branch_name;
```

Resumo por loja:

```sql
SELECT
  branch_code,
  branch_name,
  COUNT(DISTINCT product_sku) as sku_count,
  SUM(quantidade_estoque) as quantidade,
  SUM(valor_estoque) as valor
FROM pcp_estoque_sem_giro_analitico
WHERE dias_sem_giro >= :dias
  AND filtros opcionais...
GROUP BY branch_code, branch_name
ORDER BY branch_code;
```

## Resultado esperado

Entregar:

1. DDL da tabela `pcp_estoque_sem_giro_analitico`.
2. Query SQL completa para popular a tabela.
3. Indices recomendados.
4. Sugestao de rotina segura para atualizacao horaria na VPS.
5. Observacoes de performance e riscos de divergencia.

Nao invente novas tabelas de origem. Use somente as tabelas listadas. Se algum campo nao existir, indique claramente qual campo alternativo deve ser usado ou qual informacao ficara nula.
