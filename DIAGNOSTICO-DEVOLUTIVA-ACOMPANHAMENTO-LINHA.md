# Devolutiva 25/08 — Acompanhamento por Linha: respostas e diagnóstico

**Data da apuração:** 06/10/2026 · **Tela:** Relatórios › Acompanhamento por Linha

Todos os números abaixo foram apurados direto na base, não são estimativas.

---

## Resumo

Dos 5 pontos da devolutiva:

| # | Pedido | Situação |
|---|---|---|
| 1 | Totais de VENDA R$ não batem com o Excel | ✅ **Corrigido** |
| 2 | Total de COB MESES não bate com o Excel | ℹ️ **Não era erro** — explicação abaixo |
| 3 | Cálculo da cobertura A.A. está errado | ⚠️ **Confirmado, mas a causa é o dado do TOTVS**, não a fórmula |
| 4 | Card de meta diária | ✅ **Entregue** |
| 5 | Peças em trânsito (3 colunas) | ⛔ **Bloqueado** — ver "Achado crítico" |

Durante a apuração do item 5 encontramos uma **falha de sincronização do TOTVS que
começou em 25/06/2026 e segue ativa**, afetando telas que já estão no ar. Isso é mais
urgente que o pedido original e está detalhado no fim deste documento.

---

## 1. Totais de VENDA R$ — corrigido

**Confirmado.** Em setembro/2026, a linha TOTAL mostrava R$ 976.922 enquanto a soma da
coluna dava R$ 976.923.

A causa é a que vocês apontaram: cada linha era arredondada para real inteiro antes de
somar, mas o total era calculado somando os centavos e arredondando no fim. Somar
valores já arredondados não dá o mesmo que arredondar a soma.

**O que mudou:** o total passou a ser a soma dos mesmos valores exibidos nas linhas.
Agora dá para conferir o total na mão. Vale também para VENDA PÇ, ESTOQUE e EM PRODUÇÃO,
que tinham o mesmo comportamento.

## 2. Total de COB MESES — não é um erro

O valor que a exportação grava na célula de TOTAL é **exatamente o mesmo da tela**. Não
há divergência entre dashboard e Excel nesse campo.

A diferença (5,6 na tela vs 7,68) aparece quando se tira a **média da coluna** no Excel.
Cobertura não pode ser somada nem promediada entre categorias, porque cada uma tem um
volume de venda diferente:

- **Média simples das linhas** (o que o Excel calcula com `MÉDIA`): 7,97 meses — uma
  categoria que vende quase nada mas tem estoque puxa o número para cima com o mesmo
  peso de uma categoria que vende muito.
- **Cobertura real da rede** (o que a linha TOTAL mostra): 5,5 meses =
  estoque total ÷ venda média mensal total.

O número da linha TOTAL é o correto. Para deixar isso explícito, a observação passou a
sair no cabeçalho da planilha exportada.

## 3. Cobertura A.A. — vocês têm razão, mas a causa é o histórico do TOTVS

A fórmula da coluna A.A. é a mesma da coluna atual e está correta. O problema é o
**estoque histórico**, que o TOTVS registrou de forma muito mais esparsa no passado:

| Posição de estoque | SKUs com saldo | Peças |
|---|---|---|
| 30/09/2025 | 1.524 | **10.901** |
| 30/09/2026 | 6.040 | **263.812** |

A captura de saldo ficou drasticamente mais densa a partir de 2026 (o volume de
registros por ano saltou de ~43 mil para ~113 mil no estoque físico, e de ~1 mil para
~70 mil no estoque de segunda qualidade). Não é que a rede tivesse 24x menos estoque há
um ano — é que boa parte do estoque de 2025 nunca foi registrada.

**Consequência:** a coluna COB MESES A.A. é um **piso**, sempre menor que a cobertura
real da época. Ela serve para comparar tendência entre categorias no mesmo período, mas
não como valor absoluto.

**O que fizemos:** mantivemos a coluna, agora marcada com `*` e com aviso na tela e na
planilha. Preferimos sinalizar a limitação a esconder o dado ou publicar um número que
pareça confiável e não seja.

## 4. Card de meta diária — entregue

Card **"Meta do Período"** adicionado, com a fórmula pedida:
`(meta mensal ÷ dias do mês) × dias do período selecionado`. O subtítulo mostra o
equivalente por dia e quantos dias o filtro cobre.

Também corrigimos um impedimento: o total de meta só aparecia se **todas** as
classificações tivessem meta cadastrada. Como sempre existe a linha "SEM CLASSIFICAÇÃO"
(vendas sem categoria no cadastro), que nunca terá meta, o total ficava permanentemente
em branco. Agora o total soma as metas cadastradas e o percentual de atingimento compara
apenas a venda das classificações que têm meta — assim o indicador não fica distorcido
por quem não tem meta.

Fica em branco quando não há nenhuma meta no período, como solicitado.

## 5. Peças em trânsito — não é possível entregar hoje

Os três pedidos (coluna de trânsito, coluna estoque + trânsito, e cobertura sobre
estoque + trânsito) dependem do mesmo dado, que hoje não existe de forma utilizável.
Três motivos independentes:

**a) Desde 25/06/2026 o TOTVS não envia os itens das transferências.** Os documentos
chegam, mas sem as peças — ou seja, sabemos que houve transferência, mas não o que foi
transferido. Sem item, não há peça para contar. Detalhes no achado crítico abaixo.

**b) O saldo pendente histórico não representa mercadoria em trânsito.** Somando tudo
que saiu e não teve entrada registrada (103.820 peças):

- **83%** (86.262 peças) é Fábrica → Fábrica, movimentação interna;
- **15%** (15.169 peças) é de lojas já fechadas — Terrazo, Mart Moda, Mossoró e Via Sul.
  É resíduo contábil de mercadoria que saiu antes do fechamento e cuja entrada nunca foi
  baixada; vai ficar "pendente" para sempre;
- **~2%** (2.389 peças) é de loja aberta.

**c) O pendente mais recente tem 105 dias.** Não existe um único caso de "saiu há poucos
dias e ainda não chegou". Quando há dado, a transferência é baixada rapidamente no TOTVS
— o que sobra depois de meses é atraso de lançamento, não caminhão na estrada.

**O que destravaria:** (i) corrigir a sincronização dos itens (item crítico abaixo) e
(ii) o TOTVS expor o status de romaneio/guia de transferência em aberto, que é o que
identifica de verdade uma remessa não recebida. Com o saldo agregado que temos hoje, a
coluna mostraria quase só resíduo de loja fechada — um número que induziria a decisão
errada de compra e produção.

---

## ⚠️ Achado crítico — sincronização de itens parada desde 25/06/2026

Encontrado durante a apuração do item 5. **Não tem relação com a devolutiva e é mais
urgente que ela.**

### O que está acontecendo

O processo que traz os dados do TOTVS parou de gravar os **itens** de quase toda
operação que não seja venda. Os documentos continuam chegando normalmente; apenas o
conteúdo (produtos e quantidades) não vem.

Documentos **com itens** / total de documentos:

| Operação | jul/26 | ago/26 | set/26 | out/26 | |
|---|---|---|---|---|---|
| Venda | 6987/6987 | 5800/5800 | 5270/5270 | 817/817 | ✅ ok |
| Devolução de venda | 668/668 | 608/608 | 564/564 | 110/110 | ✅ ok |
| Compra de materiais de uso/consumo | 17/17 | 12/12 | 10/10 | 6/6 | ✅ ok |
| **Saída de transferência** | 0/622 | 0/643 | 0/493 | 0/81 | ❌ |
| **Entrada de transferência** | 0/531 | 0/563 | 0/462 | 0/74 | ❌ |
| **Compra de matéria-prima** | 0/157 | 0/137 | 0/140 | 0/19 | ❌ |
| **Industrialização e consignação** | 0 | 0 | 0 | 0 | ❌ |

**Data exata do corte: 25/06/2026.** Nesse dia, de 31 documentos de entrada, apenas 1
veio com itens. De 26/06 em diante, nenhum.

Verificado documento a documento: a transferência `8/915457`, de 05/10/2026, tem zero
itens; uma venda do mesmo dia e da mesma loja tem itens normalmente.

### O que já está errado nas telas por causa disso

1. **Relatório Base — coluna ÚLT. ENTRADA.** Como as lojas recebem mercadoria por
   transferência, a última entrada está **congelada em 24/06/2026** para todo produto
   que chega por esse caminho. A tela mostra uma data que já passou de 3 meses como se
   fosse a mais recente.

2. **Estoque Sem Giro — filtro de maturação.** O filtro que protege produto recém-chegado
   de ser marcado como "sem giro" depende da data de primeira entrada. Produto que chegou
   à loja depois de 25/06 não tem entrada registrada, e nesse caso o sistema o trata como
   se já estivesse maduro — podendo marcá-lo como parado logo após a chegada. Hoje há
   **8.337 combinações produto+loja com estoque e sem nenhuma entrada registrada**, de
   28.488 no total (29%).

3. **Qualquer relatório futuro de entrada, compra, transferência ou produção** nasce
   com o mesmo problema enquanto isso não for corrigido.

**Vendas e devoluções não são afetadas** — faturamento, metas, comissões, Curva ABC,
Venda do Dia e o próprio Acompanhamento por Linha continuam corretos.

### O que precisa ser corrigido

O padrão sugere que a rotina de sincronização passou a buscar itens apenas para
operações de venda e devolução de venda (as duas que continuam funcionando, mais a
compra de materiais de uso/consumo). Provavelmente um filtro de tipo de operação foi
introduzido ou estreitado por volta de 25/06/2026 na etapa que baixa os itens.

Duas ações:

1. **Remover a restrição** para que os itens voltem a ser gravados para todas as
   operações.
2. **Reprocessar de 25/06/2026 até hoje**, porque os documentos já existem na base sem
   os itens e não serão revisitados automaticamente — a gravação é por documento e já
   marca como processado.

Enquanto isso não for feito, não há como entregar nenhuma visão de trânsito, entrada ou
compra, e as duas telas citadas acima seguem mostrando informação desatualizada.
