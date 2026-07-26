# Tasks de ajustes dos dashboards

Contexto consolidado a partir das solicitações recebidas. Este arquivo descreve o que precisa ser alterado, sem implementar scripts ou mudanças de codigo neste momento.

## 1. Dashboard de vendas - novos cards

Adicionar 3 novos cards ao dashboard de vendas, seguindo o mesmo padrao visual ja existente:

- Atendimento
- Clientes
- Preco medio da peca

Regras visuais:

- Manter padrao atual de fonte, tamanhos, cards, filtros e espaçamento.
- Os novos cards devem seguir o mesmo estilo dos cards atuais: Faturamento, Pecas, Ticket Medio e Pecas/Atendimento.
- Evitar mudar a identidade visual existente.

Regras de calculo a confirmar/implementar:

- Atendimento: total de atendimentos no periodo filtrado.
- Clientes: total de clientes no periodo filtrado.
- Preco medio da peca: faturamento liquido dividido pela quantidade de pecas vendidas.

Criterios de aceite:

- Os 3 cards aparecem junto dos KPIs principais.
- Os valores respeitam filtros de data, filial, categoria, genero, status/classificacao, linha, colecao e tecido.
- Os cards nao quebram layout em desktop.

## 2. Crescimento versus ano passado em todos os cards

Hoje alguns cards ja mostram crescimento versus ano passado, mas Ticket Medio e Pecas/Atendimento ainda nao mostram.

Alterar para que todos os cards principais exibam comparativo versus o mesmo periodo do ano anterior:

- Faturamento
- Pecas
- Ticket Medio
- Pecas/Atendimento
- Atendimento
- Clientes
- Preco medio da peca

Regra esperada:

- Comparar o periodo filtrado atual com o mesmo intervalo do ano anterior.
- Exemplo: filtro `01/07/2026` ate `22/07/2026` deve comparar contra `01/07/2025` ate `22/07/2025`.
- O percentual deve indicar crescimento ou queda.

Criterios de aceite:

- Todos os cards exibem percentual versus ano anterior.
- Percentuais respeitam os mesmos filtros aplicados ao dashboard.
- Quando o valor do ano anterior for zero ou inexistente, exibir estado tratado, sem erro visual ou divisao por zero.

## 3. Filtro Status

Foi identificado que falta a classificacao `STATUS`.

Alteracao desejada:

- Substituir o filtro `Grupo/Marca` por `Status`.

Criterios de aceite:

- O filtro aparece como `Status`.
- As opcoes sao carregadas da base correta.
- Ao selecionar um status, todos os indicadores, tabelas e graficos do dashboard respeitam o filtro.

Ponto a confirmar na implementacao:

- Qual campo/tabela representa `STATUS` na base atual.

## 4. Separacao correta da Loja 2 por operacao

Dentro da Loja 2 existem operacoes diferentes. Atualmente tudo esta sendo considerado como Atacado, mas isso esta incorreto.

Regras informadas:

- Linha `2 - FABRICA` e linha `2.1 - DELIVERY` sao operacoes de varejo.
- Linha `2.3 - ATACADO` e a operacao correta de atacado.
- Se nao for possivel separar tudo no BI neste momento, e melhor remover `FABRICA` e `DELIVERY` do Atacado do que somar tudo como Atacado.

Alteracao desejada:

- Separar as operacoes da Loja 2 corretamente nas consultas/calculos.
- Atacado deve considerar somente a operacao `2.3 - ATACADO`.
- Varejo pode incluir `2 - FABRICA` e `2.1 - DELIVERY`, se fizer sentido para o dashboard.

Criterios de aceite:

- Valores de Atacado nao incluem vendas de Fabrica ou Delivery.
- Relatorios do dashboard nao classificam operacoes de varejo como Atacado.
- Filtros por filial/operacao continuam consistentes.

Pontos a confirmar na implementacao:

- Campo exato usado para identificar operacao: loja, empresa, centro de custo, serie, canal ou outro.
- Se `FABRICA` e `DELIVERY` devem aparecer como lojas separadas ou apenas compor o Varejo.

## 5. Agrupamento de cores - remover cores ja usadas

Implementar comportamento para evitar que a mesma cor seja vinculada a mais de um agrupamento.

Exemplo:

- Agrupamento `Azul Claro` recebe a cor `Azul 2102`.
- Ao trocar para outro agrupamento, como `Azul Medio`, a cor `Azul 2102` nao deve aparecer mais na lista de opcoes.

Regra desejada:

- Depois que uma cor for utilizada em um agrupamento, ela deixa de ficar disponivel para os demais agrupamentos.
- A cor deve continuar visivel/editavel no agrupamento onde ja foi selecionada.

Criterios de aceite:

- Uma mesma cor nao pode ser selecionada em dois agrupamentos diferentes.
- Ao editar um agrupamento, as cores ja selecionadas nele continuam aparecendo.
- Ao remover uma cor de um agrupamento, ela volta a ficar disponivel para outros.
- A regra vale tanto no frontend quanto na validacao de backend, para evitar conflito por chamadas diretas na API.

## 6. Atualizacao de transacoes a cada 30 minutos

Alterar rotina de atualizacao de transacoes para rodar de 30 em 30 minutos.

Regras esperadas:

- A rotina deve atualizar transacoes periodicamente a cada 30 minutos.
- Evitar duplicidade de transacoes.
- Manter idempotencia: se a mesma janela rodar duas vezes, nao deve duplicar dados.
- Registrar horario da ultima atualizacao, sucesso e erro.

Criterios de aceite:

- O processo executa a cada 30 minutos no ambiente configurado.
- Falha em uma execucao nao impede a proxima.
- Logs permitem identificar quando a ultima atualizacao ocorreu.

Pontos a confirmar na implementacao:

- Onde a rotina deve rodar: Render cron, VPS, worker dedicado ou outro scheduler.
- Qual endpoint/script atual faz a importacao das transacoes.
- Qual janela de busca deve ser usada a cada execucao.

## 7. Card/Grafico "Vendas por filial"

Ajustar o componente `Vendas por filial`.

Alteracoes desejadas:

- Reduzir o tamanho da fonte.
- Exibir todas as lojas, nao apenas as primeiras.

Criterios de aceite:

- Todas as filiais retornadas pela API aparecem no componente.
- Fonte menor melhora a leitura e evita cortes.
- Layout continua bom mesmo com muitas lojas.
- Barras continuam proporcionais ao maior valor da lista.

Observacao tecnica:

- Verificar se existe limite no frontend, por exemplo `slice(0, 8)`, e remover/substituir por renderizacao completa com altura adequada.

## 8. Itens mais vendidos - divergencia com relatorio correto

O ranking de itens mais vendidos nao esta batendo com o relatorio correto informado.

Periodo de referencia:

- Inicio: `01/07/2026`
- Fim: `22/07/2026`
- Escopo: 12 lojas do Varejo
- Agrupamento: Grupo
- Relatorio de referencia: `PRDFL074 - Lucratividade por Grupo`

Totais do relatorio de referencia:

- Quantidade venda: `14.552`
- Valor total venda: `R$ 855.109,52`
- Valor total custo: `R$ 282.160,90`
- Percentual lucro: `203,06`
- Indice: `67,00`

Ranking correto informado:

| Posicao | Grupo | Descricao | Qt. venda | Vl. total venda |
| --- | --- | --- | ---: | ---: |
| 1 | 003 BB CST413 | CAMISA BEBETENKITE SEM MANGA TOPAZE | 776 | R$ 44.001,64 |
| 2 | 008 BB VST412 | VESTIDO BEBETENKITE POLO MANACA | 184 | R$ 21.854,54 |
| 3 | 005 BB MCF196 | FRANCES BEBETENKITE TOPAZE FEMININO | 164 | R$ 19.563,99 |
| 4 | 002 BB BLS184 | BLUSA BEBETENKITE NADADOR TOPAZE | 291 | R$ 16.700,32 |
| 5 | 010 BB BD186 | BODY BEBETENKITE BODY BABYLOOK TOPAZE | 209 | R$ 16.499,60 |
| 6 | 014 BB CUE016 | PIJAMA E ROUPA INTIMA BEBETENKITE BOXER SEAMLESS | 447 | R$ 16.495,90 |
| 7 | 007 BB SHT330 | SHORTS BEBETENKITE TRICOT ESSENCE | 112 | R$ 12.208,09 |
| 8 | 002 001 BLS185 | BLUSA BEBETENKITE BABYLOOK FEMININA BASIC | 146 | R$ 11.574,33 |
| 9 | 008 BB VST409 | VESTIDO BEBETENKITE NORMANDIE | 76 | R$ 10.536,36 |
| 10 | 008 BB VST413 | VESTIDO BEBETENKITE HELLO KIT | 81 | R$ 10.339,71 |
| 11 | 016 BB BD272 | MODA PRAIA BEBETENKITE BODY PROTECAO ARIELA | 56 | R$ 10.005,06 |
| 12 | 025 BB CNJ425 | CONJUNTO BEBETENKITE OPORTUNIDADE VENTANIA | 64 | R$ 9.566,31 |
| 13 | 004 BB TAP027T | COMPLEMENTOS BEBETENKITE TAPA FRALDA BASIC TOPAZE | 185 | R$ 8.948,53 |
| 14 | 003 BB CST415 | CAMISA BEBETENKITE W | 84 | R$ 8.360,33 |
| 15 | 023 BB SAI060 | SAIA BEBETENKITE ANINHA | 65 | R$ 8.322,27 |
| 16 | 002 BB BLS282 | BLUSA BEBETENKITE RAY ESSENCE | 128 | R$ 7.627,21 |
| 17 | 003 BB CST615 | CAMISA BEBETENKITE GOLA CARECA RISO | 86 | R$ 7.613,33 |
| 18 | 006 BB PJM002 | PIJAMA E ROUPA INTIMA BEBETENKITE MANGA LONGA BASICO | 55 | R$ 7.524,19 |
| 19 | 005 BB MCF332 | FRANCES BEBETENKITE SUMMER | 68 | R$ 7.429,56 |

Alteracao desejada:

- Revisar a consulta/calculo do ranking de itens mais vendidos para bater com o relatorio acima.
- Garantir que o filtro considere somente as 12 lojas do Varejo.
- Garantir que o agrupamento esteja por `Grupo`, nao por SKU filho, produto individual ou outro nivel.

Criterios de aceite:

- Para o periodo `01/07/2026` a `22/07/2026`, com 12 lojas do Varejo, o ranking deve bater com os itens e valores informados.
- O total do dashboard deve bater com `14.552` pecas e `R$ 855.109,52` de venda.
- Ordenacao deve seguir o criterio do relatorio de referencia, provavelmente `Vl. total venda` desc.

Pontos a investigar:

- Se o dashboard usa venda bruta, venda liquida ou outro campo.
- Se devolucoes estao sendo abatidas ou exibidas separadamente.
- Se empresas/lojas consideradas no dashboard batem exatamente com a selecao do relatorio.
- Se agrupamento atual esta por produto/SKU em vez de grupo.
- Se ha divergencia por data de movimento, emissao, venda ou caixa.

## Ordem sugerida de implementacao

1. Corrigir base de calculo e filtros do ranking de itens mais vendidos.
2. Corrigir separacao da Loja 2 entre Atacado, Fabrica e Delivery.
3. Adicionar filtro `Status`.
4. Adicionar novos cards e crescimento versus ano anterior em todos os KPIs.
5. Ajustar `Vendas por filial` para listar todas as lojas com fonte menor.
6. Implementar regra de exclusividade no agrupamento de cores.
7. Configurar atualizacao de transacoes a cada 30 minutos.

## Pendencias de confirmacao

- Campo/tabela oficial para `Status`.
- Lista exata das 12 lojas de Varejo.
- Regra final para `FABRICA` e `DELIVERY`: aparecem como lojas de varejo ou ficam excluidas de certos paineis.
- Fonte oficial para Atendimento e Clientes.
- Campo correto para calcular Preco medio da peca.
- Ambiente onde a atualizacao de transacoes a cada 30 minutos deve rodar.
