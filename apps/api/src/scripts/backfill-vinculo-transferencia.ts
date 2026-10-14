/**
 * Popula `pcp_transferencia_vinculo` com o vinculo documento-a-documento de
 * transferencia, lido da API do TOTVS (`expand=originDestination`).
 *
 * POR QUE PELO LADO DA ENTRADA (padrao deste script):
 * O campo e assimetrico. Numa SAIDA, `destination` so aparece quando a loja recebe -
 * dias depois, e o TOTVS **nao** atualiza o `lastChangeDate` do documento (medido:
 * 0 de 10 saidas com entrada ate 29 dias depois tiveram a data mexida). Logo nenhum
 * sync incremental reconsulta aquela saida, e o vinculo se perde.
 * Numa ENTRADA, `origin` ja nasce preenchido (medido: 12 de 12), e a entrada e um
 * documento NOVO - qualquer sync a captura no dia em que e lancada. Puxar pela entrada
 * dispensa fila de repescagem.
 *
 * E nao se perde nada: uma entrada aponta para exatamente 1 saida (2.139 de 2.139
 * medidos), enquanto uma saida pode ter ate 5 entradas. Montando os pares pelo lado da
 * entrada, o recebimento parcial aparece como N entradas apontando a mesma saida -
 * mesma informacao, vista do outro angulo.
 *
 * POR QUE TABELA PROPRIA e nao `transacoes.origin_destination`:
 * `transacoes` e sincronizada pelo ETL - escrever nela e contra a regra do projeto
 * (ver AGENTS.md) e some no proximo sync. Alem disso aquela coluna ja guarda o
 * `destination` em formato compacto; gravar o `origin` no mesmo lugar deixaria
 * `[[2,880226]]` ambiguo entre "mandei para" e "vim de".
 *
 * Uso:
 *   npm run backfill:vinculo:dryrun -w apps/api
 *   npm run backfill:vinculo -w apps/api
 *   npx tsx src/scripts/backfill-vinculo-transferencia.ts --apply --desde=2025-01-01
 */
import 'dotenv/config';
import https from 'https';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const API_BASE_URL = process.env.TOTVS_API_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const DESDE_PADRAO = '2025-01-01';
const CONCORRENCIA = 5;
const LOTE_GRAVACAO = 500;

type Lado = 'entrada' | 'saida';

type Documento = {
  branch_code: number;
  transaction_code: number;
  transaction_date: Date;
};

type Vinculo = {
  saidaBranchCode: number;
  saidaTransactionCode: number;
  saidaTransactionDate: string | null;
  entradaBranchCode: number;
  entradaTransactionCode: number;
  entradaTransactionDate: string | null;
  fonte: Lado;
};

type OriginDestination = {
  branchCodeOrigin?: number | null;
  transactionCodeOrigin?: number | null;
  transactionDateOrigin?: string | null;
  destination?: Array<{
    branchCodeDestination?: number | null;
    transactionCodeDestination?: number | null;
    transactionDateDestination?: string | null;
  }> | null;
};

function flag(nome: string): boolean {
  return process.argv.includes(nome);
}

function opcao(nome: string, padrao: string): string {
  const arg = process.argv.find((item) => item.startsWith(`--${nome}=`));
  return arg ? arg.split('=').slice(1).join('=') : padrao;
}

function soData(valor: string | null | undefined): string | null {
  return valor ? valor.slice(0, 10) : null;
}

function toDateOnly(valor: Date): string {
  return valor.toISOString().slice(0, 10);
}

// O token expira no meio de uma execucao longa; guardamos numa referencia mutavel
// pra renovar sem reiniciar o processo.
const tokenRef = { valor: '' };

async function renovarToken(): Promise<void> {
  const resposta = await fetch(`${API_BASE_URL}/authorization/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: process.env.TOTVS_CLIENT_ID || '',
      client_secret: process.env.TOTVS_CLIENT_SECRET || '',
      username: process.env.TOTVS_USERNAME || '',
      password: process.env.TOTVS_PASSWORD || '',
    }),
    // @ts-ignore - o fetch do Node aceita agent
    agent: httpsAgent,
  });

  if (!resposta.ok) throw new Error(`Falha ao autenticar no TOTVS: HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { access_token?: string };
  if (!dados.access_token) throw new Error('TOTVS nao devolveu access_token');
  tokenRef.valor = dados.access_token;
}

async function buscarOriginDestination(doc: Documento, tentativas = 4): Promise<OriginDestination | null> {
  const query = new URLSearchParams({
    branchCode: String(doc.branch_code),
    transactionCode: String(doc.transaction_code),
    transactionDate: `${toDateOnly(doc.transaction_date)}T00:00:00`,
    expand: 'originDestination',
  });

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    const resposta = await fetch(`${API_BASE_URL}/general/v2/transactions?${query}`, {
      headers: { Authorization: `Bearer ${tokenRef.valor}` },
      // @ts-ignore
      agent: httpsAgent,
    });

    if (resposta.status === 200) {
      const corpo = (await resposta.json()) as { originDestination?: OriginDestination | null };
      return corpo.originDestination ?? null;
    }

    if (resposta.status === 401) {
      await renovarToken();
      continue;
    }

    // 429/5xx sao transitorios: espera progressiva. O resto e erro do documento.
    if (![429, 500, 502, 503, 504].includes(resposta.status) || tentativa === tentativas) {
      return null;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000 * tentativa));
  }

  return null;
}

// Converte o retorno do TOTVS em pares (saida, entrada), olhando o lado certo do
// documento consultado: entrada carrega `origin`, saida carrega `destination`.
function extrairVinculos(doc: Documento, lado: Lado, od: OriginDestination | null): Vinculo[] {
  if (!od) return [];

  if (lado === 'entrada') {
    const b = od.branchCodeOrigin;
    const c = od.transactionCodeOrigin;
    if (b === null || b === undefined || c === null || c === undefined) return [];
    return [
      {
        saidaBranchCode: Number(b),
        saidaTransactionCode: Number(c),
        saidaTransactionDate: soData(od.transactionDateOrigin),
        entradaBranchCode: doc.branch_code,
        entradaTransactionCode: doc.transaction_code,
        entradaTransactionDate: toDateOnly(doc.transaction_date),
        fonte: 'entrada',
      },
    ];
  }

  return (od.destination || [])
    .filter((d) => d.branchCodeDestination !== null && d.branchCodeDestination !== undefined
      && d.transactionCodeDestination !== null && d.transactionCodeDestination !== undefined)
    .map((d) => ({
      saidaBranchCode: doc.branch_code,
      saidaTransactionCode: doc.transaction_code,
      saidaTransactionDate: toDateOnly(doc.transaction_date),
      entradaBranchCode: Number(d.branchCodeDestination),
      entradaTransactionCode: Number(d.transactionCodeDestination),
      entradaTransactionDate: soData(d.transactionDateDestination),
      fonte: 'saida' as Lado,
    }));
}

async function ensureTabela(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS pcp_transferencia_vinculo (
      saida_branch_code INTEGER NOT NULL,
      saida_transaction_code INTEGER NOT NULL,
      saida_transaction_date DATE,
      entrada_branch_code INTEGER NOT NULL,
      entrada_transaction_code INTEGER NOT NULL,
      entrada_transaction_date DATE,
      fonte VARCHAR(10) NOT NULL,
      consultado_em TIMESTAMP NOT NULL DEFAULT now(),
      PRIMARY KEY (saida_branch_code, saida_transaction_code, entrada_branch_code, entrada_transaction_code)
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_pcp_transf_vinculo_saida ON pcp_transferencia_vinculo (saida_branch_code, saida_transaction_code)`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_pcp_transf_vinculo_entrada ON pcp_transferencia_vinculo (entrada_branch_code, entrada_transaction_code)`
  );
}

// Documentos ainda sem vinculo registrado. Idempotente: rodar de novo so pega o que
// faltou, entao da pra interromper e retomar sem perder trabalho.
async function listarPendentes(lado: Lado, desde: string, limite: number): Promise<Documento[]> {
  const tipo = lado === 'entrada' ? 'E' : 'S';
  const ladoFiltro =
    lado === 'entrada'
      ? Prisma.sql`t.branch_code <> 2 AND NOT EXISTS (
          SELECT 1 FROM pcp_transferencia_vinculo v
          WHERE v.entrada_branch_code = t.branch_code AND v.entrada_transaction_code = t.transaction_code
        )`
      : Prisma.sql`NOT EXISTS (
          SELECT 1 FROM pcp_transferencia_vinculo v
          WHERE v.saida_branch_code = t.branch_code AND v.saida_transaction_code = t.transaction_code
        )`;

  return prisma.$queryRaw<Documento[]>`
    SELECT t.branch_code, t.transaction_code, t.transaction_date
    FROM transacoes t
    JOIN classificacao_operacoes co ON co.operation_code = t.operation_code
    WHERE co.operations_type = ${tipo}
      AND co.operation_mode = '2'
      AND t.status = 4
      AND t.transaction_date >= ${desde}::date
      AND ${ladoFiltro}
    ORDER BY t.transaction_date DESC, t.branch_code, t.transaction_code
    LIMIT ${limite}
  `;
}

async function gravar(vinculos: Vinculo[]): Promise<void> {
  for (let i = 0; i < vinculos.length; i += LOTE_GRAVACAO) {
    const lote = vinculos.slice(i, i + LOTE_GRAVACAO);
    await prisma.$executeRaw`
      INSERT INTO pcp_transferencia_vinculo (
        saida_branch_code, saida_transaction_code, saida_transaction_date,
        entrada_branch_code, entrada_transaction_code, entrada_transaction_date,
        fonte, consultado_em
      )
      VALUES ${Prisma.join(
        lote.map(
          (v) => Prisma.sql`(
            ${v.saidaBranchCode}, ${v.saidaTransactionCode}, ${v.saidaTransactionDate}::date,
            ${v.entradaBranchCode}, ${v.entradaTransactionCode}, ${v.entradaTransactionDate}::date,
            ${v.fonte}, now()
          )`
        )
      )}
      ON CONFLICT (saida_branch_code, saida_transaction_code, entrada_branch_code, entrada_transaction_code)
      DO UPDATE SET
        saida_transaction_date = COALESCE(EXCLUDED.saida_transaction_date, pcp_transferencia_vinculo.saida_transaction_date),
        entrada_transaction_date = COALESCE(EXCLUDED.entrada_transaction_date, pcp_transferencia_vinculo.entrada_transaction_date),
        consultado_em = now()
    `;
  }
}

async function main(): Promise<void> {
  const aplicar = flag('--apply');
  const desde = opcao('desde', DESDE_PADRAO);
  const limite = Number(opcao('limite', '100000'));
  const lado = (opcao('lado', 'entrada') as Lado) === 'saida' ? 'saida' : 'entrada';

  await ensureTabela();

  const pendentes = await listarPendentes(lado, desde, limite);
  console.log(
    `[vinculo] lado=${lado} desde=${desde} | ${pendentes.length} documentos sem vinculo registrado` +
      (aplicar ? '' : ' (DRY-RUN, nada sera gravado)')
  );
  if (pendentes.length === 0) return;

  await renovarToken();

  // Grava em lotes durante a execucao, nao no fim. Sao milhares de chamadas de API:
  // acumular tudo em memoria significaria perder o trabalho inteiro num erro no meio.
  // Como o INSERT e ON CONFLICT e a selecao e "quem ainda nao tem vinculo", basta
  // rodar de novo pra continuar de onde parou.
  let buffer: Vinculo[] = [];
  let gravados = 0;
  let encontrados = 0;
  let consultados = 0;
  let semVinculo = 0;
  let erros = 0;

  async function descarregar(forcar = false): Promise<void> {
    if (!aplicar || buffer.length === 0) return;
    if (!forcar && buffer.length < LOTE_GRAVACAO) return;
    const lote = buffer;
    buffer = [];
    await gravar(lote);
    gravados += lote.length;
    console.log(`  [gravado] +${lote.length} vinculos (total ${gravados})`);
  }

  // Concorrencia modesta: a API do TOTVS ja derrubou requisicao em lote antes
  // (ver fetch_operations no ETL), entao nao vale a pena forcar.
  for (let i = 0; i < pendentes.length; i += CONCORRENCIA) {
    const fatia = pendentes.slice(i, i + CONCORRENCIA);
    const resultados = await Promise.all(
      fatia.map(async (doc) => {
        try {
          return { doc, od: await buscarOriginDestination(doc) };
        } catch {
          return { doc, od: null, falhou: true };
        }
      })
    );

    for (const r of resultados) {
      consultados += 1;
      if ((r as { falhou?: boolean }).falhou) {
        erros += 1;
        continue;
      }
      const achados = extrairVinculos(r.doc, lado, r.od);
      if (achados.length === 0) semVinculo += 1;
      encontrados += achados.length;
      buffer.push(...achados);
    }

    await descarregar();

    if (consultados % 500 < CONCORRENCIA) {
      console.log(`  ${consultados}/${pendentes.length} consultados | ${encontrados} vinculos`);
    }
  }

  await descarregar(true);

  const resumo = {
    modo: aplicar ? 'apply' : 'dry-run',
    lado,
    desde,
    documentosConsultados: consultados,
    vinculosEncontrados: encontrados,
    vinculosGravados: aplicar ? gravados : 0,
    documentosSemVinculo: semVinculo,
    erros,
    cobertura: consultados > 0 ? `${(((consultados - semVinculo - erros) / consultados) * 100).toFixed(1)}%` : '-',
  };
  console.log(JSON.stringify(resumo, null, 2));
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
