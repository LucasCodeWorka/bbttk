---
title: Estoque em Trânsito - fim da aproximação
date: 2026-10-14
modulo: pcp_servico
---
O relatório **Estoque em Trânsito** deixou de usar estimativa. Toda baixa agora vem do vínculo documento-a-documento do TOTVS, e a pendência caiu de 2.431 para **1.295 peças**.

## O que mudou

Antes, quando não havia vínculo, o sistema estimava a baixa por ordem de chegada (FIFO) dentro de cada par loja + produto. Isso fechava linhas que o ERP não confirmava e, pior, atribuía a pendência a um documento qualquer — chegamos a ver um documento marcado como pendente com a mercadoria já recebida.

**Esse cálculo foi removido.** Hoje existe uma regra só: se o ERP aponta um documento de entrada, a baixa acontece; se não aponta, a linha fica aberta.

Com isso, "pendente" passou a ter um significado único: **a saída não tem entrada correspondente registrada no TOTVS.**

## Por que foi possível

Descobrimos que a API do TOTVS sempre teve esse vínculo — o ETL só nunca pediu o campo. Buscamos documento a documento e populamos a história inteira: **25.425 vínculos**, de junho de 2019 até hoje.

A captura é feita pelo lado da **entrada**, e isso tem uma razão prática. Numa saída, o vínculo só aparece quando a loja recebe — dias depois, sem o TOTVS marcar o documento como alterado, então nenhuma sincronização automática voltaria para buscá-lo. Já a entrada nasce com a origem preenchida, e é um documento novo, que qualquer sincronização captura no mesmo dia.

Resultado: **100% dos documentos do relatório ficaram cobertos**, incluindo todo o período que antes era só estimativa.

## O que mudou na tela

O filtro de confiabilidade agora separa **Com vínculo no ERP** de **Sem vínculo nenhum** — este último é o caso grave, uma saída que o ERP não relaciona a entrada alguma, e que por isso aparece inteira em aberto.

A coluna **ORIGEM DA BAIXA** continua, mas hoje só mostra "Vínculo TOTVS". A coluna **DOC. ENTRADA** segue sendo o atalho para abrir a nota e conferir.

## Os números agora

| | Antes | Agora |
|---|---|---|
| Peças abertas | 2.431 | **1.295** |
| Documentos | 131 | **33** |
| Lojas | 13 | **5** |

E a leitura ficou muito mais clara:

- **946 peças (73%) são da Terrazo Shopping**, loja fechada
- **349 peças** estão em quatro lojas ativas
- **324 peças têm até 7 dias** — trânsito recente de verdade

## Um achado importante

Investigando as 1.295 peças que sobraram, encontramos o mesmo padrão em **todas**: o documento de entrada existe no TOTVS e está apontado pelo vínculo, mas **os itens dele não foram trazidos para o nosso banco**.

Ou seja, essa pendência não é mercadoria sumida — é lacuna de carga de dados. O recebimento foi lançado; o detalhe do que veio dentro é que não chegou até nós.

A correção é rodar o backfill de itens cobrindo o período antigo. Depois disso, o que restar como pendente será pendência de verdade.
