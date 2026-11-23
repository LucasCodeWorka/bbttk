# Conferência BI

Confere a devolutiva do cliente contra o BI publicado, gastando o mínimo de token.
Segue a mesma divisão do `totvs_agent_minimo` (repo `planodeproducao`):

| Camada | Quem faz | Custo |
|---|---|---|
| Abrir a devolutiva (aba 1) e o BI (aba 2), logar, aplicar data, trocar visões, ler texto, somar participações, medir alinhamento | Python + Playwright | zero token |
| Comparar checklist × evidência e dar ✅/❌ por item | Codex (`codex exec`, só texto) | ~30 mil tokens por ponto |
| Implementar a correção | Claude Code | — |

O Codex nunca decide onde clicar e nunca recebe imagem. Os prints ficam salvos só como
prova para humano.

## Primeiro uso

```powershell
python -m pip install playwright
python -m playwright install chromium
copy .agents\conferencia_bi\.env.example .agents\conferencia_bi\.env   # e preencher DEVOLUTIVA_URL
python .agents\conferencia_bi\main.py login      # abre o BI; logue uma vez, o perfil guarda a sessão
```

Senha não fica salva em lugar nenhum: a sessão fica em `perfil/` (fora do git). Se
preferir login automático, preencha `BI_EMAIL`/`BI_SENHA` no `.env`.

## Comandos

```powershell
python .agents\conferencia_bi\main.py devolutiva            # lista os pontos, caixinhas marcadas e se há receita
python .agents\conferencia_bi\main.py conferir 7            # janela visível: aba da devolutiva + aba do BI
python .agents\conferencia_bi\main.py conferir 6 7 9 --headless
python .agents\conferencia_bi\main.py conferir 7 --data 2026-11-10
python .agents\conferencia_bi\main.py conferir 7 --sem-codex   # só coleta evidência (zero token)
python .agents\conferencia_bi\main.py receitas
```

Localhost (sem login): `--app http://localhost:3000 --token-arquivo <token>` com o token
de `apps/api/scripts/mint-test-token.ts`.

Cada execução grava em `saida/<data>_ponto<N>/`: `checklist.json`, `evidencia.json`,
prints, `prompt.md`, `veredito.json`, `codex.log` e `relatorio.md` (tabela pronta para o
cliente).

## Pontos com receita

`core/receitas.py`: 6 (cards de referências/SKUs), 7 (quadro de cobertura em todas as
visões) e 9 (preços, markup, alertas e CNJ398). Ponto novo = uma função nova lá. Regra:
a receita lê texto e já faz as contas que não precisam de modelo (somas, contagens,
alinhamento). Ler também os `title` (dica do mouse): é onde a tela explica regra e data.

## Limite honesto

"⚠️ não verificável" é resposta válida: item que é regra de dado (ex.: "saldo negativo
conta") não se prova pela tela. Esses precisam de conferência contra o banco/TOTVS, que
ainda não está automatizada aqui.
