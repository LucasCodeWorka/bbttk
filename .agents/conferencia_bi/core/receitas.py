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


# ---------------------------------------------------------------- Analise de Estoque

ROTA_ANALISE_ESTOQUE = "/pcp-dashboard-estoque"

# Card de KPI: o titulo e um <h3> (CardTitle); sobe ate o bloco que tambem tem o valor.
_JS_AE_KPI = """const kpi = (t) => {
  const h = [...document.querySelectorAll('h1,h2,h3,h4,p,span')].find(e => e.children.length === 0 && e.textContent.trim() === t);
  if (!h) return null;
  let el = h;
  for (let i = 0; i < 4 && el.parentElement; i++) { el = el.parentElement; if (/\\d/.test(el.textContent.replace(t, ''))) break; }
  return { el, carregando: /animate-pulse/.test(h.className) };
};
"""

_JS_AE_PRONTO = """() => {
""" + _JS_AE_KPI + """
  if (document.querySelector('.animate-pulse')) return false;
  const k = kpi('SKUs com saldo');
  if (!k || k.carregando || !/\\d/.test(k.el.textContent.replace('SKUs com saldo', ''))) return false;
  const titulo = [...document.querySelectorAll('h1,h2,h3,div,span,p')]
    .find(e => e.children.length === 0 && /^refer[eê]ncias em estoque$/i.test(e.textContent.trim()));
  return !!titulo;
}"""

_JS_AE_CARD_TABELA = """() => {
  const titulo = [...document.querySelectorAll('h1,h2,h3,div,span,p')]
    .find(e => e.children.length === 0 && /^refer[eê]ncias em estoque$/i.test(e.textContent.trim()));
  let card = titulo; while (card && !card.querySelector('table')) card = card.parentElement;
  return card;
}"""

# Cabecalho EXATAMENTE como o usuario ve (com o indicador de ordenacao, que nessa tela e a
# letra v/^), e tambem sem ele. Mais as primeiras linhas, e se ha linha de totais no topo.
_JS_AE_TABELA = """(limite) => {
  const titulo = [...document.querySelectorAll('h1,h2,h3,div,span,p')]
    .find(e => e.children.length === 0 && /^refer[eê]ncias em estoque$/i.test(e.textContent.trim()));
  let card = titulo; while (card && !card.querySelector('table')) card = card.parentElement;
  const t = card.querySelector('table');
  const up = (c) => getComputedStyle(c).textTransform === 'uppercase';
  const ths = [...t.querySelectorAll('thead th')];
  const cab_visivel = ths.map(th => { const s = th.innerText.replace(/\\s+/g, ' ').trim(); return up(th) ? s.toUpperCase() : s; });
  const cab_rotulo = ths.map(th => { const s = (th.querySelector('.truncate') || th).textContent.trim(); return up(th) ? s.toUpperCase() : s; });
  const ordenada = ths.map((th, i) => th.querySelectorAll('span').length > 2 ? cab_rotulo[i] : null).filter(Boolean);
  const linhas = [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.innerText.replace(/\\s+/g, ' ').trim()));
  const extra = [...card.querySelectorAll('thead tr')].length > 1 || [...t.querySelectorAll('tfoot tr')].length > 0
    || /^total/i.test((linhas[0] || [])[0] || '');
  return { primeira_linha_do_corpo: linhas[0] || null, cabecalho_como_o_usuario_ve: cab_visivel, cabecalho_rotulos: cab_rotulo,
           coluna_com_indicador_de_ordenacao: ordenada, linha_de_totais_no_cabecalho_ou_rodape: extra,
           total_linhas_tbody: linhas.length, primeiras_linhas: linhas.slice(0, limite) };
}"""

# Abre a 1a referencia (botao "+") e devolve as linhas filhas ate a proxima referencia.
_JS_AE_ABRIR_PRIMEIRA = """() => {
  const card = (""" + _JS_AE_CARD_TABELA + """)();
  const btn = card.querySelector('tbody tr button');
  if (!btn) return null;
  if (btn.innerText.trim().startsWith('+')) btn.click();
  return btn.innerText.replace(/^[+-]\\s*/, '').trim();
}"""

_JS_AE_FILHAS = """() => {
  const card = (""" + _JS_AE_CARD_TABELA + """)();
  const trs = [...card.querySelectorAll('tbody tr')];
  const inicio = trs.findIndex(tr => tr.querySelector('button'));
  const filhas = [];
  for (const tr of trs.slice(inicio + 1)) {
    if (tr.querySelector('button')) break;
    filhas.push([...tr.children].map(td => td.innerText.replace(/\\s+/g, ' ').trim()));
  }
  const cores = new Set(filhas.map(l => (l[0] || '').split(' / ')[0].trim()));
  const tamanhos = new Set(filhas.map(l => (l[0] || '').split(' / ')[1] || '').filter(Boolean));
  return { linhas_filhas: filhas.length, cores_distintas: [...cores], tamanhos_distintos: [...tamanhos],
           primeira_coluna_tem_cor_barra_tamanho: filhas.some(l => / \\/ /.test(l[0] || '')),
           amostra: filhas.slice(0, 12) };
}"""

_JS_AE_CARDS = """() => {
""" + _JS_AE_KPI + """
  const out = {};
  for (const t of ['Pecas em estoque', 'Valor a custo', 'SKUs com saldo', 'Referencias', 'Filiais/locais']) {
    const k = kpi(t);
    out[t] = k ? k.el.innerText.replace(/\\n+/g, ' | ') : null;
  }
  return out;
}"""


def _esperar_ae(page: Page, timeout_s: int = 600) -> None:
    time.sleep(2)
    inicio = time.time()
    recarregou = False
    while time.time() - inicio < timeout_s:
        # Requisicao perdida (ex.: API reiniciou com a pagina ja carregando) deixa a tela
        # esperando para sempre: recarrega uma vez depois de 60 s (a API responde em 25-40 s).
        if not recarregou and time.time() - inicio > 60:
            page.reload(wait_until="domcontentloaded")
            recarregou = True
        try:
            if page.evaluate(_JS_AE_PRONTO):
                time.sleep(1)
                return
        except Exception:
            pass
        time.sleep(2)
    raise SystemExit("A Analise de Estoque nao terminou de carregar no tempo limite.")


# Destaque por pedido: contorno + fundo amarelo no ponto exato da mudanca. Cada chamada
# limpa o destaque anterior, para que cada print mostre so o pedido dele.
_JS_AE_MARCAR = """([tipo, arg, estilo]) => {
""" + _JS_AE_KPI + """
  document.querySelectorAll('[data-conf-marca]').forEach(e => { e.style.cssText = e.dataset.confOrig || ''; e.removeAttribute('data-conf-marca'); });
  const marca = (e) => { if (!e) return; e.dataset.confOrig = e.style.cssText; e.setAttribute('data-conf-marca', '1'); e.style.cssText += estilo; };
  const card = (""" + _JS_AE_CARD_TABELA + """)();
  const t = card && card.querySelector('table');
  if (tipo === 'data') marca(document.querySelector('input[type="date"]'));
  if (tipo === 'kpi') for (const titulo of arg) { const k = kpi(titulo); if (k) marca(k.el); }
  if (tipo === 'caixa') { const c = document.querySelector('input[type="checkbox"]'); marca(c && c.closest('label')); }
  if (tipo === 'linha0' && t) marca(t.querySelector('tbody tr'));
  if (tipo === 'colunas' && t) {
    const re = new RegExp(arg, 'i');
    const ths = [...t.querySelectorAll('thead th')];
    const idx = ths.map((th, i) => re.test(th.textContent.trim()) ? i : -1).filter(i => i >= 0);
    for (const tr of t.querySelectorAll('tr')) for (const i of idx) marca(tr.children[i]);
  }
  if (tipo === 'filhas' && t) {
    const trs = [...t.querySelectorAll('tbody tr')];
    const ini = trs.findIndex(tr => tr.querySelector('button'));
    for (const tr of trs.slice(ini + 1)) { if (tr.querySelector('button')) break; marca(tr.children[0]); }
  }
}"""

_ESTILO_MARCA = "background:#fff3a8 !important; outline:3px solid #e0a800 !important; outline-offset:-3px;"

_JS_AE_BLOCO_KPIS = """() => {
""" + _JS_AE_KPI + """
  const a = kpi('Pecas em estoque'), b = kpi('Filiais/locais');
  if (!a || !b) return null;
  let el = a.el; while (el && !el.contains(b.el)) el = el.parentElement;
  return el;
}"""


def _marcar(page: Page, tipo: str, arg=None) -> None:
    page.evaluate(_JS_AE_MARCAR, [tipo, arg, _ESTILO_MARCA])
    time.sleep(0.3)


def _print(page: Page, prints: list, pasta: Path, nome: str, item: str, legenda: str,
           alvo=None, altura_max: int | None = None) -> None:
    """Print de um elemento (ou do topo do card da tabela), registrado com a chave do pedido."""
    el = alvo or page.evaluate_handle(_JS_AE_CARD_TABELA).as_element()
    if alvo is None:
        # Tabela com rolagem horizontal: colunas a direita ficariam fora do print. Reduz o
        # zoom da tabela ate caber inteira na largura (so para a foto).
        page.evaluate("""() => {
          const card = (""" + _JS_AE_CARD_TABELA + """)();
          const t = card && card.querySelector('table'); if (!t) return;
          t.style.zoom = '';
          let sc = t.parentElement; while (sc && sc !== card && sc.scrollWidth <= sc.clientWidth + 2) sc = sc.parentElement;
          if (sc && sc !== card && sc.scrollWidth > sc.clientWidth + 2) t.style.zoom = String(Math.max(0.55, (sc.clientWidth - 4) / sc.scrollWidth));
        }""")
    el.scroll_into_view_if_needed()
    time.sleep(0.3)
    arq = pasta / nome
    caixa = el.bounding_box()
    if altura_max and caixa and caixa["height"] > altura_max:
        page.screenshot(path=str(arq), clip={"x": caixa["x"], "y": caixa["y"], "width": caixa["width"], "height": altura_max})
    else:
        el.screenshot(path=str(arq))
    prints.append({"arquivo": nome, "legenda": legenda, "item": item})


def analise_estoque(page: Page, app: str, data: str | None, pasta: Path) -> dict:
    from datetime import date, timedelta
    prints: list = []

    # 1) Data padrao: abrir a tela sem mexer em nada e ler o campo de data.
    page.goto(f"{app}{ROTA_ANALISE_ESTOQUE}", wait_until="domcontentloaded", timeout=240_000)
    _esperar_ae(page)
    hoje = date.today()
    data_padrao = page.locator('input[type="date"]').first.input_value()
    topo = page.locator("h1", has_text="Análise de Estoque").locator("xpath=../..")
    subtitulo = topo.inner_text()
    _marcar(page, "data")
    _print(page, prints, pasta, "item1_data_padrao.png", "data",
           f"Tela recém-aberta, sem mexer em nada (hoje = {hoje:%d/%m/%Y}): campo Data do estoque destacado",
           alvo=topo.element_handle())

    # 2) Posicao da devolutiva, para comparar com a Visao Geral na mesma data.
    data_ef = data or data_padrao
    if data and data != data_padrao:
        page.locator('input[type="date"]').first.fill(data)
        page.get_by_role("button", name="Atualizar", exact=True).click()
        _esperar_ae(page)
    cards = page.evaluate(_JS_AE_CARDS)
    tabela = page.evaluate(_JS_AE_TABELA, 5)

    _marcar(page, "kpi", ["Referencias", "SKUs com saldo"])
    bloco_kpis = page.evaluate_handle(_JS_AE_BLOCO_KPIS).as_element()
    if bloco_kpis:
        _print(page, prints, pasta, "item2_cards_analise.png", "contagem",
               f"Análise de Estoque em {data_ef}: cards Referências e SKUs destacados", alvo=bloco_kpis)

    _marcar(page, "colunas", r"^(pecas|tt geral)")
    _print(page, prints, pasta, "item3_titulo_coluna.png", "titulo",
           "Cabeçalho da tabela: coluna de total de peças destacada (o indicador de ordenação fica colado ao título)",
           altura_max=300)

    _marcar(page, "colunas", r"^(valor a custo|part|valor varejo|valor atacado)")
    _print(page, prints, pasta, "item5_colunas_valor.png", "colunas",
           "Fim da tabela: Valor a custo e as colunas que vêm depois dele destacadas", altura_max=420)

    _marcar(page, "linha0")
    _print(page, prints, pasta, "item6_linha_totais.png", "totais",
           "Primeira linha do corpo da tabela destacada (onde o cliente pediu os totais)", altura_max=300)

    ref = page.evaluate(_JS_AE_ABRIR_PRIMEIRA)
    time.sleep(1.5)
    sem_agrupar = page.evaluate(_JS_AE_FILHAS)
    _marcar(page, "filhas")
    _print(page, prints, pasta, "item4a_sem_agrupar.png", "agrupamento",
           f"Agrupamento DESMARCADO, referência {ref} aberta: linhas cor / tamanho ({sem_agrupar['linhas_filhas']} linhas)",
           altura_max=560)

    # 3) Liga o agrupamento (ele mesmo recarrega) e abre a mesma referencia.
    # rotulo antigo e novo (devolutiva 13/11 renomeou para "Agrupamento por cores")
    caixa = page.get_by_label(re.compile(r"Agrupa(r por Agrupamento de Cores|mento por cores)", re.I))
    caixa.check()
    _esperar_ae(page)
    marcada = caixa.is_checked()
    ref2 = page.evaluate(_JS_AE_ABRIR_PRIMEIRA)
    time.sleep(1.5)
    com_agrupar = page.evaluate(_JS_AE_FILHAS)
    _marcar(page, "caixa")
    _print(page, prints, pasta, "item4b_caixa_marcada.png", "agrupamento",
           "Caixa de agrupamento de cores MARCADA (destaque)", alvo=topo.element_handle())
    _marcar(page, "filhas")
    _print(page, prints, pasta, "item4c_agrupado.png", "agrupamento",
           f"Agrupamento MARCADO, mesma referência {ref2} aberta ({com_agrupar['linhas_filhas']} linhas)",
           altura_max=560)
    caixa.uncheck()

    # 4) Visao Geral na mesma data: os dois cards que a devolutiva manda comparar.
    data_vg = abrir_visao_geral(page, app, data_ef)
    vg = {t: _bloco(page, t) for t in ["Referências com estoque", "SKUs com estoque"]}
    page.evaluate("""(estilo) => { for (const p of document.querySelectorAll('p')) {
        const t = p.textContent.trim(); if (t === 'Referências com estoque' || t === 'SKUs com estoque') p.parentElement.style.cssText += estilo; } }""",
                  _ESTILO_MARCA)
    grade = page.locator("p", has_text="Referências com estoque").first.locator("xpath=../..")
    _print(page, prints, pasta, "item2_cards_visao_geral.png", "contagem",
           f"Visão Geral na mesma posição ({data_vg}): cards Referências e SKUs com estoque destacados",
           alvo=grade.element_handle())
    comp = {
        "referencias": {"analise_estoque": _num(cards.get("Referencias") or ""),
                        "visao_geral": _num(vg["Referências com estoque"] or "")},
        "skus": {"analise_estoque": _num(cards.get("SKUs com saldo") or ""),
                 "visao_geral": _num(vg["SKUs com estoque"] or "")},
    }
    for v in comp.values():
        a, b = v["analise_estoque"], v["visao_geral"]
        v["diferenca"] = None if a is None or b is None else a - b

    return {
        "tela": f"Analise de Estoque ({ROTA_ANALISE_ESTOQUE}), posicao {data_ef}, sem filtros; "
                f"Visao Geral ({ROTA_VISAO_GERAL}) na posicao {data_vg} para comparar",
        "data_padrao_ao_abrir": {"campo_data": data_padrao, "hoje": hoje.isoformat(),
                                 "dia_anterior": (hoje - timedelta(days=1)).isoformat(),
                                 "subtitulo_da_tela": subtitulo.replace("\n", " | ")},
        "data_conferida": data_ef,
        "cards_analise_estoque": cards,
        "cards_visao_geral_mesma_data": vg,
        "comparacao_referencias_e_skus": comp,
        "tabela": tabela,
        "observacao_cabecalho": "O indicador de ordenacao da coluna ativa fica colado ao rotulo (letra 'v'/'^' "
                                "na versao antiga, seta ▼/▲ na nova); 'cabecalho_rotulos' e o texto sem ele.",
        "referencia_aberta_sem_agrupamento": {"referencia": ref, **sem_agrupar},
        "agrupamento_de_cores": {"caixa_ficou_marcada": marcada, "referencia": ref2, **com_agrupar},
        "_prints": prints,
    }


# Pedidos que cada receita fotografa (chave = `item` gravado em _prints). Usado pelo
# documento de aprovacao: o agente casa cada chave com as citacoes e os prints da cliente.
ITENS = {
    "analise-de-estoque": [
        {"chave": "data", "titulo": "Data padrão do estoque"},
        {"chave": "contagem", "titulo": "Referências e SKUs com estoque comparados à Visão Geral"},
        {"chave": "titulo", "titulo": "Título da coluna de total de peças"},
        {"chave": "agrupamento", "titulo": "Agrupamento por cores"},
        {"chave": "colunas", "titulo": "Colunas depois do valor a custo (participação e valorização a preço de venda)"},
        {"chave": "totais", "titulo": "Linha de totais em cima da tabela"},
    ],
}

RECEITAS = {
    "analise-de-estoque": (analise_estoque, "Tela Analise de Estoque: data padrao, cards x Visao Geral, "
                                            "cabecalho, agrupamento de cores, colunas de valor (posicao da devolutiva)"),
    6: (ponto_6, "Cards Referencias e SKUs com estoque (Visao Geral, posicao 08/11 por padrao)"),
    7: (ponto_7, "Quadro de cobertura em todas as visoes (Visao Geral, posicao 08/11 por padrao)"),
    9: (ponto_9, "Precos, markup e alertas; exemplo CNJ398 (Visao Geral, ultima posicao)"),
}
