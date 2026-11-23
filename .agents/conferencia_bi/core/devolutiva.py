"""Le a devolutiva aberta no Word Online (OneDrive) e separa o checklist por ponto.

O Word Online so desenha as paginas perto da tela, entao o texto e coletado rolando o
documento e juntando os paragrafos pelo atributo `paraid`.
"""
from __future__ import annotations

import re
import time

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


def secao(texto: str, ponto: int) -> dict:
    """Recorta o ponto N do checklist: titulo + itens (com o estado da caixinha)."""
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
    return {"ponto": ponto, "titulo": titulo, "itens": itens, "cabecalho": cabecalho}
