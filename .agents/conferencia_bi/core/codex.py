"""Chama o Codex CLI so para comparar checklist x evidencia (texto). Nao navega nada."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["itens", "resumo"],
    "properties": {
        "itens": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["item", "situacao", "evidencia", "observacao"],
                "properties": {
                    "item": {"type": "string"},
                    "situacao": {"type": "string", "enum": ["ok", "divergente", "nao_verificavel"]},
                    "evidencia": {"type": "string"},
                    "observacao": {"type": "string"},
                },
            },
        },
        "resumo": {"type": "string"},
    },
}

INSTRUCOES = """Voce e o revisor de qualidade de um BI. Confira se cada item do checklist da
devolutiva do cliente esta atendido na tela publicada.

Regras:
- Use SOMENTE a evidencia abaixo: texto lido da tela e medicoes automaticas feitas por
  script. Nao rode comandos, nao abra arquivos, nao use conhecimento externo.
- "ok": a evidencia mostra o item atendido. "divergente": mostra o contrario ou um numero
  diferente do pedido. "nao_verificavel": a evidencia nao basta (ex.: cor, algo que nao
  foi lido).
- Exemplo numerico: compare com o numero da tela e cite os dois. Diferenca apenas de
  arredondamento na segunda casa decimal e "ok", explicando na observacao.
- Se o exemplo cita uma categoria que nao existe na tela, procure se ela aparece com
  outro nome ou dividida em outras linhas antes de concluir; explique o que achou.
- "evidencia": cite o trecho/numero exato da tela (curto). "observacao": uma frase.
- Escreva em portugues. Um objeto por item, na mesma ordem, com o texto do item igual.
- "resumo": uma ou duas frases para o desenvolvedor.
"""

INSTRUCOES_LIVRE = """
Esta devolutiva nao tem checklist pronto: sao paragrafos soltos do cliente. Monte voce
o checklist, um item por PEDIDO verificavel (paragrafos de continuacao, exemplos e
listas com "-" pertencem ao pedido anterior; um pedido com varias colunas pode virar
um item por coluna). Em "item" escreva o pedido resumido em uma frase, fiel ao cliente.
Pedido de funcionalidade que ainda nao existe na tela e "divergente" (pendente), nao
"nao_verificavel". Se a evidencia explicar a reclamacao (ex.: um indicador de ordenacao
lido como parte do titulo), diga isso na observacao.
"""


def conferir(secao: dict, evidencia: dict, pasta: Path, modelo: str | None = None,
             imagens: list[Path] | None = None) -> dict:
    evidencia = {k: v for k, v in evidencia.items() if not k.startswith("_")}  # _prints e so para o PDF
    if secao.get("livre"):
        itens = "\n".join(it["texto"] for it in secao["itens"])
        extra = INSTRUCOES_LIVRE + ("\nOs prints citados como [print N] estao anexados, na mesma ordem.\n" if imagens else "")
    else:
        itens = "\n".join(f"{i + 1}. {it['texto']}" for i, it in enumerate(secao["itens"]))
        extra = ""
    prompt = (
        f"{INSTRUCOES}{extra}\n"
        f"## {secao.get('rotulo') or secao['titulo']} (devolutiva)\n\n{itens}\n\n"
        f"## Evidencia lida da tela (JSON)\n\n```json\n{json.dumps(evidencia, ensure_ascii=False, indent=1)}\n```\n"
    )
    return executar(prompt, SCHEMA, pasta, "veredito", modelo, imagens)


def executar(prompt: str, schema: dict, pasta: Path, nome: str, modelo: str | None = None,
             imagens: list[Path] | None = None) -> dict:
    """Roda `codex exec` read-only com saida em JSON validado pelo schema.
    Grava <nome>.json, prompt/schema/log com o mesmo prefixo (veredito -> prompt.md etc.)."""
    codex = shutil.which("codex")
    if not codex:
        raise SystemExit("Codex CLI nao encontrado no PATH (npm i -g @openai/codex).")
    pref = "" if nome == "veredito" else f"{nome}_"
    (pasta / f"{pref}prompt.md").write_text(prompt, encoding="utf-8")
    arq_schema = pasta / f"{pref}schema.json"
    arq_schema.write_text(json.dumps(schema), encoding="utf-8")
    saida = pasta / f"{nome}.json"
    log = pasta / f"{pref}codex.log"

    cmd = [codex, "exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only",
           "--output-schema", str(arq_schema), "-o", str(saida), "-C", str(pasta)]
    if modelo:
        cmd += ["-m", modelo]
    for img in imagens or []:
        cmd += ["-i", str(img)]
    cmd.append("-")
    proc = subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", errors="replace",
                          capture_output=True, timeout=1200)
    log.write_text((proc.stdout or "") + "\n--- stderr ---\n" + (proc.stderr or ""), encoding="utf-8")
    if proc.returncode != 0 or not saida.exists():
        raise SystemExit(f"Codex falhou (codigo {proc.returncode}). Ver {log}")
    return json.loads(saida.read_text(encoding="utf-8"))
