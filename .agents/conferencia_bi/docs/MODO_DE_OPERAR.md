# Modo de operar: do pedido da cliente à aprovação (e depois publicar)

Este é o método que usamos na BBTK de novembro/2026 em diante. Serve de receita para
qualquer projeto em que **uma pessoa de negócio pede ajustes numa tela** e o time precisa
**provar, com a própria tela, que o pedido foi atendido** antes de publicar.

Quem pede: Renata Pastro e Gleice (BBTK), por mensagens no grupo BBTQT e por uma
devolutiva em Word. Quem opera: Lucas, com o Claude Code. Marcelo trabalha em paralelo
em outro branch.

## A ideia em uma frase

> A cliente escreve o que quer. A gente corrige, tira print do **sistema** antes e depois,
> junta com as **palavras dela** e manda um PDF para ela ler e aprovar. Só depois de aprovado
> vai para a main.

## O loop completo

```
1. RECEBER     prints + texto da cliente (grupo, devolutiva .docx/OneDrive)
2. ENTENDER    ler o código/dados, montar o plano, dizer o que NÃO vai mexer
3. EXECUTAR    implementar local (dev servers em localhost)
4. PROVAR      prints ANTES e DEPOIS do sistema (nunca "eu disse que fiz")
5. DOCUMENTAR  PDF contínuo: fala dela -> resposta -> antes x depois
6. APROVAR     Lucas (e a cliente) conferem; ajustes voltam ao passo 3
7. PUBLICAR    só quando mandarem: main -> origin + limes, nota de Novidades
8. AVISAR      mensagem para a cliente com o efeito (inclusive número que muda)
```

### 1. Receber
O Lucas manda os prints do grupo e o texto. Cada pedido vira um item com **a citação
literal** da cliente. A ferramenta guarda o que ela escreveu sem reescrever
(`conferir_citacao` confere em código que a frase existe no documento).

### 2. Entender antes de mexer
- Ler o `AGENTS.md` e o código da tela. Descobrir se a regra pedida já existe.
- Se o pedido muda um número (ex.: ruptura 62% -> 19,5%), **dizer isso antes** e medir
  no banco. A cliente vai estranhar; o aviso faz parte da entrega.
- Quando algo no pedido está ambíguo, escolher um padrão razoável, **dizer qual** e
  seguir. Só pergunta ao Lucas se a decisão for dele (regra de negócio).
- Se o Lucas fala "não faz isso com cara de que estamos errando", não propor
  implementar. Explique o que está certo e pare.

### 3. Executar
- Rodar o app local (`npm run dev` na raiz). O hot reload basta; não reiniciar à toa.
- Tocar o mínimo necessário. Mudança de apresentação não pode mudar cálculo.
- Teste automatizado junto (mocks do banco casam pelo texto do SQL: query nova exige
  ajustar os mocks existentes).

### 4. Provar com print do sistema
Regra do Lucas, dita sem rodeio: **"quero prints do próprio sistema mostrando a mudança;
dizer que fez até papagaio diz."**

- O print é da tela real, com o elemento mudado **grifado em amarelo**.
- Posição de dados fixa (ex.: 22/11/2026), **sem filtros**, para antes e depois serem
  comparáveis.
- ANTES: guardar as mudanças (`git stash`, ou copiar os arquivos e voltar a versão do
  HEAD só durante a captura), esperar o recarregamento, tirar os prints, **restaurar** e
  conferir o `git diff --stat` para ter certeza de que nada se perdeu.
- DEPOIS: tela com a mudança.
- Mostrar a primeira vez que alguém lê o resultado: abrir modal, expandir linha, trocar
  o seletor de visão. Não basta o card; a cliente vai clicar.

### 5. Documentar (PDF contínuo)
Uma página única que rola de cima a baixo, sem quebra de folha (o Lucas achou a versão
A4 "tudo muito afastado"). Estrutura de cada demanda:

1. **VOCÊS ESCREVERAM**: a citação literal da cliente.
2. **Resposta** na linguagem dela (ver `docs/VOCABULARIO.md`).
3. **ANTES** e **DEPOIS**: prints lado a lado.
4. Se há número que muda, ele está **na resposta**, com o antes e o depois.

Entrega para o Lucas: PDF anexado. Ele vê no celular quando quiser.

### 6. Aprovar
O Lucas confere e responde. Se pedir mudança, volta ao passo 3 e refaz **só** os prints
afetados. A cliente aprova o documento; "essa que a gente fez agora já foi aprovada" é a
senha para publicar.

### 7. Publicar (só quando pedirem)
Trabalho em andamento fica local. Quando o Lucas disser "publica", "sobe", "aprovado":

1. `git stash push -u -- <arquivos da entrega>` (inclui arquivos novos listados).
2. `git checkout main`; `git fetch origin limes`.
3. `git merge origin/main` e `git merge limes/main` (pode vir coisa nova de outra pessoa;
   **nunca sobrescrever**, conferir o que entrou).
4. `git stash pop`, `tsc` nos apps e os testes do módulo.
5. Criar a nota de Novidades (`apps/api/content/entregas/AAAA-MM-DD-<tema>.md`).
6. Commit e `git push origin main` + `git push limes main`.
7. Voltar para a branch de trabalho e `git merge main`.

Nunca commitar `.claude/settings.local.json`, CSVs soltos nem `.docx`.
Quando o Lucas pergunta "você fez pull e merge pq o Marcelo informou que tinha algo
feito, ou só publicamos por cima?": a resposta honesta é dizer **o que entrou do remoto**
(commit, tema), se houve conflito e o que não foi checado (outros branches).

### 8. Avisar a cliente
Texto curto, na língua dela, com o efeito prático e qualquer número que muda. Exemplo
real: "a ruptura cai de 62% para 19,5% porque agora só entra item que já entrou no estoque
e vendeu em 12 meses".

## Divisão de trabalho (custo de token)

| Camada | Quem | Custo |
|---|---|---|
| Ler a devolutiva, logar, navegar, filtros, ler a tela, somar, prints | Python + Playwright | zero token |
| Checklist da seção livre, veredito por item, casar citação, redigir resposta | Codex (`codex exec`) | ~30 mil tokens por seção |
| Entender o pedido e implementar | Claude Code | — |

A razão da ideia: usar o Claude Code só para pensar e programar; a conferência na tela
é mecânica e não deveria gastar token. O Codex é o "motor" barato de conferir, o Python
é a mão no navegador.

## Regras que o Lucas deixou (feedback acumulado)

1. **Print do sistema, sempre.** Nada de "foi feito" sem prova na tela.
2. **Antes e depois**, no mesmo esquema, para toda demanda ("mesmo esquema antes e dps").
3. **Cobertura sempre em MESES**, nunca em dias.
4. **Não publicar sem pedir.** Publicar = main em origin **e** limes.
5. **Nota de Novidades só ao publicar**, não durante o teste.
6. **PDF contínuo**, sem quebra de página, agrupado.
7. **Honestidade sobre o que não deu para verificar**: "⚠️ não verificável" é resposta
   válida (regra de dado não se prova pela tela; vai como fato do banco).
8. Quando ele manda a segunda imagem igual à primeira: é a mesma; diga, não invente.
9. Ele costuma estar no celular: respostas curtas, o arquivo já anexado.
10. Perguntas de dados ("preço médio de venda do varejo sem embalagem"): responder com o
    número, a tabela e **como calculou**, sem rodeio.

## O que somos capazes de fazer hoje

- Ler devolutiva em `.docx` (com os prints que a cliente colou) ou link do OneDrive.
- Abrir o BI publicado (Render) **ou** o localhost, logar uma vez, guardar a sessão.
- Tirar prints com destaque e zoom certo, em qualquer visão da tela.
- Conferir pedido a pedido e dar veredito (✅ ❌ ⚠️).
- Rodar **antes e depois** e juntar tudo num PDF com a voz da cliente.
- Gerar o vocabulário da cliente (`_vocabulario_cliente.md`).
- Consultar o banco para fatos que a tela não mostra (ex.: preço médio, base da ruptura).
- Publicar com merge seguro e nota de Novidades.

Ver também: [IDEIAS_E_HISTORICO.md](IDEIAS_E_HISTORICO.md) e
[PORTAR_PARA_OUTRO_PROJETO.md](PORTAR_PARA_OUTRO_PROJETO.md).
