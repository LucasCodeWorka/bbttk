// Script para entender a distribuição de cobertura
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function analisarDistribuicao() {
  console.log('🔍 Analisando distribuição de cobertura...\n');

  try {
    const config = await prisma.pcpRelatorioConfig.upsert({
      where: { relatorio: 'gestao_transferencia' },
      create: { relatorio: 'gestao_transferencia' },
      update: {},
    });
    const diasAnalise = config.diasAnaliseVendas;
    const limiteVerde = config.transferenciaCoberturaDiasVerde;
    const limiteAmarelo = config.transferenciaCoberturaDiasAmarelo;
    const dataInicio = new Date();
    dataInicio.setDate(dataInicio.getDate() - diasAnalise);

    console.log('📋 Configuração:');
    console.log('   Dias de análise:', diasAnalise);
    console.log('   Limite Verde:', limiteVerde, 'dias');
    console.log('   Limite Amarelo:', limiteAmarelo, 'dias\n');

    // Analisar distribuição de cobertura
    const distribuicao = await prisma.$queryRaw`
      WITH skus_com_entrada AS (
        SELECT DISTINCT ti.product_code, ti.branch_code
        FROM transacao_itens ti
        INNER JOIN transacoes t ON t.transaction_code = ti.transaction_code AND t.branch_code = ti.branch_code
        INNER JOIN classificacao_operacoes co ON t.operation_code = co.operation_code
        WHERE co.operations_type = 'E'
          AND ti.branch_code != 2
      ),
      vendas_recentes AS (
        SELECT
          p.product_code,
          ti.branch_code,
          COALESCE(SUM(ti.quantity), 0) as quantidade_vendida
        FROM transacao_itens ti
        INNER JOIN transacoes t ON t.transaction_code = ti.transaction_code AND t.branch_code = ti.branch_code
        INNER JOIN produtos p ON ti.product_code = p.product_code
        WHERE t.status = 4
          AND t.transaction_date >= ${dataInicio}
          AND ti.branch_code != 2
          AND t.customer_code < 110000000
        GROUP BY p.product_code, ti.branch_code
      ),
      cobertura_calc AS (
        SELECT
          p.product_code,
          sce.branch_code,
          COALESCE(SUM(ps.stock), 0) as estoque,
          COALESCE(vr.quantidade_vendida, 0) as vendas,
          CASE
            WHEN COALESCE(vr.quantidade_vendida, 0) > 0
              THEN (COALESCE(SUM(ps.stock), 0) / (COALESCE(vr.quantidade_vendida, 0) / ${diasAnalise}))
            WHEN COALESCE(SUM(ps.stock), 0) > 0
              THEN 9999
            ELSE 0
          END as cobertura_dias
        FROM skus_com_entrada sce
        INNER JOIN produtos p ON p.product_code = sce.product_code
        LEFT JOIN prd_saldo ps ON ps.product_sku = p.product_sku
          AND ps.branch_code = sce.branch_code
          AND ps.is_full_snapshot = true
          AND ps.stock_code = 1
        LEFT JOIN vendas_recentes vr ON vr.product_code = p.product_code
          AND vr.branch_code = sce.branch_code
        GROUP BY p.product_code, sce.branch_code, vr.quantidade_vendida
      )
      SELECT
        COUNT(*) FILTER (WHERE cobertura_dias = 0) as sem_estoque,
        COUNT(*) FILTER (WHERE cobertura_dias > 0 AND cobertura_dias < ${limiteVerde}) as verde,
        COUNT(*) FILTER (WHERE cobertura_dias >= ${limiteVerde} AND cobertura_dias < ${limiteAmarelo}) as amarelo,
        COUNT(*) FILTER (WHERE cobertura_dias >= ${limiteAmarelo} AND cobertura_dias < 9999) as vermelho_vendendo,
        COUNT(*) FILTER (WHERE cobertura_dias = 9999) as vermelho_sem_vendas,
        COUNT(*) as total
      FROM cobertura_calc
    `;

    const d = distribuicao[0];
    const semEstoque = Number(d.sem_estoque);
    const verde = Number(d.verde);
    const amarelo = Number(d.amarelo);
    const vermelhoVendendo = Number(d.vermelho_vendendo);
    const vermelhoSemVendas = Number(d.vermelho_sem_vendas);
    const total = Number(d.total);

    console.log('📊 DISTRIBUIÇÃO DE COBERTURA (combinações SKU+Loja):');
    console.log('');
    console.log('   Sem estoque (0):', semEstoque.toLocaleString(), `(${((semEstoque/total)*100).toFixed(1)}%)`);
    console.log('   🟢 Verde (<', limiteVerde, 'dias):', verde.toLocaleString(), `(${((verde/total)*100).toFixed(1)}%)`);
    console.log('   🟡 Amarelo (', limiteVerde, '-', limiteAmarelo, 'dias):', amarelo.toLocaleString(), `(${((amarelo/total)*100).toFixed(1)}%)`);
    console.log('   🔴 Vermelho vendendo (>', limiteAmarelo, 'dias):', vermelhoVendendo.toLocaleString(), `(${((vermelhoVendendo/total)*100).toFixed(1)}%)`);
    console.log('   🔴 Vermelho sem vendas (estoque parado):', vermelhoSemVendas.toLocaleString(), `(${((vermelhoSemVendas/total)*100).toFixed(1)}%)`);
    console.log('   ────────────────────────────────');
    console.log('   TOTAL:', total.toLocaleString());
    console.log('');

    const comOportunidade = verde + vermelhoVendendo + vermelhoSemVendas;
    const semOportunidade = amarelo + semEstoque;

    console.log('🎯 OPORTUNIDADES DE TRANSFERÊNCIA:');
    console.log('');
    console.log('   Com oportunidade (verde + vermelho):', comOportunidade.toLocaleString(), `(${((comOportunidade/total)*100).toFixed(1)}%)`);
    console.log('   Sem oportunidade (amarelo + sem estoque):', semOportunidade.toLocaleString(), `(${((semOportunidade/total)*100).toFixed(1)}%)`);
    console.log('');
    console.log('   💡 Isso explica por que o filtro quase não reduziu o volume!');
    console.log('');

  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

analisarDistribuicao();
