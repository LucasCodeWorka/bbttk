---
title: PCP - Estoque em Trânsito com dados recuperados
date: 2026-10-14
modulo: pcp_servico
---
O relatório **Estoque em Trânsito** (lançado dia 12/10) recebeu os itens de transferências que faltavam desde junho, recuperados diretamente na API do TOTVS. Com isso, a apuração passou a incluir pendências recentes.

## O que mudou

Valores registrados na sessão de recuperação, usando o cálculo FIFO; não são totais atualizados em tempo real.

| | Antes da recuperação | Após a recuperação |
|---|---|---|
| Defasagem do dado | 110 dias | 0 dias |
| Aviso vermelho no topo | Sempre visível | Sumiu |
| Peças pendentes com até 7 dias | 0 | **444** |
| Total pendente | 2.662 | 4.187 |

As 444 peças de até 7 dias representam saídas da Fábrica sem entrada equivalente no cálculo dessa apuração. A idade recente ajuda a priorizar a conferência, mas não comprova, sozinha, que a mercadoria ainda esteja em transporte. O relatório continua sendo uma ferramenta de auditoria.

## Por que estava faltando

O processo que traz os dados do TOTVS parou de registrar os itens das transferências desde 25/06/2026 (documentado na entrega de 12/10). A recuperação de junho a outubro permitiu atualizar o relatório com os itens retornados pela API.

## O que ainda não está resolvido

A causa de origem no processo de integração continua pendente. Foi preparado um processo auxiliar para completar os itens faltantes, com instruções de instalação e operação. A execução periódica no servidor precisa ser confirmada; publicar o código não ativa esse processo automaticamente. A atualização da foto usada pelo relatório também precisa ser executada após a recuperação.
