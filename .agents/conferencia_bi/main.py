"""Conferencia automatica da devolutiva do BI contra a tela publicada.

Maquina (Playwright) abre a devolutiva numa aba e o BI em outra, navega e le a tela.
Codex so compara o checklist com o texto lido. Ver README.md.

    python .agents\\conferencia_bi\\main.py login
    python .agents\\conferencia_bi\\main.py devolutiva
    python .agents\\conferencia_bi\\main.py conferir 7
    python .agents\\conferencia_bi\\main.py conferir 6 7 9 --headless
    python .agents\\conferencia_bi\\main.py conferir analise-de-estoque --devolutiva C:\\caminho\\devolutiva.docx
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from core.paths import SAIDA, SKILLS, carregar_env

APP_PADRAO = "https://bebettk.onrender.com"


def _args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def comuns(p):
        p.add_argument("--app", default=None, help="URL do BI (padrao: BI_APP_URL do .env ou o Render)")
        p.add_argument("--headless", action="store_true", help="Navegador invisivel (padrao: janela visivel)")
        p.add_argument("--token-arquivo", default=None, help="So localhost: injeta um token gerado por mint-test-token")

    comuns(sub.add_parser("login", help="Abre o BI para logar uma vez; o perfil guarda a sessao."))
    d = sub.add_parser("devolutiva", help="Le a devolutiva e lista os pontos com o estado das caixinhas.")
    d.add_argument("--headless", action="store_true")
    d.add_argument("--devolutiva", default=None, help="Link do OneDrive ou caminho de um .docx (padrao: DEVOLUTIVA_URL)")
    c = sub.add_parser("conferir", help="Confere um ou mais pontos da devolutiva na tela publicada.")
    c.add_argument("pontos", nargs="+", help="Numero do ponto (7) ou titulo da secao (analise-de-estoque)")
    c.add_argument("--devolutiva", default=None, help="Link do OneDrive ou caminho de um .docx (padrao: DEVOLUTIVA_URL)")
    c.add_argument("--data", default=None, help="Posicao AAAA-MM-DD (padrao: a da receita)")
    c.add_argument("--sem-codex", action="store_true", help="So coleta a evidencia, sem chamar o Codex")
    c.add_argument("--modelo", default=None, help="Modelo do Codex (padrao: o do config do Codex)")
    comuns(c)
    pd = sub.add_parser("pdf", help="Remonta o PDF a partir de pastas de conferencia ja feitas (sem Codex).")
    pd.add_argument("pastas", nargs="+", help="Pastas em saida/ (ex.: 2026-11-21_1033_ponto9)")
    pd.add_argument("--app", default=None)
    ap_ = sub.add_parser("aprovacao", help="Documento para aprovar: palavras e prints da cliente + prints antes x depois.")
    ap_.add_argument("antes", help="Pasta da conferencia ANTES (em saida/)")
    ap_.add_argument("depois", help="Pasta da conferencia DEPOIS (em saida/)")
    ap_.add_argument("--fim", default=None, help="Arquivo .html com pontos para aprovacao (entra antes da tabela do Codex)")
    ap_.add_argument("--intro", default=None, help="Arquivo .html de abertura")
    ap_.add_argument("--contexto", default=None, help="Arquivo .md com fatos apurados pela equipe (o agente pode citar)")
    ap_.add_argument("--remapear", action="store_true", help="Refaz o casamento citacoes x pedidos (gasta Codex)")
    ap_.add_argument("--modelo", default=None)
    ap_.add_argument("--paginado", action="store_true", help="PDF em folhas A4 (padrao: uma pagina continua)")
    sub.add_parser("receitas", help="Lista os pontos que ja tem receita.")
    sub.add_parser("skill", help="Mostra a skill de uso.")
    return ap.parse_args()


def _url_devolutiva(fonte: str | None = None) -> str:
    url = fonte or os.getenv("DEVOLUTIVA_URL")
    if not url:
        raise SystemExit("Defina DEVOLUTIVA_URL no .env (link do OneDrive) ou passe --devolutiva <link ou .docx>.")
    return url


def _ler_devolutiva(fonte: str, ctx, pasta_imagens: Path) -> tuple[str, list[Path]]:
    """.docx local: le o arquivo (sem navegador) e salva os prints. Link: abre no Word Online."""
    from core import devolutiva, navegador
    if Path(fonte).suffix.lower() == ".docx" and Path(fonte).exists():
        return devolutiva.extrair_docx(Path(fonte), pasta_imagens)
    return devolutiva.extrair_texto(navegador.nova_aba(ctx), fonte), []


def _chave(p: str):
    return int(p) if str(p).isdigit() else str(p).lower()


def _pasta_pdf() -> Path:
    """PDF_PASTA no .env (ex.: uma pasta do OneDrive, para gerar link) ou saida/."""
    pasta = Path(os.getenv("PDF_PASTA") or SAIDA)
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta


def _cabecalho(blocos: list[dict]) -> str:
    linhas = (blocos[0]["secao"].get("cabecalho") or "").splitlines() if blocos else []
    return next((l for l in linhas if l.lower().startswith(("base", "dados do estoque"))), "")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    carregar_env()
    a = _args()

    if a.cmd == "skill":
        print((SKILLS / "conferir-devolutiva" / "SKILL.md").read_text(encoding="utf-8"))
        return

    from core.receitas import ITENS, RECEITAS
    if a.cmd == "aprovacao":
        from core import aprovacao, pdf
        pasta = lambda n: Path(n) if Path(n).is_absolute() else SAIDA / n
        antes, depois = pasta(a.antes), pasta(a.depois)
        secao = pdf.ler_pasta(depois)["secao"]
        itens = ITENS.get(str(secao["ponto"]))
        if not itens:
            raise SystemExit(f"A receita '{secao['ponto']}' nao declara ITENS em core/receitas.py.")
        ler = lambda f: Path(f).read_text(encoding="utf-8") if f else ""
        destino = _pasta_pdf() / f"APROVACAO_{secao['ponto']}_{datetime.now():%Y-%m-%d_%H%M}.pdf"
        doc, vocab = aprovacao.gerar(antes, depois, itens, destino, f"{secao['titulo']} — antes × depois",
                                     _cabecalho([{"secao": secao}]), ler(a.intro), ler(a.fim), a.modelo,
                                     a.remapear or bool(a.contexto), ler(a.contexto), a.paginado)
        print(f"PDF: {doc}")
        print(f"Vocabulario (interno): {vocab}")
        return
    if a.cmd == "receitas":
        for n, (_, desc) in sorted(RECEITAS.items(), key=lambda kv: str(kv[0])):
            print(f"{n}: {desc}")
        return

    from core import devolutiva, navegador

    if a.cmd == "devolutiva":
        with navegador.abrir(a.headless) as ctx:
            texto, imagens = _ler_devolutiva(_url_devolutiva(a.devolutiva), ctx, SAIDA / "devolutiva_prints")
        SAIDA.mkdir(exist_ok=True)
        (SAIDA / "devolutiva.txt").write_text(texto, encoding="utf-8")
        titulos = [l for l in texto.splitlines() if devolutiva._eh_titulo(l)]
        if titulos:
            print("Titulos de secao (use como ponto, ex.: conferir analise-de-estoque):")
            for t in titulos:
                chave = devolutiva._norm(t).replace(" ", "-")
                print(f"  {chave}  [{'receita pronta' if chave in RECEITAS else 'sem receita'}]")
        if imagens:
            print(f"{len(imagens)} prints salvos em {SAIDA / 'devolutiva_prints'}")
        for n in range(1, 40):
            try:
                s = devolutiva.secao(texto, n)
            except SystemExit:
                break
            marcados = sum(it["marcado"] for it in s["itens"])
            receita = "receita pronta" if n in RECEITAS else "sem receita"
            print(f"{n:>2}. {s['titulo']}  [{marcados}/{len(s['itens'])} marcados; {receita}]")
        return

    app = (a.app or os.getenv("BI_APP_URL") or APP_PADRAO).rstrip("/")

    if a.cmd == "pdf":
        from core import pdf
        blocos = []
        for nome in a.pastas:
            pasta = Path(nome) if Path(nome).is_absolute() else SAIDA / nome
            bloco = pdf.ler_pasta(pasta)
            if not bloco["secao"]:
                raise SystemExit(f"Pasta sem checklist.json: {pasta}")
            blocos.append(bloco)
        pontos = "-".join(str(b["secao"]["ponto"]) for b in blocos)
        destino = _pasta_pdf() / f"{datetime.now():%Y-%m-%d_%H%M}_conferencia_pontos_{pontos}.pdf"
        print(f"PDF: {pdf.gerar(blocos, app, destino, _cabecalho(blocos))}")
        return

    if a.cmd == "login":
        with navegador.abrir(False) as ctx:
            navegador.garantir_login(navegador.nova_aba(ctx), app, headless=False)
        return

    a.pontos = [_chave(p) for p in a.pontos]
    faltando = [p for p in a.pontos if p not in RECEITAS]
    if faltando:
        raise SystemExit(f"Sem receita para o(s) ponto(s) {faltando}. Existentes: {sorted(map(str, RECEITAS))}")

    from core import codex, relatorio

    carimbo = datetime.now().strftime("%Y-%m-%d_%H%M")
    relatorios = []
    with navegador.abrir(a.headless) as ctx:
        print("Aba 1: lendo a devolutiva...", flush=True)
        texto, imagens = _ler_devolutiva(_url_devolutiva(a.devolutiva), ctx, SAIDA / f"{carimbo}_devolutiva_prints")
        aba_bi = ctx.new_page()
        print(f"Aba 2: entrando no BI ({app})...", flush=True)
        navegador.garantir_login(aba_bi, app, a.headless, a.token_arquivo)

        for ponto in a.pontos:
            secao = devolutiva.secao(texto, ponto)
            pasta = SAIDA / f"{carimbo}_ponto{ponto}"
            pasta.mkdir(parents=True, exist_ok=True)
            (pasta / "checklist.json").write_text(json.dumps(secao, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"Ponto {ponto}: navegando e lendo a tela...", flush=True)
            receita, _ = RECEITAS[ponto]
            # Secao sem ponto numerado: a data vem do proprio documento ("Dados do estoque de 10/11").
            data = a.data or (secao.get("data_estoque") if secao.get("livre") else None)
            evid = receita(aba_bi, app, data, pasta)
            (pasta / "evidencia.json").write_text(json.dumps(evid, ensure_ascii=False, indent=1), encoding="utf-8")
            relatorios.append((secao, evid, pasta))

    from core import pdf

    saida_final, blocos = [], []
    for secao, evid, pasta in relatorios:
        veredito = None
        if not a.sem_codex:
            print(f"Ponto {secao['ponto']}: Codex conferindo...", flush=True)
            veredito = codex.conferir(secao, evid, pasta, a.modelo, imagens if secao.get("livre") else None)
        md = relatorio.montar(secao, evid, veredito, app)
        (pasta / "relatorio.md").write_text(md, encoding="utf-8")
        saida_final.append(md)
        blocos.append({"secao": secao, "evid": evid, "veredito": veredito, "pasta": pasta})
        print(f"  -> {pasta}", flush=True)

    pontos = "-".join(str(p) for p in a.pontos)
    destino = pdf.gerar(blocos, app, _pasta_pdf() / f"{carimbo}_conferencia_pontos_{pontos}.pdf", _cabecalho(blocos))
    print("\n\n".join(saida_final))
    print(f"\nPDF: {destino}")


if __name__ == "__main__":
    main()
