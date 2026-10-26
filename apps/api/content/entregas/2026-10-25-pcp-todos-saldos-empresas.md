---
title: PCP - estoque com todos os saldos de todas as empresas
date: 2026-10-25
modulo: pcp
---
Os relatórios de estoque do PCP passam a somar **todos os tipos de saldo de todas
as empresas**, inclusive empresas fechadas. Quantidades negativas reduzem o estoque
e o valor em estoque. Filtros de loja e tipo de saldo continuam sendo respeitados.

Na Fábrica, o saldo de atacado permanece na coluna **Atacado** e os demais saldos
compõem **DPA**. Nas outras empresas, todos os saldos pertencem à própria empresa.

Os scripts que calculam as posições analíticas e o estoque do ano anterior também
seguem essa regra, inclusive nos valores de custo e preço de venda. Relatórios que
usam essas posições recebem os novos valores após a execução das cargas de recálculo.
