---
title: PCP - Visão Geral, Análise de Grade e Curva ABCD
date: 2026-07-27
modulo: pcp
---
Três telas novas no módulo PCP, além do Relatório Base: uma visão executiva de estoque, uma análise de grade por tamanho e uma curva ABCD de referências.

## Visão Geral

Cards de KPI (cobertura geral, giro anualizado, valor em estoque, % de estoque morto, cobertura Básico/Coleção) sempre com a meta ao lado e o gap - vermelho quando está fora do alvo, verde quando está dentro. Abaixo, uma matriz de cobertura por linha × canal (Varejo/Atacado), com opção de trocar pra ver por categoria ou por gênero.

Admin pode clicar em "Editar metas" pra ajustar os alvos de cada card.

## Análise de Grade

Heatmap de estoque: cada linha é uma referência, cada coluna um tamanho, e a cor da célula mostra a saúde da cobertura daquele tamanho (vermelho = ruptura, amarelo = cobertura apertada, verde = saudável) - o número sempre aparece dentro da célula, a cor nunca é a única informação. Abaixo, a curva ABC de tamanhos (quais tamanhos concentram a maior parte das vendas) e indicadores de ruptura.

## Curva ABCD

Classifica as referências em 4 curvas por quantidade vendida: Curva A (grandes vendedores, acima de um limiar de unidades), Curva D (a cauda do ranking) e Curva C (a fatia logo acima da cauda), com a Curva B pegando o resto. Cada curva tem um card de resumo (quantidade, valor em R$, total de SKUs, % do total) e mostra a referência mais fraca daquela curva.

Clicar numa linha da tabela abre o detalhamento SKU a SKU (referência + cor + tamanho) daquela referência, com estoque separado por varejo/atacado.

Admin pode ajustar as regras de classificação (limiar da Curva A, % de referências que cai em C e D) em "Editar regras de classificação".

## O que ainda falta

Custo, PDV real e markup do Relatório Base dependem de uma sincronização com o TOTVS que ainda está em andamento - até completar, alguns SKUs aparecem com "—" nessas colunas. Filtro por cor (Análise de Grade) e por família (Curva ABC) ainda não têm campo na tela, embora o servidor já aceite.
