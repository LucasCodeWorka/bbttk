import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';

const META_VISAO_GERAL_KEY = 'visao_geral';
const META_COBERTURA_BASICO_MESES = 4;
const META_COBERTURA_STYLE_MESES = 3;

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

// Extras da tela unificada "Visao Geral". Hoje esta rota alimenta as metas dos cards;
// os indicadores pesados ficam no Relatorio Base para respeitar o mesmo universo/data.
export async function getVisaoGeralExtras(_filtro: VisaoGeralExtrasFiltro) {
  // Meta e exposta aqui (rota so protegida por moduleAccess, nao por adminOnly) pra
  // qualquer usuario do modulo PCP ver "Meta: X - gap Y" nos cards. So a EDICAO da
  // meta exige admin - isso continua no fluxo separado (pcpConfigApi.getMetaVisaoGeral/
  // updateMetaVisaoGeral, apps/api, rota admin-only) quando o usuario abre o modal.
  let metaRow = await prisma.pcpMetaVisaoGeral.upsert({
    where: { relatorio: META_VISAO_GERAL_KEY },
    create: {
      relatorio: META_VISAO_GERAL_KEY,
      metaCoberturaBasicoMeses: META_COBERTURA_BASICO_MESES,
      metaCoberturaColecaoMeses: META_COBERTURA_STYLE_MESES,
    },
    update: {},
  });
  if (
    decimalToNumber(metaRow.metaCoberturaBasicoMeses) === 3 &&
    decimalToNumber(metaRow.metaCoberturaColecaoMeses) === 1.5
  ) {
    metaRow = await prisma.pcpMetaVisaoGeral.update({
      where: { relatorio: META_VISAO_GERAL_KEY },
      data: {
        metaCoberturaBasicoMeses: META_COBERTURA_BASICO_MESES,
        metaCoberturaColecaoMeses: META_COBERTURA_STYLE_MESES,
      },
    });
  }

  return {
    meta: {
      metaCoberturaGeralMeses: decimalToNumber(metaRow.metaCoberturaGeralMeses),
      metaGiroAnualizado: decimalToNumber(metaRow.metaGiroAnualizado),
      metaEstoqueMortoPercent: decimalToNumber(metaRow.metaEstoqueMortoPercent),
      metaCoberturaBasicoMeses: decimalToNumber(metaRow.metaCoberturaBasicoMeses),
      metaCoberturaColecaoMeses: decimalToNumber(metaRow.metaCoberturaColecaoMeses),
    },
    skusEmRisco: { percent: 0, referenciasCriticas: 0, skusEmRiscoTotal: 0, totalSkus: 0 },
    estoqueSemGiro: [],
    curvaAbc: [],
  };
}
