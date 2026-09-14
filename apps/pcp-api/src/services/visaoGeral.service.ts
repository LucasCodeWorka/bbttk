import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { getGrade } from './analiseGrade.service.js';
import { getEstoqueSemGiro } from './estoque.service.js';
import { getCurvaAbcResumo } from './curvaAbc.service.js';

const META_VISAO_GERAL_KEY = 'visao_geral';

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

export interface VisaoGeralExtrasFiltro {
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  status?: string[];
  branches?: number[];
}

// Indicadores extra da tela unificada "Visao Geral". Cada motor abaixo e pesado e
// devolve muito mais informacao do que os cards precisam. Executa-los em paralelo
// fazia quatro relatorios completos coexistirem na heap (o Relatorio Base + estes 3),
// ultrapassando o limite da instancia do Render. Extraimos apenas os resumos e os
// processamos um a um para que o resultado anterior possa ser liberado antes do proximo.
export async function getVisaoGeralExtras(filtro: VisaoGeralExtrasFiltro) {
  // Meta e exposta aqui (rota so protegida por moduleAccess, nao por adminOnly) pra
  // qualquer usuario do modulo PCP ver "Meta: X - gap Y" nos cards. So a EDICAO da
  // meta exige admin - isso continua no fluxo separado (pcpConfigApi.getMetaVisaoGeral/
  // updateMetaVisaoGeral, apps/api, rota admin-only) quando o usuario abre o modal.
  const metaRow = await prisma.pcpMetaVisaoGeral.upsert({
    where: { relatorio: META_VISAO_GERAL_KEY },
    create: { relatorio: META_VISAO_GERAL_KEY },
    update: {},
  });

  const skusEmRisco = await getGrade({
      categoria: filtro.categoria,
      linha: filtro.linha,
      genero: filtro.genero,
      status: filtro.status,
      branches: filtro.branches,
    }).then((grade) => ({
      percent: grade.indicadores.percentSkusEmRisco,
      referenciasCriticas: grade.indicadores.referenciasCriticas,
      skusEmRiscoTotal: grade.indicadores.skusEmRiscoTotal,
      totalSkus: grade.indicadores.totalSkus,
    }));

  const estoqueSemGiro = await getEstoqueSemGiro({
    dias: 90,
    branchCodes: filtro.branches,
    produtoFiltro: { categoria: filtro.categoria, linha: filtro.linha, genero: filtro.genero },
    // A Visao Geral so usa "resumo"; nao devolve milhares de SKUs ao processo.
    limit: 1,
  }).then((estoque) => estoque.resumo);

  const curvaAbc = await getCurvaAbcResumo({
    categoria: filtro.categoria,
    linha: filtro.linha,
    genero: filtro.genero,
    status: filtro.status,
  }).then((curva) => curva.curvas.map((item) => ({ curva: item.curva, percentDoTotal: item.percentDoTotal })));

  return {
    meta: {
      metaCoberturaGeralMeses: decimalToNumber(metaRow.metaCoberturaGeralMeses),
      metaGiroAnualizado: decimalToNumber(metaRow.metaGiroAnualizado),
      metaEstoqueMortoPercent: decimalToNumber(metaRow.metaEstoqueMortoPercent),
      metaCoberturaBasicoMeses: decimalToNumber(metaRow.metaCoberturaBasicoMeses),
      metaCoberturaColecaoMeses: decimalToNumber(metaRow.metaCoberturaColecaoMeses),
    },
    skusEmRisco,
    estoqueSemGiro,
    curvaAbc,
  };
}
