---
title: Acompanhamento por Linha - peças em trânsito
date: 2026-10-14
modulo: pcp_servico
---
Três colunas novas no **Acompanhamento por Linha**, atendendo aos três pontos da devolutiva de 25/08.

## O que entrou

**EM TRÂNSITO** — ao lado de ESTOQUE. São as peças que saíram do DPA e ainda não chegaram ao destino. Elas não constam no estoque de nenhuma loja, então precisavam ser contadas à parte.

**ESTOQUE + TRÂNSITO** — a soma das duas, que era o segundo pedido.

**COB C/ TRÂNSITO** — a cobertura recalculada sobre estoque + trânsito, ao lado da cobertura atual para comparação direta. Como inclui o que está a caminho, é sempre maior ou igual à COB MESES.

Um card novo no topo mostra o total em trânsito, com a soma estoque + trânsito logo abaixo. As três colunas também vão para o Excel.

## De onde vem o número

Do relatório **Estoque em Trânsito**, que usa o vínculo documento-a-documento do TOTVS — o ERP aponta exatamente qual documento de entrada recebeu cada saída. O que não tem entrada registrada é o que aparece aqui.

Os totais batem entre as duas telas: conferimos 119 peças no Acompanhamento contra 119 no Estoque em Trânsito, e por loja também (IGUATEMI EXP. 118, NORTH SHOPPING 1).

A classificação do produto é lida na hora, da mesma fonte que o estoque usa. Assim, se a categoria de um produto mudar, estoque e trânsito continuam caindo no mesmo balde — a soma das duas colunas sempre descreve a mesma linha.

## O que esperar em cada filtro

**Por loja**: o trânsito acompanha o filtro, contando só o que está a caminho das lojas selecionadas.

**Canal Atacado**: a coluna fica zerada, e isso é correto. Transferência sempre vai da Fábrica para uma loja física, então DPA e Atacado nunca têm peças a caminho.

**Canal Todos**: mostra o mesmo total do Varejo, pela mesma razão.

## Uma observação sobre a leitura

O número hoje é pequeno — 119 peças — e isso é bom sinal, não falta de dado. Significa que o recebimento está sendo lançado em dia. Quando esse número crescer, é indício de mercadoria represada ou de lançamento atrasado nas lojas, e o relatório Estoque em Trânsito mostra documento por documento onde está.
