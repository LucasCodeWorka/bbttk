"""Receitas: como chegar na tela de cada ponto da devolutiva e o que ler dela.

Tudo aqui e deterministico (zero token). Cada receita devolve um dicionario de
evidencia em TEXTO, mais prints salvos na pasta da execucao como prova para humano.
O modelo so recebe a evidencia, nunca decide onde clicar.

Para cobrir um ponto novo: escrever uma funcao `ponto_N(page, app, data, pasta)` e
registrar em RECEITAS. Uma receita boa le texto e faz as contas que nao precisam de
modelo (somas, contagens, alinhamento).
"""
from __future__ import annotations

import re
import time
from pathlib import Path

from playwright.sync_api import Page

ROTA_VISAO_GERAL = "/pcp-relatorio-base"

# ---------------------------------------------------------------- utilitarios de DOM

_JS_PRONTO = """() => {
  // textContent (nao innerText): o CSS uppercase muda o innerText e a comparacao falharia.
  const txt = document.body.textContent;
  if (txt.includes('Calculando ano anterior')) return false;
  const refsCard = [...document.querySelectorAll('p')].find(p => p.textContent.trim() === 'Referências com estoque');
  if (refsCard) {
    const bloco = refsCard.parentElement.textContent;
    // o comparativo AA chega depois do relatorio principal; esperar o rodape aparecer
    if (!/AA:|indispon/i.test(bloco)) return false;
  }
  const titulo = [...document.querySelectorAll('h1,h2,h3,div,span,p')]
    .find(e => e.children.length === 0 && e.textContent.trim().startsWith('Cobertura por'));
  if (!titulo) return false;
  let card = titulo; while (card && !card.querySelector('table') && !card.textContent.includes('Carregando')) card = card.parentElement;
  if (!card || card.textContent.includes('Carregando') || !card.querySelector('table')) return false;
  const refs = [...document.querySelectorAll('p')].find(p => p.textContent.trim() === 'Referências com estoque');
  if (refs && refs.nextElementSibling && refs.nextElementSibling.textContent.trim() === '—') return false;
  return true;
}"""

_JS_BLOCO = """(titulo) => {
  const alvo = titulo.toLowerCase();
  const folha = [...document.querySelectorAll('p,span,div,h2,h3')]
    .find(e => e.children.length === 0 && e.textContent.trim().toLowerCase() === alvo);
  if (!folha) return null;
  let el = folha;
  while (el && !(typeof el.className === 'string' && el.className.includes('rounded'))) el = el.parentElement;
  el = el || folha.parentElement;
  // Inclui as dicas de mouse (atributo title): e la que a tela explica a regra e a data do AA.
  const dicas = [el, ...el.querySelectorAll('[title]')].map(e => e.getAttribute('title')).filter(Boolean);
  return el.innerText.replace(/\\n+/g, ' | ') + (dicas.length ? ' || dicas ao passar o mouse: ' + dicas.join(' / ') : '');
}"""

_JS_CARD_COBERTURA = """() => {
  const titulo = [...document.querySelectorAll('h1,h2,h3,div,span,p')]
    .find(e => e.children.length === 0 && e.textContent.trim().startsWith('Cobertura por'));
  let card = titulo; while (card && !card.querySelector('table')) card = card.parentElement;
  return card;
}"""

# Texto que o usuario VE: tira texto so de leitor de tela (.sr-only), setas de ordenacao/
# expansao e o "ver N referencias" do botao que abre a linha. Respeita o CSS uppercase.
_JS_VISIVEL = """const visivel = (c) => {
  let el = c;
  if (c.querySelector('.sr-only')) { el = c.cloneNode(true); el.querySelectorAll('.sr-only').forEach(s => s.remove()); }
  const upper = getComputedStyle(c).textTransform === 'uppercase';
  let t = (el === c ? c.innerText : el.textContent) || '';
  if (upper) t = t.toUpperCase();
  return t.replace(/[▲▼▸▾►›⌄]/g, '').replace(/\\s*ver \\d+ refer[eê]ncias?/i, '').replace(/\\s+/g, ' ').trim();
};
"""

_JS_LER_COBERTURA = """() => {
""" + _JS_VISIVEL + """
  const titulo = [...document.querySelectorAll('h1,h2,h3,div,span,p')]
    .find(e => e.children.length === 0 && e.textContent.trim().startsWith('Cobertura por'));
  let card = titulo; while (card && !card.querySelector('table')) card = card.parentElement;
  const tabela = card.querySelector('table');
  const cab = [...tabela.querySelectorAll('thead tr')].map(tr => [...tr.children].map(visivel));
  const linhas = [...tabela.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(visivel));
  let num = 0, numCentro = 0, th = 0, thCentro = 0;
  for (const td of tabela.querySelectorAll('tbody td')) {
    if (!/\\d/.test(td.innerText)) continue;
    if (td === td.parentElement.firstElementChild) continue;  // rotulo da linha
    num++; if (getComputedStyle(td).textAlign === 'center') numCentro++;
  }
  for (const c of tabela.querySelectorAll('thead th')) {
    if (c === c.parentElement.firstElementChild) continue;
    th++;
    const flex = c.querySelector('span');
    const centro = getComputedStyle(c).textAlign === 'center' || (flex && getComputedStyle(flex).justifyContent === 'center');
    if (centro) thCentro++;
  }
  return { cabecalho: cab, linhas, alinhamento: { celulas_numericas: num, centralizadas: numCentro, cabecalhos: th, cabecalhos_centralizados: thCentro },
           largura_tabela: tabela.scrollWidth, largura_visivel: tabela.parentElement.clientWidth };
}"""


# Destaque visual nos prints (so para humano; some no proximo carregamento da pagina).
_ESTILO_DESTAQUE = "background:#fff3a8 !important; box-shadow: inset 0 0 0 2px #e0a800 !important;"

_JS_DESTACAR_PARTICIPACAO = """(estilo) => {
  document.querySelectorAll('[data-conf-destaque]').forEach(e => { e.style.cssText = e.dataset.confOrig || ''; e.removeAttribute('data-conf-destaque'); });
  const titulo = [...document.querySelectorAll('h1,h2,h3,div,span,p')]
    .find(e => e.children.length === 0 && e.textContent.trim().startsWith('Cobertura por'));
  let card = titulo; while (card && !card.querySelector('table')) card = card.parentElement;
  const t = card.querySelector('table');
  const cab = [...t.querySelectorAll('thead tr')].pop();
  const idx = [...cab.children].map((c, i) => /^part/i.test(c.textContent.trim()) ? i : -1).filter(i => i >= 0);
  for (const tr of t.querySelectorAll('tr')) for (const i of idx) {
    const c = tr.children[i]; if (!c) continue;
    c.dataset.confOrig = c.style.cssText; c.setAttribute('data-conf-destaque', '1'); c.style.cssText += estilo;
  }
}"""

_JS_DESTACAR_TEXTO = """([texto, estilo]) => {
  for (const tr of document.querySelectorAll('tbody tr')) if (tr.innerText.includes(texto)) tr.style.cssText += estilo;
  for (const th of document.querySelectorAll('thead th')) if (/PDV|MKUP|CUSTO/i.test(th.textContent)) th.style.cssText += estilo;
}"""


def _registrar_print(prints: list, arquivo: Path, legenda: str) -> None:
    prints.append({"arquivo": arquivo.name, "legenda": legenda})


def _esperar_pronto(page: Page, timeout_s: int = 600) -> None:
    time.sleep(2)  # da tempo do clique em Atualizar ligar o "carregando"
    inicio = time.time()
    while time.time() - inicio < timeout_s:
        try:
            if page.evaluate(_JS_PRONTO):
                time.sleep(1)
                return
        except Exception:
            pass
        time.sleep(2)
    raise SystemExit("A Visao Geral nao terminou de carregar no tempo limite.")


def _bloco(page: Page, titulo: str) -> str | None:
    return page.evaluate(_JS_BLOCO, titulo)


def _print_cobertura(page: Page, arquivo: Path) -> None:
    card = page.evaluate_handle(_JS_CARD_COBERTURA).as_element()
    if card:
        card.scroll_into_view_if_needed()
        card.screenshot(path=str(arquivo))


def _num(txt: str) -> float | None:
    m = re.search(r"-?[\d.]+(,\d+)?", txt or "")
    if not m:
        return None
    try:
        return float(m.group(0).replace(".", "").replace(",", "."))
    except ValueError:
        return None


def abrir_visao_geral(page: Page, app: str, data: str | None) -> str:
    """Abre a Visao Geral limpa (sem filtros salvos na sessao) e aplica a data, se pedida."""
    page.goto(f"{app}/login", wait_until="domcontentloaded", timeout=240_000)
    page.evaluate("() => sessionStorage.clear()")
    page.goto(f"{app}{ROTA_VISAO_GERAL}", wait_until="domcontentloaded", timeout=240_000)
    _esperar_pronto(page)
    if data:
        page.locator('input[type="date"]').first.fill(data)
        page.get_by_role("button", name="Atualizar", exact=True).click()
        _esperar_pronto(page)
    return page.locator('input[type="date"]').first.input_value()


def _somas_participacao(cabecalho: list[list[str]], linhas: list[list[str]]) -> dict:
    """Soma cada coluna 'Part. %' sem a linha TOTAL e confere com o valor/total da coluna vizinha."""
    if not cabecalho:
        return {}
    cab = cabecalho[-1]
    resultado = {}
    corpo = [l for l in linhas if l and l[0].strip().upper() != "TOTAL"]
    total = next((l for l in linhas if l and l[0].strip().upper() == "TOTAL"), None)
    for i, nome in enumerate(cab):
        if not nome.lower().startswith("part"):
            continue
        base = cab[i - 1] if i > 0 else f"col{i}"
        soma = sum(v for v in (_num(l[i]) for l in corpo if i < len(l)) if v is not None)
        maior_erro = 0.0
        tot_base = _num(total[i - 1]) if total and i - 1 < len(total) else None
        if tot_base:
            for l in corpo:
                if i < len(l):
                    v, p = _num(l[i - 1]), _num(l[i])
                    if v is not None and p is not None:
                        maior_erro = max(maior_erro, abs(v / tot_base * 100 - p))
        resultado[base] = {
            "soma_das_linhas_%": round(soma, 2),
            "celula_na_linha_total": (total[i] if total and i < len(total) else None) or "(vazia)",
            "maior_erro_recalculando_valor/total_%": round(maior_erro, 3),
        }
    return resultado


# ---------------------------------------------------------------- receitas


def ponto_6(page: Page, app: str, data: str | None, pasta: Path) -> dict:
    data_ef = abrir_visao_geral(page, app, data or "2026-11-08")
    cards = {t: _bloco(page, t) for t in ["Referências com estoque", "SKUs com estoque", "Ruptura"]}
    prints: list = []
    grade = page.locator("p", has_text="Referências com estoque").first.locator("xpath=../..")
    page.evaluate("""(estilo) => { for (const p of document.querySelectorAll('p')) {
        const t = p.textContent.trim(); if (t === 'Referências com estoque' || t === 'SKUs com estoque') p.parentElement.style.cssText += estilo; } }""",
                  _ESTILO_DESTAQUE)
    grade.scroll_into_view_if_needed()
    grade.screenshot(path=str(pasta / "p6_cards.png"))
    _registrar_print(prints, pasta / "p6_cards.png", f"Cards Referências e SKUs com estoque, posição {data_ef} (destacados)")
    return {
        "tela": f"Visao Geral do PCP ({ROTA_VISAO_GERAL}), posicao {data_ef}, sem filtros",
        "data_posicao": data_ef,
        "cards": cards,
        "_prints": prints,
    }


def ponto_7(page: Page, app: str, data: str | None, pasta: Path) -> dict:
    data_ef = abrir_visao_geral(page, app, data or "2026-11-08")
    seletor = page.locator('select:has(option[value="categoria"])').first
    opcoes = seletor.evaluate("s => [...s.options].map(o => [o.value, o.textContent.trim()])")
    visoes = []
    prints: list = []
    for valor, rotulo in opcoes:
        seletor.select_option(valor)
        time.sleep(1.5)
        lido = page.evaluate(_JS_LER_COBERTURA)
        page.evaluate(_JS_DESTACAR_PARTICIPACAO, _ESTILO_DESTAQUE)
        _print_cobertura(page, pasta / f"p7_{valor}.png")
        _registrar_print(prints, pasta / f"p7_{valor}.png", f"Quadro de cobertura - {rotulo}, posição {data_ef} (colunas Part. % destacadas)")
        celulas_com_m = sorted({c for l in lido["linhas"] for c in l if re.search(r"\d\s*m$", c)})
        visoes.append({
            "visao": rotulo,
            "cabecalho": lido["cabecalho"],
            "linhas": lido["linhas"],
            "medicoes_automaticas": {
                "alinhamento": lido["alinhamento"],
                "participacao_por_coluna": _somas_participacao(lido["cabecalho"], lido["linhas"]),
                "celulas_terminando_em_m": celulas_com_m[:10],
                "rolagem_horizontal": lido["largura_tabela"] > lido["largura_visivel"] + 2,
            },
        })
    return {
        "tela": f"Visao Geral do PCP ({ROTA_VISAO_GERAL}), quadro 'Cobertura por linha/categoria/genero/status x canal', posicao {data_ef}",
        "data_posicao": data_ef,
        "opcoes_do_seletor_de_visao": [r for _, r in opcoes],
        "visoes": visoes,
        "_prints": prints,
    }


_JS_TABELA_PRINCIPAL = """(limite) => {
""" + _JS_VISIVEL + """
  const t = [...document.querySelectorAll('table')].find(t => t.querySelector('thead') && t.querySelector('thead').innerText.includes('PDV'));
  if (!t) return null;
  return { cabecalho: [...t.querySelectorAll('thead tr')].map(tr => [...tr.children].map(visivel)),
           linhas: [...t.querySelectorAll('tbody tr')].slice(0, limite).map(tr => [...tr.children].map(visivel)) };
}"""


def _clicar_card(page: Page, titulo: str) -> str | None:
    page.locator("button", has_text=titulo).first.click()
    _esperar_pronto(page)
    faixa = page.locator("div", has_text="Mostrando só as referências").last
    texto = faixa.inner_text() if faixa.count() else None
    page.locator("button", has_text="Mostrar todas").first.click()
    _esperar_pronto(page)
    return texto


def ponto_9(page: Page, app: str, data: str | None, pasta: Path) -> dict:
    data_ef = abrir_visao_geral(page, app, data)  # padrao: ultima posicao (promocao vigente)
    cards = {t: _bloco(page, t) for t in ["Preço abaixo do custo", "MKUP fora da faixa"]}
    nota_promocao = page.evaluate(
        "() => { const p = [...document.querySelectorAll('p')].find(p => /promocion/i.test(p.textContent)); return p ? p.innerText : null; }"
    )
    cabecalho_tabela = (page.evaluate(_JS_TABELA_PRINCIPAL, 0) or {}).get("cabecalho")
    prints: list = []
    cards_el = page.locator("button", has_text="Preço abaixo do custo").first.locator("xpath=..")
    cards_el.scroll_into_view_if_needed()
    cards_el.screenshot(path=str(pasta / "p9_cards.png"))
    _registrar_print(prints, pasta / "p9_cards.png", f"Cards de alerta de preço, posição {data_ef}")
    filtro_preco = _clicar_card(page, "Preço abaixo do custo")
    filtro_markup = _clicar_card(page, "MKUP fora da faixa")

    page.get_by_placeholder("Referência, descrição ou código...").fill("CNJ398")
    page.get_by_role("button", name="Atualizar", exact=True).click()
    _esperar_pronto(page)
    referencia = page.evaluate(_JS_TABELA_PRINCIPAL, 5)
    page.evaluate("""() => { const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.innerText.includes('CNJ398')); if (tr) tr.click(); }""")
    time.sleep(4)
    detalhe = page.evaluate(_JS_TABELA_PRINCIPAL, 40)
    page.evaluate(_JS_DESTACAR_TEXTO, ["CNJ398", _ESTILO_DESTAQUE])
    tabela = page.locator("table", has_text="PDV ORIGINAL").first
    tabela.scroll_into_view_if_needed()
    tabela.screenshot(path=str(pasta / "p9_cnj398.png"))
    _registrar_print(prints, pasta / "p9_cnj398.png", "CNJ398: custo, PDV original/atual e markup (referência aberta por SKU)")
    return {
        "tela": f"Visao Geral do PCP ({ROTA_VISAO_GERAL}), tabela principal, posicao {data_ef}",
        "data_posicao": data_ef,
        "cabecalho_da_tabela_principal": cabecalho_tabela,
        "cards_de_alerta_sem_filtro": cards,
        "ao_clicar_card_preco_abaixo_do_custo": filtro_preco,
        "ao_clicar_card_mkup_fora_da_faixa": filtro_markup,
        "aviso_de_preco_promocional": nota_promocao,
        "busca_CNJ398_por_referencia": referencia,
        "busca_CNJ398_apos_abrir_a_referencia": detalhe,
        "_prints": prints,
    }


RECEITAS = {
    6: (ponto_6, "Cards Referencias e SKUs com estoque (Visao Geral, posicao 08/11 por padrao)"),
    7: (ponto_7, "Quadro de cobertura em todas as visoes (Visao Geral, posicao 08/11 por padrao)"),
    9: (ponto_9, "Precos, markup e alertas; exemplo CNJ398 (Visao Geral, ultima posicao)"),
}
