# Skill: conferir-devolutiva

## Quando usar

Depois de publicar uma correção pedida na devolutiva, para provar item a item que a
tela online atende, antes de marcar o checklist ou responder ao cliente.

## Comando

```powershell
python .agents\conferencia_bi\main.py conferir 7
```

## Fluxo

1. Aba 1 abre a devolutiva no Word Online, rola o documento e recorta o ponto pedido.
2. Aba 2 abre o BI (perfil já logado), limpa os filtros da sessão, aplica a data da
   receita e lê a tela.
3. O Codex recebe só o checklist e a evidência em texto e responde em JSON.
4. `relatorio.md` sai no formato de tabela usado com o cliente.

## Armadilhas

- Render dormindo: o primeiro acesso demora; os timeouts já são longos.
- A data importa: o exemplo da devolutiva é de uma posição específica (padrão das
  receitas 6/7 = 08/11/2026). Comparar com outra data gera divergência falsa.
- CSS uppercase muda `innerText`; para esperar carregamento use `textContent`.
- Texto `.sr-only` não é visível; a extração já remove.
- "não verificável" em regra de dado não é falha da tela: conferir no banco.
