---
title: Análise de Estoque - ajustes da devolutiva de 13/11
date: 2026-11-24
modulo: pcp
---
A tela **Análise de Estoque** recebeu os ajustes pedidos na devolutiva:

- A data já abre em **ontem**, a última posição com estoque calculado.
- Os cards de **Referências** e **SKUs com saldo** passaram a seguir a mesma
  regra da Visão Geral: saldo somado de todos os locais, sem itens INATIVOS.
  Na posição de 22/11 as duas telas mostram 760 referências e 6.148 SKUs.
- A coluna de total agora se chama **TT Geral**.
- Novas colunas **Part. %**, **Valor varejo** e **Valor atacado**: todo o
  estoque multiplicado pelo preço de tabela de varejo e de atacado (o mesmo
  preço usado na Visão Geral, não o promocional).
- A linha **TOTAL** aparece logo no início da tabela.
- **Agrupamento por cores** junta os tons da mesma cor numa linha só
  (ex.: AZUL TOTAL reúne azul claro, azul escuro e os códigos de azul), com
  todos os tamanhos somados.
