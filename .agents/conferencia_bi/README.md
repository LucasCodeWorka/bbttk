# Conferência BI

Lê a devolutiva da cliente, abre o BI de verdade, tira prints da própria tela e gera um
documento de aprovação com **as palavras e os prints dela** ao lado do **antes × depois**
do sistema. Gasta o mínimo de token: navegador e contas são Python, o modelo só compara
e redige.

## O que a ferramenta faz hoje

**1. Lê a devolutiva, qualquer formato**
- Link do OneDrive/Word Online: rola o documento e lê tudo (Playwright).
- Arquivo `.docx` local: lê sem navegador e **salva os prints que a cliente colou**
  (`print1.png`, `print2.png`...), marcando no texto onde cada um aparece.
- Devolutiva em pontos numerados com caixinhas (☐/☑) **ou** seção de texto livre pelo
  título (ex.: `ANÁLISE DE ESTOQUE`). Na seção livre, a data da posição sai do próprio
  texto ("Dados do estoque de 10/11").

**2. Navega no BI e prova pela tela**
- Abre o BI publicado (Render) ou o localhost, loga uma vez e guarda a sessão.
- Cada tela tem uma **receita** determinística: aplica data, troca visão, marca caixa,
  abre linha, lê cards, cabeçalhos, totais e dicas do mouse, e já faz as contas
  (somas, contagens, participações).
- **Prints com destaque**: grifa em amarelo exatamente o que mudou (card, coluna, linha
  de total, caixa marcada) e ajusta o zoom para a tabela inteira caber no print.
- Janela visível por padrão (dá para assistir); `--headless` para rodar escondido.

**3. Confere item a item**
- Codex (`codex exec`, somente leitura, saída em JSON com schema) compara o que ela
  pediu com o que a tela mostrou: ✅ atendido / ❌ não atendido / ⚠️ não verificável.
- Na seção livre, o próprio Codex monta o checklist a partir do texto e dos prints dela.

**4. Documento de aprovação (antes × depois)**
- Roda a conferência **antes** da correção e **depois**, e junta as duas.
- Para cada pedido: o trecho **literal** que ela escreveu (citação conferida em código
  contra o documento), os prints que ela mandou, uma resposta escrita na linguagem dela
  e os prints ANTES/DEPOIS lado a lado.
- `--contexto fatos.md`: fatos apurados no banco pela equipe (o que a tela sozinha não
  mostra), que a resposta pode usar. Sem inventar: o que não tem evidência fica como
  pendência.
- Pontos para aprovação (`--fim`) e abertura (`--intro`) em HTML livre.
- **PDF contínuo**: uma página só, que rola de cima a baixo, sem quebra. `--paginado`
  volta para folhas A4.
- Gera junto um `_vocabulario_cliente.md` (uso interno): os termos que a cliente usa e
  o que significam no sistema, para a equipe falar a língua dela.

## Divisão de trabalho

| Camada | Quem faz | Custo |
|---|---|---|
| Ler a devolutiva, logar, navegar, aplicar filtros, ler a tela, somar, tirar prints | Python + Playwright | zero token |
| Checklist da seção livre, veredito por item, casar citações e redigir respostas | Codex | ~30 mil tokens por seção |
| Implementar a correção | Claude Code | — |

O Codex nunca decide onde clicar. Só recebe imagem na seção livre (os prints da
cliente), para entender o que ela apontou.

## Primeiro uso

```powershell
python -m pip install playwright pymupdf
python -m playwright install chromium
copy .agents\conferencia_bi\.env.example .agents\conferencia_bi\.env   # DEVOLUTIVA_URL (opcional)
python .agents\conferencia_bi\main.py login      # abre o BI; logue uma vez, o perfil guarda a sessão
```

Precisa do Codex CLI instalado e logado (`codex exec`). Senha não fica salva: a sessão
fica em `perfil/` (fora do git). Para login automático, `BI_EMAIL`/`BI_SENHA` no `.env`.
`PDF_PASTA` no `.env` manda os PDFs para outra pasta (ex.: OneDrive, para gerar link).

## Comandos

```powershell
# devolutiva: lista pontos/seções e se já existe receita
python main.py devolutiva --devolutiva "C:\docs\Devolutiva 13 11.docx"

# conferir (ponto numerado ou título da seção)
python main.py conferir 7
python main.py conferir 6 7 9 --headless
python main.py conferir analise-de-estoque --devolutiva "C:\docs\Devolutiva 13 11.docx"
python main.py conferir 7 --data 2026-11-10 --sem-codex     # só evidência, zero token

# documento de aprovação a partir de duas rodadas já feitas
python main.py aprovacao <pasta_antes> <pasta_depois> --intro intro.html --fim fim.html --contexto fatos.md

python main.py pdf <pasta1> <pasta2>     # remonta o PDF de conferência sem gastar Codex
python main.py receitas                  # telas que já têm receita
```

Localhost (sem login): `--app http://localhost:3000 --token-arquivo <token>` com o token
de `apps/api/scripts/mint-test-token.ts`.

## Fluxo antes × depois (como foi usado na devolutiva de 13/11)

1. Guardar as mudanças da tela (`git stash push -- <arquivos do app>`); o dev server
   recarrega sozinho com a versão antiga.
2. `conferir <seção> --app http://localhost:3000 ...` → pasta **antes**.
3. `git stash pop`; esperar o recarregamento; `conferir` de novo → pasta **depois**.
4. `aprovacao <antes> <depois> ...` → PDF para a pessoa ler e aprovar.

Cada rodada grava em `saida/<data>_ponto<X>/`: `checklist.json`, `evidencia.json`,
prints, prompts, `veredito.json`, `codex.log`, `relatorio.md` e, no depois,
`mapa_cliente.json` (casamento citação × pedido; reaproveitado, `--remapear` refaz).

## Telas com receita

`core/receitas.py`: pontos 6 (cards de referências/SKUs), 7 (quadro de cobertura em
todas as visões), 9 (preços, markup, alertas, CNJ398) e `analise-de-estoque` (data
padrão, cards × Visão Geral, TT Geral, colunas de valor, linha de totais, agrupamento
por cores). Tela nova = uma função nova + a lista `ITENS` com a chave de cada pedido
(é ela que junta print antes, print depois e a fala da cliente).

## Limite honesto

"⚠️ não verificável" é resposta válida: regra de dado (ex.: "saldo negativo conta") não
se prova pela tela. Isso vai como fato apurado no `--contexto`, com o número do banco,
ou fica como pendência explícita no documento.
