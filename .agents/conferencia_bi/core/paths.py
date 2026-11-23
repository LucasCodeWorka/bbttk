from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PERFIL = RAIZ / "perfil"
SAIDA = RAIZ / "saida"
SKILLS = RAIZ / "skills"
ENV = RAIZ / ".env"


def carregar_env() -> None:
    """Le .env simples (CHAVE=valor) sem dependencia extra; nao sobrescreve o ambiente."""
    import os

    if not ENV.exists():
        return
    for linha in ENV.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        os.environ.setdefault(chave.strip(), valor.strip().strip('"').strip("'"))
