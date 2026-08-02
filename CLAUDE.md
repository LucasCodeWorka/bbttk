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

Implementada tela de configuração dedicada para o relatório "Estoque Sem Giro" em
`/pcp/estoque-sem-giro-config`, acessível via menu Configurações (requer acesso ao
módulo `pcp_servico`).

**Campos configuráveis:**
- **Período de maturação (dias)**: Produtos que chegaram nas lojas há menos tempo que
  este período não são sinalizados como "sem giro". Default: 30 dias. Permite valor 0
  para desabilitar o filtro completamente.
- **Limiares de cobertura**: Define os limites verde (estoque baixo) e vermelho
  (estoque alto) em meses de cobertura.

**Infraestrutura criada:**
- Backend: `pcpConfig.service.ts` — `getEstoqueSemGiroConfig()` e
  `updateEstoqueSemGiroConfig()`
- API Routes: `GET/PUT /api/pcp-config/estoque-sem-giro` em `pcpConfig.routes.ts`
- Frontend: `apps/web/src/lib/api.ts` — `PcpEstoqueSemGiroConfig` interface e métodos
- Schema: Campo `maturacaoDias` já existia em `pcp_relatorio_configs` (adicionado em
  sessão anterior), agora tem UI para edição

**Aplicação no relatório:**
O período de maturação é aplicado em `apps/pcp-api/src/services/estoque.service.ts`
via CTE `primeira_entrada` que identifica a primeira entrada de cada produto por filial
(usando `operations_type = 'E'` da tabela `classificacao_operacoes`) e filtra produtos
onde `CURRENT_DATE - primeira_entrada >= maturacaoDias`.

### Abreviações de Filiais

Adicionado campo `abrev` (VARCHAR(10)) na tabela `branches` para exibir identificadores
curtos (3 letras) em relatórios em vez de códigos numéricos ou nomes completos.

**Abreviações definidas:**
```
1: IGU (Iguatemi), 2: FAB (Fábrica), 3: BEN (Benfica), 4: DEL (Del Paseo),
5: PDL (Pátio Dom Luís), 6: SOB (Sobral), 7: PAR (Parangaba), 8: RIO (Riomar),
9: EXP (Expansão), 11: RPK (Riomar PK), 12: MES (Messejana), 13: EUS (Eusébio),
17: NOR (North Shopping)
```

Aplicado em `apps/pcp-api/src/services/estoque.service.ts` via
`COALESCE(b.abrev, b.description, ...)` priorizando a abreviação quando disponível.

### Ordenação Universal em Tabelas PCP

Habilitada ordenação clicável por cabeçalho em **todas as colunas** das principais
tabelas do módulo PCP. Padrão de implementação consistente em todas as telas:

**Componente reutilizável `ThSortPcp`:**
- Renderiza cabeçalho de tabela com indicador visual de ordenação (▲/▼)
- Cor roxa (`--bbtk-purple`) quando ativo, cinza quando inativo
- Hover effect para indicar clicabilidade
- Suporta alinhamento customizado (left/center/right)

**Telas atualizadas:**

1. **Estoque Sem Giro** (`pcp-novo/page.tsx`) — ✅ **Já tinha ordenação completa**
   (implementada em sessão anterior)
   - Todas as 6 colunas base + todas as colunas de distribuição por loja

2. **Análise de Grade** (`pcp-analise-grade/page.tsx`) — ✅ **Ordenação adicionada**
   - **Tabela de referências**: 12 colunas ordenáveis (Referencia, Curva, Estoque,
     3 meses de venda, Média mensal, Cobertura, SKUs, SKUs risco, % risco, Status)
   - **Mapa de calor (heatmap)**: Coluna Referencia + todas as colunas de tamanho +
     coluna Completude — ordenação independente da tabela de referências
   - Default: tabela por % risco (desc), heatmap sem ordenação inicial
   - Estados de ordenação separados: `sortKey`/`sortDir` para tabela,
     `heatmapSortKey`/`heatmapSortDir` para mapa de calor

3. **Relatório Base** (`pcp-relatorio-base/page.tsx`) — ✅ **Ordenação adicionada**
   - **25 colunas fixas** + **N × 3 colunas dinâmicas por filial** (GIRO/EST/COB)
   - Todas 100% ordenáveis, incluindo colunas sticky (SKU, DESCRIÇÃO)
   - Default: ordenado por EST. TT (estoque total, desc)
   - Export CSV respeita a ordenação ativa na tela

4. **Curva ABC** (`pcp-curva-abc/page.tsx`) — ✅ **Ordenação adicionada**
   - **Todas as 15 colunas** (modo referencia) ou **13 colunas** (modo SKU) ordenáveis
   - Cabeçalhos clicáveis sincronizam com o dropdown de ordenação existente
   - Estrutura de cabeçalho complexa (2 linhas, com rowSpan/colSpan) preservada
   - Handler `handleSort` atualiza tanto `ordenarPor` quanto `sortDir`, mantendo
     compatibilidade com controles de filtro
   - Default: continua sendo configurável via dropdown, headers refletem a escolha

5. **Visão Geral** (`pcp-visao-geral/page.tsx`) — ⚠️ **Sem ordenação**
   - Matriz estática (linha × canal), não faz sentido ordenar

6. **Agrupamento de Cores** (`pcp/agrupamento-cores/page.tsx`) — ⚠️ **Sem ordenação**
   - Interface modal/wizard, não é tabela tradicional

**Padrão de implementação:**
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

// Extração de valor ordenável
function getSortValue(row: RowType, key: string): string | number {
  // Mapeia key -> valor do row, com defaults adequados
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

**Benefícios:**
- UX consistente em todo o módulo PCP
- Facilita análise exploratória sem precisar exportar pra Excel
- Ordenação client-side (instantânea, sem chamada ao backend)
- Não afeta performance mesmo com centenas de linhas
