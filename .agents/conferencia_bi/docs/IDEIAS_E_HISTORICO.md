# Ideias do Lucas e como a ferramenta evoluiu

Registro de **de onde veio** a ferramenta, as ideias dele e as decisões, para quem for
reaproveitar (inclusive nos projetos da Liebe) entender o porquê, não só o como.

## A ideia original (novembro/2026)

O Lucas cuida do BI da Bebetenkite. As responsáveis de negócio mandam ajustes por
mensagem e numa devolutiva em Word. Depois de corrigir, ele precisava conferir "online"
se a tela publicada atendia. Ideia dele, em palavras próprias:

> "fiquei pensando se a gente criasse um agent para ler a tela e usando codex como motor
> para conferir as alterações online. Eu mando a task aqui, fazemos tudo, você olha a
> solicitação na página, vê a reclamação, depois na outra aba do navegador verifica o
> que foi alterado."

E sobre o custo:

> "acho que precisaria abrir o navegador para ler o link, por isso pensei num agente que
> automatiza com Python a abertura do terminal, abre o Codex e o navegador, controle de
> máquina mesmo, com Python. Você usaria ele como motor; usar só aqui gastaria muito
> token, entende?"

Daí saiu a divisão: **Python** controla o navegador e faz as contas (zero token),
**Codex** compara e redige (barato), **Claude Code** pensa e implementa.

## Linha do tempo

| Passo | O que ganhou a ferramenta | Pedido/ideia que motivou |
|---|---|---|
| 1 | Ler devolutiva do OneDrive, abrir o BI, conferir pontos 6, 7 e 9, relatório em PDF | A ideia de dois abas + Codex como motor |
| 2 | "Documenta isso": prints e/ou mensagem no documento | "me manda no wpp, email ou no próprio doc, o que você acha melhor?" -> PDF |
| 3 | **Prints do próprio sistema** mostrando a mudança | "dizer que fez até papagaio diz" |
| 4 | Devolutiva em `.docx` com os prints da cliente + seção "Análise de Estoque" | A cliente passou a mandar o Word |
| 5 | Documento de aprovação **antes x depois** com a citação literal dela | Cliente aprova lendo as próprias palavras ao lado da prova |
| 6 | Vocabulário da cliente (`_vocabulario_cliente.md`) | Falar a língua dela |
| 7 | PDF **contínuo**, uma página só | "tudo muito afastado", "consegue sem quebrar por página?" |
| 8 | Fluxo antes x depois sem a ferramenta completa (scripts em `exemplos/`) | Demandas pequenas que não justificam uma receita nova |
| 9 | Versionado no git (`conferencia-bi`) e documentado | Levar para a Mac M1 e para os projetos da Liebe |

## Demandas reais que passaram pelo método

- **Devolutiva "VISÃO GERAL 12/11" (pontos 6, 7 e 9)**: cards de referências/SKUs,
  quadro de cobertura, preços, markup, alertas. Ver `core/receitas.py`.
- **Análise de Estoque 13/11**: datas, cards x Visão Geral, TT Geral, colunas de valor,
  linha de totais, agrupamento de cores. Descobriu que a Análise contava SKU como "com
  estoque" se **qualquer loja** tinha saldo, mesmo com soma zero, e contava inativos.
- **Giro anual em vermelho + "Por coleção"** na Visão Geral.
- **Comercial: Top Produtos** embaixo do Ranking, com estoque por loja e foto.
- **Ruptura**: regra nova (entrada na vida + venda em 12 meses) e lista por referência
  que abre em SKU. Resultado: de 62,0% para 19,5%.
- **Quadro de cobertura**: tirar a coluna Valor em Estoque; separar FORA DE LINHA de
  FORA DE LINHA PROMO.
- **Metas**: vendedor GERAL recebe o restante da loja (outra frente, sem a ferramenta).

## Ideias do Lucas que a ferramenta ainda não cobre (próximos passos naturais)

Todas foram ditas, ou insinuadas, e ficaram para depois:

1. **Rodar sozinho**: ler a devolutiva nova, abrir a tela e já responder o grupo.
2. **Assistente pessoal**: pegar a ferramenta no Mac M1 e usar em outros projetos
   (o que este repositório começa a tornar possível).
3. **Enviar para a cliente** por WhatsApp/e-mail em vez de só PDF.
4. **Receitas por tela** para as demais telas do BI (hoje 6, 7, 9 e Análise de Estoque).
5. **Capturar antes e depois automaticamente** (hoje o "antes" envolve stash manual).
6. **Conectar a meta** do Acompanhamento por Linha à tabela do relatório (pendência
   antiga do projeto, não da ferramenta).

## Decisões técnicas que valem registrar

- **Receita determinística por tela**, não "IA clicando": a receita sabe onde clicar.
  A IA só recebe o resultado e compara. Menos custo, menos erro, repetível.
- **Perfil do navegador persistente** (`perfil/`, fora do git): loga uma vez.
- **Localhost com token** (`mint-test-token.ts`): evita depender do Render dormindo e
  permite o "antes" local com a versão antiga do código.
- **Citação conferida em código**: o texto da cliente que aparece no PDF é checado
  contra o documento original; o modelo não pode reescrever o que ela disse.
- **Posição de data fixa**: antes e depois só são comparáveis com a mesma data.
- **PDF contínuo via Chromium** (`_pdf_continuo`): mede a altura do HTML e gera uma
  página única do tamanho exato.
- **`.sr-only` e CSS uppercase** quebram a leitura do texto: o extrator usa
  `textContent` e remove o texto escondido.

## Armadilhas já pagas (não repetir)

- Esperar a página por texto de carregamento é frágil; use o critério da receita
  (`_esperar_pronto`).
- Token de teste **expira** (duas horas). Sintoma: página "não terminou de carregar".
  Gerar outro com `npx tsx scripts/mint-test-token.ts`.
- Modais deste projeto **não têm `role=dialog`**: usar `div.fixed.inset-0.z-50`.
- `Locator.screenshot` falha se o seletor não existe; sempre dar timeout e imprimir
  etapas, para saber **onde** travou.
- Ao tirar o "antes" trocando arquivos, **restaurar e conferir o diff** logo em seguida.
- Mocks de `prisma.$queryRaw` casam pelo texto do SQL: query nova quebra 17 testes que
  não conheciam a consulta.
- Arquivos CRLF: editar com Python normalizando e restaurando CRLF.
- Nunca ler/gravar arquivo UTF-8 com `Get-Content -Raw` + `Set-Content` no PowerShell 5.1.
