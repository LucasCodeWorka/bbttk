---
title: Estoque em Trânsito - agora com o vínculo real do TOTVS
date: 2026-10-13
modulo: pcp_servico
---
O relatório **Estoque em Trânsito** deixou de depender só de aproximação. Descobrimos que o TOTVS passou a gravar qual documento de entrada recebeu cada saída de transferência, e o relatório agora usa esse vínculo.

## O que muda na tela

Duas colunas novas na tabela:

- **ORIGEM DA BAIXA** — diz se aquela linha foi baixada por `Vinculo TOTVS` (o ERP aponta o documento, é fato) ou `Aproximado` (estimativa por fila FIFO).
- **DOC. ENTRADA** — o documento de entrada que recebeu a mercadoria, no formato `loja/documento`. Dá pra abrir direto no TOTVS e conferir.

Um filtro novo de **Confiabilidade** no topo permite ver só o que o ERP confirma, só o aproximado, ou tudo. E um painel novo mostra quanto do período já está coberto pelo vínculo.

O campo de busca agora também encontra pelo documento de entrada.

## Por que isso importa

Antes, toda baixa era estimada: o sistema casava saída e entrada por ordem de chegada dentro de cada par loja+produto. Funcionava para dimensionar o problema, mas não dava pra afirmar que um documento específico ficou em aberto.

Agora existem dois tipos de pendência, e a diferença é prática:

- **Pendência com vínculo** é cobrável — o ERP diz qual documento deveria ter recebido, e você abre a nota pra conferir.
- **Pendência aproximada** é indício — serve pra saber onde olhar, não pra afirmar.

O vínculo vale para saídas a partir de **26/06/2026**. Antes disso o TOTVS não gravava essa amarração, então aquele período continua aproximado — é limitação da origem do dado, não do relatório.

## Os números mudaram (para melhor)

A reestruturação derrubou a pendência total de 3.187 para **2.431 peças**: casar pelo vínculo corrigiu casos que a aproximação estava deixando em aberto por engano.

No período que já tem vínculo, **99,5% das peças aparecem baixadas** — sobram apenas 234 peças em aberto, em 10 documentos e 4 lojas. Esse é o número para trabalhar: pequeno, específico e com documento nomeado.

As outras 2.197 peças abertas são todas do período antigo, sem vínculo, e 2.082 delas têm mais de 90 dias — passivo contábil, não mercadoria na estrada.

## Um caso que vale conferir

Algumas linhas aparecem como **"Vinculo, sem baixa"**: o TOTVS aponta um documento de entrada, mas aquele produto não está dentro dele. Vale investigar — ou o produto entrou por outro documento, ou houve divergência no recebimento. A coluna DOC. ENTRADA mostra exatamente qual nota abrir.

## Sobre o aviso de dado desatualizado

O aviso vermelho que dizia que o relatório não mostrava trânsito atual **sumiu**: o ETL voltou a trazer os itens de transferência e a defasagem caiu para poucos dias. As faixas de idade curtas, que estavam zeradas, agora mostram movimento real (344 peças com até 7 dias).

O aviso continua no código e reaparece sozinho se a foto voltar a ficar velha.
