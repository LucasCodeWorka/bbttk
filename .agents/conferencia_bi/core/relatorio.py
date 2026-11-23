from __future__ import annotations

ICONE = {"ok": "✅", "divergente": "❌", "nao_verificavel": "⚠️ não verificável"}


def _cel(txt: str) -> str:
    return (txt or "").replace("|", "/").replace("\n", " ").strip()


def montar(secao: dict, evidencia: dict, veredito: dict | None, app: str) -> str:
    linhas = [
        f"## Ponto {secao['ponto']}: {secao['titulo']}",
        "",
        f"Conferido em {app}, {evidencia.get('tela', '')}.",
        "",
    ]
    if veredito is None:
        linhas += ["| Item | Marcado no Word |", "|---|---|"]
        linhas += [f"| {_cel(it['texto'])} | {'☒' if it['marcado'] else '☐'} |" for it in secao["itens"]]
        linhas += ["", "_Sem Codex: so a evidencia foi coletada (ver evidencia.json)._"]
        return "\n".join(linhas)

    linhas += ["| Item | Situação | Evidência na tela |", "|---|---|---|"]
    for it in veredito["itens"]:
        evid = _cel(it["evidencia"])
        if it.get("observacao"):
            evid += f" — {_cel(it['observacao'])}"
        linhas.append(f"| {_cel(it['item'])} | {ICONE.get(it['situacao'], it['situacao'])} | {evid} |")
    total = len(veredito["itens"])
    oks = sum(1 for it in veredito["itens"] if it["situacao"] == "ok")
    linhas += ["", f"**{oks} de {total} itens ok.** {veredito.get('resumo', '')}"]
    return "\n".join(linhas)
