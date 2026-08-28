# Histórico local de alterações

Arquivo de apoio para registrar alterações feitas no projeto. Este arquivo é local e não é enviado ao Git.

## 2026-08-26

### Relatório Acompanhamento por Linha

#### Totais

- Antes: os indicadores no topo exibiam alguns totais, mas a tabela e a exportação para Excel não apresentavam uma linha consolidada com todos os campos.
- Alteração: incluída a linha `TOTAL` ao final da tabela e do Excel.
- Critério: valores, peças, estoque e produção são somados; evolução, participação, cobertura e atingimento da meta são recalculados sobre o total, sem somar percentuais ou meses de cobertura.

#### Meta e atingimento

- Antes: não havia colunas para comparar a venda com a meta cadastrada.
- Alteração: incluídas as colunas `META R$` e `ATING. META` na tela e no Excel.
- Regra de cálculo: `meta mensal ÷ quantidade de dias do mês × dias selecionados no filtro`.
- Para períodos que atravessam meses, a meta proporcional de cada mês é calculada e somada.
- Sem meta cadastrada para uma classificação em qualquer mês do filtro, a meta e o percentual permanecem em branco.

#### Cobertura em meses

- Antes: a venda era convertida para média mensal usando uma base fixa de 30 dias, o que distorcia o cálculo, especialmente na comparação com o ano anterior e em meses com 28, 29 ou 31 dias.
- Alteração: a cobertura passou a usar os dias reais de cada mês contemplado pelo período selecionado.
- Regra: `estoque físico ÷ venda média mensal equivalente`. A cobertura do ano anterior usa o estoque e as vendas do respectivo período histórico.

#### Classificações e metas

- Antes: o relatório e o cadastro de metas ofereciam apenas Categoria, Linha e Gênero; Coleção já existia somente no cadastro de metas.
- Alteração: adicionadas as opções `Coleção` e `Status` tanto no filtro `Classificar por` quanto no cadastro de metas.
- As duas novas classificações funcionam para consulta, ordenação, totais, exportação e cadastro de meta.

#### Peças em Produção

- Antes: o relatório somava todas as ordens pendentes, inclusive componentes técnicos. Na auditoria da base atual, isso resultava em 40.179 peças, valor incompatível com a visão do BI Industrial.
- Alteração: aplicada a mesma regra de universo de produtos do PCP/BI Industrial: produtos acabados e embalagens; componentes técnicos foram excluídos.
- Resultado da auditoria: a soma da base atual passou para 9.651 peças. A imagem do BI registra 10.386 em 23/08; caso a diferença persista ao comparar o mesmo instante de atualização, será necessário validar o snapshot e regras adicionais do BI.

#### Validação e entrega

- Build do `pcp-api` concluído com sucesso.
- Build de produção do painel web concluído com sucesso.
- Alterações enviadas à branch `teste` no commit `9e5d771` (`fix(pcp): ajusta acompanhamento por linha`), por push normal, sem `--force`.

### Correção posterior: erro 500 no ambiente de teste

- Sintoma: o endpoint `venda-dia/acompanhamento` retornava HTTP 500 para Linha, Coleção e Status.
- Causa provável: a consulta de metas é comum a todas as classificações e o `render.yaml` gera o Prisma no deploy, mas não executa migrações. Se a tabela `pcp_meta_classificacao` ainda não existir no banco do Render, a consulta falha antes de o relatório ser montado.
- Correção: a ausência específica dessa tabela passa a ser tratada como ausência de metas. O relatório continua disponível e exibe as colunas de meta em branco, conforme a regra funcional; outros erros de banco continuam sendo retornados normalmente.

### Correção posterior: sintaxe SQL de Peças em Produção

- Sintoma: o endpoint retornava erro PostgreSQL `42601`, com `syntax error at or near "AND"`.
- Causa: o filtro reutilizado de produtos já inicia com `AND`. Na consulta de Peças em Produção ele foi inserido logo após `WHERE`, produzindo a expressão inválida `WHERE AND (...)`.
- Correção: a consulta passou a iniciar com `WHERE TRUE`, preservando o filtro reutilizado como `WHERE TRUE AND (...)`.

### Correção posterior: conciliação de venda por filial

- Sintoma: o Acompanhamento por Linha apresentava um total menor que o dashboard comercial e diferenças em algumas filiais.
- Causa: a consulta do Acompanhamento removia vendas de produtos sem o valor da classificação selecionada, enquanto o dashboard comercial inclui essas vendas.
- Correção: criada a linha `SEM CLASSIFICAÇÃO`. Ela recebe produtos sem cadastro analítico ou sem valor para a dimensão selecionada, preservando a conciliação dos totais sem atribuir uma classificação incorreta.
- Validação em 01–23/08/2026: o total passou a R$ 868.033 e a linha `SEM CLASSIFICAÇÃO` absorveu R$ 358,95 (exibida arredondada como R$ 359), conciliando com o dashboard comercial.

### Auditoria: peças em trânsito (pendente de fonte de dados)

- Pedido: incluir `PEÇAS EM TRÂNSITO`, `ESTOQUE + TRÂNSITO` e uma nova cobertura calculada sobre essa soma.
- Operações candidatas identificadas: saída do DPA na operação `1510 — SAÍDA DE TRANSFERÊNCIA (CE) CUSTO2` e entrada das lojas na operação `1003 — ENTRADA DE TRANSFERÊNCIA (CE) CUS`.
- Limitação encontrada: não existe no banco uma tabela de trânsito nem uma chave que relacione uma saída `1510` a sua respectiva entrada `1003`. Os códigos de transação não são compartilhados entre origem e destino.
- Decisão: nenhuma coluna foi criada com valores estimados, para não transformar diferenças históricas de transferência em falso trânsito.
- Próxima informação necessária: número da transferência/guia/NF que faça o vínculo, consulta já utilizada pelo BI Industrial, ou confirmação formal de uma regra agregada a ser adotada.

### Auditoria: venda do ano anterior e Terrazo

- Período conferido: 01–23/08/2025.
- Terrazo (filial 18) não está no universo atual do Acompanhamento por Linha. Portanto, não é considerado no valor do ano anterior.
- Total do Acompanhamento sem Terrazo: R$ 806.690,66 (exibido arredondado como R$ 806.691). A linha `SEM CLASSIFICAÇÃO` desse período representa R$ 300,66.
- Se Terrazo fosse incluída, o total seria R$ 827.619,20.
- Referências recebidas do COMFL007: R$ 797.691,13 sem Terrazo e R$ 818.619,67 com Terrazo. A diferença permanece R$ 8.999,53 nos dois cenários; logo, Terrazo não explica a divergência.
- Iguatemi foi validada e coincide exatamente com o COMFL007: R$ 63.134,47.
- Pendência: é necessário o detalhamento/exportação do COMFL007 por empresa para identificar com segurança a(s) filial(is) que compõem os R$ 8.999,53. A imagem recebida mostra apenas o detalhamento de Iguatemi e o total geral.

### Histórico de commits enviados para `teste`

- `879242b` — separação de DPA e Atacado nos relatórios.
- `2f40381` — relatórios PCP, incluindo Acompanhamento por Linha, Pesos e Grades e ajustes de Sugestão de Produção.
- `9e5d771` — totais, metas, cobertura, classificações e ajuste de produção no Acompanhamento.
- `36ce26e` — tratamento da ausência da tabela de metas no ambiente de teste.
- `a6447a6` — correção da sintaxe SQL no filtro de peças em produção.
- `ee5c1f5` — inclusão de `SEM CLASSIFICAÇÃO` para conciliação de vendas.
- `4d89528` — reestruturação do Raio X por referência, cor e grade; separação DPA/Atacado, cobertura e peças em produção.
- `bb0f9b9` — ajustes de Pesos e Grades: ordem de grade, total vendido e consolidação por categoria com filtros de linha/gênero.
- `1c73a09` — conciliação de venda bruta, desconto e venda líquida no relatório de Venda e Desconto.
- `952829e` — agrupamento do relatório Venda e Desconto por referência e rolagem horizontal visível.
- `90cb420` — correção do Resumo da Promoção: Status explícito, estoque sem duplicação, venda em peças, giro e venda bruta.
- `61dabea` — estoque do Resumo da Promoção respeita a data final e exclui DPA/Atacado por padrão.

### Raio X do Produto — reestruturação

- Problema: a tela anterior era extensa, misturava Fábrica e Atacado e não permitia abrir o produto por cor e grade.
- Correção: a consulta agora exige referência selecionada e a tela mostra primeiro o resumo por loja. Cada referência abre suas cores e cada cor abre os blocos por loja e grade.
- Grade fixa: `UN, P, M, G, GG, 2, 4, 6, 8, 10`, sempre na mesma ordem e com zero para grade ausente.
- Fábrica e Atacado: a filial 02 foi separada em `FÁBRICA (DPA)` (estoques físico e segunda qualidade) e `ATACADO` (estoque atacado), tanto em estoque quanto em venda.
- Cobertura: incluída no resumo e no detalhe por grade.
- Peças em produção: incluídas na API e exibidas somente na linha `FÁBRICA (DPA)`, sem duplicar o total nas lojas/Atacado.
- Transferências: o campo continua visível, com zero, pois a fonte/vínculo de transferência ainda não foi identificado (ver auditoria de trânsito acima).
- Validação: builds de `pcp-api` e web concluídos com sucesso.

### Pesos e Grades para Produção

- Grade: a ordenação foi corrigida para `UN, P, M, G, GG, 2, 4, 6, 8, 10`.
- Total vendido: incluída uma coluna após as grades no relatório e na exportação Excel, somando a venda de todos os tamanhos exibidos.
- Por categoria: deixou de listar cada referência individualmente. Cada linha/cartão agora consolida todos os itens da categoria selecionada, com vendas e frequência somadas por grade.
- Filtros adicionais: no modo `Por Categoria`, `Linha` e `Gênero` estão disponíveis como filtros opcionais; ambos são aplicados também na consulta de vendas, evitando somar itens fora do recorte selecionado.
- Validação: builds de `pcp-api` e web concluídos com sucesso.

### Venda e Desconto por Classificação

- Problema: os cartões misturavam conceitos diferentes: o total líquido geral aparecia como `Venda Total`, o `Total Vendido` usava outro recorte do detalhamento e o cartão de desconto mostrava `Giro` no lugar do percentual de desconto. Por isso valor, quantidade e percentual não conciliavam com o relatório 0061.
- Correção: os indicadores do período passaram a ser calculados na mesma base de vendas do relatório virtual e exibidos separadamente como `Venda Bruta`, `Desconto Concedido`, `Venda Líquida` e `Quantidade Vendida`.
- Percentual: abaixo do desconto agora é mostrado `desconto / venda bruta`, em vez de giro. Para o exemplo informado, a leitura esperada é venda bruta R$ 897.742,17, desconto R$ 74.740,31 (8,33%) e venda líquida R$ 756.412,17.
- Detalhamento: a classificação analítica do SKU passou a ser escolhida uma única vez por produto; isso evita repetir uma mesma venda quando houver mais de um registro analítico para o SKU.
- Validação: builds de `pcp-api` e web concluídos com sucesso.
- Agrupamento posterior: o detalhamento deixou de usar SKU/código de barras como nível final. Ele agora agrupa vendas, estoque e custo por referência do produto; o cabeçalho e a exportação foram renomeados para `Referência`.
- Navegação posterior: a área da tabela passou a forçar a rolagem horizontal e reservar espaço para sua barra, permitindo acessar as colunas finais (`Vendas` até `TT Desc Venda`) sem depender do fim da página.

### Resumo da Promoção por Loja

- Critério corrigido: promoção deixou de ser inferida por `Status diferente de ATIVO`. Agora, somente os Status selecionados no filtro são considerados promoção; sem Status selecionado, nenhum item é contado como promoção.
- Estoque: a junção da classificação analítica foi limitada a um registro por SKU, evitando repetir saldos quando houver cadastro analítico duplicado. Esta era uma fonte de divergência no estoque total e no estoque em promoção.
- Novas colunas: `Venda Promo (Peças)` e `Giro Promo`. O giro é calculado para o período selecionado como `venda promo em peças ÷ (venda promo em peças + estoque em promoção)`, sem congelar uma janela de 30 dias.
- Venda bruta: incluída por loja e no primeiro cartão de promoção. O percentual da promoção é calculado sobre a venda bruta; a venda líquida permanece disponível em coluna separada.
- Status no detalhamento por produto: a coluna já está presente no relatório Venda e Desconto, permitindo verificar se um item que recebeu desconto pertence ou não aos Status de promoção selecionados.
- Validação: builds de `pcp-api` e web concluídos com sucesso.
- Auditoria de estoque com banco configurado: em 23/08/2026, o cálculo corrigido das 12 lojas retorna 63.084 peças, contra 62.605 na versão anterior e 63.066 no Saldo Virtual. A diferença foi reduzida de 461 para 18 peças.
- Correções adicionais: o estoque passou a usar somente snapshots até a data final do filtro, a filial 02 fica fora da visão padrão por loja (DPA/Atacado entram apenas quando escolhidos) e `stock_code` passou a ser retornado pela subconsulta que o utiliza, eliminando um possível erro SQL 500.
- Pendência de conciliação: os 18 itens restantes precisam ser comparados com o filtro `Grupo` do Saldo Virtual mostrado no print; esse critério não é hoje exposto como classificação equivalente no relatório.
- Todos os envios foram feitos para `origin/teste` por push normal. Houve uma solicitação posterior de force push com `--force-with-lease`, mas o remoto já estava sincronizado e nada foi sobrescrito.

### Venda do Dia por Classificação — correção do erro 500

- Sintoma: a tela `Venda do Dia por Classificação`, ao consultar por Categoria (e potencialmente pelas demais classificações), apresentava HTTP 500 e a mensagem de erro no quadro de vendas por loja.
- Causa 1: a CTE que identifica o último saldo por produto, loja e depósito usava `stock_code` no filtro externo, mas não o retornava na sua lista de colunas. Isso provocava uma referência de coluna inexistente na consulta de estoque.
- Correção 1: `stock_code` passou a ser retornado pela CTE de último saldo, mantendo o filtro que separa os depósitos de DPA e Atacado.
- Causa 2: as consultas de venda e estoque agrupavam pelo `CASE` de mapeamento de filiais. Como os valores interpolados pelo Prisma recebem parâmetros distintos no `SELECT` e no `GROUP BY`, o PostgreSQL não reconhecia as expressões como iguais e retornava o erro `42803` (coluna deve aparecer no `GROUP BY`).
- Correção 2: os agrupamentos passaram a usar seus campos-base: `t.branch_code, co.description` para vendas e `us.branch_code, us.stock_code` para estoque. O `CASE` continua responsável apenas por devolver DPA e Atacado como filiais separadas.
- Validação: build do `pcp-api` concluído e chamada direta de `getVendaDia` por Categoria executada com sucesso na base configurada, retornando 15 linhas sem exceção SQL.
