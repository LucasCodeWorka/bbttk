"""PDF da conferencia: resumo, tabela item a item e os prints de prova (embutidos).

Gerado pelo Chromium do Playwright em modo invisivel (page.pdf so funciona headless),
sem biblioteca extra.
"""
from __future__ import annotations

import base64
import html
import json
import struct
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

ROTULO = {
    "ok": ("✅ OK", "ok"),
    "divergente": ("❌ Divergente", "div"),
    "nao_verificavel": ("⚠️ Não verificável pela tela", "nv"),
}

CSS = """
@page { size: A4 landscape; margin: 14mm 12mm; }
body { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2328; font-size: 11px; }
h1 { font-size: 20px; margin: 0 0 4px; color: #b3122e; }
h2 { font-size: 15px; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #b3122e; }
h3 { font-size: 12px; margin: 14px 0 6px; color: #57606a; text-transform: uppercase; letter-spacing: .04em; }
.meta { color: #57606a; margin-bottom: 10px; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; }
th, td { border: 1px solid #d0d7de; padding: 5px 7px; vertical-align: top; text-align: left; }
th { background: #f6f8fa; }
td.sit { white-space: nowrap; font-weight: 600; }
.ok { color: #1a7f37; } .div { color: #cf222e; } .nv { color: #9a6700; }
.resumo td:last-child { width: 55%; }
.fecho { background: #f6f8fa; border-left: 4px solid #b3122e; padding: 6px 10px; margin: 6px 0 10px; }
figure { margin: 8px 0 14px; page-break-inside: avoid; }
figure img { max-width: 100%; max-height: 165mm; border: 1px solid #d0d7de; }
.fatia { width: 100%; overflow: hidden; border: 1px solid #d0d7de; }
.fatia img { display: block; width: 100%; max-width: none; max-height: none; border: 0; }
figcaption { color: #57606a; margin-top: 3px; }
.quebra { page-break-before: always; }
.rodape { color: #8c959f; margin-top: 16px; font-size: 9px; }
"""


def _e(txt) -> str:
    return html.escape(str(txt or ""))


def _img(arquivo: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(arquivo.read_bytes()).decode()


# Altura util de uma pagina A4 deitada em proporcao da largura (descontando legenda).
_PROPORCAO_PAGINA = 0.60


def _figura(arquivo: Path, legenda: str) -> str:
    """Print alto vira fatias na largura total da pagina, em vez de encolher ate caber."""
    dados = arquivo.read_bytes()
    w, h = struct.unpack(">II", dados[16:24])  # cabecalho IHDR do PNG
    src = _img(arquivo)
    fatia = int(w * _PROPORCAO_PAGINA)
    if h <= fatia * 1.15:
        return f"<figure><img src='{src}'><figcaption>{_e(legenda)}</figcaption></figure>"
    partes, inicio, n = [], 0, 1
    total = -(-h // fatia)
    while inicio < h:
        alt = min(fatia, h - inicio)
        partes.append(
            f"<figure><div class='fatia' style='aspect-ratio:{w}/{alt}'>"
            f"<img src='{src}' style='transform:translateY(-{inicio / h * 100:.4f}%)'></div>"
            f"<figcaption>{_e(legenda)} (parte {n} de {total})</figcaption></figure>")
        inicio += fatia
        n += 1
    return "".join(partes)


def ler_pasta(pasta: Path) -> dict:
    """Le uma conferencia ja feita (checklist, evidencia e, se houver, veredito do Codex)."""
    ler = lambda n: json.loads((pasta / n).read_text(encoding="utf-8")) if (pasta / n).exists() else None
    return {"secao": ler("checklist.json"), "evid": ler("evidencia.json"), "veredito": ler("veredito.json"), "pasta": pasta}


def _prints(bloco: dict) -> list[dict]:
    pasta: Path = bloco["pasta"]
    registrados = (bloco["evid"] or {}).get("_prints")
    if registrados:
        return [p for p in registrados if (pasta / p["arquivo"]).exists()]
    return [{"arquivo": f.name, "legenda": f.stem} for f in sorted(pasta.glob("*.png"))]


def montar_html(blocos: list[dict], app: str, cabecalho_devolutiva: str = "",
                titulo: str = "Conferência da devolutiva - BI Estoque", intro_html: str = "") -> str:
    """`intro_html` (ja em HTML, confiavel) entra logo depois do titulo: usado no documento
    de aprovacao, que abre com as decisoes e o quadro antes x depois."""
    agora = datetime.now().strftime("%d/%m/%Y %H:%M")
    partes = [f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>"]
    partes.append(f"<h1>{_e(titulo)}</h1>")
    partes.append(f"<div class='meta'>Gerado em {agora} · Tela: {_e(app)}"
                  + (f"<br>{_e(cabecalho_devolutiva)}" if cabecalho_devolutiva else "") + "</div>")
    if intro_html:
        partes.append(intro_html)

    partes.append("<h3>Resumo</h3><table class='resumo'><tr><th>Ponto</th><th>Resultado</th><th>Observação</th></tr>")
    for b in blocos:
        s, v = b["secao"], b["veredito"]
        if v:
            n_ok = sum(1 for it in v["itens"] if it["situacao"] == "ok")
            res = f"{n_ok} de {len(v['itens'])} itens OK"
            obs = v.get("resumo", "")
        else:
            res, obs = "Só evidência (sem Codex)", ""
        partes.append(f"<tr><td>{_e(s.get('rotulo') or str(s['ponto']) + '. ' + s['titulo'])}</td><td>{_e(res)}</td><td>{_e(obs)}</td></tr>")
    partes.append("</table>")
    partes.append("<p class='meta'>Legenda: ✅ OK = a tela atende · ❌ Divergente = a tela mostra outra coisa · "
                  "⚠️ Não verificável = regra de dado que a tela sozinha não prova (conferida no banco à parte).</p>")

    for i, b in enumerate(blocos):
        s, ev, v = b["secao"], b["evid"] or {}, b["veredito"]
        partes.append(f"<h2 class='quebra'>{_e(s.get('rotulo') or 'Ponto ' + str(s['ponto']) + ': ' + s['titulo'])}</h2>")
        partes.append(f"<div class='meta'>{_e(ev.get('tela', ''))}</div>")
        partes.append("<table><tr><th style='width:34%'>Item da devolutiva</th><th>Situação</th><th>Evidência na tela</th></tr>")
        if v:
            for it in v["itens"]:
                rot, cls = ROTULO.get(it["situacao"], (it["situacao"], ""))
                evid = _e(it["evidencia"]) + (f"<br><span class='meta'>{_e(it['observacao'])}</span>" if it.get("observacao") else "")
                partes.append(f"<tr><td>{_e(it['item'])}</td><td class='sit {cls}'>{rot}</td><td>{evid}</td></tr>")
        else:
            for it in s["itens"]:
                partes.append(f"<tr><td>{_e(it['texto'])}</td><td class='sit'>—</td><td>Ver prints abaixo.</td></tr>")
        partes.append("</table>")
        if v and v.get("resumo"):
            partes.append(f"<div class='fecho'>{_e(v['resumo'])}</div>")
        for p in _prints(b):
            partes.append(_figura(b["pasta"] / p["arquivo"], p["legenda"]))

    partes.append("<div class='rodape'>Gerado automaticamente: a tela foi lida por script (Playwright) e "
                  "comparada com o checklist pelo Codex. Os prints são da tela publicada no momento da conferência.</div>")
    partes.append("</body></html>")
    return "".join(partes)


def gerar(blocos: list[dict], app: str, destino: Path, cabecalho_devolutiva: str = "",
          titulo: str = "Conferência da devolutiva - BI Estoque", intro_html: str = "") -> Path:
    conteudo = montar_html(blocos, app, cabecalho_devolutiva, titulo, intro_html)
    destino.with_suffix(".html").write_text(conteudo, encoding="utf-8")
    with sync_playwright() as p:
        nav = p.chromium.launch(headless=True)
        pg = nav.new_page()
        pg.set_content(conteudo, wait_until="load")
        pg.pdf(path=str(destino), print_background=True, prefer_css_page_size=True)
        nav.close()
    destino.with_suffix(".html").unlink(missing_ok=True)
    return destino
