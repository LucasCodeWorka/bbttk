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

// Indicadores extra da tela unificada "Visao Geral" - NAO reusam o motor do Relatorio
// Base (esses 3 ja tem calculo proprio, testado, em cada relatorio de origem) - so
// chamam direto os services ja existentes (mesmo workspace apps/pcp-api, import direto
// sem duplicar SQL) e extraem os poucos numeros que viram card aqui. Aceita rodar por
// baixo os 3 relatorios inteiros so pra pegar 2-3 numeros de cada - tradeoff aceito no
// Fase 1 (correcao/reuso > microperf); se o carregamento da tela unificada ficar
// sensivelmente mais lento que visitar as 3 telas separadas, extrair depois uma versao
// "resumo" mais enxuta de cada service.
export async function getVisaoGeralExtras(filtro: VisaoGeralExtrasFiltro) {
  const [metaRow, grade, estoque, curva] = await Promise.all([
    // Meta e exposta aqui (rota so protegida por moduleAccess, nao por adminOnly) pra
    // qualquer usuario do modulo PCP ver "Meta: X - gap Y" nos cards. So a EDICAO da
    // meta exige admin - isso continua no fluxo separado (pcpConfigApi.getMetaVisaoGeral/
    // updateMetaVisaoGeral, apps/api, rota admin-only) quando o usuario abre o modal.
    prisma.pcpMetaVisaoGeral.upsert({
      where: { relatorio: META_VISAO_GERAL_KEY },
      create: { relatorio: META_VISAO_GERAL_KEY },
      update: {},
    }),
    getGrade({
      categoria: filtro.categoria,
      linha: filtro.linha,
      genero: filtro.genero,
      status: filtro.status,
      branches: filtro.branches,
    }),
    getEstoqueSemGiro({
      dias: 90,
      branchCodes: filtro.branches,
      produtoFiltro: { categoria: filtro.categoria, linha: filtro.linha, genero: filtro.genero },
    }),
    getCurvaAbcResumo({
      categoria: filtro.categoria,
      linha: filtro.linha,
      genero: filtro.genero,
      status: filtro.status,
    }),
  ]);

  return {
    meta: {
      metaCoberturaGeralMeses: decimalToNumber(metaRow.metaCoberturaGeralMeses),
      metaGiroAnualizado: decimalToNumber(metaRow.metaGiroAnualizado),
      metaEstoqueMortoPercent: decimalToNumber(metaRow.metaEstoqueMortoPercent),
      metaCoberturaBasicoMeses: decimalToNumber(metaRow.metaCoberturaBasicoMeses),
      metaCoberturaColecaoMeses: decimalToNumber(metaRow.metaCoberturaColecaoMeses),
    },
    skusEmRisco: {
      percent: grade.indicadores.percentSkusEmRisco,
      referenciasCriticas: grade.indicadores.referenciasCriticas,
      skusEmRiscoTotal: grade.indicadores.skusEmRiscoTotal,
      totalSkus: grade.indicadores.totalSkus,
    },
    estoqueSemGiro: estoque.resumo,
    curvaAbc: curva.curvas.map((c) => ({ curva: c.curva, percentDoTotal: c.percentDoTotal })),
  };
}
