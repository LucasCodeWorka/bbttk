# Bebetenkite Dashboard — Contexto do Projeto

Painel interno da Bebetenkite (rede de lojas infantil) que consolida dados de vendas do
ERP TOTVS Moda (via ETL externo → Postgres) e adiciona ferramentas de gestão (metas,
agrupamento de produtos) que o TOTVS não oferece.

## Arquitetura

Monorepo com **npm workspaces** (`apps/*`), dois serviços independentes:

- **`apps/api`** — Express + TypeScript + Prisma, porta padrão 3001 (dev). Roda com
  `tsx watch` em dev (não faz type-check completo!) e `tsc` no build de produção.
- **`apps/web`** — Next.js 16 (App Router, Turbopack), porta 3000. Todas as páginas são
  `'use client'` — não usa Server Components, Server Actions, Middleware nem rotas de
  API do próprio Next. Auth é 100% client-side (token JWT em `localStorage`).

**Sempre rodar `npm install`/scripts a partir da raiz do repo**, nunca de dentro de
`apps/api` ou `apps/web` isoladamente — é um workspace, isolar quebra o hoisting de
dependências.

```
npm run dev          # sobe api (3001) + web (3000) juntos, tsx watch + next dev
npm run build         # build de produção dos dois (tsc + next build)
npx prisma db push    # (de dentro de apps/api) aplica mudanças de schema no Neon
npx prisma db pull    # reintrospecta o banco — ver seção "Banco de dados" abaixo
```

## Banco de dados — Neon Postgres (⚠️ cuidado aqui)

Connection string em `apps/api/.env` (`DATABASE_URL`). O banco tem **duas categorias de
tabelas muito diferentes** que dividem o mesmo schema Prisma:

1. **Tabelas sincronizadas pelo ETL do TOTVS** (fora do nosso controle, um script Python
   externo que roda periodicamente): `transacoes`, `transacao_itens`, `produtos`,
   `prd_saldo`, `branches`, `operacoes`, `sync_state`, `etl_log`. **Nunca escrever nelas
   diretamente** — qualquer edição manual se perde no próximo sync. Elas também **mudam
   de schema sem aviso** (o ETL já adicionou colunas novas tipo `updated_at` sem a gente
   saber) — isso já causou um `prisma db push` tentar **dropar colunas com dado real**.
   **Regra de ouro: sempre rodar `npx prisma db pull` antes de qualquer `db push`**, pra
   reconciliar o schema local com o que o ETL mudou, e nunca usar `--accept-data-loss`
   sem entender exatamente o que seria perdido.
2. **Tabelas da aplicação** (Prisma é a fonte de verdade): `users`, `metas`,
   `meta_niveis`, `meta_distributions`, `distribution_items`, `agrupamento_grupos`,
   `agrupamento_membros`. Seguem convenção camelCase no schema + `@map` pra snake_case
   no banco, com `createdById`/`createdAt` como padrão de auditoria.

`produtos.product_sku` (string, PK) = referência+cor+tamanho combinados. `produtos.
product_code` (int) é uma chave **separada**, usada só nas queries de venda
(`transacao_itens.product_code`); `prd_saldo` já junta por `product_sku`. As duas
chaves coexistem no código por causa de como o TOTVS expõe os dados — não são
intercambiáveis.

## Regras de negócio — Comercial

- **Faturamento é sempre líquido** (venda − devolução). Devolução é identificada pelo
  `operation_code` da transação: os códigos com `operationMode=3`/`operationsType=E` na
  API TOTVS (`DEVOLUTION_OPERATIONS` em `apps/api/src/config/constants.ts`) entram com
  sinal negativo no cálculo, não são simplesmente excluídos. Existe também
  `EXCLUDED_OPERATIONS` — operações que não são venda nem devolução (ajuste, etc.),
  essas sim são 100% ignoradas.
- **Filial Fábrica (branch_code 2) nunca entra em relatório de loja** — é produção, não
  ponto de venda.
- **Projeção de faturamento** usa "caminhada do ano anterior": `caminhada = fat.
  parcial_ano_anterior / fat.mês_completo_ano_anterior`; `projeção = fat.atual /
  caminhada`.
- **Cliente novo** = `customer_code` cuja primeira compra válida em toda a história caiu
  dentro do período do relatório.
- Cálculos centralizados em `apps/api/src/services/vendas.service.ts` — qualquer métrica
  nova de venda deveria reusar os fragmentos SQL de lá (`SALE_OPERATION_FILTER`,
  `DEVOLUTION_SIGN`, `STORE_BRANCH_FILTER`) em vez de duplicar a lógica de filtro.

## Módulos e permissões

A sidebar (`apps/web/src/components/layout/Sidebar.tsx`) é organizada em **módulos**:
- **Comercial** (`comercial`): Dashboard de Vendas + Metas
- **PCP** (`pcp`): hoje só tem "Agrupamento de Cores" (configurador genérico pra juntar
  variações de cor de produto num grupo, sem alterar dado do TOTVS — pensado pra ser
  reaproveitado por outras ferramentas de agrupamento no futuro)

Cada usuário tem `moduleAccess: string[]` (além de `branchCodes` pra loja e `role`
admin/gerente). **Isso é reforçado em dois lugares, não só um**:
1. Frontend: `apps/web/src/app/(dashboard)/layout.tsx` bloqueia navegação direta pra
   rota de um módulo sem acesso (usa `apps/web/src/lib/permissions.ts` como mapa
   rota→módulo).
2. Backend: middleware `moduleAccess(key)` em `apps/api/src/middleware/auth.middleware.ts`,
   aplicado via `router.use(authMiddleware, moduleAccess('pcp'))` no topo das rotas do
   módulo.

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
desenvolvimento terminar uma entrega, criar um novo `.md` nessa pasta resumindo o que
mudou e como usar — nenhuma mudança de código é necessária, a rota já pega o arquivo
novo automaticamente.

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

## Deploy (Render)

`render.yaml` na raiz descreve os dois serviços (blueprint). Pontos que já causaram
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
- `NEXT_PUBLIC_API_URL` é *inlined* no build do Next — só dá pra setar depois que o
  serviço da API já tem URL definida, e mudar essa env var exige **redeploy manual**
  (não é runtime).
- Segredos (`DATABASE_URL`, `JWT_SECRET`, `TOTVS_*`) nunca vão pro `render.yaml`
  (`sync: false` — preenchidos manualmente no dashboard do Render).

## Integração TOTVS

Credenciais em `apps/api/.env` (`TOTVS_*`). O tenant `bebetenkiteapiv2` teve o módulo
**General V2** (transações, operações, devoluções) bloqueado pela TOTVS até 07/07/2026 —
se voltar a dar 403 em `totvs.service.ts` ou nas queries de venda pararem de atualizar,
esse é o primeiro suspeito (contatar suporte TOTVS, não é bug nosso). O catálogo de
cores do TOTVS (`/product/v2/colors/search`) já tem um campo `groupName` próprio de
classificação — **não é o mesmo conceito** do nosso "Agrupamento de Cores" (que é uma
ferramenta de agrupamento livre, definida pelo usuário, sem depender de mudar cadastro
no TOTVS). Swagger da API: `{TOTVS_API_URL}/general/v2/swagger/v1/swagger.json` (útil
pra descobrir endpoints/campos sem depender de documentação externa — foi assim que
achamos `/general/v2/operations` pra classificar `operation_code` via `isFinancial`/
`invoiceData.operationMode`/`operationsType`, e `general/v2/transactions/search` que o
ETL usa, com paginação `Page`/`PageSize` real, campo `hasNext`).

### Bug real já encontrado e corrigido: dados incompletos por causa do ETL "só pra frente"

Batendo o Dashboard contra o relatório nativo do TOTVS (FISFL024) pra Iguatemi
(01-17/07/2026), achamos **quatro bugs empilhados** e reconciliamos R$74.437,47 (errado)
até R$60.397,67 — **exatamente igual ao TOTVS, centavo por centavo, peça por peça**. Não
confundir um bug com o outro se aparecer de novo:

1. **`customer_code >= 110000000` = conta interna do TOTVS** (transferência entre
   filiais, ajuste de estoque, amostra, perda), nunca um cliente real — confirmado via
   `general/v2/operations`: os `operation_code`s que só aparecem com esses códigos têm
   `isFinancial: false`. Sem filtrar isso, esses movimentos entravam como faturamento de
   verdade: **~R$22,8 milhões inflados em todo o histórico, todas as filiais**. Corrigido
   com `REAL_CUSTOMER_FILTER` em `apps/api/src/services/vendas.service.ts` (dentro de
   `SALE_OPERATION_FILTER` e em `getDevolucoesPorFilial`).
2. **Filtro de status errado**: usava `t.status != 6` (exclui só cancelada) em vez de
   `t.status = 4` (exige "Atendida" - venda de fato concluída). O enum completo do TOTVS
   (`StatusTransactionType` no swagger) tem 10 valores - 1=Em andamento, 2=Liberado p/
   faturamento, 3=Parcialmente atendida, 4=Atendida, 5=Encerrada, 6=Cancelada,
   7=Pré-faturada, 8=Bloqueada p/ faturamento, 9=Recusada, 10=Agrupada. No banco inteiro
   já apareceram status 1 (2265 transações) e 10 (204 transações) sendo contados como
   venda por engano. Corrigido: todo `AND t.status != 6` virou `AND t.status = 4` em
   `vendas.service.ts` (8 ocorrências).
3. **Dias inteiros faltando**: o ETL Python (script separado, fora deste repo — cola
   trechos no chat quando precisar mexer nele) grava em `etl_log` com `status='SUCCESS'`
   mesmo quando a API do TOTVS devolve 0 transações por um erro transitório — e como a
   lógica de retomada é `actual_start = last_date + 1` (nunca revisita um dia já
   marcado `SUCCESS`), esse dia fica faltando **pra sempre**. Achamos um caso real:
   Iguatemi 11/07/2026 com 31 transações no TOTVS e 0 no nosso banco.
4. **Itens faltando dentro de transações que já existem**: a transação foi sincronizada,
   mas nem todos os itens dela — sinal de que TOTVS recebeu lançamentos/correções
   (ex: devolução) depois que o ETL já tinha capturado aquele dia. Achamos em Iguatemi
   12–17/07/2026.

**Os bugs 3 e 4 são estruturais do script e vão continuar acontecendo pra qualquer dia
recente, em qualquer filial**, até o ETL mudar de estratégia. Fix recomendado pro script
Python: em vez de só `actual_start = last_date + 1`, sempre re-sincronizar uma janela
deslizante dos últimos ~14-30 dias a cada execução (o upsert já é `ON CONFLICT DO
UPDATE`, então re-rodar dias já sincronizados é seguro e barato). Não temos esse script
neste repo pra editar direto — se o usuário colar o conteúdo, aplicar esse fix nele.

**Backfill manual pontual** (sem esperar o fix do script): dá pra chamar
`general/v2/transactions/search` direto (mesmo padrão de auth de `totvs.service.ts`) pra
um branch/dia específico e regravar em `transacoes`/`transacao_itens`. **Cuidado**: ao
regravar os itens de uma transação, **sempre `DELETE FROM transacao_itens WHERE
branch_code=... AND transaction_code=...` antes de reinserir** - um upsert por
`item_index` sozinho deixa linhas órfãs pra trás quando a transação tem MENOS itens
agora do que numa sincronização anterior (isso aconteceu no nosso primeiro backfill e
inflou o número de novo até a gente perceber e corrigir).

## Contas e acesso

Login do admin (`admin@bebetenkite.com`) já existia no banco antes de qualquer sessão
com Claude — a senha está com hash bcrypt, **não há como recuperar**, só resetar via
tela de Usuários (que já tem botão "Redefinir Senha", só funciona logado como admin).

## Fase 3 — Módulo PCP (em andamento, 27/07/2026)

Depois do "Estoque Sem Giro" (`/pcp-novo`, feito pelo Marcelo), esta fase adicionou 4
telas novas dentro do módulo PCP (`moduleAccess('pcp_servico')`, **nenhuma linkada no
Dashboard Comercial**). Commit de referência: `feat: modulo PCP - Relatorio Base,
Configurador, Visao Geral, Analise de Grade e Curva ABCD` (foi só pro `origin`, pessoal
do Lucas — **ainda não subiu pro `limes`**, o remote compartilhado, porque o usuário
ainda quer validar visualmente antes).

### Telas

- **`/pcp-relatorio-base`** — tabela SKU × filial (giro/estoque/cobertura/custo/PDV
  real/markup/lançamento/última entrada), sticky columns, export CSV. Backend em
  `apps/pcp-api/src/services/relatorioBase.service.ts`.
- **`/pcp/relatorio-base-config`** (admin only) — Configurador do PCP: janelas de
  giro/cobertura, cobertura ideal por filial, e qual código de custo/preço do TOTVS usar
  (com botão pra sincronizar). Backend em `apps/api/src/services/pcpConfig.service.ts` +
  `apps/api/src/services/totvs.service.ts` (`syncCustosEPrecos`).
- **`/pcp-visao-geral`** — KPI cards com meta/gap (cobertura geral, giro anualizado,
  valor em estoque, % estoque morto, cobertura Básico/Coleção), matriz cobertura por
  linha×canal (com toggle categoria/gênero). Metas editáveis inline (admin). Backend em
  `apps/pcp-api/src/services/visaoGeral.service.ts`.
- **`/pcp-analise-grade`** — heatmap estoque por referência×tamanho (paleta de status
  validada pela skill `dataviz`, não a paleta da marca), curva ABC de tamanhos,
  indicadores de ruptura. Backend em `apps/pcp-api/src/services/analiseGrade.service.ts`.
- **`/pcp-curva-abc`** — Curva ABCD por referência, inspirada numa ferramenta de
  referência que o usuário já usa (`planodeproducao-web.onrender.com`): cards de resumo
  por curva (A/B/C/D), "última referência" de cada curva, regras de classificação
  **configuráveis** (admin, botão "Editar regras de classificação"), drill-down por SKU
  ao clicar numa linha. Backend em `apps/pcp-api/src/services/curvaAbc.service.ts`.
  Classificação: Curva A = limiar fixo de unidades vendidas (`metaCurvaAUnidades`,
  default 2500); Curva D = cauda do ranking (`curvaDPercent`% do total de referências
  analisadas, default 15,9%); Curva C = fatia seguinte (`curvaCPercent`%, default
  23,8%); Curva B = o resto. Os defaults replicam as proporções reais observadas na
  ferramenta de referência do usuário (20/126 e 30/126 refs), escaladas pro nosso
  catálogo bem maior (~800 referências analisadas vs ~126 deles) — decisão explícita do
  usuário de escalar proporcionalmente em vez de usar contagem fixa (30/20).

### Custo, preço e markup (dado real do TOTVS)

`ProdutoCusto`/`ProdutoPreco` (schema) guardam custo/preço por `product_code` ×
`branch_code` × código do TOTVS, sincronizados via `product/v2/costs|prices/search`.
Pontos importantes se for mexer nisso de novo:

- **A API do TOTVS é lenta e tem limites não documentados** descobertos na unha: (1)
  gateway deles estoura com 502 se a página demorar mais que ~75-110s — por isso
  `pageSize=100` fixo, não maior; (2) `filter.productCodeList` tem limite de **900
  itens por request** (erro `ListExceeded`) — por isso o sync divide em lotes de 900;
  (3) token OAuth do TOTVS expira antes de terminar um sync grande, por isso é buscado
  de novo a cada página em vez de uma vez só no início.
- **Sync é escopada pro universo do Relatório Base** (~7-8 mil produtos com estoque>0
  ou giro nos últimos 6 meses), não o catálogo inteiro do TOTVS (66 mil+, a maioria
  embalagem/matéria-prima que nunca aparece em relatório nenhum) — isso já cortou o
  tempo de sync de ~16h estimadas pra ~1-2h.
- **Estado no momento deste commit: sync incompleta.** Rodando a última verificação,
  `produto_custos` tinha ~4.481 de ~7-8mil produtos cobertos e `produto_precos` tinha
  ~10.030 (a sync de preço parece ter continuado sozinha mesmo depois de custo ter dado
  erro de connection pool - `Timed out fetching a new connection from the connection
  pool` - `DATABASE_URL` do Neon tem só 13 conexões no pool, e sync de custo+preço
  rodando em paralelo mais o dev server mais outras queries pode estourar isso). **Se
  for continuar o trabalho, rodar de novo `POST /api/pcp-config/sincronizar-custos-precos`
  (admin) até completar** — é seguro re-rodar (upsert via `ON CONFLICT DO UPDATE`), só
  demora. Enquanto não estiver completo, `CUSTO`/`PDV REAL`/`MARKUP` aparecem como `—`
  pra SKUs ainda não sincronizados (contrato de API já é tolerante a isso, não é bug).
- **Markup não usa o custo/preço configurado no Configurador** (esses são preço de
  TABELA do TOTVS, ficam só nas colunas CUSTO/PDV REAL) — usa custo da **última compra**
  (costCode=2, fixo) vs. preço da **última venda real** (transação de verdade, líquida
  de desconto), separado por canal varejo/atacado. Decisão explícita do usuário.

### Pendências / pontos pra validar com o usuário (não foram fechados, só documentados)

- Formatação fina dos cards da Visão Geral (ex: como mostrar "Meta: 10% · R$36,5k" de
  estoque morto).
- "Completude da grade" (Análise de Grade) foi definida como % dos tamanhos da própria
  referência com estoque > 0 — não existe uma "grade ideal" separada pra comparar.
- Filtro por **cor** (Análise de Grade) e por **família** (Curva ABC, mapeado pra
  `class_grupo` do TOTVS, que hoje parece mais marca — BEBETENKITE/TEENKIS/MIST BRAND —
  do que família de produto) — o backend já aceita os dois filtros, só falta UI.
- "30d V"/"30d A" do mockup original da Curva ABC (antes da reescrita pra ABCD) foram
  interpretados como janelas de 30 dias comparativas - a Curva ABCD atual não usa mais
  isso, mas fica registrado caso volte a aparecer em outro contexto.
- Sem série histórica mensal em lugar nenhum (Visão Geral, Curva ABC) - só o valor
  atual. O rascunho do usuário pedia "inserir histórico dos últimos 12 meses" - fica
  fora de escopo até decidir como guardar isso (snapshot mensal? tabela nova?).

### Pra continuar em outra máquina

`npm install` na raiz, `apps/api/.env` + `apps/pcp-api/.env` (mesma `DATABASE_URL` do
Neon, `JWT_SECRET` igual) + `apps/web/.env.local` com `NEXT_PUBLIC_PCP_API_URL=
http://localhost:3002` — nenhum desses `.env` vai pro git, precisa recriar na mão.
`npm run dev` sobe os 3 processos (api:3001, web:3000, pcp-api:3002). Pra testar rotas
autenticadas sem saber a senha do admin, mintar um JWT direto (script não versionado,
recriar se precisar):
```ts
// apps/api/scripts/mint-test-token.ts
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/config/database.js';
const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
const token = jwt.sign(
  { userId: admin.id, email: admin.email, role: admin.role, branchCodes: admin.branchCodes, moduleAccess: admin.moduleAccess },
  process.env.JWT_SECRET || 'bebetenkite-dashboard-secret-2024',
  { expiresIn: '2h' }
);
console.log(token);
```
