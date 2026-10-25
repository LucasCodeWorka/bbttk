---
title: Estoque em Trânsito - prazo de entrega por loja
date: 2026-10-15
modulo: pcp_servico
---
Painel novo no **Estoque em Trânsito**: quanto tempo cada loja leva para receber uma transferência da Fábrica, com janela de 30, 90 ou 180 dias.

## O que mostra

Barras horizontais por loja, ordenadas da mais lenta para a mais rápida, com média, mediana e máximo em dias. Só entram remessas **já encerradas** — a que ainda não chegou não tem prazo, teria de ser um palpite.

Nos últimos 30 dias a rede entrega em **1,1 dia em média**, sobre 5.107 remessas. Em 90 dias sobe para 1,4 e em 180 dias para 1,6 — a operação está mais rápida agora do que no semestre.

A diferença entre lojas é pequena mas visível: nos últimos 30 dias, SOBRAL SHOPPING leva 1,5 dia e IGUATEMI 1,2.

Vale olhar a coluna de **máximo** junto com a média: em 180 dias o EUSEBIO tem média de 2,1 dias mas máximo de 45. A média esconde casos isolados; o máximo os denuncia.

O painel respeita o filtro de loja, mas ignora os de status, idade e busca de propósito — ele descreve o desempenho histórico da operação, e filtrar por "só pendentes" deixaria a amostra só com o que não chegou.

A média da rede é ponderada por volume, então não é a média das barras: loja com mil remessas pesa mais que uma com cinquenta.

## A coluna de dias mudou de significado

Onde antes se lia IDADE, agora se lê **DIAS EM TRÂNSITO**, e o comportamento é outro:

- **Linha aberta**: o contador corre até hoje — há quanto tempo está parada.
- **Linha recebida**: congela na data da baixa — quanto tempo a transferência levou.

Antes o campo corria para sempre, inclusive em linha já recebida. O resultado é que uma remessa entregue no dia seguinte aparecia com **189 dias de média**, quando o trânsito real foi de 1,6. Media a idade do documento, não o tempo de entrega.

É essa correção que torna o painel de prazo possível.

## Por trás

A foto deixou de ser apagada e reescrita por inteiro a cada atualização. Agora só grava o que mudou de fato, e remove o que saiu da janela ou foi cancelado. Na prática: quando nada muda, nenhuma linha é tocada — antes eram 108 mil.

Isso também elimina o instante em que a tabela ficava vazia durante a atualização, em que a tela podia mostrar zero para quem abrisse naquele momento.
