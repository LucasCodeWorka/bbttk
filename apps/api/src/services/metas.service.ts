import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { NIVEL_PERCENTUAIS } from '../config/constants.js';
import { Decimal } from '@prisma/client/runtime/library';

// Helpers
function decimalToNumber(value: Decimal | number | null): number {
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals: number = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
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
      comissao_nivel_1: Decimal | null;
      comissao_nivel_2: Decimal | null;
      comissao_nivel_3: Decimal | null;
      comissao_nivel_4: Decimal | null;
      comissao_nivel_5: Decimal | null;
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
      comissao_nivel_1: Decimal | null;
      comissao_nivel_2: Decimal | null;
      comissao_nivel_3: Decimal | null;
      comissao_nivel_4: Decimal | null;
      comissao_nivel_5: Decimal | null;
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
    comissao_nivel_1: m.comissao_nivel_1 === null ? null : decimalToNumber(m.comissao_nivel_1),
    comissao_nivel_2: m.comissao_nivel_2 === null ? null : decimalToNumber(m.comissao_nivel_2),
    comissao_nivel_3: m.comissao_nivel_3 === null ? null : decimalToNumber(m.comissao_nivel_3),
    comissao_nivel_4: m.comissao_nivel_4 === null ? null : decimalToNumber(m.comissao_nivel_4),
    comissao_nivel_5: m.comissao_nivel_5 === null ? null : decimalToNumber(m.comissao_nivel_5),
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
  comissao_nivel_1?: number | null;
  comissao_nivel_2?: number | null;
  comissao_nivel_3?: number | null;
  comissao_nivel_4?: number | null;
  comissao_nivel_5?: number | null;
}) {
  const c1 = data.comissao_nivel_1 ?? null;
  const c2 = data.comissao_nivel_2 ?? null;
  const c3 = data.comissao_nivel_3 ?? null;
  const c4 = data.comissao_nivel_4 ?? null;
  const c5 = data.comissao_nivel_5 ?? null;

  await prisma.$executeRaw`
    INSERT INTO metas (ano, mes, branch_code, seller_code, nivel_1, nivel_2, nivel_3, nivel_4, nivel_5,
      comissao_nivel_1, comissao_nivel_2, comissao_nivel_3, comissao_nivel_4, comissao_nivel_5)
    VALUES (${data.ano}, ${data.mes}, ${data.branch_code}, ${data.seller_code},
            ${data.nivel_1}, ${data.nivel_2}, ${data.nivel_3}, ${data.nivel_4}, ${data.nivel_5},
            ${c1}, ${c2}, ${c3}, ${c4}, ${c5})
    ON CONFLICT (ano, mes, branch_code, seller_code) DO UPDATE SET
      nivel_1 = EXCLUDED.nivel_1,
      nivel_2 = EXCLUDED.nivel_2,
      nivel_3 = EXCLUDED.nivel_3,
      nivel_4 = EXCLUDED.nivel_4,
      nivel_5 = EXCLUDED.nivel_5,
      comissao_nivel_1 = EXCLUDED.comissao_nivel_1,
      comissao_nivel_2 = EXCLUDED.comissao_nivel_2,
      comissao_nivel_3 = EXCLUDED.comissao_nivel_3,
      comissao_nivel_4 = EXCLUDED.comissao_nivel_4,
      comissao_nivel_5 = EXCLUDED.comissao_nivel_5,
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

export interface ComissaoOverride {
  nivel1?: number | null;
  nivel2?: number | null;
  nivel3?: number | null;
  nivel4?: number | null;
  nivel5?: number | null;
}

interface LinhaDistribuicao {
  branchCode: number;
  valor: number;
  comissaoOverride?: ComissaoOverride | null;
  vendedores: Array<{
    sellerCode: number;
    valor: number;
    comissaoOverride?: ComissaoOverride | null;
    isGerente?: boolean;
  }>;
  // true quando o frontend carregou a lista COMPLETA de vendedores dessa loja
  // (ex: tela de Editar Meta por Loja, que sempre busca o vinculo oficial antes de
  // salvar) - nesse caso, sincronizamos de verdade: qualquer Meta de vendedor dessa
  // loja/periodo que nao esteja em `vendedores` e apagada (nao so deixada de fora do
  // upsert). Sem essa flag (ex: Cadastro de Metas multi-loja, onde uma loja pode ser
  // selecionada sem nunca expandir "Distribuir vendedores"), mantem o comportamento
  // antigo de so upsert - `vendedores: []` nesse caso significa "nao carregado", nao
  // "zerar todo mundo".
  sincronizarVendedores?: boolean;
}

function calcularNiveis(valor: number) {
  return {
    nivel1: valor * NIVEL_PERCENTUAIS[1],
    nivel2: valor * NIVEL_PERCENTUAIS[2],
    nivel3: valor * NIVEL_PERCENTUAIS[3],
    nivel4: valor * NIVEL_PERCENTUAIS[4],
    nivel5: valor * NIVEL_PERCENTUAIS[5],
  };
}

// Salva o cadastro/distribuicao de metas inteiro numa chamada so - modal unico
// "Cadastrar Metas" do frontend ja manda os valores em R$ de cada loja e de cada
// vendedor dentro dela, ja calculados e conferidos no client (distribuicao
// igual/historico/manual, arredondamento com soma exata). Aqui so valida de novo (defesa
// em profundidade - nunca confiar so no client) e grava: 1 linha de Meta por loja
// (seller_code=null, é o alvo da loja inteira lido pelo Comparativo do Dashboard) + 1
// linha de Meta por vendedor dentro dela, mais o registro de auditoria
// MetaDistribution/DistributionItem (mesmo padrao de createDistribution).
export async function salvarDistribuicaoCompleta(data: {
  ano: number;
  mes: number;
  totalValue: number;
  distributionType: 'manual' | 'igual' | 'proporcional';
  lojas: LinhaDistribuicao[];
  createdById?: number;
}) {
  if (!(data.totalValue > 0)) {
    throw new Error('Valor total da meta precisa ser maior que zero');
  }
  if (data.lojas.length === 0) {
    throw new Error('Selecione ao menos uma loja');
  }

  const TOLERANCIA = 0.02;
  const somaLojas = data.lojas.reduce((s, l) => s + l.valor, 0);
  if (Math.abs(somaLojas - data.totalValue) > TOLERANCIA) {
    throw new Error(
      `A soma das metas das lojas (${somaLojas.toFixed(2)}) nao bate com o valor total da meta (${data.totalValue.toFixed(2)})`
    );
  }

  for (const loja of data.lojas) {
    if (loja.valor < 0) {
      throw new Error(`Valor da loja ${loja.branchCode} nao pode ser negativo`);
    }
    // A gerente da loja (no maximo uma por loja) fica de fora dessa soma de proposito - a
    // meta dela pode ser o valor CHEIO da loja (modo padrao, nao e uma fatia, entao nao
    // teria como a soma com as demais vendedoras bater com loja.valor) OU so o que sobrar
    // depois de distribuir entre as demais (modo "assume o restante", escolhido no
    // CadastroMetaModal do frontend) - nesse segundo modo a soma das regulares pode ficar
    // ABAIXO de loja.valor de proposito (a gerente absorve a diferenca), so nao pode
    // ULTRAPASSAR. Sem gerente, mantem a exigencia de bater exatamente (nao ha quem
    // absorva sobra/falta).
    const temGerente = loja.vendedores.some((v) => v.isGerente);
    const vendedoresRegulares = loja.vendedores.filter((v) => !v.isGerente);
    if (vendedoresRegulares.length > 0) {
      const somaVendedores = vendedoresRegulares.reduce((s, v) => s + v.valor, 0);
      const diferenca = somaVendedores - loja.valor;
      const excedeuComGerente = temGerente && diferenca > TOLERANCIA;
      const naoBateuSemGerente = !temGerente && Math.abs(diferenca) > TOLERANCIA;
      if (excedeuComGerente || naoBateuSemGerente) {
        throw new Error(
          `A soma dos vendedores da loja ${loja.branchCode} (${somaVendedores.toFixed(2)}) nao bate com a meta da loja (${loja.valor.toFixed(2)})`
        );
      }
    }
    for (const v of loja.vendedores) {
      if (v.valor < 0) {
        throw new Error(`Valor do vendedor ${v.sellerCode} na loja ${loja.branchCode} nao pode ser negativo`);
      }
    }
  }

  const distribution = await prisma.metaDistribution.create({
    data: {
      ano: data.ano,
      mes: data.mes,
      totalValue: data.totalValue,
      distributionType: data.distributionType,
      createdById: data.createdById,
    },
  });

  await prisma.$transaction(async (tx) => {
    async function upsertMeta(
      branchCode: number,
      sellerCode: number | null,
      valor: number,
      override: ComissaoOverride | null | undefined
    ) {
      const niveis = calcularNiveis(valor);

      // Postgres trata NULL != NULL numa constraint unica, entao ON CONFLICT nunca
      // "acha" a linha da loja (seller_code sempre NULL) pra atualizar - cada save
      // criava uma linha nova em vez de atualizar a existente (achado ao testar a
      // tela de Editar Meta por Loja, que re-salva a mesma loja repetidas vezes).
      // Delete+insert dentro da mesma transacao contorna a limitacao so pra esse caso.
      if (sellerCode === null) {
        await tx.$executeRaw`
          DELETE FROM metas WHERE ano = ${data.ano} AND mes = ${data.mes} AND branch_code = ${branchCode} AND seller_code IS NULL
        `;
        await tx.$executeRaw`
          INSERT INTO metas (ano, mes, branch_code, seller_code, nivel_1, nivel_2, nivel_3, nivel_4, nivel_5,
            comissao_nivel_1, comissao_nivel_2, comissao_nivel_3, comissao_nivel_4, comissao_nivel_5)
          VALUES (${data.ano}, ${data.mes}, ${branchCode}, NULL,
                  ${niveis.nivel1}, ${niveis.nivel2}, ${niveis.nivel3}, ${niveis.nivel4}, ${niveis.nivel5},
                  ${override?.nivel1 ?? null}, ${override?.nivel2 ?? null}, ${override?.nivel3 ?? null},
                  ${override?.nivel4 ?? null}, ${override?.nivel5 ?? null})
        `;
        return niveis;
      }

      await tx.$executeRaw`
        INSERT INTO metas (ano, mes, branch_code, seller_code, nivel_1, nivel_2, nivel_3, nivel_4, nivel_5,
          comissao_nivel_1, comissao_nivel_2, comissao_nivel_3, comissao_nivel_4, comissao_nivel_5)
        VALUES (${data.ano}, ${data.mes}, ${branchCode}, ${sellerCode},
                ${niveis.nivel1}, ${niveis.nivel2}, ${niveis.nivel3}, ${niveis.nivel4}, ${niveis.nivel5},
                ${override?.nivel1 ?? null}, ${override?.nivel2 ?? null}, ${override?.nivel3 ?? null},
                ${override?.nivel4 ?? null}, ${override?.nivel5 ?? null})
        ON CONFLICT (ano, mes, branch_code, seller_code) DO UPDATE SET
          nivel_1 = EXCLUDED.nivel_1, nivel_2 = EXCLUDED.nivel_2, nivel_3 = EXCLUDED.nivel_3,
          nivel_4 = EXCLUDED.nivel_4, nivel_5 = EXCLUDED.nivel_5,
          comissao_nivel_1 = EXCLUDED.comissao_nivel_1, comissao_nivel_2 = EXCLUDED.comissao_nivel_2,
          comissao_nivel_3 = EXCLUDED.comissao_nivel_3, comissao_nivel_4 = EXCLUDED.comissao_nivel_4,
          comissao_nivel_5 = EXCLUDED.comissao_nivel_5, updated_at = NOW()
      `;
      return niveis;
    }

    for (const loja of data.lojas) {
      const niveisLoja = await upsertMeta(loja.branchCode, null, loja.valor, loja.comissaoOverride);
      await tx.distributionItem.create({
        data: {
          distributionId: distribution.id,
          branchCode: loja.branchCode,
          sellerCode: null,
          percentage: data.totalValue > 0 ? round((loja.valor / data.totalValue) * 100, 2) : 0,
          valorCalculado: loja.valor,
          nivel1: niveisLoja.nivel1,
          nivel2: niveisLoja.nivel2,
          nivel3: niveisLoja.nivel3,
          nivel4: niveisLoja.nivel4,
          nivel5: niveisLoja.nivel5,
        },
      });

      for (const v of loja.vendedores) {
        const niveisVendedor = await upsertMeta(loja.branchCode, v.sellerCode, v.valor, v.comissaoOverride);
        await tx.distributionItem.create({
          data: {
            distributionId: distribution.id,
            branchCode: loja.branchCode,
            sellerCode: v.sellerCode,
            percentage: loja.valor > 0 ? round((v.valor / loja.valor) * 100, 2) : 0,
            valorCalculado: v.valor,
            nivel1: niveisVendedor.nivel1,
            nivel2: niveisVendedor.nivel2,
            nivel3: niveisVendedor.nivel3,
            nivel4: niveisVendedor.nivel4,
            nivel5: niveisVendedor.nivel5,
          },
        });
      }

      if (loja.sincronizarVendedores) {
        const sellerCodesAtuais = loja.vendedores.map((v) => v.sellerCode);
        // NOT IN () vazio e invalido em SQL - com a lista vazia (loja sincronizada
        // sem nenhum vendedor), o guarda -1 faz a clausula sempre verdadeira, ou
        // seja, apaga todas as metas de vendedor dessa loja/periodo (comportamento
        // correto: a lista sincronizada e "ninguem").
        const guarda = sellerCodesAtuais.length > 0 ? sellerCodesAtuais : [-1];
        await tx.$executeRaw`
          DELETE FROM metas
          WHERE ano = ${data.ano} AND mes = ${data.mes} AND branch_code = ${loja.branchCode}
            AND seller_code IS NOT NULL
            AND seller_code NOT IN (${Prisma.join(guarda)})
        `;
      }
    }
  });

  return distribution;
}
