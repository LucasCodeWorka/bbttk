# PCP: status, composição dos grupos e ordem por estoque

## Comportamento

Na Visão Geral, a matriz por status apresentava separadamente os complementos
de FORA DE LINHA. Agora o status exato e os complementos, como FORA DE LINHA 2025
e FORA DE LINHA LIQUI JUL 2022, aparecem na categoria FORA DE LINHA.

Cada linha da matriz oferece “Ver referências”, nas cinco dimensões: linha
resumida, linha completa, categoria, gênero e status. A janela permite pesquisar
por referência, descrição e status original, com paginação de 25 referências.
Ela usa a composição completa do grupo calculada na mesma consulta, antes da
paginação da tabela principal. Uma referência com SKUs em status diferentes
preserva todos os status correspondentes; seu estoque soma apenas os SKUs que
pertencem àquele grupo. Saldos negativos e zerados continuam incluídos.

O relatório passa a ordenar por ESTOQUE TT em peças, decrescente, no servidor
antes da paginação. Referência é o desempate. A matriz também ordena por estoque,
com o total ao final. A ordem antiga salva na sessão é migrada uma vez, preservando
os filtros; o cache anterior não é reaproveitado.

A consolidação altera a apresentação por status e sua composição, sem alterar
as classificações cadastradas, o total de estoque ou as regras de ruptura e
SKUs ativos. O indicador de promoção mantém o critério anterior dos complementos.
Os filtros de status continuam permitindo selecionar as classificações originais.

## Validação em 17/11/2026

Consulta real para 10/11/2026, sem filtros de produto ou filial, em transação
explicitamente somente leitura, com timeout de consulta e de espera por bloqueio:

| Status consolidado | Estoque em peças | Referências no grupo |
| --- | ---: | ---: |
| ATIVO | 80.716 | 351 |
| FORA DE LINHA | 11.355 | 523 |
| INATIVO | 1 | 34 |
| Total | 92.072 | — |

A contagem do grupo inclui referências sem estoque e negativas; não corresponde
ao indicador de referências ATIVAS com estoque. A soma das referências foi
conferida contra o estoque de cada grupo nas cinco dimensões.

Primeiras referências da tabela: 003 BB CST413 (5.509 peças), 002 BB BLS184
(3.519) e 009 BB ACE675 (3.404). A composição dos grupos foi serializada junto
à resposta, sem consultas adicionais ao banco.

Testes automatizados cobrem as consultas histórica e atual: consolidação,
status original, múltiplos SKUs por referência, negativos, não classificados,
composição além da página e ordenação global antes da paginação.

- `npm run test:agrupamentos -w apps/pcp-api`
- `node --test apps/pcp-api/tests/*.test.cjs`: 80 testes aprovados.
- Builds de `apps/pcp-api` e `apps/web` aprovados.
- Chrome local com resposta real interceptada: migração da ordem antiga, abertura
  do grupo, avanço de página, busca de referência fora da primeira página e
  exibição do status original; sem exceções de JavaScript.
