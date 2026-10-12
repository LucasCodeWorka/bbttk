---
title: PCP - Estoque em Trânsito (auditoria de transferência)
date: 2026-10-12
modulo: pcp_servico
---
Relatório novo em **Relatórios → Estoque em Trânsito**: pega cada item que saiu da Fábrica por transferência nos últimos 12 meses e tenta casar com a entrada registrada na loja de destino. O que não foi baixado aparece como pendência, com a idade em dias.

## Como usar

A tela abre já filtrada em "só o que ainda tem saldo aberto" — é a visão de auditoria. Desmarcando essa opção, você vê o ciclo inteiro (incluindo o que já foi recebido), útil pra conferir se a baixa de um documento específico aconteceu.

Filtros: loja de destino, categoria/linha/gênero/status do produto, faixa de idade (mínima e máxima em dias), status do trânsito e busca livre por documento, SKU, referência, produto ou loja.

Os três painéis do meio respondem perguntas diferentes:

- **Idade da pendência** — distribui as peças abertas por faixa de dias. Faixa alta é o sinal de atraso de lançamento.
- **Pendência por loja destino** — ranking por quantidade aberta. Clicar na loja filtra a tabela embaixo. Loja marcada `FECHADA` é resíduo contábil, não tem o que cobrar.
- **Ciclo da transferência** — quanto de cada linha já foi baixado: aberto, parcial ou recebido.

A tabela de baixo é a prova documento a documento: uma linha por item de documento de saída, com quantidade que saiu, quantidade já recebida, quantidade aberta e as datas da primeira e da última baixa. Dá pra ordenar por qualquer coluna e exportar pro Excel.

## Como o cálculo funciona (e o limite dele)

O TOTVS **não** guarda vínculo documento-a-documento de transferência: não existe campo dizendo "esta entrada baixou aquela saída". A amarração é feita por fila FIFO por loja de destino + produto — a entrada mais antiga abate a saída mais antiga daquele produto naquela loja.

Consequência prática: uma linha pendente significa **saída sem entrada equivalente registrada**, o que pode ser mercadoria em trânsito de verdade ou atraso de lançamento no TOTVS. A faixa de idade é o que separa os dois casos.

## ⚠️ Hoje o relatório não mostra trânsito atual

O ETL que traz os dados do TOTVS parou de gravar os **itens** das operações de transferência. A saída mais recente com item registrado é de **24/06/2026** — de julho em diante não há item pra contar. Isso não significa que a rede parou de transferir mercadoria; significa que o dado não está chegando.

A tela avisa isso sozinha, num aviso vermelho no topo que mostra a data da última saída conhecida e quantos dias de defasagem existem. **O aviso desaparece por conta própria quando o ETL for corrigido** — não precisa mexer no relatório.

Enquanto isso, use como **auditoria do passivo** (baixa de transferência atrasada, limpeza de cadastro), nunca como previsão de chegada de mercadoria.

## O que a primeira apuração mostrou

Dos últimos 12 meses: 99.451 peças saíram, 96.789 foram baixadas, e sobraram **2.662 peças abertas** em 1.505 linhas e 127 documentos, espalhadas por 13 lojas.

Dois recortes que mudam a leitura desse número:

- **Nenhuma pendência tem menos de 91 dias.** Não existe um único caso de "saiu há poucos dias e ainda não chegou" — tudo que está aberto é antigo.
- **946 peças (36%) são da Terrazo Shopping, loja já fechada.** Mercadoria que saiu antes do fechamento e cuja entrada nunca foi baixada; vai ficar pendente pra sempre.

Ou seja: o saldo real a investigar nas lojas ativas é bem menor que o total bruto, e é todo de natureza contábil.

## Atualização dos dados

A foto é materializada por um script, não é calculada ao vivo (são 40 mil linhas de origem). Pra regerar: `npm run rebuild:estoque-transito -w apps/api`. Rodar de novo substitui a foto anterior inteira, sem duplicar linha.
