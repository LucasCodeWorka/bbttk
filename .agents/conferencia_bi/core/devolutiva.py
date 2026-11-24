"""Le a devolutiva (Word Online pelo link do OneDrive, ou um .docx local) e separa o
checklist por ponto.

O Word Online so desenha as paginas perto da tela, entao o texto e coletado rolando o
documento e juntando os paragrafos pelo atributo `paraid`. O .docx e lido direto do XML
(sem dependencia), e as imagens coladas viram linhas "[print N]" no texto.

Dois formatos de devolutiva:
- com pontos numerados ("7. ...") e caixinhas ☒/☐: `secao(texto, 7)`;
- so com um titulo de tela ("ANÁLISE DE ESTOQUE") e paragrafos soltos: `secao(texto,
  "analise de estoque")`. Ai os itens vem "livres" e o Codex monta o checklist.
"""
from __future__ import annotations

import re
import time
import unicodedata
import zipfile
from pathlib import Path

from playwright.sync_api import Page

_JS_COLETA = "() => [...document.querySelectorAll('[paraid]')].map(p => [p.getAttribute('paraid'), p.innerText])"
_JS_ROLA = """(passo) => {
  let sc = null, h = 0;
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50 && el.scrollHeight > h) { sc = el; h = el.scrollHeight; }
  }
  if (!sc) return [0, 0, 0];
  sc.scrollTop += passo;
  return [sc.scrollTop, sc.scrollHeight, sc.clientHeight];
}"""

_INVISIVEIS = re.compile(r"[​‌‍﻿]")


def extrair_texto(page: Page, url: str) -> str:
    page.goto(url, wait_until="domcontentloaded", timeout=120_000)
    frame = None
    for _ in range(90):
        time.sleep(1)
        for f in page.frames:
            try:
                if f.evaluate("() => document.querySelectorAll('[paraid]').length") > 0:
                    frame = f
            except Exception:
                pass
        if frame:
            break
    if not frame:
        raise SystemExit("Nao consegui abrir o documento da devolutiva (Word Online nao carregou).")

    ordem: list[str] = []
    textos: dict[str, str] = {}

    def coletar() -> None:
        for pid, texto in frame.evaluate(_JS_COLETA):
            if pid not in textos:
                ordem.append(pid)
            textos[pid] = texto

    no_fim = 0
    for _ in range(300):
        coletar()
        topo, altura, visivel = frame.evaluate(_JS_ROLA, 700)
        time.sleep(0.5)
        if topo + visivel >= altura - 5:
            no_fim += 1
            if no_fim > 3:
                break
    coletar()
    frame.evaluate("() => { for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0; }")
    linhas = (_INVISIVEIS.sub("", textos[k]).strip() for k in ordem)
    return "\n".join(l for l in linhas if l)


_W_T = re.compile(r"<w:t(?: [^>]*)?>([^<]*)</w:t>")


def extrair_docx(caminho: Path, destino_imagens: Path | None = None) -> tuple[str, list[Path]]:
    """Texto do .docx (um paragrafo por linha) + imagens salvas em ordem como printN."""
    with zipfile.ZipFile(caminho) as z:
        xml = z.read("word/document.xml").decode("utf-8")
        rels = z.read("word/_rels/document.xml.rels").decode("utf-8")
        alvo = dict(re.findall(r'Id="([^"]+)"[^>]*Target="([^"]+)"', rels))
        alvo.update({i: t for t, i in re.findall(r'Target="([^"]+)"[^>]*Id="([^"]+)"', rels)})
        linhas, imagens = [], []
        for p in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S):
            texto = "".join(_W_T.findall(p))
            texto = _INVISIVEIS.sub("", texto).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").strip()
            if texto:
                linhas.append(texto)
            for rid in re.findall(r'r:embed="([^"]+)"', p):
                imagens.append(alvo.get(rid, ""))
                linhas.append(f"[print {len(imagens)}]")
        salvas: list[Path] = []
        if destino_imagens:
            destino_imagens.mkdir(parents=True, exist_ok=True)
            for n, t in enumerate(imagens, 1):
                arq = destino_imagens / f"print{n}{Path(t).suffix or '.png'}"
                arq.write_bytes(z.read("word/" + t.lstrip("/").removeprefix("word/")))
                salvas.append(arq)
    return "\n".join(linhas), salvas


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def _eh_titulo(l: str) -> bool:
    letras = [c for c in l if c.isalpha()]
    return bool(letras) and len(l) <= 60 and all(c.isupper() for c in letras) and not l.startswith("[print")


def data_estoque(texto: str) -> str | None:
    """'Dados do estoque de 10/11' + ano do cabecalho -> '2026-11-10'."""
    m = re.search(r"estoque de (\d{1,2})/(\d{1,2})(?:/(\d{4}))?", texto, flags=re.I)
    if not m:
        return None
    ano = m.group(3) or next(iter(re.findall(r"\d{1,2}/\d{1,2}/(\d{4})", texto)), None)
    return f"{ano}-{int(m.group(2)):02d}-{int(m.group(1)):02d}" if ano else None


def _secao_titulo(texto: str, titulo: str) -> dict:
    linhas = texto.splitlines()
    alvo = _norm(titulo)
    inicio = next((i for i, l in enumerate(linhas) if _norm(l) == alvo), None)
    if inicio is None:
        disponiveis = [l for l in linhas if _eh_titulo(l)]
        raise SystemExit(f"Secao '{titulo}' nao encontrada. Titulos no documento: {disponiveis}")
    itens = []
    for l in linhas[inicio + 1:]:
        if _eh_titulo(l):
            break
        itens.append({"marcado": None, "texto": l})
    return {"ponto": alvo.replace(" ", "-"), "titulo": linhas[inicio], "rotulo": linhas[inicio],
            "itens": itens, "livre": True, "cabecalho": "\n".join(linhas[: min(6, inicio)]),
            "data_estoque": data_estoque("\n".join(linhas[: inicio + 1]))}


def secao(texto: str, ponto: int | str) -> dict:
    """Recorta o ponto N do checklist: titulo + itens (com o estado da caixinha)."""
    if not str(ponto).isdigit():
        return _secao_titulo(texto, str(ponto))
    ponto = int(ponto)
    linhas = texto.splitlines()
    inicio = next((i for i, l in enumerate(linhas) if re.match(rf"^{ponto}\.\s", l)), None)
    if inicio is None:
        raise SystemExit(f"Ponto {ponto} nao encontrado na devolutiva.")
    itens = []
    for l in linhas[inicio + 1:]:
        if re.match(r"^\d+\.\s", l) or l.lower().startswith("critérios de conclusão"):
            break
        m = re.match(r"^\s*([☒☐])\s*(.+)$", l)
        if m:
            itens.append({"marcado": m.group(1) == "☒", "texto": m.group(2).strip()})
    titulo = re.sub(r"^\d+\.\s*", "", linhas[inicio]).strip()
    cabecalho = "\n".join(linhas[: min(6, inicio)])
    return {"ponto": ponto, "titulo": titulo, "rotulo": f"Ponto {ponto}: {titulo}", "itens": itens,
            "cabecalho": cabecalho, "data_estoque": data_estoque(cabecalho)}
