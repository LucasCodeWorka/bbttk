#!/usr/bin/env python3
"""
Backfill dos itens que o ETL principal deixou de gravar.

CONTEXTO
--------
Desde 25/06/2026 o ETL grava o cabecalho do documento em `transacoes` mas nao grava
nada em `transacao_itens` para operacao que nao e venda/devolucao de venda -
transferencia, compra, industrializacao, consignacao. Sao 45 operacoes afetadas.

A API do TOTVS devolve os itens normalmente (conferido documento a documento), entao
o buraco e recuperavel. Este script e um PALIATIVO: ele repoe o que falta enquanto a
causa raiz nao e corrigida no ETL principal. Nao substitui a correcao - se o ETL
continuar filtrando, o buraco volta a crescer todo dia (medido: 102 documentos e 968
pecas em 4 dias).

Tambem preenche `transacoes.origin_destination`, que o ETL nunca populou em periodo
nenhum porque nunca pediu `expand=originDestination` na busca. Esse campo traz o
vinculo documento-a-documento da transferencia: qual entrada corresponde a qual saida.
Saida com destino vazio = ainda nao recebida, ou seja, em transito de verdade.

USO
---
    python backfill_transacao_itens.py --dry-run          # so relata
    python backfill_transacao_itens.py                    # roda uma vez
    python backfill_transacao_itens.py --intervalo=3600   # modo servico (loop)

    --dias=N         janela deslizante em dias (default 30)
    --desde=DATA     ignora --dias e usa data fixa, ex: --desde=2026-06-25
    --todas          inclui todas as operacoes sem item, nao so transferencia
    --intervalo=SEG  modo servico: repete a cada SEG segundos
    --dry-run        nao escreve nada

AMBIENTE (.env ou variaveis do sistema)
---------------------------------------
    DATABASE_URL          postgres://user:senha@host:5432/base
    TOTVS_API_URL         https://.../api/totvsmoda
    TOTVS_CLIENT_ID
    TOTVS_CLIENT_SECRET
    TOTVS_USERNAME
    TOTVS_PASSWORD

DEPENDENCIAS
------------
    pip install psycopg2-binary requests
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
import time
from datetime import date, datetime, timedelta
from typing import Any, Iterable

import psycopg2
import psycopg2.extras
import requests
import urllib3

# O endpoint do TOTVS usa certificado que nao valida na cadeia padrao - mesma coisa que
# o app Node ja faz (rejectUnauthorized: false). Silencia so o aviso repetido.
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

LOTE = 40           # transacoes por chamada; o filtro e por filial, nao da pra misturar
PAUSA_LOTE = 0.25   # segundos entre chamadas, pra nao martelar o ERP em horario comercial
TIMEOUT_HTTP = 120
LIMITE_ORIGIN_DESTINATION = 255  # a coluna e VARCHAR(255)

log = logging.getLogger("backfill-itens")

_parar = False


def _sinal(signum, _frame):
    """SIGTERM/SIGINT: termina o ciclo atual e sai limpo (systemd manda SIGTERM)."""
    global _parar
    _parar = True
    log.info("sinal %s recebido - encerrando apos o ciclo atual", signum)


class TotvsClient:
    """Cliente da API do TOTVS com renovacao automatica de token.

    Em modo servico o processo fica horas no ar, entao o token expira no meio do
    caminho - renova sozinho com folga de 60s antes do vencimento.
    """

    def __init__(self) -> None:
        self.base = os.environ["TOTVS_API_URL"].rstrip("/")
        self._token: str | None = None
        self._expira_em: float = 0.0
        self.sessao = requests.Session()
        self.sessao.verify = False

    def _token_valido(self) -> str:
        if self._token and time.time() < self._expira_em - 60:
            return self._token
        resp = self.sessao.post(
            f"{self.base}/authorization/v2/token",
            data={
                "grant_type": "password",
                "client_id": os.environ["TOTVS_CLIENT_ID"],
                "client_secret": os.environ["TOTVS_CLIENT_SECRET"],
                "username": os.environ["TOTVS_USERNAME"],
                "password": os.environ["TOTVS_PASSWORD"],
            },
            timeout=TIMEOUT_HTTP,
        )
        resp.raise_for_status()
        dados = resp.json()
        self._token = dados["access_token"]
        self._expira_em = time.time() + float(dados.get("expires_in", 3600))
        log.debug("token renovado")
        return self._token

    def buscar_transacoes(self, branch_code: int, codigos: list[int]) -> list[dict[str, Any]]:
        corpo = {
            "branchCodeList": [branch_code],
            "transactionCodeList": codigos,
            "expand": "originDestination",
            "page": 1,
            "pageSize": len(codigos),
        }
        for tentativa in range(1, 4):
            try:
                resp = self.sessao.post(
                    f"{self.base}/general/v2/transactions/search",
                    json=corpo,
                    headers={"Authorization": f"Bearer {self._token_valido()}"},
                    timeout=TIMEOUT_HTTP,
                )
                if resp.status_code == 401:  # token morreu antes da hora
                    self._token = None
                    continue
                resp.raise_for_status()
                return resp.json().get("items") or []
            except requests.RequestException as erro:
                if tentativa == 3:
                    raise
                espera = 2 ** tentativa
                log.warning("falha na API (tentativa %s/3): %s - repetindo em %ss", tentativa, erro, espera)
                time.sleep(espera)
        return []


def compactar_destino(origin_destination: Any) -> str | None:
    """Reduz o originDestination do TOTVS aos pares [filial, transacao] do destino.

    O JSON cru estoura o VARCHAR(255) assim que o documento tem mais de um destino.
    Guardamos so o que o relatorio de transito precisa. Lista vazia = em transito.
    Devolve None quando nem assim cabe - meio JSON seria pior que nada.
    """
    if not isinstance(origin_destination, dict):
        return None
    destinos = origin_destination.get("destination")
    if not isinstance(destinos, list):
        return None
    pares = [
        [d.get("branchCodeDestination"), d.get("transactionCodeDestination")]
        for d in destinos
        if d.get("branchCodeDestination") is not None and d.get("transactionCodeDestination") is not None
    ]
    texto = json.dumps(pares, separators=(",", ":"))
    return texto if len(texto) <= LIMITE_ORIGIN_DESTINATION else None


def buscar_documentos_sem_item(cur, desde: date, so_transferencia: bool) -> list[tuple[int, int]]:
    """Documentos que existem em `transacoes` mas nao tem nenhuma linha de item."""
    filtro = "AND co.operation_mode = '2'" if so_transferencia else ""
    cur.execute(
        f"""
        SELECT t.branch_code, t.transaction_code
        FROM transacoes t
        JOIN classificacao_operacoes co ON co.operation_code = t.operation_code
        LEFT JOIN transacao_itens ti
          ON ti.branch_code = t.branch_code AND ti.transaction_code = t.transaction_code
        WHERE t.transaction_date >= %s
          AND t.status = 4
          AND ti.id IS NULL
          {filtro}
        ORDER BY t.transaction_date, t.branch_code, t.transaction_code
        """,
        (desde,),
    )
    return cur.fetchall()


def gravar_documento(conn, doc: dict[str, Any]) -> tuple[int, bool]:
    """Regrava os itens de UM documento e o vinculo origem/destino.

    O DELETE antes do INSERT e obrigatorio: upsert por item_index sozinho deixa linha
    orfa quando o documento passa a ter menos itens do que numa carga anterior.
    Os dois precisam estar na MESMA transacao, senao uma falha no meio deixaria o
    documento sem item nenhum.
    """
    branch = doc["branchCode"]
    codigo = doc["transactionCode"]
    itens = doc.get("items") or []
    compacto = compactar_destino(doc.get("originDestination"))

    with conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM transacao_itens WHERE branch_code = %s AND transaction_code = %s",
                (branch, codigo),
            )
            if itens:
                psycopg2.extras.execute_values(
                    cur,
                    """
                    INSERT INTO transacao_itens
                      (branch_code, transaction_code, item_index, product_code,
                       measured_unit, quantity, value, unit_discount_value, net_value, seller_code)
                    VALUES %s
                    """,
                    [
                        (
                            branch, codigo, indice, item.get("productCode"),
                            item.get("measuredUnit"), item.get("quantity"), item.get("value"),
                            item.get("unitDiscountValue"), item.get("netValue"), item.get("sellerCode"),
                        )
                        for indice, item in enumerate(itens)
                    ],
                )
            if compacto is not None:
                cur.execute(
                    "UPDATE transacoes SET origin_destination = %s WHERE branch_code = %s AND transaction_code = %s",
                    (compacto, branch, codigo),
                )
    return len(itens), compacto is not None


def agrupar_por_filial(docs: Iterable[tuple[int, int]]) -> dict[int, list[int]]:
    por_filial: dict[int, list[int]] = {}
    for branch_code, transaction_code in docs:
        por_filial.setdefault(branch_code, []).append(transaction_code)
    return por_filial


def executar_ciclo(args) -> dict[str, Any]:
    desde = (
        datetime.strptime(args.desde, "%Y-%m-%d").date()
        if args.desde
        else date.today() - timedelta(days=args.dias)
    )

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            docs = buscar_documentos_sem_item(cur, desde, not args.todas)

        por_filial = agrupar_por_filial(docs)
        resumo: dict[str, Any] = {
            "modo": "dry-run" if args.dry_run else "apply",
            "escopo": "transferencia" if not args.todas else "todas as operacoes",
            "desde": desde.isoformat(),
            "documentos_sem_item": len(docs),
            "filiais": len(por_filial),
        }
        if not docs:
            log.info("nada a fazer: %s", json.dumps(resumo))
            return resumo

        log.info("inicio: %s", json.dumps(resumo))

        cliente = TotvsClient()
        itens_gravados = 0
        vinculos = 0
        em_transito = 0
        sem_item_na_api = 0
        falhas: list[str] = []

        for branch_code, codigos in por_filial.items():
            for i in range(0, len(codigos), LOTE):
                if _parar:
                    break
                lote = codigos[i : i + LOTE]
                try:
                    encontrados = cliente.buscar_transacoes(branch_code, lote)
                except Exception as erro:  # noqa: BLE001 - lote falhou, segue pro proximo
                    falhas.append(f"filial {branch_code} lote {i}: {erro}")
                    log.error("lote falhou (filial %s): %s", branch_code, erro)
                    continue

                for doc in encontrados:
                    qtd = len(doc.get("items") or [])
                    if qtd == 0:
                        sem_item_na_api += 1
                    compacto = compactar_destino(doc.get("originDestination"))
                    if compacto == "[]":
                        em_transito += 1

                    if args.dry_run:
                        itens_gravados += qtd
                        vinculos += 1 if compacto is not None else 0
                        continue

                    # Um documento problematico nao pode derrubar o ciclo inteiro.
                    try:
                        gravados, teve_vinculo = gravar_documento(conn, doc)
                        itens_gravados += gravados
                        vinculos += 1 if teve_vinculo else 0
                    except Exception as erro:  # noqa: BLE001
                        falhas.append(f"doc {branch_code}/{doc.get('transactionCode')}: {erro}")
                        log.error("documento %s/%s falhou: %s", branch_code, doc.get("transactionCode"), erro)

                time.sleep(PAUSA_LOTE)
            if _parar:
                break

        resumo.update(
            {
                "itens": itens_gravados,
                "vinculos_origem_destino": vinculos,
                "saidas_ainda_nao_recebidas": em_transito,
                "documentos_sem_item_tambem_na_api": sem_item_na_api,
                "falhas": len(falhas),
            }
        )
        nivel = log.warning if falhas else log.info
        nivel("fim: %s", json.dumps(resumo))
        for detalhe in falhas[:10]:
            log.warning("  %s", detalhe)
        return resumo
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill dos itens que o ETL nao grava")
    parser.add_argument("--dias", type=int, default=30, help="janela deslizante (default 30)")
    parser.add_argument("--desde", type=str, default=None, help="data fixa YYYY-MM-DD (ignora --dias)")
    parser.add_argument("--todas", action="store_true", help="todas as operacoes, nao so transferencia")
    parser.add_argument("--intervalo", type=int, default=0, help="modo servico: segundos entre ciclos")
    parser.add_argument("--dry-run", action="store_true", help="nao escreve nada")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stdout,  # systemd/journalctl capturam stdout
    )
    signal.signal(signal.SIGTERM, _sinal)
    signal.signal(signal.SIGINT, _sinal)

    faltando = [v for v in ("DATABASE_URL", "TOTVS_API_URL", "TOTVS_CLIENT_ID",
                            "TOTVS_CLIENT_SECRET", "TOTVS_USERNAME", "TOTVS_PASSWORD")
                if not os.environ.get(v)]
    if faltando:
        log.error("variaveis de ambiente faltando: %s", ", ".join(faltando))
        return 2

    if args.intervalo <= 0:
        executar_ciclo(args)
        return 0

    log.info("modo servico: ciclo a cada %ss", args.intervalo)
    while not _parar:
        try:
            executar_ciclo(args)
        except Exception as erro:  # noqa: BLE001 - servico nao pode morrer por erro de um ciclo
            log.exception("ciclo falhou, continuando: %s", erro)
        # Dorme em fatias pra responder rapido ao SIGTERM em vez de segurar o shutdown.
        for _ in range(args.intervalo):
            if _parar:
                break
            time.sleep(1)
    log.info("encerrado")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
