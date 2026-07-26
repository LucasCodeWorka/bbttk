---
title: Comercial - Correcoes de faturamento, ranking e novos indicadores
date: 2026-07-23
modulo: comercial
---
Reconciliamos o Dashboard contra os relatorios oficiais do TOTVS (FISFL024 e PRDFL074) e corrigimos tres problemas que estavam inflando o faturamento: sinal de devolucao gravado errado em parte dos dados, operacoes que nao sao venda (compra, consignacao, remessa, brinde) sendo contadas como faturamento, e o canal Atacado somando a Fabrica inteira em vez de so a operacao de atacado. As lojas de Varejo agora batem exatas com o TOTVS.

- O ranking de Top Produtos estava descartando 86% das vendas reais por causa de um filtro com dado incompleto no cadastro - corrigido, bate 100% com o relatorio de referencia (PRDFL074).
- A Fabrica (filial 2) agora aparece dividida em 3 linhas no Comparativo por Filial - Fabrica, Delivery e Atacado - igual o TOTVS ja mostra nativamente, em vez de uma linha so misturando tudo.
- Filtro "Grupo/Marca" trocado por "Status" (Ativo/Inativo/Fora de Linha), que tem dado real na base.
- 3 KPIs novos no Dashboard: Atendimento, Clientes e Preco Medio da Peca. Todos os 7 indicadores agora mostram o percentual de crescimento vs o mesmo periodo do ano anterior.
- "Vendas por Filial" agora mostra as 13 filiais (antes só as 8 primeiras).
- No Agrupamento de Cores, uma cor usada em um agrupamento nao aparece mais como opcao pra outro agrupamento - evita a mesma cor entrar em dois grupos por engano.
- A classificacao de operacao (o que e venda, o que e devolucao) agora sincroniza sozinha com o TOTVS quando aparece um codigo novo, em vez de depender de lista fixa no codigo - isso e o que causou os bugs de faturamento inflado, e agora se corrige automaticamente.
