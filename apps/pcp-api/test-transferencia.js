// Script de teste rápido para contar registros da query de transferência
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testarQuery() {
  console.log('🔍 Testando volume de dados da query de transferência...\n');
  
  try {
    // 1. Contar total de SKUs distintos (produtos)
    const totalSkus = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT product_sku) as total
      FROM produtos
    `;
    console.log('📦 Total de SKUs no catálogo:', totalSkus[0].total);

    // 2. Contar lojas (exceto fábrica)
    const totalLojas = await prisma.$queryRaw`
      SELECT COUNT(*) as total
      FROM branches
      WHERE branch_code != 2
    `;
    console.log('🏪 Total de lojas:', totalLojas[0].total);

    // 3. Contar SKUs que já tiveram entrada em lojas
    const skusComEntrada = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT ti.product_code || '_' || ti.branch_code) as total
      FROM transacao_itens ti
      INNER JOIN transacoes t ON t.transaction_code = ti.transaction_code AND t.branch_code = ti.branch_code
      INNER JOIN classificacao_operacoes co ON t.operation_code = co.operation_code
      WHERE co.operations_type = 'E'
        AND ti.branch_code != 2
    `;
    console.log('📥 Combinações SKU+Loja com entrada:', skusComEntrada[0].total);

    // 4. Buscar configuração
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

    console.log('\n📋 Configuração:');
    console.log('   Dias de análise:', diasAnalise);
    console.log('   Limite Verde:', limiteVerde, 'dias');
    console.log('   Limite Amarelo:', limiteAmarelo, 'dias');

    // 5. Simular a query COM filtro de entrada (versão anterior)
    console.log('\n⏳ Query COM filtro de entrada (versão anterior)...');
    const inicio1 = Date.now();

    const resultado1 = await prisma.$queryRaw`
      WITH skus_ref AS (
        SELECT DISTINCT product_sku, reference_code, product_name, color_name, size
        FROM produtos
      ),
      lojas AS (
        SELECT branch_code, description
        FROM branches
        WHERE branch_code != 2
      ),
      skus_com_entrada AS (
        SELECT DISTINCT ti.product_code, ti.branch_code
        FROM transacao_itens ti
        INNER JOIN transacoes t ON t.transaction_code = ti.transaction_code AND t.branch_code = ti.branch_code
        INNER JOIN classificacao_operacoes co ON t.operation_code = co.operation_code
        WHERE co.operations_type = 'E'
          AND ti.branch_code != 2
      )
      SELECT COUNT(*) as total
      FROM skus_ref s
      CROSS JOIN lojas l
      INNER JOIN produtos p ON p.product_sku = s.product_sku
      INNER JOIN skus_com_entrada sce ON sce.product_code = p.product_code AND sce.branch_code = l.branch_code
    `;

    const tempo1 = Date.now() - inicio1;
    console.log('📊 Linhas (versão anterior):', resultado1[0].total);
    console.log('⏱️  Tempo:', tempo1 + 'ms');

    // 6. Simular a query COM filtro de oportunidade (versão nova otimizada)
    console.log('\n⏳ Query COM filtro de oportunidade (NOVA versão otimizada)...');
    const inicio2 = Date.now();

    const resultado2 = await prisma.$queryRaw`
      WITH skus_ref AS (
        SELECT DISTINCT product_sku, reference_code, product_name, color_name, size
        FROM produtos
      ),
      lojas AS (
        SELECT branch_code, description
        FROM branches
        WHERE branch_code != 2
      ),
      skus_com_entrada AS (
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
      ),
      skus_com_verde AS (
        SELECT DISTINCT product_code
        FROM cobertura_calc
        WHERE cobertura_dias > 0 AND cobertura_dias < ${limiteVerde}
      ),
      skus_com_vermelho AS (
        SELECT DISTINCT product_code
        FROM cobertura_calc
        WHERE cobertura_dias > ${limiteAmarelo}
      ),
      skus_com_oportunidade AS (
        SELECT product_code
        FROM skus_com_verde
        INTERSECT
        SELECT product_code
        FROM skus_com_vermelho
      )
      SELECT COUNT(*) as total
      FROM skus_ref s
      CROSS JOIN lojas l
      INNER JOIN produtos p ON p.product_sku = s.product_sku
      INNER JOIN skus_com_entrada sce ON sce.product_code = p.product_code AND sce.branch_code = l.branch_code
      INNER JOIN skus_com_oportunidade sco ON sco.product_code = p.product_code
    `;

    const tempo2 = Date.now() - inicio2;
    console.log('✅ Linhas (versão OTIMIZADA):', resultado2[0].total);
    console.log('⏱️  Tempo:', tempo2 + 'ms');

    // 7. Calcular redução da otimização
    const total1 = Number(resultado1[0].total);
    const total2 = Number(resultado2[0].total);
    const reducaoOtimizada = ((1 - total2 / total1) * 100).toFixed(1);
    console.log('\n📊 COMPARAÇÃO:');
    console.log('   Versão anterior:', total1.toLocaleString(), 'linhas');
    console.log('   Versão otimizada:', total2.toLocaleString(), 'linhas');
    console.log('   Redução:', reducaoOtimizada + '%');
    console.log('   Linhas economizadas:', (total1 - total2).toLocaleString());

    if (total2 > 10000) {
      console.log('\n⚠️  ALERTA: Ainda muito pesado! Recomendações adicionais:');
      console.log('   1. Exigir filtro de referência (não permitir busca vazia)');
      console.log('   2. Adicionar filtro de estoque > 0');
      console.log('   3. Limitar para produtos ativos nos últimos 6 meses');
    } else if (total2 > 5000) {
      console.log('\n⚠️  ATENÇÃO: Volume médio-alto. Considere paginação.');
    } else {
      console.log('\n✅ Volume aceitável para renderização direta!');
    }

  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testarQuery();
