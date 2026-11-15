---
title: PCP - ordem das lojas e conferência de produção
date: 2026-11-15
modulo: pcp
---
Na **Visão Geral**, as lojas seguem a ordem solicitada, começando por **02 DPA**
e **02 ATACADO**. As lojas atuais permanecem visíveis; lojas fechadas aparecem
somente quando têm venda ou estoque diferente de zero na data consultada.
A exportação segue a mesma ordem.

A coluna **EM PROD.** passa a incluir os SKUs com produção pendente mesmo
quando ainda não têm estoque ou venda. A quantidade é contada uma única vez
por SKU, inclusive ao agregar referências e cores.

A consulta por data usa a posição de produção registrada naquele dia.
Quando não existe registro para a data, a tela mostra **—** e o Excel informa
**Indisponível**. Quando há posição disponível, a tela mostra o horário da
captura. Uma posição confirmada sem pendências continua mostrando zero.

O registro diário começa com as novas sincronizações da rotina atualizada;
ele não reconstrói as pendências anteriores. A identificação das OPs também
foi corrigida para distinguir números reutilizados em ciclos diferentes.
