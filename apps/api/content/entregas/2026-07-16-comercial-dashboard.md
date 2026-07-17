---
title: Comercial - Dashboard de Vendas
date: 2026-07-16
modulo: comercial
---
O Dashboard mostra, por filial, o comparativo completo de vendas do periodo selecionado: Faturamento, Pecas, Preco Medio, Ticket Medio, Peças por Atendimento, Clientes, Devolucoes, Clientes Novos, Meta e Projecao.

- O Faturamento e sempre liquido: vendas menos devolucoes. Uma devolucao e identificada pelo tipo de operacao que vem da TOTVS (operationMode = 3, operationsType = "E") - a lista de operacoes que sao devolucao fica em `apps/api/src/config/constants.ts`, na constante `DEVOLUTION_OPERATIONS`.
- A filial Fabrica (codigo 2) nao entra nos relatorios de venda de loja - ela e producao, nao ponto de venda.
- A Projecao usa a "caminhada" do ano anterior: pega quanto a filial tinha vendido ate esse mesmo dia no mes passado (ano anterior) dividido pelo total do mes inteiro do ano anterior, e usa essa proporcao pra projetar o faturamento do mes atual inteiro.
- Clientes Novos = clientes cuja primeira compra valida em toda a historia caiu dentro do periodo que voce esta olhando.
