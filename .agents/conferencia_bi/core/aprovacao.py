"""Documento de aprovacao: cada pedido abre com as PALAVRAS e os PRINTS da propria cliente,
depois a nossa resposta e os prints da tela ANTES e DEPOIS.

Fluxo:
1. `mapear_cliente`: o Codex le os paragrafos da devolutiva (com os prints dela anexados) e,
   para cada pedido fotografado pela receita, devolve a citacao literal, os prints dela que
   ilustram o pedido e uma resposta escrita com os termos que ELA usa. Tambem extrai um
   vocabulario (como ela chama cada coisa) para a equipe.
2. A citacao e conferida por codigo: tem que existir no texto dela, palavra por palavra.
   Se o modelo parafrasear, entra o paragrafo original mais parecido.
3. `gerar`: monta o PDF. O vocabulario vai para um .md separado, nunca para o documento dela.

Os prints da tela sao pareados pela chave `item` que a receita grava em `_prints`.
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

from core import codex
from core.pdf import CSS, ROTULO, _e, _img, ler_pasta

CSS_EXTRA = """
/* Fluxo continuo: pedidos um depois do outro, sem pagina nova por pedido. Prints com altura
   maxima (sem fatiar) e nunca partidos ao meio; titulo nunca sozinho no pe da pagina. */
.pedido { border-top: 2px solid #d0d7de; margin-top: 14px; padding-top: 2px; }
.pedido h2 { margin-top: 6px; border: 0; break-after: avoid; page-break-after: avoid; }
.fig { margin: 3px 0 8px; break-inside: avoid; page-break-inside: avoid; }
.fig img { display: block; max-width: 100%; max-height: 80mm; width: auto; height: auto; border: 1px solid #d0d7de; }
.fig .leg { color: #57606a; font-size: 10px; margin-top: 2px; }
.cab { break-after: avoid; page-break-after: avoid; }
.par { display: block; margin: 4px 0 6px; }
.etq { display: inline-block; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 3px; margin: 8px 0 2px; }
.etq.antes { background: #ffebe9; color: #cf222e; }
.etq.depois { background: #dafbe1; color: #1a7f37; }
.etq.cliente { background: #fbefff; color: #8250df; }
blockquote { margin: 4px 0 8px; padding: 7px 12px; background: #fbf7ff; border-left: 4px solid #8250df;
             font-size: 12px; font-style: italic; color: #24292f; white-space: pre-line; }
.resposta { background: #f0fff4; border-left: 4px solid #1a7f37; padding: 7px 12px; margin: 4px 0 8px; font-size: 12px; }
"""

SCHEMA_MAPA = {
    "type": "object", "additionalProperties": False, "required": ["pedidos", "vocabulario"],
    "properties": {
        "pedidos": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["chave", "citacao", "prints", "resposta"],
            "properties": {
                "chave": {"type": "string"},
                "citacao": {"type": "string"},
                "prints": {"type": "array", "items": {"type": "integer"}},
                "resposta": {"type": "string"},
            }}},
        "vocabulario": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["termo", "significado"],
            "properties": {"termo": {"type": "string"}, "significado": {"type": "string"}}}},
    },
}

INSTRUCOES_MAPA = """Voce esta ajudando a responder a devolutiva de uma cliente sobre um relatorio de BI.
Abaixo: os paragrafos originais que ELA escreveu (com marcadores [print N] onde ela colou um
print; os prints estao anexados na mesma ordem), a lista de pedidos que conferimos na tela, e a
evidencia lida da tela DEPOIS das correcoes, com a conferencia item a item.

Para CADA pedido da lista, devolva um objeto com:
- "chave": a chave do pedido, exatamente como na lista.
- "citacao": o pedido COMPLETO dela sobre esse assunto, COPIADO LITERALMENTE, sem mudar uma
  letra, virgula ou maiuscula: inclua as reclamacoes, os exemplos e o "ficaria assim", juntando
  os paragrafos seguidos (separe com quebra de linha). Ela precisa se reconhecer no trecho.
  Nao inclua os marcadores [print N].
- "prints": os numeros N dos prints DELA que mostram esse pedido (lista vazia se nenhum).
- "resposta": 1 a 3 frases dirigidas a ela ("voce"), em portugues simples, retomando as
  palavras que ela usou (se ela disse "tons", diga "tons"; se disse "TT GERAL", use "TT GERAL").
  Diga o que mudou com base SOMENTE na evidencia DEPOIS. Nao prometa nada que a evidencia nao
  mostre. Se algo nao ficou 100% igual ao pedido, diga com franqueza e explique em uma frase.
  Se a reclamacao tinha uma causa que a evidencia explica (ex.: o "V" era a seta de ordenacao),
  conte isso de forma gentil, sem fazer ela parecer errada.

Em "vocabulario": termos e expressoes que ELA usa e o que significam no sistema (ex.: "TT GERAL"
= total geral de pecas; "default" = valor que ja vem preenchido). Isso e para a equipe aprender a
linguagem dela; 5 a 12 entradas, curtas.

Se houver "Contexto da equipe", sao fatos ja apurados por nos (ex.: consultas no banco) que a
tela sozinha nao mostra. Use-os na resposta quando explicarem o pedido, sem inventar alem deles.

Nao rode comandos, nao abra arquivos. Use so o que esta aqui.
"""


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFC", t or "")
    return re.sub(r"\s+", " ", t.replace("“", '"').replace("”", '"')).strip()


def _palavras(t: str) -> set[str]:
    return set(re.findall(r"\w{3,}", _norm(t).lower()))


def conferir_citacao(citacao: str, paragrafos: list[str]) -> tuple[str, bool]:
    """Garante que a citacao e literal. Cada linha precisa existir no texto da cliente;
    se nao, devolve o paragrafo original com mais palavras em comum."""
    texto = _norm("\n".join(paragrafos))
    linhas = [l for l in (citacao or "").splitlines() if l.strip()]
    if linhas and all(_norm(l) in texto for l in linhas):
        return "\n".join(l.strip() for l in linhas), True
    alvo = _palavras(citacao)
    melhor = max(paragrafos, key=lambda p: len(alvo & _palavras(p)), default="")
    return melhor, False


def mapear_cliente(secao: dict, depois: dict, itens: list[dict], imagens: list[Path], pasta: Path,
                   modelo: str | None = None, contexto: str = "") -> dict:
    paragrafos = "\n".join(it["texto"] for it in secao["itens"])
    lista = "\n".join(f"- {it['chave']}: {it['titulo']}" for it in itens)
    evid = {k: v for k, v in (depois["evid"] or {}).items() if not k.startswith("_")}
    prompt = (f"{INSTRUCOES_MAPA}\n## Texto da cliente ({secao.get('titulo', '')})\n\n{paragrafos}\n\n"
              f"## Pedidos conferidos\n\n{lista}\n\n"
              f"## Evidencia da tela DEPOIS (JSON)\n\n```json\n{json.dumps(evid, ensure_ascii=False, indent=1)}\n```\n\n"
              f"## Conferencia item a item DEPOIS\n\n```json\n{json.dumps(depois['veredito'], ensure_ascii=False, indent=1)}\n```\n"
              + (f"\n## Contexto da equipe\n\n{contexto}\n" if contexto else ""))
    mapa = codex.executar(prompt, SCHEMA_MAPA, pasta, "mapa_cliente", modelo, imagens)

    textos = [it["texto"] for it in secao["itens"] if not it["texto"].startswith("[print")]
    for p in mapa["pedidos"]:
        p["citacao"], p["citacao_literal"] = conferir_citacao(p["citacao"], textos)
        p["prints"] = [n for n in p["prints"] if 1 <= n <= len(imagens)]
    (pasta / "mapa_cliente.json").write_text(json.dumps(mapa, ensure_ascii=False, indent=1), encoding="utf-8")
    return mapa


def _fig(arquivo: Path, legenda: str) -> str:
    return f"<div class='fig'><img src='{_img(arquivo)}'><div class='leg'>{_e(legenda)}</div></div>"


def _prints_por_item(bloco: dict) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for p in (bloco["evid"] or {}).get("_prints", []):
        if p.get("item") and (bloco["pasta"] / p["arquivo"]).exists():
            out.setdefault(p["item"], []).append(p)
    return out


def _tabela_codex(bloco: dict, titulo: str) -> str:
    v = bloco["veredito"]
    if not v:
        return ""
    linhas = [f"<h3>{_e(titulo)}</h3><table><tr><th style='width:34%'>Item</th><th>Situação</th><th>Evidência lida na tela</th></tr>"]
    for it in v["itens"]:
        rot, cls = ROTULO.get(it["situacao"], (it["situacao"], ""))
        linhas.append(f"<tr><td>{_e(it['item'])}</td><td class='sit {cls}'>{rot}</td><td>{_e(it['evidencia'])}"
                      f"<br><span class='meta'>{_e(it.get('observacao', ''))}</span></td></tr>")
    linhas.append("</table>")
    return "".join(linhas)


def montar_html(antes: dict, depois: dict, itens: list[dict], mapa: dict, imagens: list[Path],
                titulo: str, cabecalho: str, intro_html: str = "", fim_html: str = "") -> str:
    pa, pd = _prints_por_item(antes), _prints_por_item(depois)
    por_chave = {p["chave"]: p for p in mapa.get("pedidos", [])}
    agora = datetime.now().strftime("%d/%m/%Y %H:%M")
    h = [f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}{CSS_EXTRA}</style></head><body>",
         f"<h1>{_e(titulo)}</h1>", f"<div class='meta'>Gerado em {agora}<br>{_e(cabecalho)}</div>", intro_html,
         "<h3>Seus pedidos e o que mudou</h3><table><tr><th style='width:4%'>#</th>"
         "<th style='width:46%'>Você escreveu</th><th>Resposta</th></tr>"]
    for n, it in enumerate(itens, 1):
        m = por_chave.get(it["chave"], {})
        cit = (m.get("citacao") or "").split("\n")[0]
        h.append(f"<tr><td>{n}</td><td><i>“{_e(cit[:180] + ('…' if len(cit) > 180 else ''))}”</i></td>"
                 f"<td>{_e(m.get('resposta', ''))}</td></tr>")
    h.append("</table>")

    for n, it in enumerate(itens, 1):
        m = por_chave.get(it["chave"], {})
        h.append(f"<div class='pedido'><h2>{n}. {_e(it['titulo'])}</h2>")
        h.append("<div class='par cab'><span class='etq cliente'>VOCÊ ESCREVEU</span></div>")
        h.append(f"<blockquote>“{_e(m.get('citacao', ''))}”</blockquote>")
        for num in m.get("prints", []):
            h.append(_fig(imagens[num - 1], f"Print que você enviou na devolutiva (print {num})"))
        if m.get("resposta"):
            h.append(f"<div class='resposta'><b>Resposta:</b> {_e(m['resposta'])}</div>")
        for rotulo, cls, prints, bloco in (("ANTES (versão publicada)", "antes", pa.get(it["chave"], []), antes),
                                           ("DEPOIS (versão nova)", "depois", pd.get(it["chave"], []), depois)):
            h.append(f"<div class='par cab'><span class='etq {cls}'>{rotulo}</span></div>")
            if not prints:
                h.append("<p class='meta'>(sem print para este pedido nesta rodada)</p>")
            for p in prints:
                h.append(_fig(bloco["pasta"] / p["arquivo"], p["legenda"]))
        h.append("</div>")

    h.append(fim_html)
    h.append("<h2 class='quebra'>Conferência automática item a item</h2>")
    h.append("<p class='meta'>Texto lido da tela pela ferramenta e comparado com a devolutiva, nas duas rodadas.</p>")
    h.append(_tabela_codex(antes, "Antes das correções"))
    h.append(_tabela_codex(depois, "Depois das correções"))
    h.append("</body></html>")
    return "".join(h)


def _pasta_prints_cliente(pasta_rodada: Path) -> Path:
    carimbo = pasta_rodada.name.split("_ponto")[0]
    return pasta_rodada.parent / f"{carimbo}_devolutiva_prints"


LARGURA_PX = 1123          # A4 deitado (297mm a 96dpi), a mesma largura da versao paginada
ALTURA_MAX_PX = 19000      # limite do PDF (200 polegadas); acima disso reduz a escala


def _pdf_continuo(nav, conteudo: str, destino: Path) -> None:
    """Uma pagina so, da altura exata do conteudo: rola como uma pagina web, sem quebras."""
    pg = nav.new_page(viewport={"width": LARGURA_PX, "height": 900})
    pg.emulate_media(media="print")  # mede com o mesmo layout que a impressao vai usar
    pg.set_content(conteudo, wait_until="load")
    pg.add_style_tag(content="@page { margin: 0 !important; } "
                             "html, body { margin: 0 !important; } body { padding: 14mm 12mm !important; } "
                             "* { break-before: auto !important; page-break-before: auto !important; "
                             "break-after: auto !important; page-break-after: auto !important; "
                             "break-inside: auto !important; page-break-inside: auto !important; }")
    altura = pg.evaluate("Math.ceil(document.documentElement.scrollHeight)") + 4
    escala = min(1.0, ALTURA_MAX_PX / altura)
    # O CSS base declara "A4 landscape"; um @page posterior com tamanho explicito vence.
    pg.add_style_tag(content=f"@page {{ size: {int(LARGURA_PX * escala)}px {int(altura * escala) + 2}px; margin: 0; }}")
    pg.pdf(path=str(destino), print_background=True, prefer_css_page_size=True, scale=escala)


def gerar(pasta_antes: Path, pasta_depois: Path, itens: list[dict], destino: Path, titulo: str,
          cabecalho: str = "", intro_html: str = "", fim_html: str = "", modelo: str | None = None,
          remapear: bool = False, contexto: str = "", paginado: bool = False) -> tuple[Path, Path]:
    antes, depois = ler_pasta(pasta_antes), ler_pasta(pasta_depois)
    imagens = sorted(_pasta_prints_cliente(pasta_depois).glob("print*.png"),
                     key=lambda f: int(re.sub(r"\D", "", f.stem) or 0))
    arq_mapa = pasta_depois / "mapa_cliente.json"
    if arq_mapa.exists() and not remapear:
        mapa = json.loads(arq_mapa.read_text(encoding="utf-8"))
    else:
        mapa = mapear_cliente(depois["secao"], depois, itens, imagens, pasta_depois, modelo, contexto)

    conteudo = montar_html(antes, depois, itens, mapa, imagens, titulo, cabecalho, intro_html, fim_html)
    with sync_playwright() as p:
        nav = p.chromium.launch(headless=True)
        if paginado:
            pg = nav.new_page()
            pg.set_content(conteudo, wait_until="load")
            pg.pdf(path=str(destino), print_background=True, prefer_css_page_size=True)
        else:
            _pdf_continuo(nav, conteudo, destino)
        nav.close()

    vocab = destino.with_name(destino.stem + "_vocabulario_cliente.md")
    linhas = [f"# Como a cliente fala — {depois['secao'].get('titulo', '')}", "",
              "Uso interno da equipe (não vai no documento dela).", "", "| Termo dela | O que significa no sistema |", "|---|---|"]
    linhas += [f"| {v['termo']} | {v['significado']} |" for v in mapa.get("vocabulario", [])]
    nao_literais = [p["chave"] for p in mapa.get("pedidos", []) if not p.get("citacao_literal", True)]
    if nao_literais:
        linhas += ["", f"Citações substituídas pelo parágrafo original (o modelo parafraseou): {', '.join(nao_literais)}"]
    vocab.write_text("\n".join(linhas) + "\n", encoding="utf-8")
    return destino, vocab
