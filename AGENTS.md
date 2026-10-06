# Bebetenkite Dashboard — Contexto do Projeto

Painel interno da Bebetenkite (rede de lojas infantil) que consolida dados de vendas do
ERP TOTVS Moda (via ETL externo → Postgres) e adiciona ferramentas de gestão (metas,
agrupamento de produtos) que o TOTVS não oferece.

> Este arquivo é a fonte única de contexto do projeto, lida tanto por Claude Code
> quanto por outros agentes (ex: Codex CLI). `CLAUDE.md` na raiz só importa este
> arquivo (`@AGENTS.md`) — edite sempre aqui, nunca duplique conteúdo lá. Mesmo padrão
> já usado em `apps/web/CLAUDE.md` → `apps/web/AGENTS.md`.

## Arquitetura

Monorepo com **npm workspaces** (`apps/*`), **três** serviços independentes (não dois —
isso mudou depois de uma sessão em que o módulo PCP foi temporariamente removido e
depois trazido de volta como app próprio):

- **`apps/api`** — Express + TypeScript + Prisma, porta padrão 3001 (dev). Roda com
  `tsx watch` em dev (não faz type-check completo!) e `tsc` no build de produção.
  Concentra: auth, Comercial (vendas/metas/comissões), e **todas as telas de
  Configurações/Cadastro do PCP** (`pcpConfig.routes.ts`, `metaClassificacao.routes.ts`
  etc.) — cadastro fica sempre em `apps/api`, mesmo quando é uma config específica do
  PCP, o `apps/pcp-api` só lê.
- **`apps/pcp-api`** — Express + TypeScript + Prisma, porta própria (3002 em dev). Só
  os **relatórios pesados** do módulo PCP (leitura). Frontend chama via
  `apps/web/src/lib/pcpApi.ts` (`PCP_API_URL`), separado do client de `apps/api`
  (`apps/web/src/lib/api.ts`, `API_URL`). Os dois workspaces **não têm import cruzado**
  configurado — helpers de SQL (ex: `SALE_OPERATION_FILTER`, `QUANTIDADE_COM_SINAL`)
  são duplicados manualmente entre `apps/api/src/services/vendas.service.ts` e
  `apps/pcp-api/src/services/relatorioBase.service.ts` (que por sua vez os
  reexporta pros outros services do próprio `pcp-api` — não duplicar de novo dentro
  do `pcp-api`, só entre os dois apps).
- **`apps/web`** — Next.js 16 (App Router, Turbopack), porta 3000. Todas as páginas são
  `'use client'` — não usa Server Components, Server Actions, Middleware nem rotas de
  API do próprio Next. Auth é 100% client-side (token JWT em `localStorage`).

**IMPORTANTE — `apps/web` roda uma versão do Next.js diferente do que qualquer LLM
treinou** (ver `apps/web/AGENTS.md`): breaking changes de API/convenção/estrutura de
arquivo. Antes de escrever código novo em `apps/web`, ler a doc local em
`node_modules/next/dist/docs/` em vez de confiar em conhecimento prévio.

**Sempre rodar `npm install`/scripts a partir da raiz do repo**, nunca de dentro de
`apps/api`, `apps/web` ou `apps/pcp-api` isoladamente — é um workspace, isolar quebra o
hoisting de dependências.

```
npm run dev          # sobe api (3001) + web (3000) + pcp-api (3002) juntos
npm run build         # build de produção dos tres (tsc + tsc + next build)
npx prisma db push    # (de dentro de apps/api) aplica mudanças de schema no Neon
npx prisma db pull    # reintrospecta o banco — ver seção "Banco de dados" abaixo
```

### Reiniciar os dev servers depois de mexer no schema Prisma

`npx prisma generate` falha com `EPERM: operation not permitted, rename ...
query_engine-windows.dll.node` se os dev servers estiverem rodando (o `tsx watch`
mantém o binário do engine aberto, no Windows não dá pra sobrescrever arquivo em uso).
Sequência que funciona:
1. Descobrir os PIDs das portas 3000/3001/3002: `netstat -ano | grep LISTENING`.
2. Matar os três: `taskkill //F //PID <pid> //T` pra cada um (a flag `//T` mata a
   árvore de processos filhos também — sem isso, sobra processo zumbi na porta).
3. `npx prisma generate` (agora sem lock).
4. `npm run dev` nas raiz de novo, em background.

## Banco de dados — Neon Postgres (⚠️ cuidado aqui, dobrado agora)

Connection string em `apps/api/.env` (`DATABASE_URL`) — **a mesma exata** em
`apps/pcp-api/.env` (schema Prisma é um arquivo só,
`apps/api/prisma/schema.prisma`; `apps/pcp-api` só gera o client a partir dele:
`"db:generate": "prisma generate --schema=../api/prisma/schema.prisma"`). O banco tem
**duas categorias de tabelas muito diferentes** que dividem o mesmo schema Prisma:

1. **Tabelas sincronizadas pelo ETL do TOTVS** (fora do nosso controle, um script Python
   externo que roda periodicamente): `transacoes`, `transacao_itens`, `produtos`,
   `prd_saldo`, `branches`, `operacoes`, `sync_state`, `etl_log`, `produto_analitico`,
   `ops_em_producao` (sync via `apps/api/src/services/totvs.service.ts
   syncEmProducao`, disparado do botão "Sincronizar com o TOTVS" na tela de
   Configurações PCP). **Nunca escrever nelas diretamente** — qualquer edição manual
   se perde no próximo sync.
2. **Tabelas da aplicação** (Prisma é a fonte de verdade): `users`, `metas`,
   `meta_niveis`, `meta_distributions`, `distribution_items`, `agrupamento_grupos`,
   `agrupamento_membros`, `pcp_relatorio_configs`, `pcp_cobertura_ideal_filiais`,
   `pcp_corte_minimo_skus`, `pcp_meta_classificacao`, etc. Seguem convenção camelCase
   no schema + `@map` pra snake_case no banco, com `createdById`/`createdAt` como
   padrão de auditoria.

### ⚠️ NOVO (achado em 16-18/08/2026): o banco é compartilhado entre branches git diferentes

Existe pelo menos mais uma pessoa (Marcelo) trabalhando num branch separado
(`limes/teste`) que **roda `db push` contra o MESMO banco Neon**, mesmo o código dele
nunca ter sido mergeado pra `main`. Ou seja: **o estado real do banco pode conter
tabelas/colunas que não existem no `main` local**, criadas por outro branch. Isso já
causou dois incidentes reais nessa sessão:

- `pcp_relatorio_configs` ganhou 3 colunas novas (`redistribuicao_lojas_destinatarias`,
  `redistribuicao_lojas_remetentes`, `redistribuicao_estoque_minimo`) e apareceu uma
  tabela nova inteira, `pcp_redistribuicao_jobs` (com linhas reais, criadas na hora —
  feature "Sugestão de Redistribuição" que existe em `limes/teste`
  (`22ec015 feat: add redistribuicao estoque minimo config`) mas nunca em `main`).
- Também apareceu `produto_em_producao` (1002 linhas, todas de uma leva só, dado
  parado há dias — parece teste abandonado de alguma sessão anterior, não uma tabela
  mantida; **não construir nada em cima dela**, ao contrário de `ops_em_producao` que
  é sincronizada de verdade).

**Regra de ouro reforçada**: sempre `npx prisma db pull` antes de `db push` (já era
regra, mas agora o motivo mais comum de drift não é só o ETL do TOTVS — é gente
mexendo no banco a partir de outro branch). Se `db push` avisar que vai **dropar uma
tabela não vazia** que você não reconhece, **não** rodar com `--accept-data-loss` — é
sinal de que outro branch criou aquilo. Adicionar o model ao seu schema (deixando o
código dele quieto, sem uso) em vez de tentar decidir sozinho se é seguro apagar.
`db pull` também **apaga comentários manuais** no schema.prisma que não vêm do banco —
depois de todo pull, conferir/restaurar os comentários de `OpsEmProducao` e dos models
`Pcp*` que a gente escreveu (view o histórico de diffs pra saber quais).

`produtos.product_sku` (string, PK) = referência+cor+tamanho combinados. `produtos.
product_code` (int) é uma chave **separada**, usada só nas queries de venda
(`transacao_itens.product_code`); `prd_saldo` já junta por `product_sku`. As duas
chaves coexistem no código por causa de como o TOTVS expõe os dados — não são
intercambiáveis. Confirmado nessa sessão: **cada `product_sku` tem exatamente 1
`product_code`** (não há vários tamanhos/cores compartilhando o mesmo `product_code`),
então cruzar dado agregado por `product_code` (ex: `ops_em_producao`, que só tem
`product_code`) com dado por `product_sku` (ex: `prd_saldo`) é seguro sem duplicar.

### `prd_saldo.stock_code` — o que cada valor significa (nunca documentado antes, descoberto nessa sessão)

`stock_code` não é um enum fixo com legenda em lugar nenhum do código — descobri
consultando `stock_description` direto no banco:

| stock_code | stock_description observada | uso |
|---|---|---|
| 1 | `FISICO` (às vezes `CSV Virtual`, aparenta ser fallback quando a descrição não veio do TOTVS) | estoque físico disponível na loja — filtrado explicitamente no "Acompanhamento por Linha" (`vendaDia.service.ts`); o módulo Gestão de Transferência, que também isolava esse código, foi removido (ver seção "Sessão 28-30/08/2026") |
| 5 | `SEGUNDA QUALIDADE` | estoque de segunda linha/avariado |
| 8 | `ATACADO` | estoque reservado pro canal atacado |

**Não existe stock_code de "trânsito"** (transferência entre lojas em andamento) em
lugar nenhum do dado sincronizado — se um relatório pedir "estoque físico + trânsito",
hoje só dá pra entregar o físico, e é preciso avisar explicitamente que trânsito não
está disponível (não inventar um número).

### Investigação 31/08/2026 — dá pra calcular "em trânsito" a partir de `transacoes`, mas o número não presta pra previsão de curto prazo

O usuário pediu pra construir "estoque em trânsito" (peças que saíram da Fábrica mas
ainda não chegaram na loja) achando que precisaria de uma API nova do TOTVS
(`transaction-receiving`) + um script Python separado. Investigação mostrou as duas
premissas erradas, mas achou um caminho real:

- **`transaction-receiving`** (`POST /api/totvsmoda/general/v2/transaction-receiving`)
  é sobre **conciliação de pagamento** (cardOperator, NSU, authorizationCode,
  paymentStatus, digitalWalletType) — recebimento de dinheiro, não de mercadoria. Não
  serve pra isso, nunca foi integrada no projeto.
- **Transferência entre filiais JÁ está nas tabelas sincronizadas** (`transacoes`/
  `transacao_itens`), só nunca tinha sido decodificada antes:
  - Saída de transferência: `operation_code` **510**/**1510** (Ceará) ou **512**
    (RN/MA) — sempre com `operations_type='S', operation_mode='2'` em
    `classificacao_operacoes`.
  - Entrada de transferência (do lado da loja que recebe): `operation_code` **3**/
    **1003** (Ceará) ou **5** (RN/MA).
  - **A filial contraparte vem codificada no `customer_code`**: `customer_code -
    110000000 = branch_code` da outra ponta (destino, na saída; origem, na entrada) —
    o mesmo offset "conta interna do TOTVS" já usado pra excluir cliente falso do
    faturamento (`customer_code >= 110000000`), só que aqui tem função estrutural real.
    Confirmado com 100% de correspondência real pra todas as 18 filiais (inclusive as
    fechadas). Vale pra transferência loja-a-loja também, não só Fábrica→loja.
  - **Não existe vínculo documento-a-documento** (`guide_code` e `origin_destination`
    em `transacoes` estão `NULL` em 100% das 853 mil linhas da tabela — colunas mortas,
    nunca preenchidas pelo ETL; a tabela `operacoes`, que tem uma coluna `invoice_data`
    JSON que poderia ajudar, está **vazia, 0 linhas**, diferente de
    `classificacao_operacoes` que é a que realmente é sincronizada e usada). Só dá pra
    calcular um **saldo agregado**: `SUM(saída pro destino) − SUM(entrada vinda de lá)`
    por `product_code`, não rastrear uma remessa específica.
  - ⚠️ **Corrigido em 06/10/2026**: `getTransferencias()` **não existe mais** em
    `raioX.service.ts` (a descrição antiga aqui estava desatualizada). O que existe é um
    campo chamado `transferencias` cujo valor é um **resíduo de reconciliação**
    (`estoqueFinal - estoqueInicial + vendas`), não transferência de verdade — por isso
    o frontend o exibe como **"MOV. ESTOQUE"** (`RaioXCompacto.tsx`, `raio-x/page.tsx`).
    Não confundir os dois nem tentar "completar" aquela função.
  - A classificação certa pra transferência é por `classificacao_operacoes`, não por
    lista de código fixo (convenção do projeto, ver `apps/api/src/config/constants.ts`):
    **saída = `operations_type='S' AND operation_mode='2'`** (35 operações),
    **entrada = `operations_type='E' AND operation_mode='2'`** (27 operações). Os códigos
    510/1510/512 e 3/1003/5 citados acima caem todos nesses dois pares.

**Por que não foi construído mesmo assim**: medindo o saldo pendente (saída − entrada)
por SKU/destino, **86% do total (7.129 de 8.266 peças) vem de lojas JÁ FECHADAS**
(Terrazo Shopping sozinha = 5.586, Mossoró = 1.380, Mart Moda = 93, Via Sul = 70) —
mercadoria que saiu antes de a loja fechar e cujo documento de entrada nunca foi
baixado no TOTVS, não é trânsito de verdade, é resíduo contábil que vai ficar "pendente"
pra sempre. E mesmo olhando só lojas abertas, **nenhum saldo pendente tem menos de 61
dias de idade** (nenhum caso de "saiu há alguns dias, ainda não chegou") — sugere que
transferência entre lojas ativas costuma ser baixada rápido no TOTVS na prática, e o
que sobra depois de 60+ dias é muito mais provável ser atraso de lançamento/reconciliação
do que caminhão parado na estrada. Ou seja: o dado sustenta um relatório de "peças com
baixa de transferência atrasada" (auditoria/limpeza de cadastro), mas **não** sustenta
"estoque futuro previsto" como foi pedido — usar pra previsão de curto prazo daria
número enganoso. Decisão do usuário: não construir por enquanto, revisitar só se
aparecer uma fonte de dado melhor (ex: TOTVS expor status de romaneio/guia de
transferência em aberto de verdade).

A maioria dos relatórios do PCP (Relatório Base, Curva ABC, Análise de Grade, Venda do
Dia, Sugestão de Produção) **não filtra por `stock_code`** — soma todos os códigos
juntos como "estoque líquido" (inclui físico + segunda qualidade + atacado misturados).
Só a Gestão de Transferência e o novo "Acompanhamento por Linha" isolam
`stock_code = 1` de propósito. Ter isso em mente ao comparar números entre relatórios
diferentes — "estoque" não significa sempre a mesma coisa no projeto todo.

### `prd_saldo` é um changelog, não um snapshot diário completo

Confirmado nessa sessão: uma linha nova só é gravada quando o valor de estoque daquele
`product_sku + branch_code + stock_code` **muda** (não é uma captura completa de todo o
catálogo todo dia). Um SKU cujo estoque não muda desde 2019 vai ter `captured_at` de
2019 pra sempre — isso é o valor correto (não é dado "velho"/inválido), só significa que
nada mudou desde então. O padrão certo pra pegar "o estoque como estava numa data X do
passado" é:

```sql
SELECT DISTINCT ON (product_sku, branch_code)
  product_sku, branch_code, stock
FROM prd_saldo
WHERE stock_code = 1 AND captured_at <= 'X'::date + interval '1 day'
ORDER BY product_sku, branch_code, captured_at DESC
```

— pega a última linha conhecida **até aquela data**, exatamente o mesmo princípio já
usado pra "estoque atual" (que é a mesma query sem o corte de data). Isso está correto
e validado (ver seção de pendência abaixo), mas ainda não sabemos se o histórico é
**completo** desde sempre ou se a granularidade de captura foi ficando mais fina com o
tempo — ver "Pendência aberta" no fim deste arquivo.

## Regras de negócio — Comercial

- **Faturamento é sempre líquido** (venda − devolução). Devolução é identificada pelo
  `operation_code` da transação: os códigos com `operationMode=3`/`operationsType=E` na
  API TOTVS (`DEVOLUTION_OPERATIONS` em `apps/api/src/config/constants.ts`) entram com
  sinal negativo no cálculo, não são simplesmente excluídos. Existe também
  `EXCLUDED_OPERATIONS` — operações que não são venda nem devolução (ajuste, etc.),
  essas sim são 100% ignoradas. O ETL grava `net_value`/`quantity` de devolução com o
  sinal que o TOTVS mandou de forma **inconsistente** (às vezes positivo, às vezes já
  negativo) — o padrão certo é sempre `CASE WHEN devolucao THEN -ABS(valor) ELSE valor
  END` (nunca assumir que já vem com sinal certo). Ver
  `FATURAMENTO_COM_SINAL`/`PECAS_COM_SINAL` em `vendas.service.ts` (Comercial) e
  `VALOR_COM_SINAL`/`QUANTIDADE_COM_SINAL` em `relatorioBase.service.ts` (PCP) — mesmo
  padrão, duplicado entre os dois apps de propósito.
- **Filial Fábrica (branch_code 2) nunca entra em relatório de loja** — é produção, não
  ponto de venda. "Canal" em relatórios PCP mais recentes (Raio X, Acompanhamento por
  Linha) segue essa mesma lógica: `varejo` = todas as lojas exceto Fábrica, `atacado` =
  só Fábrica, `todos` = as duas juntas.
- **Projeção de faturamento** usa "caminhada do ano anterior": `caminhada = fat.
  parcial_ano_anterior / fat.mês_completo_ano_anterior`; `projeção = fat.atual /
  caminhada`.
- **Cliente novo** = `customer_code` cuja primeira compra válida em toda a história caiu
  dentro do período do relatório.
- **`customer_code >= 110000000` = conta interna do TOTVS** (transferência, ajuste,
  amostra), nunca cliente real — sempre excluir de cálculo de faturamento/cliente.
- Cálculos centralizados em `apps/api/src/services/vendas.service.ts` (Comercial) —
  qualquer métrica nova de venda deveria reusar os fragmentos SQL de lá
  (`SALE_OPERATION_FILTER`, `DEVOLUTION_SIGN`, `STORE_BRANCH_FILTER`) em vez de
  duplicar a lógica de filtro. Pro módulo PCP, o equivalente é
  `apps/pcp-api/src/services/relatorioBase.service.ts` (`SALE_OPERATION_FILTER`,
  `QUANTIDADE_COM_SINAL`, `VALOR_COM_SINAL`, `OPERACAO_JOIN`,
  `PCP_ESTOQUE_LIQUIDO_SKU_FILTER`, `FABRICA_BRANCH_CODE`).

## Módulos e permissões

A sidebar (`apps/web/src/components/layout/Sidebar.tsx`) é organizada em **módulos**:
- **Comercial** (`comercial`): Dashboard de Vendas + Metas
- **PCP** (`pcp`): "Agrupamento de Cores" (configurador genérico pra juntar variações de
  cor de produto num grupo, sem alterar dado do TOTVS)
- **PCP Serviço** (`pcp_servico`): todos os relatórios pesados do PCP (Visão Geral,
  Estoque Sem Giro, Análise de Grade, Curva ABC, Raio X, Em Produção, Gestão de
  Transferência, Performance Coleção, Venda do Dia, Sugestão de Produção,
  Acompanhamento por Linha) + a tela de Configurações PCP

Cada usuário tem `moduleAccess: string[]` (além de `branchCodes` pra loja e `role`
admin/gerente). **Isso é reforçado em dois lugares, não só um**:
1. Frontend: `apps/web/src/app/(dashboard)/layout.tsx` bloqueia navegação direta pra
   rota de um módulo sem acesso (usa `apps/web/src/lib/permissions.ts` como mapa
   rota→módulo — `{ prefix: '/relatorios', module: 'pcp_servico' }` cobre qualquer rota
   nova criada sob `/relatorios/*` automaticamente, sem precisar editar esse arquivo).
2. Backend: middleware `moduleAccess(key)` em `apps/api/src/middleware/auth.middleware.ts`
   (e a cópia equivalente em `apps/pcp-api/src/middleware/auth.middleware.ts` — **são
   dois arquivos diferentes, sem import cruzado entre os apps**), aplicado via
   `router.use(authMiddleware, moduleAccess('pcp_servico'))` no topo das rotas do
   módulo. Rotas de **cadastro/config** dentro de `apps/api` (não `pcp-api`) tendem a
   usar `adminOnly` em vez de `moduleAccess` (ver `pcpConfig.routes.ts`,
   `metaClassificacao.routes.ts`) — mais restritivo, só admin pode escrever.

**Atenção**: as rotas de `vendas.routes.ts` e `metas.routes.ts` (módulo Comercial) ainda
**não têm nenhuma proteção de auth** — são públicas hoje. É uma lacuna conhecida, não
fechada ainda porque exigiria atualizar todo o frontend pra mandar token nessas chamadas
(hoje `vendasApi`/`metasApi` fazem GET sem token). Se for mexer nisso, seguir o mesmo
padrão de `produtos.routes.ts`/`agrupamentos.routes.ts` (que já têm `moduleAccess('pcp')`
aplicado corretamente, incluindo update do frontend pra passar token nos GETs).

## "Novidades" (changelog dentro do app)

A tela `/inicio` tem um carrossel "Novidades" que lê arquivos Markdown de
`apps/api/content/entregas/*.md` (frontmatter simples: `title`, `date`, `modulo`) via
`GET /api/entregas` — **sem banco de dados**. Fluxo esperado: toda vez que uma sessão de
desenvolvimento terminar uma entrega **e o usuário pedir pra publicar/subir pro git**,
criar um novo `.md` nessa pasta resumindo o que mudou e como usar — nenhuma mudança de
código é necessária, a rota já pega o arquivo novo automaticamente. **Não criar esse
arquivo enquanto o trabalho ainda está sendo testado/ajustado em localhost** — o usuário
já pediu explicitamente pra não "publicar" trabalho em progresso; o changelog é parte
do ato de publicar, não do ato de construir.

## Convenções de UI

- Sem biblioteca de ícones — todo ícone é SVG inline copiado no próprio componente
  (padrão Heroicons-outline). Manter esse padrão em vez de adicionar `lucide-react` etc.
- Cores da marca em `apps/web/src/app/globals.css` (`--bbtk-red`, `--bbtk-green`,
  `--bbtk-purple`, `--bbtk-orange`, `--bbtk-turquoise`, `--bbtk-yellow`, `--bbtk-pink`,
  `--bbtk-blue`). **Essa paleta falha no validador de contraste/CVD da skill de
  dataviz** (verde/laranja/turquesa/amarelo com baixo contraste, roxo "acinzentado") —
  já sabemos disso, e por pedido explícito do usuário **não mexemos na paleta**; a
  saída é sempre rótulo direto nos dados (não depender só da cor) em vez de recolorir.
- `cn()` em `apps/web/src/lib/utils.ts` é um joiner simples (`classes.filter(Boolean).
  join(' ')`), **não é tailwind-merge** — duas classes conflitantes (`w-full` + `w-36`)
  não se resolvem pela ordem no JSX, e sim pela ordem que o Tailwind gera no CSS final
  (imprevisível sem testar). Se precisar de largura customizável num componente, aplique
  a classe recebida OU o default, nunca as duas juntas (`className || 'w-full'`, não
  `cn('w-full', className)`) — já causamos um bug de layout real com isso.
- Gráficos: antes de criar/mexer em qualquer gráfico, usar a skill `dataviz`. Barras
  horizontais categóricas (tipo "Vendas por Filial") tiveram bug real e persistente com
  o eixo de categoria do Recharts (rótulo sumindo, barra não escalando) — a solução que
  funcionou foi abandonar o Recharts pra esse caso e desenhar a lista de barras em
  HTML/CSS puro (`RankedBarList` em `apps/web/src/components/charts/BarChart.tsx`).
- Tabelas com cabeçalho ordenável: cada tela do PCP tem sua própria cópia local do
  componente `ThSortPcp` (cabeçalho clicável, ▲/▼ roxo quando ativo) — **não é um
  componente compartilhado**, apesar de várias telas terem literalmente o mesmo código.
  Copiar o padrão de uma tela existente (ex: `pcp-performance-colecao/page.tsx`) em vez
  de tentar extrair/reusar um componente, pra não introduzir uma dependência entre
  páginas que hoje são independentes.
- Padrão de export Excel: `apps/web/src/lib/exportExcel.ts` (`exportToExcel`), 100%
  client-side via `XLSX.writeFile`. Existem também `exportCsv.ts`/`exportXlsx.ts`
  (variantes mais antigas) — `exportExcel.ts` é o padrão dominante, usar esse pra
  telas novas.
- Padrão de upload de arquivo: só existe em dois lugares — Agrupamento de Cores
  (`agrupamentos.routes.ts`, `multer` + parsing manual de CSV linha a linha, sem lib) e
  Corte Mínimo por SKU (`pcpConfig.routes.ts`, mesmo padrão). Reusar esse padrão
  (`multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })`
  + `uploadFile()` helper em `apps/web/src/lib/api.ts`) pra qualquer upload novo — não
  existe lib de CSV/Excel no backend (`csv-parse`, `xlsx` etc.), é sempre split manual
  de string.
- Modais: `apps/web/src/components/ui/Modal.tsx` (`isOpen`/`onClose`/`title`/`size`).

## Deploy (Render)

`render.yaml` na raiz descreve os serviços (blueprint). Pontos que já causaram
retrabalho:
- A API lê `PORT` (padrão do Render) com fallback pra `API_PORT` (uso local) — nunca só
  `API_PORT` sozinho, senão a plataforma não consegue rotear pro processo.
- `express` está pinado em v4 (`package.json`) mas em algum momento `@types/express`
  puxou v5 e duplicou no lockfile — isso **quebrava silenciosamente o `tsc` de
  produção** (o `tsx watch` do dev não denunciava, só faz transpile). Corrigido via
  `overrides` no `package.json` raiz forçando `@types/express` numa única versão em
  toda a árvore. Se voltar a acontecer erro estranho de tipos em `req.params`/rotas,
  suspeitar disso primeiro (`npm ls @types/express` deve mostrar só uma versão).
  Depois de mexer em overrides, **sempre apagar `node_modules` + `package-lock.json` e
  reinstalar do zero** — instalação incremental não reaplica overrides direito.
- No Render, `apps/web` precisa ser criado como **Web Service** (roda `next start`),
  nunca "Static Site" — o app usa client-side routing/auth, `output: 'export'` até
  funcionaria (todas as rotas já saem `○ Static` no build) mas não foi ativado ainda.
- `NEXT_PUBLIC_API_URL` (e o equivalente pro `pcp-api`) é *inlined* no build do Next —
  só dá pra setar depois que o serviço da API já tem URL definida, e mudar essa env var
  exige **redeploy manual** (não é runtime).
- Segredos (`DATABASE_URL`, `JWT_SECRET`, `TOTVS_*`) nunca vão pro `render.yaml`
  (`sync: false` — preenchidos manualmente no dashboard do Render).
- **Não publicar/dar `git push` sem o usuário pedir explicitamente.** Trabalho em
  progresso fica local (commitado ou não) até o usuário dizer algo como "publica" /
  "sobe pro git" / "faz um merge com a versão pública". Quando pedir, confirmar antes
  se é só `origin` ou também `limes` (ver seção de branches abaixo).

## Git — múltiplos remotes, múltiplos branches, cuidado redobrado

```
origin -> https://github.com/LucasCodeWorka/bbttk.git   (remote "principal" do usuário)
limes  -> git@github.com:limes-ia/bebetenkite.git        (remote compartilhado com o time)
```

`main` local acompanha `origin/main`. Sessões anteriores já sincronizaram `main` com
`limes/main` (merge, sem conflito — os dois remotes ficam iguais depois de um push
duplo). **`limes/teste` é outra história**: é o branch de trabalho do Marcelo,
divergiu de `main` logo depois do commit `87a82e8` e ganhou funcionalidade própria
("Sugestão de Redistribuição") que **nunca foi mergeada em `main`** — se o usuário
mostrar um print do app "online" com menu diferente do que você vê em localhost
(`main`), a explicação mais provável é que ele está olhando o deploy do `limes/teste`,
não um bug seu. Antes de assumir que algo foi "apagado", rodar
`git log --oneline limes/teste -10` e comparar com `git log --oneline main -10` — se o
`teste` tem commits que `main` não tem (ou vice-versa), é isso.

Ao publicar (só quando pedido): sempre `git fetch` os dois remotes primeiro, `git
merge origin/main` e `git merge limes/main` na sua branch antes de dar push — mesmo
que geralmente dê "Already up to date", é a forma de garantir que não tem nada novo
publicado por outra sessão/pessoa desde a última sincronização.

Script utilitário `apps/api/scripts/mint-test-token.ts` (não commitado, fica solto no
working tree) gera um JWT de admin válido pra testar rotas autenticadas via curl sem
precisar logar pelo navegador: `npx tsx scripts/mint-test-token.ts` (de dentro de
`apps/api`) imprime o token no stdout.

Arquivos soltos não commitados na raiz de `apps/web` (CSVs de metas importadas,
`RESUMO_ENTREGAS_23-07.md`, `data.csv`) são resíduo de imports pontuais de sessões
anteriores — não são parte do código, não staged em nenhum commit, deixar quietos a
menos que o usuário peça pra limpar.

## Integração TOTVS

Credenciais em `apps/api/.env` (`TOTVS_*`). O tenant `bebetenkiteapiv2` teve o módulo
**General V2** (transações, operações, devoluções) bloqueado pela TOTVS até 07/07/2026 —
se voltar a dar 403 em `totvs.service.ts` ou nas queries de venda pararem de atualizar,
esse é o primeiro suspeito (contatar suporte TOTVS, não é bug nosso). O catálogo de
cores do TOTVS (`/product/v2/colors/search`) já tem um campo `groupName` próprio de
classificação — **não é o mesmo conceito** do nosso "Agrupamento de Cores".

`dim_vendedor.dados_api` (JSON sincronizado do TOTVS) tem um campo
`branchInformations: [{branchCode, isInactive, sellerTypeCode, sellerTypeDescription,
...}]` com o **vínculo oficial** de cada vendedora com uma ou mais filiais — descoberto
e usado nessa sessão pra listar vendedoras candidatas a meta por loja independente de
terem vendido lá ou não (antes a lista vinha de quem tinha vendido nos últimos 3 meses,
o que escondia vendedora nova). Pode trazer código "técnico" (ex: canal online da
mesma pessoa, tipo "NAYANDRA ONLINE") que não deveria virar meta — não filtrar isso por
heurística de nome, deixar o usuário desconsiderar manualmente na tela.

Swagger da API: `{TOTVS_API_URL}/general/v2/swagger/v1/swagger.json` (útil pra
descobrir endpoints/campos sem depender de documentação externa).

### Bugs reais já encontrados e corrigidos (não repetir)

1. **`customer_code >= 110000000` = conta interna do TOTVS**, nunca cliente real —
   sem filtrar, inflava faturamento em ~R$22,8 milhões em todo o histórico.
   ⚠️ **Atualizado em 06/10/2026**: `REAL_CUSTOMER_FILTER` **não existe mais** em
   `vendas.service.ts` — foi removido de propósito, e a justificativa está preservada
   num comentário longo no próprio arquivo (procurar "HISTÓRICO" perto do topo): a
   heurística virou redundante e **ativamente prejudicial** depois que a classificação
   passou a ser dinâmica, porque transferência/ajuste nunca tem
   `operations_type='S' + operation_mode='4'` e já é excluída pelo `IS_VENDA` sozinho.
   O `apps/api` (Comercial) hoje **não filtra `customer_code`**. O corte literal
   `customer_code < 110000000` ainda aparece em `redistribuicao.service.ts` e
   `vendaDesconto.service.ts` (3x cada) — ali sem guarda de `IS NULL`, e como a coluna é
   `BigInt?`, linha com NULL some silenciosamente.
2. **Filtro de status errado**: `t.status != 6` (só exclui cancelada) em vez de
   `t.status = 4` (exige "Atendida"). Enum completo (`StatusTransactionType`): 1=Em
   andamento, 2=Liberado p/ faturamento, 3=Parcialmente atendida, 4=Atendida,
   5=Encerrada, 6=Cancelada, 7=Pré-faturada, 8=Bloqueada p/ faturamento, 9=Recusada,
   10=Agrupada. Corrigido: todo `AND t.status != 6` virou `AND t.status = 4`.
3. **Dias inteiros faltando no ETL**: `etl_log` marca `SUCCESS` mesmo quando a API do
   TOTVS devolve 0 transações por erro transitório, e a lógica de retomada
   (`actual_start = last_date + 1`) nunca revisita um dia já marcado `SUCCESS` — dia
   fica faltando pra sempre. **Estrutural, ainda não corrigido no script Python** (fora
   deste repo). Fix recomendado: janela deslizante dos últimos ~14-30 dias a cada
   execução (upsert já é `ON CONFLICT DO UPDATE`, reprocessar é seguro).
4. **Itens faltando dentro de transações que já existem**: transação sincronizada mas
   nem todos os itens (TOTVS recebeu correção depois que o ETL já capturou aquele dia).
   Mesma causa raiz do item 3.
5. **Sinal de devolução inconsistente** no `net_value`/`quantity` — ver seção "Regras
   de negócio" acima, sempre usar `CASE WHEN devolucao THEN -ABS(valor) ELSE valor END`.
6. **Ranking "Itens Mais Vendidos" descartava 86% das vendas** por causa de filtro
   `is_finished_product` com dado incompleto no cadastro — corrigido, bate 100% com
   PRDFL074.
7. **Backfill manual de transação**: ao regravar itens de uma transação, **sempre
   `DELETE FROM transacao_itens WHERE branch_code=... AND transaction_code=...`** antes
   de reinserir — upsert por `item_index` sozinho deixa linha órfã quando a transação
   tem menos itens agora do que numa sincronização anterior.

## Contas e acesso

Login do admin (`admin@bebetenkite.com`) já existia no banco antes de qualquer sessão
com IA — senha com hash bcrypt, não recuperável, só resetar via tela de Usuários
(botão "Redefinir Senha", só funciona logado como admin).

## Dashboard Comercial — Comparativo por Filial e Comissões (27/07/2026)

Ajustes pontuais pedidos pelo usuário na tabela "Comparativo por Filial"
(`apps/web/src/app/(dashboard)/dashboard/page.tsx`) e na tela de Comissões
(`apps/web/src/app/(dashboard)/comissoes/page.tsx`). Nenhum desses commits mexe no
módulo PCP.

### Ordem de colunas do Comparativo por Filial

Sequência pedida explicitamente pelo usuário (cabeçalho, linhas, linha de TOTAL e
export CSV têm que ficar sempre sincronizados nessa mesma ordem — os 4 lugares têm 43
colunas cada, contar depois de qualquer mudança pra conferir que bateu):

```
Filial, Meta, Faturamento, % Meta, Fat. Ant., Var % Faturamento, %TT, Projeção, PA,
PA Ant., Var % PA, TM, TM Ant., Var % TM, Meta Dia, Peças, Peças Ant., Débito p/ Meta,
%TT Peças, Var % Peças, PM, PM Ant., Var % PM, TM Cliente, TM Cliente Ant.,
Var % TM Cliente, PAC, PAC Ant., Var % PAC, Clientes, Clientes Ant., Var % Clientes,
Atendimento, Atend. Ant., Var % Atendimento, Devoluções, Qtde Dev, % Dev, % CN,
Clientes Novos, Faturamento CN, Vs Ano Ant., Bate Meta
```

"Débito p/ Meta" é uma coluna nova (não existia antes) — quanto falta em R$ pra bater a
meta (`meta.valor - atual.faturamento`, nunca negativo), calculada no frontend
(`debitoMeta` em `LinhaComparativo`), não vem da API.

### Ordenação por Filial/Loja usa o código, não o nome

Clicar no cabeçalho "Filial" (Dashboard) ou "Loja" (Comissões) ordena por `branch_code`
(ID da loja), não mais alfabeticamente pelo nome — pedido explícito do usuário. Se
algum dia adicionar um terceiro lugar com uma coluna de filial ordenável, seguir o
mesmo padrão (`getSortValueLinha`/equivalente retornando `branch_code` em vez do nome
quando a chave de ordenação for a de filial).

### Botões de rolagem horizontal

A tabela Comparativo por Filial tem 43 colunas — scroll horizontal é obrigatório.
Adicionamos duas setas (‹ ›) sobre o card, fora da área da tabela em si (no padding do
`Card`, não em cima de nenhuma coluna), que chamam `scrollBy` num container cujo `ref`
é exposto pelo componente `Table` (`apps/web/src/components/ui/Table.tsx`, agora usa
`forwardRef` no wrapper com `overflow-x-auto`). Botões simples: só a setinha em cinza
claro, sem fundo/borda — já tentamos com fundo circular preto e o usuário achou muito
chamativo/em cima das colunas.

### Fábrica dividida em 3 linhas — meta e débito usam o faturamento combinado

A Fábrica (`branch_code=2`) já era dividida em 3 linhas por canal de operação antes
dessa sessão (`getVendasFabricaDividida` em `apps/api/src/services/vendas.service.ts`):
"FABRICA" (código sintético `2`), "FABRICA - DELIVERY" (`2.1`) e "FABRICA - ATACADO"
(`2.3`), classificadas via `classificacao_operacoes.description ILIKE '%DELIVERY%'` /
`'%ATACADO%'`. Isso já era assim, não é código novo.

**O que não funcionava**: só existe UMA meta cadastrada no banco pra Fábrica (presa no
`branch_code=2` puro, a tabela `metas` não tem infraestrutura pra separar meta por
operação/canal). Antes desse fix, a linha "FABRICA" sozinha comparava seu faturamento
parcial (só a fatia que não foi classificada como Delivery/Atacado) contra a meta
inteira, o que fazia o %Meta parecer catastrófico (ex: -99,8%), enquanto as linhas
DELIVERY/ATACADO — que concentram a maior parte do faturamento real — ficavam sem meta
nenhuma (`%Meta = "-"`).

**Fix** (`apps/api/src/routes/vendas.routes.ts`, rota `/comparativo-ano`): pra essas 3
linhas especificamente (`FABRICA_DIVIDIDA_CODES = [2, 2.1, 2.3]`), `meta.valor`,
`meta.pct` e `meta.meta_dia` passam a ser calculados sobre o **faturamento somado das
3 linhas** e **repetidos igualmente nas 3** — representa melhor a realidade (é uma
meta só, da fábrica inteira, só exibida em 3 linhas por canal). O "Débito p/ Meta" do
frontend segue a mesma lógica (usa o faturamento combinado pras 3 linhas, não o
faturamento individual de cada uma). Todas as outras filiais continuam com o cálculo
de sempre (meta individual contra faturamento individual).

**Não mexemos ainda**: "Bate Meta" e "Vs Ano Ant." (que vêm de `getProjecaoFiliais`,
uma fonte de dado separada da meta) continuam usando a projeção individual de cada
linha — não sabemos se a projeção também precisa desse mesmo tratamento combinado, não
foi pedido ainda.

## Módulo PCP — Configurações e Ordenação (02/08/2026)

### Configuração do Estoque Sem Giro

Tela de configuração dedicada pro relatório "Estoque Sem Giro" em
`/pcp/estoque-sem-giro-config` (⚠️ isso foi consolidado depois — hoje é uma aba dentro
de `/pcp/configuracoes`, ver `pcp/configuracoes/page.tsx`, `secaoAtiva` state — a rota
separada mencionada aqui não existe mais, mas os campos de config abaixo continuam
válidos).

**Campos configuráveis:**
- **Período de maturação (dias)**: Produtos que chegaram nas lojas há menos tempo que
  este período não são sinalizados como "sem giro". Default: 30 dias. Permite valor 0
  para desabilitar o filtro completamente.
- **Limiares de cobertura**: Define os limites verde (estoque baixo) e vermelho
  (estoque alto) em meses de cobertura.

**Infraestrutura:**
- Backend: `pcpConfig.service.ts` — `getEstoqueSemGiroConfig()` e
  `updateEstoqueSemGiroConfig()`
- API Routes: `GET/PUT /api/pcp-config/estoque-sem-giro` em `pcpConfig.routes.ts`
- Frontend: `apps/web/src/lib/api.ts` — `PcpEstoqueSemGiroConfig` interface e métodos
- Schema: campo `maturacaoDias` em `pcp_relatorio_configs`

**Aplicação no relatório:**
O período de maturação é aplicado em `apps/pcp-api/src/services/estoque.service.ts`
via CTE `primeira_entrada` que identifica a primeira entrada de cada produto por filial
(usando `operations_type = 'E'` da tabela `classificacao_operacoes`) e filtra produtos
onde `CURRENT_DATE - primeira_entrada >= maturacaoDias`.

### Abreviações de Filiais

Campo `abrev` (VARCHAR(10)) na tabela `branches` pra exibir identificadores curtos
(3 letras) em relatórios em vez de códigos numéricos ou nomes completos:

```
1: IGU (Iguatemi), 2: FAB (Fábrica), 3: BEN (Benfica), 4: DEL (Del Paseo),
5: PDL (Pátio Dom Luís), 6: SOB (Sobral), 7: PAR (Parangaba), 8: RIO (Riomar),
9: EXP (Expansão), 11: RPK (Riomar PK), 12: MES (Messejana), 13: EUS (Eusébio),
17: NOR (North Shopping)
```

Aplicado em `apps/pcp-api/src/services/estoque.service.ts` via
`COALESCE(b.abrev, b.description, ...)` priorizando a abreviação quando disponível.

### Ordenação Universal em Tabelas PCP

Ordenação clicável por cabeçalho em todas as colunas das principais tabelas do módulo
PCP. Padrão de implementação consistente (cada tela tem sua própria cópia local do
`ThSortPcp`, ver seção "Convenções de UI" acima):

```typescript
// Estado de ordenação
const [sortKey, setSortKey] = useState<string | null>('defaultColumn');
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

// Handler de clique
function handleSort(key: string) {
  if (sortKey === key) {
    setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
  } else {
    setSortKey(key);
    setSortDir('desc');
  }
}

// Dados ordenados
const sortedData = useMemo(() => {
  if (!sortKey) return data;
  return [...data].sort((a, b) => {
    const aVal = getSortValue(a, sortKey);
    const bVal = getSortValue(b, sortKey);
    const cmp = typeof aVal === 'string'
      ? aVal.localeCompare(bVal as string)
      : Number(aVal) - Number(bVal);
    return sortDir === 'asc' ? cmp : -cmp;
  });
}, [data, sortKey, sortDir]);
```

Telas com ordenação universal completa: Estoque Sem Giro (`pcp-novo/page.tsx`), Análise
de Grade (`pcp-analise-grade/page.tsx`, tabela de referências + heatmap com estados de
ordenação independentes), Relatório Base (`pcp-relatorio-base/page.tsx`, 25 colunas
fixas + N×3 dinâmicas por filial), Curva ABC (`pcp-curva-abc/page.tsx`, cabeçalho
sincroniza com dropdown de ordenação existente). Visão Geral (matriz estática) e
Agrupamento de Cores (wizard) não fazem sentido ordenar, ficaram de fora de propósito.

---

## Sessão 16-18/08/2026 — o que foi construído (para dar continuidade)

Trabalho concentrado no módulo Comercial (Cadastro de Metas) e PCP (três relatórios
novos). Tudo abaixo já está implementado, testado com dado real via curl, `tsc` limpo
nos três apps, e commitado/publicado em `main` (origin + limes), **exceto onde dito o
contrário**.

### Comercial — Cadastro de Metas (`apps/web/src/components/metas/CadastroMetaModal.tsx`)

- Listagem (`apps/web/src/app/(dashboard)/metas/page.tsx`): checkbox por linha +
  "selecionar todas" + botão "Excluir selecionadas (N)" — exclusão em lote via
  `Promise.all` de chamadas individuais à rota `DELETE /api/metas/:id` já existente
  (sem rota nova no backend, confirmado seguro porque `Meta` não tem FK de entrada/
  saída no schema).
- O modal "Cadastrar Metas" agora reseta 100% do estado toda vez que abre (antes só
  resetava parte — `vendedoresPorLoja`, `tipoLojas` etc. ficavam "em cache" de sessão
  anterior). Reset feito dentro do mesmo `useEffect([isOpen, ano, mes])` que já existia.
- Lista de vendedoras por loja dentro do modal: trocou de "quem vendeu nos últimos 3
  meses" pra "quem está oficialmente vinculada à filial no TOTVS"
  (`dim_vendedor.dados_api.branchInformations`, ver seção TOTVS acima) — nova função
  `getVendedoresVinculadosLoja` em `apps/api/src/services/vendas.service.ts`.
- Botão "Desconsiderar" por vendedora dentro da loja (mesmo padrão do botão "Remover"
  que já existia na aba Volante) — remove do pool e redistribui o valor entre as
  restantes.
- Gerente pode "Assumir o restante" (em vez do valor cheio da loja) — dropdown novo
  ao lado do texto informativo. **Achado e corrigido nessa sessão**: a validação de
  backend (`salvarDistribuicaoCompleta` em `metas.service.ts`) exigia que a soma das
  vendedoras batesse exatamente com a meta da loja, sem saber desse modo novo —
  bloqueava salvar. Corrigido: com gerente em modo "restante", só é erro se a soma
  **ultrapassar** a meta (sobra é esperada, vira a meta da gerente).

### PCP — "Sugestão de Produção" (`/relatorios/sugestao-producao`)

Relatório de rede inteira (sem quebra por loja): compara estoque atual + OPs pendentes
contra venda média, sugere produção arredondada pelo corte mínimo de cada SKU. Backend:
`apps/pcp-api/src/services/sugestaoProducao.service.ts`. Config nova em Configurações
PCP (aba "Sugestão de Produção"): período de venda, cobertura alvo, corte mínimo padrão
e por SKU (cadastro individual ou upload CSV `SKU;VALOR`) — tabela nova
`PcpCorteMinimoSku`, campos novos em `PcpRelatorioConfig`
(`coberturaAlvoMeses`/`corteMinimoDefault`).

**Limitações conhecidas, avisadas na própria tela**: não separa embalagem/subproduto
do cálculo (usa o mesmo filtro de estoque líquido do resto do PCP); não filtra "SKU
técnico" (ex: canal online) por heurística.

### PCP — "Acompanhamento por Linha" (`/relatorios/acompanhamento-linha`)

**Importante sobre a navegação**: essa tela **NÃO é uma aba dentro de "Venda do Dia"**
— foi assim numa primeira versão e o usuário pediu pra separar de novo, porque achou
confuso ter duas coisas diferentes escondidas atrás do mesmo nome de menu. Hoje são
duas páginas/rotas totalmente independentes:
- `/relatorios/venda-dia` — o relatório original, intocado (venda por loja, dia/
  semana/mês, sem comparação com ano anterior).
- `/relatorios/acompanhamento-linha` — página nova, item **próprio e primeiro** no
  menu Relatórios (`apps/web/src/components/layout/Sidebar.tsx`).

Backend compartilhado (mesmo arquivo, `apps/pcp-api/src/services/vendaDia.service.ts`,
função `getAcompanhamentoDiario` — não confundir com `getVendaDia`, que é a de
`/venda-dia`) porque reaproveita helpers, mas as rotas/páginas de frontend são
independentes.

Funcionalidade: venda em R$ e peças por categoria/linha/gênero, comparada com o mesmo
intervalo de dias do ano anterior (crescimento %), participação no total, **cobertura
sempre em MESES** (nunca dias — pedido explícito do usuário: "cobertura sempre em mês
primeiro de tudo"), tanto atual quanto do ano anterior (usando o estoque e a venda de
como estavam **naquele período histórico**, não o de hoje), estoque físico
(`stock_code=1`), peças em Ordem de Produção aberta. Filtro de canal (varejo/atacado/
todos), loja, e **filtro de data livre** (de/até — o período do ano anterior sempre
acompanha automaticamente, mesmo intervalo um ano antes, nunca escolhido separado).

Modal "Cadastrar Metas" na própria tela: cadastro de meta mensal por
categoria/linha/gênero/coleção (tabela nova `PcpMetaClassificacao`, backend em
`apps/api/src/services/metaClassificacao.service.ts` +
`apps/api/src/routes/metaClassificacao.routes.ts`, rotas admin-only). **Ainda não
conectado à tabela do relatório** — dá pra cadastrar e listar/remover meta, mas a
tabela de linhas do relatório ainda não mostra "Meta"/"Desvio"/"% Atingido" cruzando
com a venda real. Próximo passo natural se o usuário pedir.

Colunas "COB A.A." (dias) e "EVOL COB" existiram numa versão intermediária e foram
removidas a pedido do usuário ("tira") — não recriar em dias, só em meses, e sem a
coluna de evolução (delta) a menos que peçam de novo.

## ✅ ENCERRADA (06/10/2026) — cobertura do ano anterior: era lacuna de captura (hipótese 2)

**Resolvido.** A hipótese 2 abaixo está confirmada com dado; a 1 está descartada. Medição
direta no `prd_saldo` (mesma query do relatório, só mudando o corte de data):

| Posição | SKUs com saldo | Peças |
|---|---|---|
| 30/09/2025 | 1.524 | **10.901** |
| 30/09/2026 | 6.040 | **263.812** |

A causa é a densidade de captura do ETL, que mudou de patamar em 2026 — linhas gravadas
por ano em `prd_saldo`: `stock_code=1` ficou em ~43 mil/ano de 2019 a 2025 e saltou pra
**113 mil em 2026**; `stock_code=5` saiu de ~1 mil/ano pra **70 mil**; `stock_code=8` de
~3 mil/ano pra **79 mil**. Ou seja: o estoque histórico não foi registrado por completo,
não é que a rede tivesse 24x menos estoque (rede nenhuma multiplica estoque por 24 em 12
meses). **Não foi preciso comparar com relatório nativo do TOTVS** — a própria assimetria
de volume de captura já decide.

**Consequência prática**: `coberturaMesesAnoAnterior` (e qualquer métrica que dependa de
estoque histórico anterior a 2026) é um **piso**, sempre menor que o real. Serve pra
tendência entre categorias no mesmo período, não como valor absoluto. Decisão do usuário:
**manter a coluna com aviso visível** (asterisco no cabeçalho + nota abaixo da tabela +
ressalva no cabeçalho do Excel) em vez de remover — ver
`apps/web/src/app/(dashboard)/relatorios/acompanhamento-linha/page.tsx`. Não tentar
"corrigir o cálculo": a fórmula sempre esteve certa, o insumo é que é incompleto.

<details>
<summary>Investigação original (mantida pra referência)</summary>

### ⚠️ Pendência aberta — cobertura do ano anterior parece alta demais, causa não confirmada

Ao construir a comparação de cobertura ano-a-ano no "Acompanhamento por Linha", os
números do ano anterior deram consistentemente muito mais baixos que o atual em
**toda** categoria testada (não é isolado a uma categoria) — ex: VESTIDOS 348 peças em
ago/2025 vs 5.880 hoje (17x), CAMISA 325 vs 7.629 (23x), SHORTS 274 vs 3.557 (13x),
CALCA 93 vs 763 (8x). Investigação feita nessa sessão (query manual direto no Neon,
fora do código do app):

- A query que busca "estoque como estava numa data do passado" está **matematicamente
  correta** — mesmo princípio da query de "estoque atual" (`DISTINCT ON` + `ORDER BY
  captured_at DESC`), só com um corte de data a mais. Não é bug de SQL.
- Separei os SKUs de VESTIDOS entre "já existiam em ago/2025" (2.891 SKUs) e "surgiram
  depois" (359 SKUs, produto lançado depois — corretamente contam 0 no ano anterior).
  Mesmo olhando **só** os 2.891 SKUs antigos, o estoque deles sozinho cresceu de 348
  pra 1.868 (5,4x) — ou seja, produto novo lançado depois **não explica tudo**, os
  produtos antigos também têm bem mais estoque hoje do que tinham há um ano.
- Verifiquei se havia um "reset" pontual de dado (ex: uma re-carga gigante de uma vez
  só) que pudesse artificialmente zerar o passado — não achei: o volume de linhas
  gravadas em `prd_saldo` por mês cresce de forma gradual ao longo do ano inteiro
  (2.380 linhas/mês em jun/2025 até ~11-14 mil/mês em jul-ago/2026), não é um salto
  único suspeito.

**O usuário confirmou entender que SKU inexistente não deve contar no ano anterior**
(comportamento já correto), mas ainda não confirmou se a magnitude do crescimento (8x
a 25x, em toda categoria) é plausível pro negócio real. Duas hipóteses em aberto, sem
como decidir só olhando o banco:
1. **Real**: a rede genuinamente tinha bem menos estoque físico em ago/2025 (expansão
   de lojas, compra grande recente, etc.) — nesse caso os números do relatório estão
   certos como estão.
2. **Limitação de dado histórico**: talvez a captura de `stock_code=1` (físico) não
   fosse tão completa há um ano quanto é hoje — nesse caso "cobertura do ano anterior"
   estaria **subestimada** por causa de uma lacuna de rastreio, não por bug de cálculo.

**Próximo passo pedido pelo usuário, ainda não feito**: comparar contra um relatório
nativo do TOTVS pra uma loja específica em ago/2025 (mesmo processo já usado antes pra
validar o Dashboard Comercial contra FISFL024/PRDFL074) — se bater com o número baixo
que o app mostra, é real (hipótese 1); se o TOTVS mostrar bem mais estoque pra aquela
data, é lacuna de histórico (hipótese 2). Não assumir nenhuma das duas sem essa
confirmação externa.

</details>

## 🚨 ETL parou de gravar ITENS de operação que não é venda (desde 25/06/2026, ativo)

Achado em 06/10/2026 enquanto se investigava o pedido de "peças em trânsito". **Não tem
relação com trânsito e é mais grave**: o ETL continua gravando os documentos em
`transacoes`, mas **não grava nada em `transacao_itens`** pra quase toda operação que
não seja venda. Documentos COM item / total, status=4:

| type+mode | operação | jul | ago | set | out |
|---|---|---|---|---|---|
| `S4` | venda | 6987/6987 | 5800/5800 | 5270/5270 | 817/817 ✅ |
| `E3` | devolução de venda | 668/668 | 608/608 | 564/564 | 110/110 ✅ |
| `E4` | compra materiais uso/consumo | 17/17 | 12/12 | 10/10 | 6/6 ✅ |
| `S2` | **saída de transferência** | 0/622 | 0/643 | 0/493 | 0/81 ❌ |
| `E2` | **entrada de transferência** | 0/531 | 0/563 | 0/462 | 0/74 ❌ |
| `E5` | **compra de matéria-prima** | 0/157 | 0/137 | 0/140 | 0/19 ❌ |
| `E6`/`EC`/`S5`/`S6`/`SC` | industrialização, consignação | 0 | 0 | 0 | 0 ❌ |

Corte exato: **25/06/2026** (nesse dia, 31 documentos de entrada e só 1 com item; de
26/06 em diante, zero). Confirmado doc a doc: transferência `8/915457` de 05/10 tem 0
itens, venda do mesmo dia tem itens normais.

**Telas já degradadas por isso** (não é hipótese, foi medido):
- **`ÚLT. ENTRADA` do Relatório Base** (`getUltimaEntradaRows`/`getEntradaDpaRows` em
  `relatorioBase.service.ts`, filtram `co.operations_type='E'`): congelada em
  **24/06/2026** pra todo produto que chega na loja por transferência (`E2`). Só `E3` e
  `E4` ainda atualizam a data.
- **Maturação do Estoque Sem Giro** (`estoque.service.ts`, CTE `primeira_entrada`): o
  `WHERE` trata `primeira_entrada_data IS NULL` como **maduro** (passa no filtro), então
  produto que chegou depois de 25/06 pode ser marcado "sem giro" logo na chegada — o
  oposto do que o filtro existe pra fazer. Hoje: **8.337 pares produto+loja com estoque
  e sem nenhuma entrada registrada**, de 28.488 (29%).

**Não afeta** venda/devolução — faturamento, metas, comissões, Curva ABC, Venda do Dia e
o Acompanhamento por Linha seguem corretos.

**Correção é fora deste repo** (script Python do ETL): provavelmente um filtro de tipo de
operação introduzido/estreitado por volta de 25/06 na etapa que baixa os itens. Além de
remover a restrição, é preciso **reprocessar de 25/06/2026 até hoje** — os documentos já
estão gravados sem itens e a retomada não revisita documento já processado (mesma causa
raiz dos bugs 3 e 4 da seção "Bugs reais já encontrados"). Documento pronto pra
encaminhar: `DIAGNOSTICO-DEVOLUTIVA-ACOMPANHAMENTO-LINHA.md` na raiz.

**Enquanto não for corrigido, não dá pra construir nenhuma visão de trânsito, entrada ou
compra** — não existe item pra contar.

**Atualização 28-30/08/2026 — achada uma 3ª hipótese real e concreta, corrigida**: numa
devolutiva do cliente (`.docx` "Projeto BI Estoque - Devolutiva 25 08"), a pergunta
"consideramos a loja Terrazo Shopping (fechada) na venda do ano anterior?" levou a
achar que `LOJAS_VAREJO` em `apps/pcp-api/src/services/vendaDia.service.ts` — a lista
hardcoded das 12 lojas de varejo ativas hoje — era reusada **tanto pro período atual
quanto pro "ano anterior"** em `getAcompanhamentoDiario`. Ou seja: qualquer loja que
fechou entre um ano atrás e hoje (Terrazo Shopping, Mossoró, Via Sul, Mart Moda — ver
`LOJAS_VAREJO_FECHADAS` em `apps/pcp-api/src/config/constants.ts`) tinha sua venda E
estoque do ano anterior **silenciosamente excluídos** da comparação de rede inteira,
mesmo tendo vendido/tido estoque de verdade naquela época. Isso sozinho já explica uma
parte real do "ano anterior parece baixo demais" (loja fechada = zero contado, não é
lacuna de captura de dado, é exclusão by design do filtro de filial). **Corrigido**:
`getAcompanhamentoDiario` agora usa um universo de filiais mais amplo
(`branchesAnoAnterior`) só pro lado "ano anterior", incluindo as lojas fechadas — e só
quando a comparação é de rede inteira sem filtro de loja específico (uma seleção
explícita de loja continua estrita). Isso **não** resolve sozinho as duas hipóteses
antigas (real vs. lacuna de captura no `prd_saldo`) — ainda não foi re-testado com o
banco (Neon fora do ar no momento do fix) pra saber quanto da magnitude de 8-25x esse
achado explica. Próximo passo: comparar a magnitude do gap antes/depois desse fix pra
categorias como VESTIDOS/CAMISA assim que o banco voltar, e só então decidir se ainda
vale a pena perseguir a comparação com relatório nativo do TOTVS.

## Sessão 28-30/08/2026 — merge grande com `limes/teste`, DPA/Atacado virou padrão do PCP

`limes/teste` é o branch de trabalho do Marcelo (ver seção "Git" acima). Entre o último
merge com `main` e 28/08/2026, ele acumulou 25 commits sem nunca avisar em qual branch
publicou — isso gerou confusão real (usuário viu no WhatsApp o Marcelo comentando ajuste
de cor no Raio X sem saber se aquilo já estava em produção). Investigação: comparar
`git log -1 --format=%ai` do topo de `limes/main` vs `limes/teste` mostrou a `teste`
6 dias na frente — confirma que o trabalho mais recente dele vai pra lá, não pra `main`,
até ser mergeado explicitamente. **Path de investigação pra repetir se acontecer de
novo**: `git fetch` os dois, comparar timestamp do commit mais recente de cada branch
(não só existência de commits novos — quem está "mais atualizado de verdade" é quem tem
a data mais recente, não a branch com mais commits).

A pedido do usuário ("traz a teste do git, deixa ela como versão principal"), a `teste`
inteira foi mergeada em `main` (`git merge limes/teste`), com uma regra clara: **em
qualquer conflito real de conteúdo, prevalece a versão da `teste`** (não tentar
reconciliar linha a linha) — só quando o merge automático do Git já resolvia sozinho
(edições em partes diferentes do arquivo) é que as duas contribuições ficaram lado a
lado. 13 arquivos em conflito, praticamente todos resolvidos pegando o arquivo inteiro
da `teste` (`git show limes/teste:caminho > caminho`), porque cada um era parte de uma
reescrita ampla e coerente (não dava pra misturar metade de cada lado sem quebrar). Uma
correção pontual foi necessária depois do merge: `apps/pcp-api/src/index.ts` ganhou um
import/registro duplicado de `pesosGradesRoutes` (efeito colateral de um merge anterior
já ter "resolvido" isso e o merge novo reintroduzir via 3-way sem base comum
reconhecida) — sempre conferir duplicatas de import depois de um merge grande assim.

### DPA e Atacado agora são filiais sintéticas em todo o módulo PCP

Atendendo ao pedido do cliente ("considerar sempre dois locais distintos: FÁBRICA (DPA)
e ATACADO"), o Marcelo introduziu em `apps/pcp-api/src/config/constants.ts`:

```ts
export const DPA_BRANCH_CODE = -1;      // filial 02 (Fabrica), stock_code 1 e 5 (fisico + segunda qualidade)
export const ATACADO_BRANCH_CODE = -2;  // filial 02 (Fabrica), stock_code 8 (atacado) OU operacao com "ATACADO" na descricao
export const DPA_STOCK_CODES = [1, 5];
export const ATACADO_STOCK_CODE = 8;
```

Códigos negativos de propósito, pra nunca colidir com um `branch_code` real do TOTVS —
mesmo padrão que `ATACADO_BRANCH_CODE` já usava sozinho em `relatorioBase.service.ts`
antes disso (ver seção "stock_code" acima), agora generalizado e com um par (DPA
também). **Isso substitui o uso solto de `FABRICA_BRANCH_CODE` (branch_code=2) como uma
coisa só** em `relatorioBase.service.ts`, `vendaDia.service.ts`, `vendaDesconto.service.ts`
e `raioX.service.ts` — qualquer relatório novo que tocar a Fábrica deveria seguir esse
mesmo padrão (DPA vs Atacado como duas linhas/opções de filtro separadas), não voltar a
tratar branch_code=2 como uma coisa só. Distinção: **estoque** usa `stock_code` (1/5 =
DPA, 8 = Atacado, direto na tabela `prd_saldo`); **venda/transação** não tem stock_code,
então usa `classificacao_operacoes.description ILIKE '%ATACADO%'` pra decidir o canal
(`COALESCE(co.description, '') NOT ILIKE '%ATACADO%'` = DPA, senão Atacado).

### Outras entregas trazidas da `teste` nesse merge (correções da devolutiva do cliente)

- **Raio X**: reconstruído do zero pra agrupar por cor (arquivo novo
  `RaioXCompacto.tsx`) — clicar no produto abre por cor, com grade por tamanho.
- **Venda e Desconto**: agrupamento por referência (não mais por SKU/código de barras),
  conciliação venda bruta/líquida/desconto batendo com o relatório 61 do DICFM, e uma
  tela nova companheira "Resumo de Promoção por Loja" (`/relatorios/resumo-promocao`).
- **Acompanhamento por Linha**: cobertura recalculada por mês-calendário de verdade (via
  `getPeriodosCalendario`) em vez da aproximação fixa de 30 dias antiga; colunas Meta
  R$/Ating. Meta % (proporcional aos dias selecionados) cruzando com
  `PcpMetaClassificacao`; linha de TOTAL; classificações Coleção e Status adicionadas;
  vendas sem classificação somam num bucket "SEM CLASSIFICAÇÃO" (pra bater com o
  dashboard comercial em vez de sumir silenciosamente).
- **Pesos e Grades para Produção**: ordem de grade corrigida (UN P M G GG 2 4 6 8 10 —
  ver `ORDEM_GRADES`/`ordemGrade()`), "Por Categoria" agora agrupa a categoria inteira
  em vez de vir por item, filtros de Linha/Gênero adicionados quando filtra por
  Categoria, coluna de total vendido.
  ⚠️ **Completado em 06/10/2026** — a ordem acima estava só meio certa:
  `ORDEM_GRADES` começa com `'UN'`, mas o cadastro do TOTVS grava tamanho único como
  **`U`** (1.344 SKUs; `UN`/`UNICO`/`ÚNICO` não existem no `produto_analitico.size`).
  Como `'U'` não casava com a lista, caía no bucket "desconhecido" e era ordenado por
  **último** em vez de primeiro. Corrigido com `normalizarTamanho()` em
  `pesosGrades.service.ts`. Além disso, o pedido tinha uma segunda metade que nunca
  havia sido implementada — "zero onde não houver venda naquele tamanho": o serviço
  fazia `.filter(v => v.quantidade > 0)`, então tamanho sem venda sumia. Agora existe
  `getGradeCadastrada()` (grade do cadastro por referência/categoria) e o universo de
  tamanhos é `grade cadastrada ∪ tamanhos que venderam`, com 0 onde não houve venda.
  **Não usar `ORDEM_GRADES` como universo** — a maioria das referências tem 3 a 6
  tamanhos (produto de tamanho único ficaria com 9 colunas de zero) e existem 46
  tamanhos distintos no cadastro, muitos fora da lista (PP, 12, 14, 36-44, numeração de
  calçado 17-33). Referência que não vendeu nada no período continua fora da tela.
- `metaClassificacao.service.ts` ganhou `status` como `tipoClassificacao` válido (antes
  só tinha categoria/linha/genero/colecao).

### Pendente, ainda não verificado (banco fora do ar no fim dessa sessão)

O Neon ficou inacessível (`P1001`, testado com `prisma db pull` e com o Prisma Client
direto, TCP puro conecta mas o handshake do Postgres falha) bem no momento de validar
esse merge com dado real — `npx prisma db pull`/`generate` não rodou, e o fix do
`LOJAS_VAREJO_FECHADAS` não foi testado contra o banco ainda. `tsc` limpo nos 3 apps
(prova que o código compila e os tipos batem), mas isso **não** substitui testar as
telas reescritas (Raio X, Venda e Desconto, Acompanhamento por Linha) com dado real —
fazer isso assim que o banco voltar, antes de considerar essa entrega fechada.
