---
title: Dashboard de Vendas - excluir dias da análise
date: 2026-10-08
modulo: comercial
---
Agora dá pra tirar dias específicos de dentro do período analisado, sem mexer no intervalo.

## Como usar

Ao lado dos campos Início e Fim apareceu o campo **Dias**. Ele mostra quantos dias o período tem (ex: `30 dias`). Clicando, abre o calendário do intervalo escolhido: clique num dia pra riscá-lo e tirar da análise, clique de novo pra trazer de volta.

O campo passa a mostrar `29 de 30 dias · 1 fora` e fica em vermelho, pra ficar claro que a análise não está cobrindo o período inteiro. Tem um botão "Incluir todos os dias de volta" pra limpar de uma vez.

Serve pra quando um dia distorce a leitura: loja fechada, evento atípico, falha de sistema, inventário.

## O que o dia excluído afeta

Sai de tudo no Dashboard: faturamento, peças, clientes, ticket médio, PA, devoluções, clientes novos, ranking de vendedores, itens mais vendidos e os gráficos.

**No ano anterior, o mesmo dia também sai.** Se você desmarcar 15/09/2026, o 15/09/2025 sai junto — assim a comparação continua sendo 29 dias contra 29 dias, e não 29 contra 30.

**A meta continua cheia.** Analisar 29 dias não reduz a meta do mês, então o % de atingimento cai de propósito.

## Atenção na projeção

A projeção usa a "caminhada do ano anterior", comparando data com data. Excluir um dia pode mexer bastante nela quando poucos dias do mês já passaram — um dia forte no começo do mês pesa muito no ritmo. Quanto mais avançado o mês, menor o efeito. Em mês já fechado, o impacto é pequeno.
