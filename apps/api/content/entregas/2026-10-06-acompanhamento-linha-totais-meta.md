---
title: Acompanhamento por Linha - totais corrigidos e card de meta
date: 2026-10-06
modulo: pcp
---
Correções pedidas na devolutiva do cliente sobre o relatório Acompanhamento por Linha, mais um card novo de meta.

## Totais agora batem com o Excel

A linha TOTAL mostrava um valor e a soma da coluna no Excel mostrava outro — diferença de R$ 1 em setembro (R$ 976.922 na tela, R$ 976.923 somando a coluna). Cada linha era arredondada antes de somar, mas o total arredondava só no fim.

Agora o total é a soma dos mesmos valores que aparecem nas linhas, então dá pra conferir na mão. Vale também pra VENDA PÇ, ESTOQUE e EM PRODUÇÃO.

## Card "Meta do Período"

Card novo no topo da tela: meta mensal proporcional aos dias selecionados no filtro (meta mensal ÷ dias do mês × dias do período), com o equivalente por dia no subtítulo. Fica em branco quando não há meta cadastrada no período.

Junto com isso, o total de META R$ parou de exigir que **todas** as classificações tivessem meta. Como sempre existe a linha "SEM CLASSIFICAÇÃO", que nunca tem meta, o total ficava permanentemente em branco. Agora soma as metas cadastradas, e o % de atingimento compara só a venda das classificações que têm meta.

## Aviso na coluna COB MESES A.A.

A coluna de cobertura do ano anterior agora aparece com asterisco e um aviso abaixo da tabela. O motivo: o histórico de estoque do TOTVS anterior a 2026 é incompleto — em 30/09/2025 havia 10.901 peças registradas contra 263.812 em 30/09/2026, porque a captura de saldo ficou muito mais densa a partir de 2026.

A fórmula sempre esteve certa; o que falta é dado. Na prática a coluna é um **piso**: serve pra comparar tendência entre categorias no mesmo período, não como valor absoluto. Preferimos sinalizar a limitação a esconder o número.

## Sobre "peças em trânsito"

As três colunas pedidas (peças em trânsito, estoque + trânsito, e cobertura sobre os dois) não foram construídas porque o dado não existe hoje de forma utilizável — inclusive há uma falha de sincronização do TOTVS, ativa desde 25/06/2026, que impede qualquer visão de transferência, entrada ou compra. O diagnóstico completo está no documento entregue junto com esta atualização.
