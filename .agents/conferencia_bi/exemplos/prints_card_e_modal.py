"""Print de um CARD destacado + modal aberto (ex.: card RUPTURA e a lista de itens).

EXEMPLO de como cada demanda foi provada (adaptar os seletores/textos ao seu caso).
Uso: python exemplos/prints_card_e_modal.py <pasta_saida> <token.txt>   # rodar 1x ANTES e 1x DEPOIS
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
MARCA = "outline:4px solid #f5c400 !important; outline-offset:3px;"
JS_CARD = """() => { for (const e of document.querySelectorAll('h3,p,span,div')) {
  if (e.children.length===0 && e.textContent.trim().toLowerCase()==='ruptura') {
    let c=e; while(c && !(c.className||'').toString().includes('border-l-4')) c=c.parentElement; return c; } } return null; }"""
with navegador.abrir(True) as ctx:
    page = navegador.nova_aba(ctx)
    navegador.garantir_login(page, APP, True, sys.argv[2])
    page.set_viewport_size({"width": 1600, "height": 1150})
    data = abrir_visao_geral(page, APP, "2026-11-22")
    print("data", data, flush=True)
    card = page.evaluate_handle(JS_CARD).as_element()
    card.scroll_into_view_if_needed(); time.sleep(.5)
    print("card", card.inner_text().replace("\n", " | "), flush=True)
    # card + vizinhos: a linha inteira de cards da ruptura
    linha = card.evaluate_handle("c=>c.parentElement").as_element()
    page.evaluate("(c)=>c.setAttribute('style',(c.getAttribute('style')||'')+';"+MARCA+"')", card)
    time.sleep(.3); linha.screenshot(path=str(pasta / "1_card_ruptura.png"))
    ver = page.locator("button", has_text="Ver itens")
    if ver.count():
        ver.first.click()
        painel = page.locator("div.fixed.inset-0.z-50").last.locator(":scope > div").last
        ini = time.time()
        while time.time() - ini < 120:
            if painel.locator("table tbody tr").count() > 3: break
            time.sleep(1)
        time.sleep(1)
        painel.screenshot(path=str(pasta / "2_lista_referencias.png"))
        print("refs", painel.locator("table tbody tr").count(), flush=True)
        painel.locator("table tbody tr").first.click()
        time.sleep(1)
        painel.screenshot(path=str(pasta / "3_referencia_aberta_skus.png"))
        print("aberta ok", flush=True)
