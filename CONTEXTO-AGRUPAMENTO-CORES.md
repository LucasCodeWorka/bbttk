# Handoff — Agrupamento de Cores no PCP + restauração da Performance Coleção

> Arquivo de contexto para continuar o trabalho em outra ferramenta (Codex CLI).
> Escrito em 22/09/2026. Leia `AGENTS.md` primeiro (contexto geral do projeto);
> este arquivo cobre só o que foi feito nesta rodada e o que falta.
>
> Continuação em 22/09/2026: as telas foram validadas no Chromium e receberam
> correções adicionais. Ver seção 8; os itens "não validado" abaixo descrevem
> o estado anterior a essa continuação. Tudo continua no working tree.

---

## 1. Estado do git — NADA FOI COMMITADO

```
branch: main
HEAD:   aae16cb "Otimiza memoria do relatorio base PCP"  (= limes/main, puxado em 22/09)
origin/main e limes/main: 8a116ca (atrás — main local está à frente por causa do merge)
```

**Todo o trabalho está no working tree, sem commit, por pedido explícito do usuário**
("quando finalizar nao comita nada vou fazer o teste e mesmo venho te liberar para
comitar"). Não commitar/publicar sem ele liberar.

### Arquivos modificados
```
apps/pcp-api/src/index.ts                                  (registra rota nova)
apps/pcp-api/src/routes/analiseGrade.routes.ts             (param agruparPorCorSalva)
apps/pcp-api/src/routes/curvaAbc.routes.ts                 (param)
apps/pcp-api/src/routes/dashboardEstoque.routes.ts         (param)
apps/pcp-api/src/routes/estoque.routes.ts                  (param)
apps/pcp-api/src/routes/relatorioBase.routes.ts            (param)
apps/pcp-api/src/services/analiseGrade.service.ts          (toggle)
apps/pcp-api/src/services/curvaAbc.service.ts              (toggle)
apps/pcp-api/src/services/dashboardEstoque.service.ts      (toggle + fix cache key)
apps/pcp-api/src/services/estoque.service.ts               (toggle + refactor agregação)
apps/pcp-api/src/services/performanceColecao.service.ts    (RESTAURAÇÃO completa)
apps/pcp-api/src/services/relatorioBase.service.ts         (helpers compartilhados + drill-down por cor)
apps/web/src/app/(dashboard)/pcp-analise-grade/page.tsx    (checkbox)
apps/web/src/app/(dashboard)/pcp-curva-abc/page.tsx        (checkbox, só visão SKU)
apps/web/src/app/(dashboard)/pcp-dashboard-estoque/page.tsx(checkbox)
apps/web/src/app/(dashboard)/pcp-novo/page.tsx             (checkbox)
apps/web/src/app/(dashboard)/pcp-performance-colecao/page.tsx (RESTAURAÇÃO completa)
apps/web/src/app/(dashboard)/pcp-relatorio-base/page.tsx   (drill-down por cor + checkbox)
apps/web/src/components/layout/Sidebar.tsx                 (item de menu novo)
apps/web/src/lib/pcpApi.ts                                 (tipos + params de todos acima)
apps/web/src/lib/permissions.ts                            (rota nova → pcp_servico)
```

### Arquivos novos
```
apps/pcp-api/src/services/agrupamentoCoresCobertura.service.ts
apps/pcp-api/src/routes/agrupamentoCoresCobertura.routes.ts
apps/web/src/app/(dashboard)/pcp-agrupamento-cobertura/page.tsx
apps/web/src/lib/gradeOrdem.ts        (GRADES/tamanhoNormalizado/ordemGrade compartilhado)
```

> `.claude/settings.local.json` também aparece modificado — é config local de permissões,
> **não incluir em commit**.

---

## 2. Contexto crítico: a regressão que motivou metade do trabalho

Em 14/09 publicamos na `limes/teste` a Performance Coleção corrigida (7 bugs da
devolutiva) + drill-down por cor/tamanho. Em 15/09 o Marcelo commitou
`2be3f51 "Ajusta performance de colecao e pool comercial"` que **reverteu tudo isso** —
ele tinha uma cópia mais antiga do arquivo e a versão dele prevaleceu no merge dele.
Quando puxamos `limes/main` (22/09), a regressão veio junto: coluna "GRUPO", custo
pelo `config.custoCode` (zera em coleção nova), `entrouDpa`/`qtdeProduzida`, `giro`
único, markup como razão crua, zero drill-down.

**Reaplicamos tudo manualmente em cima do estado atual** (não `git revert`), porque no
meio disso o Marcelo adicionou uma feature legítima que precisava ser preservada: o card
**"Resumo de Produção da Coleção"** (`PerformanceColecaoResumoProducao`). Ele foi mantido
e **recalculado** sobre a métrica correta (`qtde_entregue` de `ops_em_producao` em vez do
`qtde_produzida` da CTE `entradas`, que vinha de documento fiscal de entrada — fonte
errada). Validado: `resumoProducao.pecas === kpis.qtdeEntregue` (219 = 219).

⚠️ **Risco de repetir**: na próxima publicação isso vai conflitar com o que o Marcelo
tem em `limes/main`/`limes/teste`. Combinar com ele antes de subir.

---

## 3. O que foi implementado

### 3.1 Aba nova: "Cobertura do Agrupamento de Cores"
Rota `/pcp-agrupamento-cobertura` (menu Relatórios), módulo `pcp_servico`.
Endpoint: `GET /api/pcp/agrupamento-cores/cobertura` (sem filtros, retorna tudo).

- **3 KPIs**: grupos criados (24), cores agrupadas (5.594), referências atingidas (2.464)
- **Tabela antes/depois**: abre "sem agrupamento" (1 linha por referência+cor original,
  5.594 linhas); botão "Ver com agrupamento" colapsa **no cliente** por
  `referenceCode|corAgrupada` → 4.424 linhas (1.170 colapsaram, 646 linhas juntando 2+
  cores). Maior caso: `003 BB CST001T` = 15 cores → 1 linha ("amarelo claro", 97 SKUs).
- Soma de SKUs idêntica nos dois modos (24.252) — colapso não perde nem duplica.
- Backend devolve o grão fino; o colapso é JS na página (dataset único, sem 2ª chamada).

### 3.2 Toggle "Agrupar por Agrupamento de Cores" em 5 relatórios

Param HTTP em todos: `?agruparPorCorSalva=true`. Checkbox hand-rolled (o projeto não tem
componente Switch — convenção é `<label><input type="checkbox">`).

| Relatório | Arquivo service | Como agrupa | Validado ao vivo |
|---|---|---|---|
| Estoque Sem Giro (`/pcp-novo`) | `estoque.service.ts` | `chaveAgregacao()`: `product_sku` → `ref\|cor_de_para\|tamanho` | 2.314 → 1.940 linhas |
| Curva ABC por SKU (`/pcp-curva-abc`) | `curvaAbc.service.ts` | mescla `brutos` por `ref\|cor\|tam` **antes** de calcular curva/rank | 37.090 → 31.901 linhas, somas idênticas (69.373 pçs / R$ 4.061.945,13 / 88.818 est) |
| Análise de Grade (`/pcp-analise-grade`) | `analiseGrade.service.ts` | chave da célula: `product_sku` → `cor\|tamanho` | ref `001 001 ACE285`: 4 células (LISTRA AMARELA/AZUL/ROSA/VERDE) → 1 ("listrados") |
| Análise de Estoque (`/pcp-dashboard-estoque`) | `dashboardEstoque.service.ts` | troca a definição de `cor` na CTE `produtos_filtrados` — tudo deriva dela | 5.909 → 5.448 células, quantidade idêntica (84.817) |
| Visão Geral (`/pcp-relatorio-base`) | `relatorioBase.service.ts` | drill-down novo **por cor** (ver 3.3) | `003 BB CST413`: 85 → 55 linhas de cor; payload 81KB → 59KB |

### 3.3 Visão Geral: drill-down por SKU → por COR (ideia do usuário)

O Marcelo havia **esvaziado** o drill-down por SKU no commit `aae16cb` ("Otimiza memoria
do relatorio base PCP"): o backend passou a devolver `skus: []` sempre vazio, mas o
frontend continuava com o código de renderizar (expansão vazia) e o export Excel com
colunas COR/TAMANHO sem dados.

Decisão do usuário: **em vez de restaurar por SKU (pesado), colocar por COR** — "é
justamente para isso que o agrupamento serve". Mais leve e ainda útil.

O que mudou:
- `RelatorioBaseRow` (por SKU) **removido** dos tipos → novo `RelatorioBaseCorRow`
  (`cor`, `refCor`, `coresOriginais`, `totalSkus`, custo/pdv/markup, emProducao, estTt,
  giroTt1/3/6, branches).
- `RelatorioBaseReferenciaRow.skus` → `.cores`.
- No loop principal: novo `coresAgg: Map<corExibicao, CorAcumulado>` por referência,
  acumulando est/giro por filial (pra recalcular cobertura certa, não somar arredondado).
- `materializarCores()` roda **só nas referências da página atual** (`rowsPaginadas`) —
  é o que mantém o payload pequeno e respeita a preocupação de memória do Marcelo.
- Frontend: `COLUNAS_SKU_DETALHE` → `COLUNAS_COR_DETALHE`; colunas de identidade do SKU
  (código, categoria, linha, gênero, modelo, lanç, últ. entrada, descrição) viram "—"
  porque são da referência, não da cor. Subtítulo da célula mostra
  `N SKUs · N cores agrupadas`.
- Export Excel: grão referência+cor, com colunas `REFERÊNCIA`, `COR`, `CORES AGRUPADAS`,
  `SKUS` e a identidade da referência repetida em cada linha (pra ficar pivotável).

**Redução**: `003 BB CST413` tem 619 SKUs → 85 linhas de cor (sem agrupar) → 55 (com).
~11x menos que o drill-down por SKU original.

### 3.4 Helpers SQL compartilhados (em `relatorioBase.service.ts`)

Extraídos pra não repetir o par de LEFT JOIN em 5 lugares. **Exigem alias `a` para
`produto_analitico`**:

```ts
AGRUPAMENTO_COR_JOIN   // LEFT JOIN agrupamento_membros am + agrupamento_grupos ag
COR_AGRUPADA_SELECT    // NULLIF(TRIM(ag.nome), '')  → nome do grupo ou NULL
COR_EXIBICAO_SELECT    // COALESCE(grupo, color_name, color_code, 'SEM COR')
```

Modelo de dados (já existia): `agrupamento_grupos` (id, tipo='cor_produto', nome) e
`agrupamento_membros` (grupo_id, tipo, reference_code, color_code, color_name,
**color_match_key** = color_code com fallback color_name). Um membro = um par
(referência, cor) → grupo. Unique `(tipo, reference_code, color_match_key)`: uma
cor de uma referência só pode estar em um grupo.

### 3.5 Performance Coleção restaurada
Ver seção 2. Itens: coluna COLEÇÃO (não GRUPO), `CUSTO_PRODUCAO_CODE` (cost_code=1),
`markupPercentual()` (percentual real, não razão), `qtdesLiberadas`/`qtdeEntregue`/
`saldoAEntregar`/`percentEntregue` via `ops_em_producao` (CTE `producao`, não `entradas`),
`giroPeriodo` + `giroAteHoje` (CTEs `estoque_atual`/`vendas_ate_hoje` sem corte de data),
drill-down Referência→Cor→Tamanho (`montarArvore()`), export Excel no grão fino,
`resumoProducao` preservado e recalculado.

---

## 4. Pegadinhas / decisões que precisam ser respeitadas

1. **NÃO mexer no `agruparPorCor` do Raio X.** É outra feature (junta todas as cores de
   uma referência numa linha, sem relação com o Agrupamento de Cores). O checkbox existe
   no frontend e está morto no backend (`raioX.service.ts` linhas 16/51/362 — só comentário,
   nunca lido em `getRaioX`). Bug separado, não foi tocado de propósito.
   Além disso, o Raio X **sempre** aplica o agrupamento (`cor_agrupada || corOriginal`),
   sem toggle — comportamento antigo, mantido.

2. **Duas chaves de cache tiveram que incluir o novo param** — se esquecer, o toggle
   devolve dado errado:
   - Backend: `dashboardEstoqueCacheKey()` em `dashboardEstoque.service.ts`
   - Frontend: `cacheKey` do sessionStorage em `pcp-relatorio-base/page.tsx`
     (usa `JSON.stringify(filtro)`, então basta o campo estar no objeto `filtro`)

3. **No Estoque Sem Giro os totais MUDAM ao ligar o toggle — é esperado, não bug.**
   `dias_sem_giro` de um grupo é o `Math.min` dos SKUs mesclados; se qualquer cor do
   grupo vendeu recentemente, o grupo inteiro pode sair do bucket ">90 dias sem giro".
   É a mesma regra que já existia pra mesclar filiais do mesmo SKU. Usuário foi avisado
   e precisa validar se a regra faz sentido pro negócio.

4. **Relatórios deixados de fora de propósito** (não têm dimensão de cor no resultado):
   Performance Coleção (já tem drill-down próprio por cor/tamanho), Venda do Dia,
   Acompanhamento por Linha, Venda e Desconto, Resumo Promoção, Pesos e Grades
   (color-blind por design — corte é por referência+tamanho), Em Produção (cor é
   `STRING_AGG` de exibição, não dimensão agrupável).

5. **Nomes de grupo inconsistentes no cadastro**: "Azul claro" (maiúscula) vs
   "azul escuro" (minúscula). Não é bug do relatório — é como o pessoal nomeou.
   Se padronizar, é na tela `/pcp/agrupamento-cores`.

6. **`/tmp` no git-bash ≠ `/tmp` no Node (Windows)**: Node resolve `/tmp` como `C:\tmp`.
   Scripts de verificação precisam de path Windows absoluto. Use o scratchpad da sessão.

7. **Convenção de scripts de diagnóstico**: criar em `apps/pcp-api/scripts/` ou
   `apps/api/scripts/`, rodar com `npx tsx`, e **apagar depois** (`rm -f`). Nenhum ficou
   pra trás nesta rodada.

8. `apps/api/scripts/mint-test-token.ts` (untracked, deixar quieto) gera JWT admin:
   `cd apps/api && npx tsx scripts/mint-test-token.ts`

---

## 5. O que está validado e o que NÃO está

### Validado
- `npx tsc --noEmit` limpo nos **3 apps** (api, pcp-api, web) — última execução 22/09.
- ESLint: sem erro novo. Os erros que aparecem (`react-hooks/set-state-in-effect`,
  `static-components`, unused vars) são **pré-existentes** e aparecem igual em páginas
  não tocadas (confirmado rodando lint em `pcp-relatorio-base` e `relatorios/venda-dia`
  antes das mudanças). Arquivos novos (`pcp-agrupamento-cobertura/page.tsx`,
  `gradeOrdem.ts`) estão 100% limpos.
- Cada toggle testado ao vivo via curl nos dois modos, conferindo que **somas se
  preservam** e **contagem de linhas cai** (números na tabela da seção 3.2).
- Aba nova: dados reais conferidos (KPIs + colapso + soma preservada).

### NÃO validado
- **Nada foi testado visualmente no navegador** (sem ferramenta de browser na sessão).
  Layout, fluidez da tabela de 5.594 linhas, posição dos checkboxes: tudo por validar.
- **Visão Geral (`/pcp-relatorio-base`): o frontend não foi testado nem carregando.**
  O backend foi validado por curl (85→55 linhas de cor, somas batendo), e o `tsc` passa,
  mas depois das mudanças de frontend os dev servers caíram e a página não foi
  reaberta. **É o item de maior risco — testar primeiro.**
- `npm run build` (produção) não foi rodado — só `tsc --noEmit`.
- Nenhum teste automatizado (o projeto não tem suíte).

### Dev servers
Estavam rodando e caíram no fim da sessão. Subir com:
```bash
cd /c/bbtl/bbttk && npm run dev      # api 3001 + web 3000 + pcp-api 3002
```
Health: `curl http://localhost:3002/health`

---

## 6. Próximos passos

1. **Testar a Visão Geral** (`/pcp-relatorio-base`): abrir, expandir uma referência,
   conferir se as linhas de cor aparecem, se os números batem com o total da referência,
   e se o export Excel sai correto. É o que ficou menos validado.
2. Teste visual das outras 5 telas + aba nova (o usuário ia fazer isso).
3. Validar com o time a regra de `dias_sem_giro` no modo agrupado (item 4.3).
4. **Ao publicar** (só quando o usuário liberar):
   - Combinar com o Marcelo pra não repetir a regressão da Performance Coleção.
   - Criar o `.md` de changelog em `apps/api/content/entregas/` (convenção do
     AGENTS.md — parte do ato de publicar, não do de construir).
   - Atualizar `AGENTS.md`: documentar os helpers `AGRUPAMENTO_COR_JOIN`/
     `COR_AGRUPADA_SELECT`, o param `agruparPorCorSalva`, a troca de drill-down por SKU
     → por cor na Visão Geral, e o `gradeOrdem.ts` compartilhado (exceção consciente à
     convenção "cada tela sua cópia").
   - `git fetch` nos dois remotes + merge antes do push (AGENTS.md).
   - Não commitar `.claude/settings.local.json` nem os CSVs/docx soltos da raiz.
5. Bug aberto e não tocado: checkbox morto do Raio X (item 4.1).
6. Bug pré-existente achado e não tocado: `permissions.ts` — `/pcp-performance-colecao`
   cai no catch-all `/pcp` (módulo `pcp`) em vez de `pcp_servico`, porque `startsWith`
   não respeita limite de segmento. Impacto só no gate de navegação do frontend (o
   backend continua exigindo `pcp_servico`), mas vale corrigir junto algum dia.

---

## 7. Comandos de verificação usados

```bash
# token
cd apps/api && npx tsx scripts/mint-test-token.ts

# aba nova
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3002/api/pcp/agrupamento-cores/cobertura"

# qualquer toggle: comparar os dois modos
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3002/api/pcp/estoque-sem-giro?dias=91&limit=all"
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3002/api/pcp/estoque-sem-giro?dias=91&limit=all&agruparPorCorSalva=true"

# Visão Geral (o menos validado)
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3002/api/pcp/relatorio-base?page=1&pageSize=3"
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3002/api/pcp/relatorio-base?page=1&pageSize=3&agruparPorCorSalva=true"

# outros: curva-abc/resumo-sku, analise-grade?referencia=001%20001%20ACE285,
#         dashboard-estoque?data=2026-09-22
```

Referências úteis para conferir o colapso:
- `001 001 ACE285` — 4 cores LISTRA* no grupo "listrados"
- `003 BB CST001T` — 15 cores no grupo "amarelo claro"
- `003 BB CST413` — 619 SKUs, 85 cores originais → 55 agrupadas

---

## 8. Continuação — validação no navegador (22/09/2026)

### Correções encontradas durante a validação

- **CORS local** (`apps/pcp-api/src/index.ts`): a lista permitia apenas as origens
  do Render. Curl passava, mas o navegador bloqueava todas as chamadas PCP em
  localhost. Adicionadas `http://localhost:3000` e `http://127.0.0.1:3000` somente
  quando `NODE_ENV !== 'production'`. Origem desconhecida continua sem permissão.
- **Pool do Relatório Base**: a abertura completa falhou repetidamente com Prisma
  P2024 (16 consultas disparadas juntas, pool local de 13 conexões). As consultas
  auxiliares agora rodam em quatro lotes de quatro. Após o ajuste, as execuções
  completas estabilizaram em cerca de 18–26 s de processamento nesta máquina;
  consultas filtradas ficaram em cerca de 2–5 s. A fila de relatórios pode aumentar
  o tempo total observado no navegador.
- **Busca da Visão Geral**: incluiu `reference_code` no filtro SQL. Antes, pesquisar
  o código completo da referência não encontrava os exemplos deste handoff.
- **Excel da Visão Geral**: agora envia `dataPosicao`, preservando a data da tela.
- **Detalhamento por cor**: o deslocamento da coluna fixa Descrição agora respeita
  os 140 px de Cor; antes sobrepunha 40 px durante a rolagem horizontal.
- **Cor no Estoque Sem Giro**: a árvore e o Excel usavam sempre `cor_de_para`,
  inclusive com o toggle desligado; cores sem grupo apareciam como "SEM COR".
  A API agora devolve `cor` como a cor efetivamente exibida (original no modo
  desligado, grupo com fallback para original no modo ligado). A tabela e o Excel
  usam esse campo. A regra de dias sem giro e seus totais não foi alterada.

### Evidências de validação

Testes com Chromium/Playwright, autenticação real, dados reais e leitura dos XLSX
baixados pelo botão da tela. Scripts temporários removidos ao encerrar.

- **Visão Geral**: abertura completa (3.380 referências, 226 páginas), expansão,
  toggle desligado → ligado → desligado, cache da sessão, soma das cores vs.
  referência (SKUs, estoque, produção, giros 1/3/6 e estoque/giro por filial).
  Nove downloads Excel conferidos para as três referências nos três estados:
  - `003 BB CST413`: 85 → 55 cores, 619 SKUs; estoque 4.833 nos dois modos.
  - `001 001 ACE285`: 4 → 1 cor (`listrados`), 4 SKUs.
  - `003 BB CST001T`: **97 → 67 cores**, 640 SKUs.
- **Excel histórico**: posição 31/08/2026, `CST413`, agrupado: 55 linhas,
  estoque 5.787; somas da planilha iguais às da tela.
- **Excel de várias páginas**: busca `003 BB CST4`, posição 31/08/2026,
  agrupado: tela com 63 referências em 5 páginas; Excel com as 63 referências
  e 297 linhas referência+cor, estoque total preservado.
- **Rolagem**: verificação geométrica no navegador confirmou ausência da
  sobreposição Cor/Descrição após o ajuste; modo "Ver por loja" exercitado.
- **Cobertura do Agrupamento**: 24 / 5.594 / 2.464 nos KPIs, 5.594 → 4.424
  linhas, soma 24.252 SKUs preservada. Alternância levou aproximadamente 1,7–2,4 s
  nesta máquina; busca e renderização conferidas.
- **Análise de Grade**: `ACE285`, 4 células → 1 `listrados`, detalhe aberto.
- **Análise de Estoque**: toggle + **Atualizar** (essa tela aplica os filtros pelo
  botão); 5.919 → 5.453 células, 85.221 peças e R$ 1.447.768,49 preservados;
  expansão por cor/tamanho e retorno ao modo original conferidos.
- **Estoque Sem Giro**: abertura, toggle e "Expandir"; tabela e dois downloads
  Excel dos Top 10 conferidos após corrigir as cores. Ex.: `VERDE ESCURO 36`
  vira `verde escuro`; `CINZA` e `AZUL MARINHO.` preservam a cor original quando
  não têm grupo. Totais diferentes entre modos continuam sendo esperados.
- **Curva ABC por SKU**: 37.113 → 31.924 linhas; somas de quantidade vendida,
  valor vendido e estoque preservadas, busca e renderização de `ACE285` agrupada
  conferidas. As execuções finais não apresentaram erros de console.
- **Build final**: `npm.cmd run build` passou nos três apps após todas as correções
  (Next.js com 28 páginas geradas + TypeScript das duas APIs). `git diff --check`
  também passou. Serviços deixados em execução nas portas 3000/3001/3002.

Os números de estoque/cadastro diferem um pouco da seção 3.2 porque os dados reais
mudaram entre as verificações. Outra correção importante do handoff: **as 15 cores
de `CST001T` são apenas o subconjunto do grupo amarelo claro (97 SKUs)**. A referência
possui outros grupos: 11 linhas na aba de cobertura, que lista somente cores
cadastradas no agrupamento; na Visão Geral entram também as cores não agrupadas.

Nenhum commit, push, stash ou troca de branch foi feito. Raio X permaneceu intocado.
Continua pendente a aprovação do dono para publicar e a validação de negócio da
regra de dias sem giro do modo agrupado. A Performance Coleção não recebeu alterações
nesta continuação; seu risco de regressão em futuros merges permanece o da seção 2.

### Correção após teste do dono — checkbox da Análise de Estoque

O dono mostrou `004 BB TAP027T` em 23/09/2026 com o checkbox ligado e cores originais.
O teste anterior havia clicado em **Atualizar** depois do checkbox; marcar sozinho
não recarregava a tabela. Corrigido: o checkbox agora aplica imediatamente o novo
valor, mantém a referência expandida e fica desabilitado durante o carregamento.
Os demais filtros continuam seguindo o botão Atualizar.

Validado no Chromium sem clicar em Atualizar entre alternâncias: `TAP027T`, posição
23/09/2026, **116 → 100 → 116 → 100 linhas cor/tamanho**, sempre **2.101 peças**.
Renderização da referência aberta e respostas de cache HIT nos dois modos conferidas;
cores sem vínculo cadastrado continuam com seus nomes originais. TypeScript do web
passou (`tsc --noEmit`). Script temporário removido; nenhum commit/publicação.

## 9. Auditoria de todos os pontos do agrupamento

Após o relato de que o checkbox não agrupava, foram revisados os cinco caminhos
completos (checkbox → client → rota → serviço → detalhe/Excel), os dois caches e
a aba de cobertura. Também foram inspecionados os outros relatórios para identificar
onde o cadastro já é utilizado e onde não foi integrado.

### Correções adicionais

- Os cinco carregadores agora identificam a requisição mais recente e ignoram
  respostas/erros antigos. Antes, alternar rapidamente o checkbox podia deixar a
  seleção em um modo e os dados no outro, dependendo da ordem das respostas.
- Na Visão Geral, a identificação acontece **antes de ler sessionStorage**, pois
  voltar ao modo original pelo cache também precisa invalidar uma consulta agrupada
  ainda em andamento. As chaves de cache continuam incluindo `agruparPorCorSalva`.
- Excel fica desabilitado durante a atualização nas quatro telas que exportam
  (Visão Geral, Grade, ABC e Sem Giro). Evita baixar os dados do modo anterior
  enquanto o checkbox já indica o novo modo. Análise de Estoque não possui Excel.
- Falha na consulta atual limpa os dados anteriores, evitando exibir um resultado
  incompatível com o filtro selecionado.

### Verificação no Chromium após os ajustes

Dados reais, autenticação real e downloads reais, sem alterar cadastro ou estoque.
Nos quatro relatórios com Excel, uma resposta agrupada real foi retida no navegador;
o checkbox foi desligado, o modo original carregou, e só então a resposta antiga foi
liberada. O Excel permaneceu igual ao original. Depois foram conferidos os modos
ligado e desligado novamente (16 downloads ao todo); a exportação ficou bloqueada
durante o carregamento. Nenhum erro de execução JavaScript nesses testes.

| Tela | Resultado |
|---|---|
| Visão Geral | `ACE285`: 4 → 1 (`listrados`) → 4; detalhe por cor, Excel e retorno pelo cache |
| Análise de Grade | `ACE285`: 4 → 1 → 4 detalhes; matriz aberta e as duas abas do Excel |
| Curva ABC — Por SKU | `ACE285`: 4 → 1 → 4 itens; Excel acompanha o modo |
| Estoque Sem Giro | Top 10: cores/valores agrupados diferentes e retorno exato ao Excel original; regra de dias preservada |
| Análise de Estoque | `TAP027T`: 116 → 100 → 116 → 100 linhas, 2.101 peças; sem clicar Atualizar, mantendo expansão |
| Cobertura do Agrupamento | `ACE285`: 4 → 1 → 4; KPIs 24 grupos / 5.594 cores / 2.464 referências |

`npm.cmd run build` passou novamente nos três apps. A tentativa inicial no sandbox
falhou no download da fonte Inter; a execução com rede passou. `git diff --check`
sem erros. Script de auditoria temporário removido. Nenhum commit/publicação.

### Alcance e lacunas encontrados no código

- O agrupamento é **por referência e grupo cadastrado**; Grade, ABC e Análise de
  Estoque preservam tamanho. Sem Giro também preserva tamanho. Visão Geral detalha
  por cor, somando tamanhos. Cores sem vínculo mantêm a cor original.
- **Raio X** já aplica `cor_agrupada || corOriginal` automaticamente. Seu checkbox
  antigo `agruparPorCor` é outra função, continua fora de escopo e não foi alterado.
- **Performance Coleção** mantém o drill-down por cor original/tamanho, conforme a
  exclusão expressa da seção 4; não recebeu o novo toggle.
- **Sugestão de Produção** é uma lacuna não mencionada na lista da seção 4:
  apresenta cor/tamanho, mas usa `color_name` original e calcula sugestão/corte mínimo
  por SKU. Não recebeu agrupamento. Uma futura integração precisa definir se soma
  sugestões já calculadas ou recalcula déficit e corte mínimo para o grupo — essas
  operações produzem resultados diferentes. Nenhuma regra foi inventada nesta auditoria.
- **Redistribuição** usa SKU físico para transferir estoque; não usa agrupamento salvo.
- **Venda do Dia, Acompanhamento por Linha, Venda e Desconto, Resumo Promoção,
  Pesos e Grades** não possuem dimensão de cor no resultado. **Em Produção** exibe
  cores concatenadas nas ordens, sem o toggle. Permanecem no escopo original.

### Novo print: `010 BB BD186` — cadastro parcial confirmado

O dono voltou a mostrar a Análise de Estoque agrupada, posição 23/09/2026,
com `AZUL 1515`, `AZUL 1911`, `AZUL 2229` e `AZUL 2304` separados. Desta vez
foram consultados os vínculos dessas cores diretamente no banco:

- A referência tem **75 cores no catálogo; 30 vinculadas e 45 sem grupo**.
- Os quatro azuis do print não têm vínculo em `agrupamento_membros`, nem nessa
  referência nem pelo mesmo nome em outras referências. Não é falha na chave do JOIN.
- A consulta real de Análise de Estoque, filtrada nessa referência e data, retorna
  **86 → 73 linhas cor/tamanho**, mantendo **2.681 peças**, ao ligar o agrupamento.
- Exemplo concreto já agrupado: tamanho G de `AMARELO 1624` (1 peça) +
  `AMARELO 2325` (38 peças) = `amarelo claro / G` (39 peças).
- Na resposta agrupada os azuis sem vínculo aparecem primeiro; nomes de grupos
  minúsculos (`amarelo claro`, `amarelo escuro`, `azul escuro` etc.) aparecem depois
  das cores originais maiúsculas na ordenação atual. Isso explica o trecho do print.

Portanto, "cadastro finalizado" no resumo inicial não significa cobertura de todas
as cores: os vínculos desses azuis continuam faltando. Não associar automaticamente
azuis/rosas/verdes a claro/escuro por prefixo; o grupo correto depende do cadastro
feito pela empresa. Nenhum vínculo foi criado/alterado neste diagnóstico. Script
temporário removido.
