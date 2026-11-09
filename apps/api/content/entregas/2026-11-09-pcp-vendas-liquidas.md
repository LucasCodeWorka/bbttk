---
title: PCP - correção das peças vendidas e indicadores de cobertura
date: 2026-11-09
modulo: pcp
---
O cálculo das posições diárias da Visão Geral do PCP foi corrigido para considerar
somente vendas, descontando devoluções. Compras, consignações, brindes e outras
movimentações deixam de entrar como peças vendidas.

Os totais calculados em tempo real também respeitam o mesmo catálogo de produtos
da tabela, inclusive quando nenhum filtro de classificação está selecionado.

A posição de **08/11/2026** foi recalculada. Para conferir, selecione essa data na
Visão Geral e atualize o relatório. Cobertura e estoque crítico usam as vendas
corrigidas; estoque crítico identifica SKUs com cobertura de pelo menos cinco
meses ou com estoque sem venda líquida positiva no período.

As demais posições diárias recebem a correção quando forem recalculadas pela
rotina atualizada.
