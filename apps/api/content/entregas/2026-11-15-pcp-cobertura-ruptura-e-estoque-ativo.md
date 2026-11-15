---
title: PCP - cobertura, ruptura e indicadores de estoque ativo
date: 2026-11-15
modulo: pcp
---
Na Visão Geral, o card **Estoque crítico >5,0 meses** considera cobertura
estritamente superior a cinco meses e mantém o estoque sem venda líquida
positiva no período. O percentual passa a representar a participação em peças,
com duas casas decimais. O valor a custo acompanha os produtos selecionados.

O card **PEÇAS SEM VENDA >30 DIAS** consolida as faixas anteriores. O cálculo
avalia a venda líquida da referência inteira: uma cor ou tamanho sem venda
não faz a referência entrar no indicador quando outros SKUs dela venderam.

A ruptura considera todos os SKUs de **Básico e Básico Renovável com STATUS =
ATIVO**, inclusive sem entrada registrada. O card mostra o percentual total,
os percentuais por linha e a base de SKUs ativos.

Os cards **Referências com estoque** e **SKUs com estoque** usam essa mesma
base de ativos, incluem saldos negativos e exibem participação na base, ano
anterior e desvio percentual. Uma referência com saldos positivos e negativos
em tamanhos diferentes continua contando mesmo quando a soma é zero.

Para conferir, selecione a data e os filtros e clique em **Atualizar**.
As conciliações de quantidade com o Virtual TOTVS e com o relatório 086
permanecem para a próxima etapa.
