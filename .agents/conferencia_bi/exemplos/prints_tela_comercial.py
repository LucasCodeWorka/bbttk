"""Print de uma tela inteira do Comercial (/dashboard): grid, card marcado e modal de fotos.

EXEMPLO de como cada demanda foi provada (adaptar os seletores/textos ao seu caso).
Uso: python exemplos/prints_tela_comercial.py <pasta_saida> <token.txt>
O token vem de apps/api/scripts/mint-test-token.ts (localhost). Ver docs/MODO_DE_OPERAR.md.
"""
import sys
from pathlib import Path as _P
sys.path.insert(0, str(_P(__file__).resolve().parents[1]))
import sys, time
from pathlib import Path
from core import navegador

pasta = Path(sys.argv[1]); pasta.mkdir(parents=True, exist_ok=True)
APP = "http://localhost:3000"
MARCA = ";outline:4px solid #f5c400;outline-offset:3px;"

JS_TITULO = """(t) => { for (const e of document.querySelectorAll('h1,h2,h3,p,div,span')) {
  if (e.children.length===0 && e.textContent.trim().toLowerCase()===t) return e; } return null; }"""
JS_CARD = """(t) => { const f = (""" + JS_TITULO + """)(t); let c=f;
  while (c && !(c.className||'').toString().includes('rounded')) c=c.parentElement; return c; }"""
JS_GRID = """() => { const f = (""" + JS_TITULO + """)('ranking vendedores'); let c=f;
  while (c && !((c.className||'').toString().includes('grid') && c.querySelectorAll('table').length>=2)) c=c.parentElement; return c; }"""
JS_PRONTO = """() => { const c = (""" + JS_CARD + """)('top produtos'); return !!(c && c.querySelectorAll('tbody tr').length >= 5); }"""

with navegador.abrir(True) as ctx:
    page = navegador.nova_aba(ctx)
    navegador.garantir_login(page, APP, True, sys.argv[2])
    page.goto(f"{APP}/dashboard", wait_until="domcontentloaded", timeout=240_000)
    ini = time.time()
    while time.time() - ini < 400:
        try:
            if page.evaluate(JS_PRONTO):
                break
        except Exception:
            pass
        time.sleep(2)
    time.sleep(3)
    grid = page.evaluate_handle(JS_GRID).as_element()
    grid.scroll_into_view_if_needed(); time.sleep(.5)
    grid.screenshot(path=str(pasta / "1_layout_ranking_produtos.png"))
    card = page.evaluate_handle(JS_CARD, 'top produtos').as_element()
    page.evaluate("(c)=>c.setAttribute('style',(c.getAttribute('style')||'')+'" + MARCA + "')", card)
    card.scroll_into_view_if_needed(); time.sleep(.5)
    card.screenshot(path=str(pasta / "2_top_produtos.png"))
    print("prints ok", flush=True)
    botao = page.locator("button", has_text="Fotos").first
    if botao.count():
        botao.click()
        ini = time.time()
        while time.time() - ini < 60:
            if page.locator("[role=dialog] img").count() or page.locator("text=Não foi possível").count():
                break
            time.sleep(1)
        time.sleep(2)
        dlg = page.locator("[role=dialog]").first
        (dlg if dlg.count() else page).screenshot(path=str(pasta / "3_fotos.png"))
        print("fotos ok", page.locator("[role=dialog] img").count(), flush=True)
