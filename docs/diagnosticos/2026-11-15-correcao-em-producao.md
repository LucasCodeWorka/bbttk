# Correção da coluna EM PRODUÇÃO

Implementada em 15/11/2026 nos repositórios `bebetenkite` e `projetobb`. A ativação do ETL na VPS é uma etapa distinta da publicação do código e ainda está pendente.

## Comportamento

- A consulta atual inclui produtos com produção pendente mesmo sem estoque/venda. Posições analíticas antigas também recebem os SKUs faltantes quando existe captura válida da data.
- A pendência é atribuída uma única vez ao SKU canônico de cada produto, preferindo SKU real a placeholder. Cópias da linha por loja não multiplicam produção.
- Sincronizações Python e Node passam a preservar a última captura de cada dia, com fuso explícito de São Paulo. A carga corrente e a captura são atômicas, inclusive quando vazias.
- Consultas históricas usam somente a captura da data selecionada. Ausência de captura retorna `emProducao: null`, acompanhado de `producao.disponivel: false`; captura vazia retorna zero. Tela e Excel distinguem esses casos e a tela informa o horário da captura disponível.
- O fallback para `ops_em_producao` só atende a data real da carga corrente, antes da primeira captura diária. Valores legados da tabela analítica não são usados como pendência histórica.
- A carga de todas as OPs passa a identificar capa e itens por filial, número **e ciclo**. O bootstrap migra as PKs/FK de modo transacional e preenche o ciclo dos itens legados a partir da capa. As duas consultas de Performance Coleção incluem o ciclo e aceitam o esquema anterior durante a transição.

Não há exclusão fixa da OP 3691: foi criada em 11/11 e é válida a partir dessa data. Também não há números de referências/OPs fixados nos cálculos.

## Conferências

O SELECT completo do materializador foi executado em transação somente de leitura, simulando a fotografia da carga corrente de 15/11:

| Referência | Produção corrigida | Observação |
|---|---:|---|
| BLS184 | 1.887 | Recupera as 760 peças omitidas pelo universo anterior. |
| CST413 | 3.871 | Inclui a OP 3691 na posição atual; sem ela, 1.891. |
| CUE016 | 3.900 | Recupera as 384 peças omitidas pelo universo anterior. |

Consulta real da API local corrigida contra o banco em modo somente de leitura: a posição de 10/11 para CST413 retorna produção indisponível, preservando o estoque de 5.509 peças. Ela deixa de tratar as 2.261 peças contaminadas como posição histórica válida. Não é possível reconstruir as pendências exatas de 10/11 usando somente o saldo atual.

## Validação e ativação

- `npm run test:ops -w apps/api`.
- `npm run test:producao -w apps/pcp-api`.
- Regressões de estoque, ruptura, cobertura e lojas em `apps/pcp-api/tests`.
- Build das APIs e verificação TypeScript/build do frontend.
- No ETL: `python -m unittest tests.test_ops tests.test_pcp_estoque_aa tests.test_pcp_vendas -v`. Integração da migração e fotografias usa somente tabelas temporárias, isoladas por `search_path=pg_temp`, com rollback.

Ativar primeiro as APIs/frontend atualizados e depois as rotinas na VPS. O guia completo está em `../../projetobb/docs/OPS_EM_PRODUCAO.md` a partir da raiz deste repositório. É necessária uma carga histórica completa para recuperar ciclos antes descartados. As fotografias diárias começam com as próximas sincronizações; não fazer backfill de datas passadas usando pendências atuais.

Versão correspondente do ETL: `scriptsbb` commit `a9675f5`.

Nenhuma tabela persistente foi alterada durante a implementação/testes. Não houve execução de carga na VPS nem mudança do cron.

Resultado final: 77 testes do PCP, dois testes da sincronização manual e dez testes Python passaram. Builds de `apps/api`, `apps/pcp-api` e `apps/web` e validação do schema Prisma passaram.
