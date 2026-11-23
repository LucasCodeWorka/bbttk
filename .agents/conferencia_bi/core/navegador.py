"""Navegador controlado por Playwright: perfil proprio, login no BI e leitura de DOM.

O perfil fica em `perfil/` (fora do git). Depois do primeiro login o token fica no
localStorage desse perfil e as proximas execucoes ja entram logadas.
"""
from __future__ import annotations

import os
import time
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import BrowserContext, Page, sync_playwright

from .paths import PERFIL


@contextmanager
def abrir(headless: bool):
    PERFIL.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        ctx: BrowserContext = p.chromium.launch_persistent_context(
            str(PERFIL),
            headless=headless,
            viewport={"width": 1900, "height": 1100},
            locale="pt-BR",
        )
        try:
            yield ctx
        finally:
            ctx.close()


def nova_aba(ctx: BrowserContext) -> Page:
    paginas = [p for p in ctx.pages if p.url in ("about:blank", "")]
    return paginas[0] if paginas else ctx.new_page()


def _token(page: Page) -> str | None:
    try:
        return page.evaluate("() => localStorage.getItem('token')")
    except Exception:
        return None


def _logado(page: Page, app: str) -> bool:
    """Abre /inicio e ve se o app manteve a sessao (token invalido volta pro /login)."""
    page.goto(f"{app}/inicio", wait_until="domcontentloaded", timeout=240_000)
    for _ in range(10):
        time.sleep(1)
        if "/login" in page.url:
            return False
    return bool(_token(page)) and "/login" not in page.url


def garantir_login(page: Page, app: str, headless: bool, token_arquivo: str | None = None, espera_s: int = 300) -> None:
    # Render pode estar "dormindo": o primeiro acesso demora.
    page.goto(f"{app}/login", wait_until="domcontentloaded", timeout=240_000)

    if token_arquivo:  # uso local (localhost): token gerado por mint-test-token
        token = Path(token_arquivo).read_text(encoding="utf-8").strip()
        page.evaluate("t => localStorage.setItem('token', t)", token)
        return

    if _token(page) and _logado(page, app):
        return

    page.goto(f"{app}/login", wait_until="domcontentloaded", timeout=240_000)
    email, senha = os.getenv("BI_EMAIL"), os.getenv("BI_SENHA")
    if email and senha:
        page.locator('input[type="email"]').fill(email)
        page.locator('input[type="password"]').fill(senha)
        page.locator('button[type="submit"]').click()
    elif headless:
        raise SystemExit(
            "Sem login salvo no perfil. Rode uma vez: python .agents\\conferencia_bi\\main.py login"
        )
    else:
        print(f"Faca login no BI na janela aberta (aguardando ate {espera_s // 60} min)...", flush=True)

    inicio = time.time()
    while time.time() - inicio < espera_s:
        if _token(page) and "/login" not in page.url:
            print("Login confirmado.", flush=True)
            return
        time.sleep(1.5)
    raise SystemExit("Login nao confirmado no tempo limite.")
