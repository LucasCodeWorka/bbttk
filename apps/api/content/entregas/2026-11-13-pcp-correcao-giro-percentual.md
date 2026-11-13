---
title: PCP - correção do giro percentual na Visão Geral
date: 2026-11-13
modulo: pcp
---
O giro exibido no card **Peças Vendidas 30 dias** passa a usar a fórmula
**venda ÷ (venda + estoque final) × 100**, com duas casas decimais.

Por exemplo, 19.531 peças vendidas e estoque final de 92.072 peças resultam em
**17,50%** de giro. Quando há venda e o estoque final é zero, o giro é **100,00%**;
sem uma base válida para divisão, aparece **—**.

Para conferir, abra a Visão Geral do PCP, selecione os filtros e clique em
**Atualizar**. O indicador **Giro Anual**, medido em vezes, mantém sua fórmula.
