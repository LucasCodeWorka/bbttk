---
title: PCP - Curva ABC com classificação e giro em %, correção do estoque da Fábrica
date: 2026-08-11
modulo: pcp
---
Ajustes na Curva ABC pedidos pela Renata (rede de lojas) e uma correção importante no estoque exibido pela Visão Geral.

## Curva ABC

No lugar dos cards "Último item por curva" (pouco úteis), agora cada curva (A/B/C) tem um card mostrando a estratificação por Linha - quantas referências e qual % do valor vendido vêm de Básico, Básico Renovável e Coleção dentro daquela curva.

A tabela de Referências ganhou 5 colunas de classificação (Categoria, Linha, Gênero, Status, Lançamento) entre a Descrição e a Curva.

As colunas "Giro 30D V"/"Giro 30D A" (que mostravam peças vendidas cruas, confuso) viraram "Giro 90D %"/"Giro 30D %" - percentual das vendas do período sobre o estoque atual da referência, mesmo cálculo já usado no relatório Venda do Dia.

No início do painel, um resumo compara a participação de Venda com a participação de Estoque lado a lado, por curva (A/B/C, Itens sem venda e Total) - pedido original da Renata, pra identificar desequilíbrio (ex: Curva A concentrava quase 80% da venda mas só ~70% do estoque, sinal de risco de ruptura).

Referências com estoque mas **sem nenhuma venda no período** agora aparecem na tabela (antes eram descartadas do relatório inteiro) - ficam fora do ranking A/B/C (não faz sentido classificar por venda quem não vendeu) e aparecem no final da lista, com um selo "SV". A tabela também ganhou a coluna "Últ. Entrada", com a data da última entrada de estoque de cada referência.

## Correção do estoque "inflado" da Fábrica

A Visão Geral estava somando junto com o estoque real da Fábrica um volume grande de **subprodutos** (componentes internos de montagem de conjuntos, ex: "SUBPRODUTO CAMISA CONJUNTO...", nunca vendidos como peça avulsa) e itens de categoria **Embalagem**. Isso inflava o estoque físico da Fábrica em ~221 mil peças fantasmas - a maior parte do número que aparecia na tela.

Agora esses itens são excluídos do cálculo (identificados pelo código de produto do TOTVS, que reserva a faixa acima de 1.000.000 para subproduto). O estoque total caiu de ~283 mil para ~62 mil peças, batendo com a realidade.

## O que ainda falta

O pedido de mostrar só o estoque "Atacado" da Fábrica (separado do estoque físico do DPA) ainda não entrou - o Marcelo está terminando de subir essa informação no banco, e o código de saldo que vai representar esse estoque ainda não está definido.
