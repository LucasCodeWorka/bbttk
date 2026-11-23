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


def conferir(secao: dict, evidencia: dict, pasta: Path, modelo: str | None = None) -> dict:
    codex = shutil.which("codex")
    if not codex:
        raise SystemExit("Codex CLI nao encontrado no PATH (npm i -g @openai/codex).")

    evidencia = {k: v for k, v in evidencia.items() if not k.startswith("_")}  # _prints e so para o PDF
    itens = "\n".join(f"{i + 1}. {it['texto']}" for i, it in enumerate(secao["itens"]))
    prompt = (
        f"{INSTRUCOES}\n"
        f"## Ponto {secao['ponto']} da devolutiva: {secao['titulo']}\n\n{itens}\n\n"
        f"## Evidencia lida da tela (JSON)\n\n```json\n{json.dumps(evidencia, ensure_ascii=False, indent=1)}\n```\n"
    )
    (pasta / "prompt.md").write_text(prompt, encoding="utf-8")
    schema = pasta / "schema.json"
    schema.write_text(json.dumps(SCHEMA), encoding="utf-8")
    saida = pasta / "veredito.json"

    cmd = [codex, "exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only",
           "--output-schema", str(schema), "-o", str(saida), "-C", str(pasta)]
    if modelo:
        cmd += ["-m", modelo]
    cmd.append("-")
    proc = subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", errors="replace",
                          capture_output=True, timeout=1200)
    (pasta / "codex.log").write_text((proc.stdout or "") + "\n--- stderr ---\n" + (proc.stderr or ""), encoding="utf-8")
    if proc.returncode != 0 or not saida.exists():
        raise SystemExit(f"Codex falhou (codigo {proc.returncode}). Ver {pasta / 'codex.log'}")
    return json.loads(saida.read_text(encoding="utf-8"))
