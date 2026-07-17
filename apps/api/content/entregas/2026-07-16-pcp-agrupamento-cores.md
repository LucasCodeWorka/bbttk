---
title: PCP - Agrupamento de Cores
date: 2026-07-16
modulo: pcp
---
Primeira ferramenta do modulo PCP: agrupar variacoes de uma mesma cor (ex: azul claro, azul escuro, azul bebe) em um unico grupo, sem alterar os dados originais do produto (que vem do TOTVS e e re-sincronizado periodicamente).

## Como criar um agrupamento

1. Va em PCP > Agrupamento de Cores.
2. Digite o nome do novo grupo (ex: "Azul").
3. Clique em "+ Adicionar Cores" e busque as cores que devem entrar nesse grupo - digite pra filtrar ou role a lista. Tambem dá pra subir um CSV com uma cor por linha.
4. Clique em "Proximo" pra ver o impacto: todas as combinacoes referencia+cor que seriam afetadas por esse agrupamento.
5. Se alguma referencia especifica nao deve entrar no grupo, clique em "Remover" naquela linha antes de confirmar.
6. Clique em "Confirmar Agrupamento".

## Regra importante

Uma combinacao referencia+cor nunca pode pertencer a dois agrupamentos ao mesmo tempo. Se ela ja estiver em outro grupo, a tela de impacto mostra isso bloqueado automaticamente (com o nome do outro grupo) e nao deixa incluir de novo.

Esse mapeamento ainda nao e usado em nenhum relatorio existente (Dashboard, Top Produtos) - por enquanto e so a ferramenta de configuracao. Usar esses grupos nos relatorios e o proximo passo.
