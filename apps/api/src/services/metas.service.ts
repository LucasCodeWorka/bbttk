import { prisma } from '../config/database.js';
import { NIVEL_PERCENTUAIS } from '../config/constants.js';
import { Decimal } from '@prisma/client/runtime/library';

// Helpers
function decimalToNumber(value: Decimal | number | null): number {
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

// Buscar níveis de meta
export async function getMetaNiveis() {
  const niveis = await prisma.$queryRaw<Array<{
    nivel_ordem: number;
    nivel_nome: string;
    nivel_cor: string;
    comissao_percentual: Decimal;
  }>>`SELECT nivel_ordem, nivel_nome, nivel_cor, comissao_percentual FROM meta_niveis ORDER BY nivel_ordem`;

  return niveis.map(n => ({
    nivel_ordem: n.nivel_ordem,
    nivel_nome: n.nivel_nome,
    nivel_cor: n.nivel_cor,
    comissao_percentual: decimalToNumber(n.comissao_percentual),
  }));
}

// Atualizar níveis de meta
export async function updateMetaNiveis(niveis: Array<{
  nivel_ordem: number;
  nivel_nome: string;
  nivel_cor: string;
  comissao_percentual?: number;
}>) {
  for (const nivel of niveis) {
    await prisma.$executeRaw`
      UPDATE meta_niveis
      SET nivel_nome = ${nivel.nivel_nome}, nivel_cor = ${nivel.nivel_cor},
          comissao_percentual = ${nivel.comissao_percentual ?? 0}, updated_at = NOW()
      WHERE nivel_ordem = ${nivel.nivel_ordem}
    `;
  }
}

// Buscar metas por período
export async function getMetas(ano: number, mes: number, branchCode?: number) {
  let metas;

  if (branchCode) {
    metas = await prisma.$queryRaw<Array<{
      id: number;
      ano: number;
      mes: number;
      branch_code: number;
      seller_code: number | null;
      nivel_1: Decimal | null;
      nivel_2: Decimal | null;
      nivel_3: Decimal | null;
      nivel_4: Decimal | null;
      nivel_5: Decimal | null;
    }>>`
      SELECT * FROM metas
      WHERE ano = ${ano} AND mes = ${mes} AND branch_code = ${branchCode}
      ORDER BY branch_code, seller_code
    `;
  } else {
    metas = await prisma.$queryRaw<Array<{
      id: number;
      ano: number;
      mes: number;
      branch_code: number;
      seller_code: number | null;
      nivel_1: Decimal | null;
      nivel_2: Decimal | null;
      nivel_3: Decimal | null;
      nivel_4: Decimal | null;
      nivel_5: Decimal | null;
    }>>`
      SELECT * FROM metas
      WHERE ano = ${ano} AND mes = ${mes}
      ORDER BY branch_code, seller_code
    `;
  }

  return metas.map(m => ({
    id: m.id,
    ano: m.ano,
    mes: m.mes,
    branch_code: m.branch_code,
    seller_code: m.seller_code,
    nivel_1: decimalToNumber(m.nivel_1),
    nivel_2: decimalToNumber(m.nivel_2),
    nivel_3: decimalToNumber(m.nivel_3),
    nivel_4: decimalToNumber(m.nivel_4),
    nivel_5: decimalToNumber(m.nivel_5),
  }));
}

// Salvar meta
export async function saveMeta(data: {
  ano: number;
  mes: number;
  branch_code: number;
  seller_code: number | null;
  nivel_1: number;
  nivel_2: number;
  nivel_3: number;
  nivel_4: number;
  nivel_5: number;
}) {
  await prisma.$executeRaw`
    INSERT INTO metas (ano, mes, branch_code, seller_code, nivel_1, nivel_2, nivel_3, nivel_4, nivel_5)
    VALUES (${data.ano}, ${data.mes}, ${data.branch_code}, ${data.seller_code},
            ${data.nivel_1}, ${data.nivel_2}, ${data.nivel_3}, ${data.nivel_4}, ${data.nivel_5})
    ON CONFLICT (ano, mes, branch_code, seller_code) DO UPDATE SET
      nivel_1 = EXCLUDED.nivel_1,
      nivel_2 = EXCLUDED.nivel_2,
      nivel_3 = EXCLUDED.nivel_3,
      nivel_4 = EXCLUDED.nivel_4,
      nivel_5 = EXCLUDED.nivel_5,
      updated_at = NOW()
  `;
}

// Deletar meta
export async function deleteMeta(id: number) {
  await prisma.$executeRaw`DELETE FROM metas WHERE id = ${id}`;
}

// Criar distribuição de metas
export async function createDistribution(data: {
  name?: string;
  ano: number;
  mes: number;
  totalValue: number;
  distributionType: 'manual' | 'igual' | 'proporcional';
  createdById?: number;
  items: Array<{
    branchCode: number;
    sellerCode?: number;
    percentage: number;
  }>;
}) {
  // Criar distribuição
  const distribution = await prisma.metaDistribution.create({
    data: {
      name: data.name,
      ano: data.ano,
      mes: data.mes,
      totalValue: data.totalValue,
      distributionType: data.distributionType,
      createdById: data.createdById,
    },
  });

  // Criar itens da distribuição
  for (const item of data.items) {
    const valorCalculado = (data.totalValue * item.percentage) / 100;

    // Calcular níveis baseado nos percentuais configurados
    const nivel1 = valorCalculado * NIVEL_PERCENTUAIS[1];
    const nivel2 = valorCalculado * NIVEL_PERCENTUAIS[2];
    const nivel3 = valorCalculado * NIVEL_PERCENTUAIS[3];
    const nivel4 = valorCalculado * NIVEL_PERCENTUAIS[4];
    const nivel5 = valorCalculado * NIVEL_PERCENTUAIS[5];

    await prisma.distributionItem.create({
      data: {
        distributionId: distribution.id,
        branchCode: item.branchCode,
        sellerCode: item.sellerCode,
        percentage: item.percentage,
        valorCalculado,
        nivel1,
        nivel2,
        nivel3,
        nivel4,
        nivel5,
      },
    });

    // Criar ou atualizar a meta correspondente
    await saveMeta({
      ano: data.ano,
      mes: data.mes,
      branch_code: item.branchCode,
      seller_code: item.sellerCode || null,
      nivel_1: nivel1,
      nivel_2: nivel2,
      nivel_3: nivel3,
      nivel_4: nivel4,
      nivel_5: nivel5,
    });
  }

  return distribution;
}

// Buscar distribuições
export async function getDistributions(ano: number, mes: number) {
  return prisma.metaDistribution.findMany({
    where: { ano, mes },
    include: {
      items: true,
      createdBy: {
        select: { name: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

// Deletar distribuição
export async function deleteDistribution(id: number) {
  // Items são deletados automaticamente pelo CASCADE
  return prisma.metaDistribution.delete({
    where: { id },
  });
}
