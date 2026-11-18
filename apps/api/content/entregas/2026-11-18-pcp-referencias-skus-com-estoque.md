---
title: Visão Geral do PCP - referências e SKUs com estoque
date: 2026-11-18
modulo: pcp
---
Os quadros **Referências com estoque** e **SKUs com estoque** agora consideram
todas as linhas e todos os status do cadastro, deixando de fora **somente o
INATIVO**. Antes eles olhavam só o mix Básico/Renovável ativo, o que mostrava
um número bem menor que o do card de Estoque Total.

Saldo negativo também conta: só fica de fora a referência (ou o SKU) zerada em
todos os tamanhos. Cada quadro mostra o percentual sobre o total de itens não
inativos e, no rodapé, a quantidade do ano anterior na mesma data, com a
variação.

A **Ruptura** não mudou: continua calculada só sobre Básico e Básico Renovável
com status ATIVO, porque coleção não é reposta.
