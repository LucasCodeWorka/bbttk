"""Print do quadro 'Cobertura por linha...' trocando a visao no seletor (Por status, Por colecao).

EXEMPLO de como cada demanda foi provada (adaptar os seletores/textos ao seu caso).
Uso: python exemplos/prints_quadro_cobertura.py <pasta_saida> <token.txt>
O token vem de apps/api/scripts/mint-test-token.ts (localhost). Ver docs/MODO_DE_OPERAR.md.
"""
import sys
from pathlib import Path as _P
sys.path.insert(0, str(_P(__file__).resolve().parents[1]))
import sys, time
from pathlib import Path
from core import navegador
from core.receitas import abrir_visao_geral
pasta = Path(sys.argv[1]); pasta.mkdir(parents=True, exist_ok=True)
APP = "http://localhost:3000"
JS_CARD = """() => { for (const e of document.querySelectorAll('h2,h3,p,span,div')) {
  if (e.children.length===0 && e.textContent.trim().toUpperCase().startsWith('COBERTURA POR LINHA')) {
    let c=e; while(c && !(c.className||'').toString().includes('rounded')) c=c.parentElement; return c; } } return null; }"""
with navegador.abrir(True) as ctx:
    page = navegador.nova_aba(ctx)
    navegador.garantir_login(page, APP, True, sys.argv[2])
    page.set_viewport_size({"width": 1900, "height": 1150})
    abrir_visao_geral(page, APP, "2026-11-22"); print("aberta", flush=True)
    for arq, rot in [("1_status.png", "Por status"), ("2_colecao.png", "Por coleção")]:
        card = page.evaluate_handle(JS_CARD).as_element()
        card.scroll_into_view_if_needed()
        card.query_selector("select").select_option(label=rot, timeout=20000); print("opt", rot, flush=True)
        time.sleep(2)
        card = page.evaluate_handle(JS_CARD).as_element()
        card.screenshot(path=str(pasta / arq), timeout=30000)
        print(arq, flush=True)
