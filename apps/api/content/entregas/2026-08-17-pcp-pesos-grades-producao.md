---
title: PCP - Novo relatório Pesos e Grades para Produção
date: 2026-08-17
modulo: pcp
---
Relatório novo no menu Relatórios: sugere a grade de tamanhos pra produção de uma referência, a partir do peso de venda real de cada tamanho.

## Como funciona

Escolhe um período e um "fator divisor" (ex: 10) — pra cada referência+tamanho, calcula `arredonda pra cima (quantidade vendida no período / fator divisor)`, olhando venda geral (varejo + atacado juntos, sem quebrar por canal). O resultado é a grade sugerida: quantas peças de cada tamanho produzir, mantendo a proporção de venda real entre os tamanhos.

Dois modos de seleção de referências: "Por Item" (escolhe referências específicas) ou "Por Categoria" (todas as referências de uma categoria/linha/gênero).

## Busca de referências

Botão "Buscar Referências" abre um modal com filtros (categoria, linha, gênero, status) + busca por texto — devolve a lista inteira já filtrada, com checkbox por linha e "Selecionar todas", em vez de precisar pesquisar referência por referência. A lista só mostra referências que tiveram venda no período escolhido.

## O que ainda falta

Primeira versão direto ao ponto — sem exportação em formato de ficha de produção ainda, só a tabela na tela.
