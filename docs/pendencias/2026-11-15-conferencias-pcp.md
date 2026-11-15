# Conciliações de estoque PCP adiadas

Em 15/11/2026, o usuário autorizou publicar os ajustes concluídos e deixar
as duas conciliações abaixo para depois. Os valores externos são referências
de conferência e não foram fixados no código.

As apurações abaixo usam a posição de **10/11/2026**, sem filtros de empresa
ou classificação, com todos os locais e tipos de saldo do Relatório Base.
O estoque total dessa posição é **92.072 peças**. A janela vigente de vendas
do relatório é D-30 a D, inclusive.

## Cobertura superior a cinco meses

- Regra publicada: por SKU, estoque positivo e cobertura **>5,0 meses**,
  incluindo estoque sem venda líquida positiva na janela.
- Backend: **66.453 peças**, **72,18%**, **R$ 1.694.780,51** a custo.
- Conferência informada no Virtual TOTVS: **65.054 peças**.
- Diferença pendente: **1.399 peças**.
- O erro independente do percentual foi corrigido: agora divide quantidade
  selecionada por estoque total em peças, em vez de usar a participação financeira.
- Descontar todos os saldos negativos resulta em 66.381 peças; excluir SKUs
  com venda líquida negativa resulta em 65.632. Não abater devoluções nas vendas
  resulta em 64.695. Nenhum desses cenários reproduz a conferência externa.

## Peças sem venda nos últimos 30 dias

- Regra publicada: consolidar estoque e venda líquida por referência; selecionar
  referências com estoque positivo e venda líquida acumulada igual a zero.
- Backend: **3.176 peças em 178 referências**.
- Conferência informada no relatório 086 do DICFM, criado pelo Fernando:
  **3.212 peças em 180 referências**.
- Diferença pendente: **36 peças e 2 referências**.
- Incluir também venda líquida negativa resulta em 3.310 peças/186 referências;
  considerar ausência de vendas sem compensar devoluções resulta em
  3.181 peças/180 referências. A diferença não foi conciliada.

## Retomar a conferência

Comparar as exportações detalhadas do Virtual e do relatório 086 com o
Relatório Base, por referência/SKU. Conferir data-base, início e fim da janela,
empresas/locais, tipos de saldo, classificação das operações e tratamento
de devoluções e de saldos negativos. Se a seleção mudar, recalcular também
o valor financeiro dos produtos efetivamente selecionados.
