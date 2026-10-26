import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { ATACADO_BRANCH_CODE, ATACADO_STOCK_CODE, DPA_BRANCH_CODE, RELATORIO_BASE_BRANCH_ORDER } from '../config/constants.js';

// Todos os saldos pertencem a empresa de origem. Somente a Fabrica possui dois
// locais sinteticos na interface: atacado (8) e DPA (todos os demais saldos).
export function localEstoqueSql(alias = ''): Prisma.Sql {
  const prefixo = alias ? `${alias}.` : '';
  const filial = Prisma.raw(`${prefixo}branch_code`);
  const saldo = Prisma.raw(`${prefixo}stock_code`);
  return Prisma.sql`CASE
    WHEN ${filial} = 2 AND ${saldo} = ${ATACADO_STOCK_CODE} THEN ${ATACADO_BRANCH_CODE}
    WHEN ${filial} = 2 THEN ${DPA_BRANCH_CODE}
    ELSE ${filial}
  END::int`;
}

export function condicaoLocalEstoqueSql(branches?: number[] | null, alias = ''): Prisma.Sql {
  if (!branches?.length) return Prisma.sql`TRUE`;
  const prefixo = alias ? `${alias}.` : '';
  const filial = Prisma.raw(`${prefixo}branch_code`);
  const saldo = Prisma.raw(`${prefixo}stock_code`);
  const condicoes: Prisma.Sql[] = [];
  const empresas = branches.filter((codigo) => codigo > 0);
  if (empresas.length) condicoes.push(Prisma.sql`${filial} IN (${Prisma.join(empresas)})`);
  if (branches.includes(DPA_BRANCH_CODE)) condicoes.push(Prisma.sql`(${filial} = 2 AND ${saldo} <> ${ATACADO_STOCK_CODE})`);
  if (branches.includes(ATACADO_BRANCH_CODE)) condicoes.push(Prisma.sql`(${filial} = 2 AND ${saldo} = ${ATACADO_STOCK_CODE})`);
  return condicoes.length ? Prisma.sql`(${Prisma.join(condicoes, ' OR ')})` : Prisma.sql`FALSE`;
}

export function filtroLocalEstoqueSql(branches?: number[] | null, alias = ''): Prisma.Sql {
  return branches?.length ? Prisma.sql`AND ${condicaoLocalEstoqueSql(branches, alias)}` : Prisma.empty;
}

export function saldosAtuaisSql(): Prisma.Sql {
  return Prisma.sql`SELECT DISTINCT ON (product_sku, branch_code, stock_code) *
    FROM prd_saldo
    ORDER BY product_sku, branch_code, stock_code, captured_at DESC, id DESC`;
}

export async function getColunasEstoque(): Promise<Array<{ branchCode: number; label: string }>> {
  const empresas = await prisma.$queryRaw<Array<{ branch_code: number; branch_name: string | null }>>`
    SELECT branch_code, branch_name FROM branches
    WHERE branch_code > 0 AND branch_code <> 2 ORDER BY branch_code
  `;
  const conhecidas = new Set(RELATORIO_BASE_BRANCH_ORDER.map((item) => item.branchCode));
  return [
    ...RELATORIO_BASE_BRANCH_ORDER,
    ...empresas.filter((item) => !conhecidas.has(item.branch_code)).map((item) => ({
      branchCode: item.branch_code,
      label: item.branch_name?.trim() || `Filial ${item.branch_code}`,
    })),
  ];
}
