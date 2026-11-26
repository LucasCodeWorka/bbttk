"""Monta o PDF continuo: fala da cliente + resposta + print ANTES x DEPOIS por demanda.

EXEMPLO de como cada demanda foi provada (adaptar os seletores/textos ao seu caso).
Uso: python exemplos/montar_antes_depois.py <pasta_com_as_pastas_de_prints> <destino.pdf>
O token vem de apps/api/scripts/mint-test-token.ts (localhost). Ver docs/MODO_DE_OPERAR.md.
"""
import sys
from pathlib import Path as _P
sys.path.insert(0, str(_P(__file__).resolve().parents[1]))
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from core.pdf import CSS, _img, _e
from core.aprovacao import CSS_EXTRA, _pdf_continuo
S = Path(sys.argv[1]); A, D = S/"rup_antes", S/"rup_depois"; MA, MD = S/"mz_antes", S/"mz_depois"
def fig(p, leg): return f"<div class='fig'><img src='{_img(p)}'><div class='leg'>{_e(leg)}</div></div>" if p.exists() else f"<p><i>{_e(leg)} — sem print</i></p>"
h = [f"<html><head><meta charset='utf-8'><style>{CSS}{CSS_EXTRA}</style></head><body>",
 "<h1>Visão Geral — Ruptura e quadro de cobertura (antes × depois)</h1>",
 "<p class='meta'>Prints do próprio sistema, posição de 22/11/2026, sem filtros, ambiente local.</p>"]
for n, tit, cit, arq, resp, so_depois, *tipo in [
 (1, "Nova regra da ruptura", "Renata: \"Vamos inserir na regra do cálculo da ruptura o item já ter tido alguma entrada na vida (para não considerar os itens cadastrados que ainda não entraram no DPA) e ter venda nos últimos 12 meses.\"", "1_card_ruptura.png",
  "A ruptura continua olhando só Básico e Básico Renovável com STATUS Ativo. Agora o SKU também precisa ter tido alguma entrada até a data da posição e ter vendido nos 12 meses anteriores a ela, em qualquer loja ou canal. Também saíram 520 registros técnicos duplicados do sistema (código \"PRODUCT_CODE\"). Na posição de 22/11, a base caiu de 10.953 para 4.723 SKUs, e a ruptura foi de 6.790 SKUs (62,0%) para 919 (19,5%): Básico 616 (23,2%) e Renovável 303 (14,7%). O filtro de lojas continua decidindo de quais lojas se olha o estoque.", False),
 (2, "Relação dos itens, primeiro por referência", "Renata: \"Podemos incluir aqui neste quadrado da ruptura o botão pra ver a relação dos itens? Mas teria que sair primeiro por referência e, ao clicar, abrir por sku, juntando os skus de uma mesma referência.\"", "2_lista_referencias.png",
  "O quadro ganhou o botão VER ITENS. Ele abre a lista por referência, com: quantos SKUs estão em ruptura, quantos estão na base, o percentual, as peças vendidas em 12 meses e a data da última venda. Por padrão vêm primeiro as referências com mais SKUs em ruptura, mas dá para ordenar pelas outras colunas. Também dá para buscar por referência ou descrição, filtrar Básico ou Renovável, abrir a foto e exportar para Excel (uma aba por referência e outra por SKU). A lista segue os mesmos filtros da tela.", True),
 (3, "Ao clicar, os SKUs da mesma referência juntos", "Renata: \"As relações por sku estão ruins de serem analisadas, pois os itens ficam em lugares diferentes nos relatórios.\"", "3_referencia_aberta_skus.png",
  "Ao clicar na referência, abrem todos os SKUs dela juntos: cor, tamanho, situação, estoque, venda em 12 meses, última venda e última entrada. Os SKUs em ruptura aparecem primeiro, em vermelho, e logo abaixo os que ainda têm estoque, para ver na mesma tela o que falta na grade.",  True),
 (4, "Tirar a coluna Valor em Estoque do quadro de cobertura", "Renata: “O espaço ficou um pouco espremido, quando a gente vê por Coleção. Achei que o VALOR EM ESTOQUE ficou perdido neste relatório, temos este volume em outros, então, por favor tira esta coluna (de todas as visualizações).”", "2_colecao.png",
  "A coluna Valor em Estoque (e o Part. % dela) saiu de todas as visões do quadro. Ele foi de 18 para 16 colunas e as que ficaram ganharam espaço. O card Valor em Estoque dos indicadores lá em cima continua como estava.", False, "m"),
 (5, "Fora de Linha separado de Fora de Linha Promo", "Renata: “Aqui foram agrupados todos os FORA DE LINHA. Porém, solicitei agrupar somente os FORA DE LINHA XXX (Black, Promo, Liqui...) e manter a linha do FORA DE LINHA. Pq os itens FORA DE LINHA são itens com preço cheio e os FORA DE LINHA PROMO são os que estamos dando descontos.”", "1_status.png",
  "Na visão Por status, o FORA DE LINHA puro (preço cheio) voltou a ser uma linha própria. Todos os FORA DE LINHA com complemento (Black, Promo, Liqui, 2025...) ficam juntos em FORA DE LINHA PROMO. Na posição de 22/11: FORA DE LINHA 4.040 peças em estoque (93 referências) e FORA DE LINHA PROMO 5.980 (411 referências); a soma é a mesma de antes, 10.020. O status original de cada referência continua aparecendo ao abrir o grupo.", False, "m"),
]:
    h.append(f"<div class='pedido'><h2>{n}. {_e(tit)}</h2>")
    h.append(f"<div class='par cab'><span class='etq cliente'>VOCÊS ESCREVERAM</span></div><blockquote>{_e(cit)}</blockquote>")
    h.append(f"<div class='resposta'>{_e(resp)}</div>")
    if not so_depois:
        h.append("<div class='par cab'><span class='etq antes'>ANTES</span></div>" + fig((MA if tipo else A)/arq, "Antes"))
    h.append("<div class='par cab'><span class='etq depois'>DEPOIS</span></div>" + fig((MD if tipo else D)/arq, "Depois") + "</div>")
h.append("</body></html>")
dest = Path(sys.argv[2])
with sync_playwright() as p:
    nav = p.chromium.launch(headless=True); _pdf_continuo(nav, "".join(h), dest); nav.close()
print(dest)
