# Levar o modo de operar para outro projeto (ex.: Liebe)

A ferramenta nasceu na BBTK, mas só **duas camadas** são específicas dela. O resto serve
para qualquer sistema web com login em que uma pessoa pede mudança e o time precisa provar.

## O que é genérico e o que é da BBTK

| Parte | Arquivo | Genérico? |
|---|---|---|
| Navegador, perfil, login por token ou manual | `core/navegador.py` | Sim |
| Caminhos, `.env` | `core/paths.py` | Sim |
| Ler devolutiva `.docx` ou OneDrive, achar seção/pontos | `core/devolutiva.py` | Sim |
| Chamar o Codex com schema JSON | `core/codex.py` | Sim |
| PDF contínuo, HTML, CSS dos prints | `core/pdf.py`, `core/aprovacao.py` | Sim |
| CLI | `main.py` | Sim, trocar `APP_PADRAO` |
| **Receitas** (onde clicar, o que ler) | `core/receitas.py` | **Não, é da BBTK** |
| Textos de resposta e vocabulário | `core/aprovacao.py`, prompts | Parcial |
| Exemplos de scripts avulsos | `exemplos/` | Modelos para copiar |

## Passo a passo para um projeto novo

1. **Copiar a pasta** `.agents/conferencia_bi` para o novo repositório (ou manter como
   submódulo/pacote). Não copie `perfil/`, `saida/` nem `.env`.
2. **Instalar**: `python -m pip install playwright pymupdf` e
   `python -m playwright install chromium`. Instalar e logar o Codex CLI
   (`codex exec`) se for usar a camada de veredito.
3. **Configurar** `.env` a partir de `.env.example`:
   - `BI_APP_URL`: o sistema (publicado ou localhost).
   - `DEVOLUTIVA_URL`: link do Word Online (opcional; também aceita `.docx` local).
   - `BI_EMAIL`/`BI_SENHA` ou `main.py login` uma vez para guardar a sessão.
4. **Ajustar `APP_PADRAO`** em `main.py` e as constantes de rota/login em
   `core/navegador.py` (`/login`, onde fica o token, como reconhecer "logado").
5. **Escrever as receitas do projeto** em `core/receitas.py` (ver abaixo). Comece por **uma**
   tela pequena. Troque a lista `ITENS` e o dicionário `RECEITAS`.
6. **Testar sem Codex**: `python main.py conferir <ponto> --sem-codex`. Se as evidências
   e os prints estão certos, só então ligue o Codex.
7. **Para demandas pequenas**, nem precisa de receita: copie um script de `exemplos/`,
   troque os seletores, rode antes e depois e monte o PDF com `montar_antes_depois.py`.

## Como escrever uma receita

Uma receita é uma função `ponto_X(page, app, data, pasta) -> dict` que:

1. **Abre a tela limpa** (sem filtros salvos: `sessionStorage.clear()`), aplica a data/
   filtro da devolutiva e **espera pronto** por um critério objetivo (tabela com linhas,
   card com número).
2. **Lê o que a cliente cobrou**: cards, cabeçalhos, totais, dicas (`title`). Já faz as
   contas (somas, contagens, participações).
3. **Tira prints com destaque** (`outline: 4px solid #f5c400`) do que mudou.
4. Devolve `{ "evidencias": ..., "prints": [...] }`. A chave de cada item de `ITENS` é
   o que une **print antes + print depois + fala da cliente**.

Padrões que funcionaram:

- Achar o card pelo **texto do título** (`textContent` em minúsculas) e subir até o
  elemento com `rounded`/`border-l-4`.
- Trocar visão por `select_option(label=...)` e esperar 2 s.
- Para modais, pegar `div.fixed.inset-0.z-50` e o último filho direto.
- Aumentar o viewport (`1600x1150` ou `1900x1150`) para a tabela caber.

## Ambiente local vs publicado

- **Publicado**: login do robô com perfil persistente. Render pode estar dormindo (o
  primeiro acesso demora; timeouts longos de propósito).
- **Localhost**: `--app http://localhost:3000 --token-arquivo token.txt`. Necessário para
  o "antes" (código antigo) e para provar antes de publicar.

## Adaptando para a Liebe

Perguntas para responder no começo, antes de mexer em código:

1. Quem pede mudanças e por qual canal (grupo, e-mail, documento)? Como o pedido chega?
2. O sistema tem **login** e como pegar um token de teste?
3. Há uma tela com **dados fixos de referência** (uma data) para comparar antes/depois?
4. O banco tem os números certos para eu provar o que a tela sozinha não mostra?
5. Qual é o **vocabulário** da cliente? Escrever `docs/VOCABULARIO.md` do projeto.
6. A cliente aprova por PDF, WhatsApp ou outra via? Ajustar o passo 5 de
   `MODO_DE_OPERAR.md`.
7. Há regras de publicação (branch, remotes, nota de entregas)? Copiar para o
   `AGENTS.md` do projeto, como na BBTK.

Mantenha no `AGENTS.md` do novo projeto as mesmas regras que o Lucas definiu aqui: print
do sistema, antes/depois, PDF contínuo, não publicar sem pedir, honestidade quando não
dá para verificar.

## Cuidados de segurança

- `perfil/` guarda a sessão de login: **nunca versionar**.
- `.env` pode ter senha: ignorado pelo git.
- Token de teste tem papel **admin**: só local, nunca em repositório.
- O vocabulário e os prints podem conter dados reais: não publicar o PDF fora do canal
  combinado com a cliente.
