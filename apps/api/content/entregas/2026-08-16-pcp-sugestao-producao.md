---
title: PCP - Novo relatório Sugestão de Produção
date: 2026-08-16
modulo: pcp
---
Relatório novo no menu Relatórios, pra apontar quais SKUs precisam entrar em produção.

## Como funciona

Pra cada SKU: soma o estoque atual com o que já está em Ordem de Produção aberta (rede toda, todas as lojas juntas) e compara com a venda média mensal multiplicada pela cobertura alvo. Se a soma ficar abaixo desse mínimo, o relatório sugere produzir a diferença — arredondada pra cima pelo corte mínimo daquele SKU (pra nunca sugerir um corte inviável de produzir).

Mostra também os dois últimos períodos de venda lado a lado, pra dar noção de tendência (subindo ou caindo), além do estoque atual, o que já está em produção e o estoque futuro projetado.

## Configuração

Nova aba "Sugestão de Produção" em Configurações PCP:
- Tamanho de cada período de venda comparado e a janela usada pra calcular a venda média.
- Cobertura alvo (quantos meses de venda média viram estoque mínimo).
- Corte mínimo padrão, usado quando o SKU não tem um valor específico.
- Corte mínimo por SKU — cadastro individual ou upload de CSV (`SKU;VALOR`), mesmo padrão de upload já usado no Agrupamento de Cores.

## O que ainda falta

Primeira versão direto ao ponto, sem quebrar por grade/tamanho em heatmap (isso já existe separado na Análise de Grade) e sem excluir embalagens/subprodutos do cálculo (usa o mesmo filtro de estoque líquido do resto do PCP). Ajustes finos entram depois, com uso real da tela.
