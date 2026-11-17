# Excel de clientes no Dashboard de Vendas

O card **CLIENTES** recebeu um botão discreto **Excel**, com indicador de geração e aviso em caso de falha. O arquivo usa o utilitário compartilhado `exportMultiSheetExcel`, com título/período, cabeçalhos, larguras e formato monetário dos demais relatórios.

O arquivo tem duas abas, **Compras** e **Devoluções**, sempre presentes, inclusive quando uma delas está vazia. Ambas trazem loja, código/nome do cliente, telefone, e-mail, cidade/UF, quantidade de movimentos, peças, valor, média por movimento e primeira/última data do respectivo tipo no período. Códigos e telefones são texto para preservar zeros. As métricas se referem ao intervalo e filtros selecionados, não ao histórico inteiro do cliente.

Na aba Compras, quantidade e valor consideram somente vendas, e ticket médio = valor de compras ÷ quantidade de compras. Na aba Devoluções, quantidade e datas consideram somente devoluções; valor/peças são negativos, normalizados com `-ABS`, e a coluna Valor médio por devolução divide o valor devolvido pelo número de devoluções. Valores monetários usam duas casas decimais. Quem comprou e devolveu aparece nas duas abas, com valores segregados; quem apenas devolveu aparece somente em Devoluções.

## Critério

- Uma linha por cliente, grupo de loja e tipo de movimento. O mesmo cliente em lojas diferentes aparece em cada loja. O card publicado continua contando quem teve venda; a aba Compras acompanha esse universo. A aba Devoluções inclui também quem apenas devolveu, sem alterar o card.
- Na fábrica, DPA e Atacado juntos não duplicam o cliente. Os filtros isolados de canal continuam respeitados.
- Usa os mesmos filtros de período, lojas, classificações e dias excluídos do card, incluindo a competência por `dt_fatura` quando disponível.
- Mantém clientes sem cadastro e movimentos sem itens elegíveis, como o indicador atual. O botão permite baixar mesmo quando o card tem zero compradores, para atender recortes com somente devoluções.
- Captura os filtros associados aos dados carregados do card, para que uma alteração de filtros ou falha de atualização não troque silenciosamente o período do download.

## API

`GET /api/vendas/clientes/periodo/:start/:end`

Exige autenticação, valida datas/filiais e limita usuários não administradores às suas lojas. O dashboard também passa a usar as lojas permitidas como seleção padrão desses usuários. A consulta é somente de leitura, com limite de execução de 30 segundos e de espera por lock de cinco segundos. Não há alteração de schema ou de dados sincronizados.

A API devolve `periodo`, `compras` e `devolucoes`. A consulta agrega os movimentos por tipo numa única leitura, antes de juntar o cadastro de clientes.

## Validação

- `npm run test:clientes-dashboard -w apps/api`: 13 testes passaram. Comparação com a consulta real do card em CTEs fictícias garante que todos os compradores continuam presentes na aba Compras e devoluções são segregadas. Cobre lojas, canais, classificações, datas, valores negativos, cadastros ausentes e clientes repetidos entre lojas. Um cliente com duas compras somando R$ 150 e duas devoluções somando R$ 8 aparece nas duas abas, reconciliando R$ 142 líquidos. Testes HTTP verificam autenticação, restrição por filial e separação das listagens.
- Builds da API e do frontend passaram.
- Chrome headless, com respostas simuladas: clique no botão baixou um XLSX válido com ambas as abas, telefone preservado como texto, moeda numérica e requisição autenticada, sem erros no navegador. Verificados o mesmo cliente nas duas abas com valores separados e o caso de Compras vazia com Devoluções preenchida, mesmo com o card mostrando zero compradores.
- Conferência somente de leitura em dados reais, de 01/11 a 17/11/2026, todas as lojas: **Compras: 2.987 registros cliente/loja, 3.357 compras, R$ 709.225,94**. **Devoluções: 324 registros cliente/loja, 333 devoluções, -R$ 59.757,26**. O líquido de **R$ 649.468,68** coincide com o dashboard do print. Nenhum dado pessoal foi impresso ou exportado nesta conferência real.
- Cobertura de nomes consultada em 17/11/2026, recorte 01/11 a 17/11: **2.987 registros cliente/loja**, **2.936 clientes distintos**, todos com nome ou nome fantasia disponível em `dim_cliente`. Zero registros sem cadastro ou com cadastro sem nome. Em outro recorte, se faltar nome, a exportação mantém `Cliente <código>`; deve-se reconciliar o cadastro com a API de pessoas PF/PJ do TOTVS, sem inferir identidade de vendas anônimas.
- A presença de clientes apenas com devolução e a participação de um mesmo cliente nas duas abas são validadas por fixtures e pelo download no navegador, sem depender da existência desses casos no recorte real consultado.

Implementação e validações concluídas em 17/11/2026. Nota de entrega: `apps/api/content/entregas/2026-11-17-comercial-clientes-excel.md`.
