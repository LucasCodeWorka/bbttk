# Referências expandidas na matriz de cobertura

A tabela “Cobertura por linha/categoria/gênero/status × canal” passa a expandir
as referências imediatamente abaixo de cada grupo. O clique na linha ou no
botão Ver referências abre e recolhe o detalhamento. Mais de um grupo pode
permanecer aberto.

As referências usam as mesmas onze colunas: identificação, estoque por canal,
estoque total, valor financeiro, vendas por canal e total, e coberturas. Descrição
e status original aparecem abaixo do código. Busca e paginação de 25 referências
ficam dentro de cada grupo. A ordenação do cabeçalho também ordena as referências;
o Total geral continua ao final e a troca de dimensão/filtros fecha os grupos.

O backend inclui as métricas das referências na composição que já calcula nos
caminhos histórico e atual. Usa exatamente os SKUs pertencentes ao grupo, inclusive
quando uma referência tem variações com status diferentes. Cobertura é calculada
com estoque e vendas agregados da referência. Não há nova consulta ao abrir,
buscar, ordenar ou paginar um grupo. O cache anterior da tela é invalidado.

As fórmulas e os subtotais existentes dos grupos e indicadores não foram alterados.
O detalhe de fotos dos SKUs permanece como na entrega anterior.

Validação em base real de 10/11/2026, em transação somente leitura: 44 grupos nas
cinco dimensões conferidos, com estoque de 92.072 peças preservado. Estoques e
vendas das referências fecham com os grupos; valores financeiros mantêm o
arredondamento individual para centavos. Diferença máxima entre soma de valores
arredondados e subtotal financeiro: R$ 0,06.

Testes de integração cobrem ambos os caminhos, métricas por referência, estoque
negativo, valores financeiros, separação de uma referência entre status e
cobertura por canal após a agregação. Suíte completa do PCP: 81 testes aprovados.
Builds de PCP e frontend aprovados.

Chrome local com resposta real: expansão sem janela, onze colunas alinhadas,
busca, paginação, ordenação, abertura de múltiplos grupos, recolhimento e troca de dimensão,
sem exceções de JavaScript. Evidências locais em
`../auditorias/pcp-matriz-expansivel-2026-11-18/`.
