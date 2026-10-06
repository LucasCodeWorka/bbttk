---
title: Pesos e Grades - ordem fixa da grade e tamanhos com zero
date: 2026-10-06
modulo: pcp
---
Último ponto da devolutiva do cliente sobre o relatório Pesos e Grades para Produção.

## Tamanhos sem venda agora aparecem com zero

Antes, tamanho que não vendeu no período simplesmente sumia da grade do produto. Agora a grade cadastrada aparece inteira, com zero no tamanho que não teve venda — que é o que interessa pro corte: dá pra ver qual tamanho não girou, em vez de ele desaparecer da tabela.

Exemplo real (CAMISA, setembro): a grade sai `P · M · G · GG · 2 · 4 · 6 · 8 · 10 · 12 · 14 · EXG · PP`, com GG, 12, 14, EXG e PP em zero.

Referência que não vendeu nada no período continua fora da tela, como antes — o zero é pros tamanhos **dentro** de um produto que vendeu.

## Produto de tamanho único voltou pro começo da grade

A ordem pedida é UN · P · M · G · GG · 2 · 4 · 6 · 8 · 10, mas produto de tamanho único vinha sendo mostrado **por último**, junto com PP e 12/14.

Motivo: o cadastro do TOTVS grava tamanho único como `U`, e o relatório procurava por `UN` — como não casava, caía no grupo "tamanho desconhecido", que vai pro fim. São 1.344 SKUs afetados. Corrigido: `U` agora é reconhecido e aparece em primeiro.

Tamanhos que não estão na lista fixa (PP, 12, 14, EXG, numeração de calçado 17 a 44) continuam aparecendo depois dos principais, em ordem numérica.

## Exportação alinhada com a tela

O Excel gerava uma aba vazia para referência sem venda no período, enquanto a tela escondia essa referência. Agora os dois seguem a mesma regra.
