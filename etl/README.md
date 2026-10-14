# Backfill dos itens de transação (paliativo)

Repõe em `transacao_itens` os itens que o ETL principal deixou de gravar a partir de
**25/06/2026**, buscando direto na API do TOTVS.

> **Isto é um curativo, não a cura.** A causa raiz está no ETL principal, que parou de
> gravar itens de operação que não é venda. Enquanto ele não for corrigido, o buraco
> volta a crescer todo dia — medido: 102 documentos e 968 peças em 4 dias. Este serviço
> só impede que o buraco se acumule.

## O problema que ele resolve

Desde 25/06/2026, de 45 operações (transferência, compra de matéria-prima,
industrialização, consignação, brindes), o cabeçalho chega em `transacoes` mas
`transacao_itens` fica vazio. Venda (`S4`), devolução de venda (`E3`) e compra de
materiais (`E4`) seguem normais.

Sem item não há peça para contar, o que derrubou:

- o relatório **Estoque em Trânsito** (não enxergava nada depois de junho);
- a coluna **ÚLT. ENTRADA** do Relatório Base (congelada em 24/06);
- a **maturação do Estoque Sem Giro** (produto sem entrada registrada é tratado como maduro).

## O que ele faz

1. Procura em `transacoes` os documentos sem nenhuma linha em `transacao_itens`, numa
   janela deslizante (default: 30 dias).
2. Busca cada um em `POST /general/v2/transactions/search` com `expand=originDestination`,
   em lotes de 40 por filial.
3. Grava os itens (`DELETE` antes do `INSERT`, na mesma transação).
4. Preenche `transacoes.origin_destination` com os pares `[filial, transação]` do destino.

### Sobre o `origin_destination`

Essa coluna **nunca** foi preenchida pelo ETL, em período nenhum — ele nunca pediu o
`expand`. Ela traz o vínculo documento-a-documento da transferência: qual entrada
corresponde a qual saída. **Destino vazio (`[]`) significa ausência de vínculo na
resposta consultada**; sozinho não comprova a localização física da mercadoria.

O formato gravado é compacto (`[[9,918193]]`) porque o JSON cru do TOTVS estoura o
`VARCHAR(255)` da coluna. ⚠️ **Esse formato é desta ferramenta, não do TOTVS** — quando
o ETL principal for corrigido e passar a escrever nessa coluna, é preciso decidir quem
é o dono dela.

O backfill só consulta documentos sem itens. Depois de preencher um documento, ele
não revisita seu vínculo: uma lista vazia pode continuar vazia mesmo após a chegada
da mercadoria. O ETL definitivo precisa atualizar também os vínculos de documentos
já existentes.

## Instalação na VPS

O arquivo de serviço é um modelo para instalação. Publicar estes arquivos no Git não
instala nem ativa o serviço; confirmar sua execução com os comandos de operação abaixo.

```bash
sudo useradd -r -s /usr/sbin/nologin bbtk
sudo mkdir -p /opt/bbtk-backfill && cd /opt/bbtk-backfill
sudo cp backfill_transacao_itens.py .

python3 -m venv venv
./venv/bin/pip install psycopg2-binary requests

sudo tee .env >/dev/null <<'EOF'
DATABASE_URL=postgres://usuario:senha@host:5432/base
TOTVS_API_URL=https://.../api/totvsmoda
TOTVS_CLIENT_ID=...
TOTVS_CLIENT_SECRET=...
TOTVS_USERNAME=...
TOTVS_PASSWORD=...
EOF
sudo chmod 600 .env
sudo chown -R bbtk:bbtk /opt/bbtk-backfill

sudo cp bbtk-backfill-itens.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bbtk-backfill-itens
```

Antes de habilitar o serviço, vale rodar uma vez em seco:

```bash
cd /opt/bbtk-backfill
set -a && . ./.env && set +a
./venv/bin/python backfill_transacao_itens.py --dry-run
```

## Operação

```bash
systemctl status bbtk-backfill-itens
journalctl -u bbtk-backfill-itens -f          # acompanhar
journalctl -u bbtk-backfill-itens --since today | grep '"falhas"'
```

Cada ciclo registra uma linha JSON com `itens`, `vinculos_origem_destino`,
`saidas_ainda_nao_recebidas` e `falhas`. Em operação normal `falhas` é 0 — se subir de
forma consistente, é sinal de problema na API ou no banco, não no script.

## Flags

| Flag | Para quê |
|---|---|
| `--dias=N` | Janela deslizante (default 30) |
| `--desde=YYYY-MM-DD` | Data fixa; use `--desde=2026-06-25` para a recuperação inicial completa |
| `--todas` | Todas as 45 operações afetadas, não só transferência |
| `--intervalo=SEG` | Modo serviço (loop). Sem isso roda uma vez e sai |
| `--dry-run` | Não escreve nada |

**Recuperação inicial** (uma vez, fora do serviço): `--desde=2026-06-25 --todas`.
Depois disso a janela de 30 dias do serviço dá conta.

É idempotente: apaga e regrava por documento, então rodar duas vezes não duplica nada.

## O que ele NÃO faz

O relatório de Estoque em Trânsito lê uma **foto materializada**
(`pcp_estoque_transito`), não calcula ao vivo. Depois do backfill é preciso rematerializar,
senão a tela continua mostrando a foto antiga:

```bash
npm run rebuild:estoque-transito -w apps/api
```

Isso roda onde a aplicação Node está, não nesta VPS. Se o backfill passar a rodar de
hora em hora, vale agendar o rebuild com frequência parecida.

## A correção de verdade

No ETL principal, dois ajustes:

1. **Remover o filtro** que restringe quais operações têm itens gravados. O `items` vem
   por padrão na resposta do `transactions/search`, não depende de `expand` — o recorte
   está no ETL. O suspeito é um `operationCodeList`/`transactionTypeList`/`modalityList`
   estreitado por volta de 25/06/2026.
2. **Pedir `expand=originDestination`** nas transferências, para o vínculo
   saída→entrada vir do TOTVS em vez de ser inferido por FIFO.

Feito isso, este serviço pode ser desligado.
