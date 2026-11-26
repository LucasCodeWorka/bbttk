# Vocabulário da BBTK (como a cliente fala -> o que é no sistema)

Para responder na língua dela. O `_vocabulario_cliente.md` gerado em cada documento de
aprovação complementa este arquivo com termos novos.

| Elas dizem | No sistema |
|---|---|
| Visão Geral | Relatório Base, tela `/pcp-relatorio-base` |
| Análise de Estoque | Aba/relatório de estoque do PCP |
| DPA | Fábrica (filial 2), estoque físico e segunda qualidade |
| Atacado | Fábrica (filial 2), saldo 8 ou operação com "ATACADO" |
| Ruptura | SKU de Básico/Renovável Ativo, com estoque <= 0, **que já teve entrada e vendeu em 12 meses** |
| Básico / Renovável / Style | Linhas de classificação do produto |
| Giro anual | Giro acumulado contra a meta anual; abaixo da meta fica vermelho |
| Cobertura (em **meses**) | Estoque dividido pela venda dos 30 dias; **sempre meses, nunca dias** |
| Por coleção / Por status / Por linha | Visões do quadro de cobertura |
| FORA DE LINHA | Itens a preço cheio |
| FORA DE LINHA PROMO | Itens com desconto (Black, Promo, Liqui e demais complementos) |
| NÃO CLASSIFICADO | Sem classificação no cadastro |
| PM | Preço médio de venda (valor líquido / peças líquidas) |
| PDV ORIGINAL | Preço de tabela do varejo |
| PDV ATUAL | Preço promocional vigente, ou o de tabela |
| Markup | PDV atual / custo, multiplicador com 2 casas (abaixo de 2,00 sinaliza) |
| Giro 30d | Venda líquida dos últimos 30 dias da posição |
| Posição | A data do snapshot do relatório (ex.: 22/11) |

## Como a cliente se refere ao material

- "Devolutiva": documento Word com pontos numerados ou seção de texto livre.
- "Quadrinho": um card do topo da tela.
- "Esse relatório mesmo": a tela citada na mensagem anterior.
- "Mesmo esquema antes e dps": o documento com prints antes/depois e a fala dela.

## Pessoas

- **Renata Pastro** e **Gleice**: responsáveis de negócio (aprovam).
- **Adri**: ao lado da Renata, também pede ajustes.
- **Marcelo**: desenvolvedor, trabalha na branch `limes/teste`.
- **Lucas**: dono do repositório e do BI; opera com o Claude Code.
