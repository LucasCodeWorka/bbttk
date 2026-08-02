import { prisma } from '../config/database.js';

const ATACADO_COBERTURA_BASES = ['fabrica_total', 'atacado_only'];

export interface UpdateConfigInput {
  relatorio: string;
  giroDias: number;
  coberturaMeses: number;
  riscoCoberturaMeses: number;
  atacadoCoberturaBase: string;
  custoCode: number;
  pdvVarejoCode: number;
  pdvAtacadoCode: number;
  precoCustoBranchCode: number;
}

export interface CoberturaIdealItem {
  branchCode: number;
  coberturaIdealMeses: number;
}

export interface UpdateMetaVisaoGeralInput {
  relatorio: string;
  metaCoberturaGeralMeses: number;
  metaGiroAnualizado: number;
  metaEstoqueMortoPercent: number;
  metaCoberturaBasicoMeses: number;
  metaCoberturaColecaoMeses: number;
  estoqueMortoDias: number;
}

// Busca a config do relatorio, criando com os defaults se ainda nao existir
// (upsert-on-read - nao precisa de seed manual).
export async function getConfig(relatorio: string) {
  return prisma.pcpRelatorioConfig.upsert({
    where: { relatorio },
    create: { relatorio },
    update: {},
  });
}

export async function updateConfig(input: UpdateConfigInput, userId?: number) {
  if (!Number.isInteger(input.giroDias) || input.giroDias <= 0) {
    throw new Error('giroDias precisa ser um numero inteiro positivo');
  }
  if (!Number.isInteger(input.coberturaMeses) || input.coberturaMeses <= 0) {
    throw new Error('coberturaMeses precisa ser um numero inteiro positivo');
  }
  if (typeof input.riscoCoberturaMeses !== 'number' || input.riscoCoberturaMeses <= 0) {
    throw new Error('riscoCoberturaMeses precisa ser um numero positivo');
  }
  if (!ATACADO_COBERTURA_BASES.includes(input.atacadoCoberturaBase)) {
    throw new Error(`atacadoCoberturaBase precisa ser um de: ${ATACADO_COBERTURA_BASES.join(', ')}`);
  }
  if (!Number.isInteger(input.custoCode)) throw new Error('custoCode invalido');
  if (!Number.isInteger(input.pdvVarejoCode)) throw new Error('pdvVarejoCode invalido');
  if (!Number.isInteger(input.pdvAtacadoCode)) throw new Error('pdvAtacadoCode invalido');
  if (!Number.isInteger(input.precoCustoBranchCode)) throw new Error('precoCustoBranchCode invalido');

  const dados = {
    giroDias: input.giroDias,
    coberturaMeses: input.coberturaMeses,
    riscoCoberturaMeses: input.riscoCoberturaMeses,
    atacadoCoberturaBase: input.atacadoCoberturaBase,
    custoCode: input.custoCode,
    pdvVarejoCode: input.pdvVarejoCode,
    pdvAtacadoCode: input.pdvAtacadoCode,
    precoCustoBranchCode: input.precoCustoBranchCode,
  };

  return prisma.pcpRelatorioConfig.upsert({
    where: { relatorio: input.relatorio },
    create: { relatorio: input.relatorio, ...dados, createdById: userId },
    update: dados,
  });
}

// Lista os codigos de custo/preco que ja foram sincronizados (nome + codigo), pra
// popular os selects do Configurador do PCP sem precisar de chamada nova na API do
// TOTVS toda vez que a tela abre.
export async function getCodigosDisponiveis() {
  const [custos, precos] = await Promise.all([
    prisma.produtoCusto.findMany({
      distinct: ['costCode'],
      select: { costCode: true, costName: true },
      orderBy: { costCode: 'asc' },
    }),
    prisma.produtoPreco.findMany({
      distinct: ['priceCode'],
      select: { priceCode: true, priceName: true },
      orderBy: { priceCode: 'asc' },
    }),
  ]);

  return {
    custos: custos.map((c) => ({ code: c.costCode, name: c.costName || `Codigo ${c.costCode}` })),
    precos: precos.map((p) => ({ code: p.priceCode, name: p.priceName || `Codigo ${p.priceCode}` })),
  };
}

// Retorna so os overrides ja salvos (lista esparsa) - a tela (que ja tem a lista fixa
// das 13 colunas) mescla isso com o default efetivo (coberturaMeses global) pra exibir
// sempre as 13 linhas, mesmo sem override em nenhuma.
export async function getCoberturaIdeal(relatorio: string) {
  return prisma.pcpCoberturaIdealFilial.findMany({
    where: { relatorio },
    orderBy: { branchCode: 'asc' },
  });
}

export async function upsertCoberturaIdeal(relatorio: string, items: CoberturaIdealItem[], userId?: number) {
  for (const item of items) {
    if (!Number.isInteger(item.branchCode)) {
      throw new Error('branchCode invalido em um dos itens');
    }
    if (typeof item.coberturaIdealMeses !== 'number' || item.coberturaIdealMeses <= 0) {
      throw new Error('coberturaIdealMeses precisa ser um numero positivo em todos os itens');
    }
  }

  return prisma.$transaction(
    items.map((item) =>
      prisma.pcpCoberturaIdealFilial.upsert({
        where: { relatorio_branchCode: { relatorio, branchCode: item.branchCode } },
        create: {
          relatorio,
          branchCode: item.branchCode,
          coberturaIdealMeses: item.coberturaIdealMeses,
          createdById: userId,
        },
        update: { coberturaIdealMeses: item.coberturaIdealMeses },
      })
    )
  );
}

// Metas da tela Visao Geral (cards com meta/gap) - upsert-on-read, defaults =
// valores do mockup enviado pelo usuario (ja definidos no schema).
export async function getMetaVisaoGeral(relatorio: string) {
  return prisma.pcpMetaVisaoGeral.upsert({
    where: { relatorio },
    create: { relatorio },
    update: {},
  });
}

export async function updateMetaVisaoGeral(input: UpdateMetaVisaoGeralInput, userId?: number) {
  const campos: [string, number][] = [
    ['metaCoberturaGeralMeses', input.metaCoberturaGeralMeses],
    ['metaGiroAnualizado', input.metaGiroAnualizado],
    ['metaEstoqueMortoPercent', input.metaEstoqueMortoPercent],
    ['metaCoberturaBasicoMeses', input.metaCoberturaBasicoMeses],
    ['metaCoberturaColecaoMeses', input.metaCoberturaColecaoMeses],
    ['estoqueMortoDias', input.estoqueMortoDias],
  ];
  for (const [nome, valor] of campos) {
    if (typeof valor !== 'number' || valor <= 0) {
      throw new Error(`${nome} precisa ser um numero positivo`);
    }
  }
  if (!Number.isInteger(input.estoqueMortoDias)) {
    throw new Error('estoqueMortoDias precisa ser um numero inteiro');
  }

  const dados = {
    metaCoberturaGeralMeses: input.metaCoberturaGeralMeses,
    metaGiroAnualizado: input.metaGiroAnualizado,
    metaEstoqueMortoPercent: input.metaEstoqueMortoPercent,
    metaCoberturaBasicoMeses: input.metaCoberturaBasicoMeses,
    metaCoberturaColecaoMeses: input.metaCoberturaColecaoMeses,
    estoqueMortoDias: input.estoqueMortoDias,
  };

  return prisma.pcpMetaVisaoGeral.upsert({
    where: { relatorio: input.relatorio },
    create: { relatorio: input.relatorio, ...dados, createdById: userId },
    update: dados,
  });
}

export interface UpdateCurvaAbcConfigInput {
  relatorio: string;
  giroDias: number;
  curvaALimitePercent: number;
  curvaBLimitePercent: number;
  curvaCLimitePercent: number;
}

// Limiares da Curva ABCD por representatividade acumulada do valor vendido.
export async function getCurvaAbcConfig(relatorio: string) {
  const config = await prisma.pcpCurvaAbcConfig.upsert({
    where: { relatorio },
    create: { relatorio },
    update: {},
  });
  const a = Number(config.curvaALimitePercent);
  const b = Number(config.curvaBLimitePercent);
  const c = Number(config.curvaCLimitePercent);
  if (!(a > 0 && a < b && b < c && c < 100)) {
    return prisma.pcpCurvaAbcConfig.update({
      where: { relatorio },
      data: { curvaALimitePercent: 80, curvaBLimitePercent: 95, curvaCLimitePercent: 99 },
    });
  }
  return config;
}

export async function updateCurvaAbcConfig(input: UpdateCurvaAbcConfigInput, userId?: number) {
  if (!Number.isInteger(input.giroDias) || input.giroDias <= 0) {
    throw new Error('giroDias precisa ser um numero inteiro positivo');
  }
  if (!Number.isInteger(input.curvaALimitePercent)) {
    throw new Error('curvaALimitePercent precisa ser um numero inteiro');
  }
  // curvaB/CLimitePercent sao Decimal no schema - a API GET ja devolve elas como string
  // (Decimal nao tem representacao JSON nativa), entao o mesmo objeto que veio do GET e
  // reenviado sem edicao no PUT chega aqui como string, nao number. Number(valor) aceita
  // os dois casos sem exigir que o frontend normalize antes.
  const curvaBLimitePercent = Number(input.curvaBLimitePercent);
  const curvaCLimitePercent = Number(input.curvaCLimitePercent);
  const limites = [
    ['curvaALimitePercent', input.curvaALimitePercent],
    ['curvaBLimitePercent', curvaBLimitePercent],
    ['curvaCLimitePercent', curvaCLimitePercent],
  ] as const;
  for (const [nome, valor] of limites) {
    if (!Number.isFinite(valor) || valor <= 0 || valor >= 100) {
      throw new Error(`${nome} precisa ser um numero entre 0 e 100`);
    }
  }
  if (!(input.curvaALimitePercent < curvaBLimitePercent && curvaBLimitePercent < curvaCLimitePercent)) {
    throw new Error('Os limites precisam estar em ordem crescente: A < B < C');
  }

  const dados = {
    giroDias: input.giroDias,
    curvaALimitePercent: input.curvaALimitePercent,
    curvaBLimitePercent,
    curvaCLimitePercent,
  };

  return prisma.pcpCurvaAbcConfig.upsert({
    where: { relatorio: input.relatorio },
    create: { relatorio: input.relatorio, ...dados, createdById: userId },
    update: dados,
  });
}

export interface UpdateEstoqueSemGiroConfigInput {
  relatorio: string;
  maturacaoDias: number;
  coberturaLimiteVerde: number;
  coberturaLimiteVermelho: number;
}

// Configuracoes do relatorio Estoque Sem Giro (periodo de maturacao e limiares de cobertura)
export async function getEstoqueSemGiroConfig(relatorio: string) {
  return prisma.pcpRelatorioConfig.upsert({
    where: { relatorio },
    create: { relatorio },
    update: {},
  });
}

export async function updateEstoqueSemGiroConfig(input: UpdateEstoqueSemGiroConfigInput, userId?: number) {
  if (!Number.isInteger(input.maturacaoDias) || input.maturacaoDias < 0) {
    throw new Error('maturacaoDias precisa ser um numero inteiro nao-negativo');
  }
  if (typeof input.coberturaLimiteVerde !== 'number' || input.coberturaLimiteVerde < 0) {
    throw new Error('coberturaLimiteVerde precisa ser um numero nao-negativo');
  }
  if (typeof input.coberturaLimiteVermelho !== 'number' || input.coberturaLimiteVermelho < 0) {
    throw new Error('coberturaLimiteVermelho precisa ser um numero nao-negativo');
  }

  const dados = {
    maturacaoDias: input.maturacaoDias,
    coberturaLimiteVerde: input.coberturaLimiteVerde,
    coberturaLimiteVermelho: input.coberturaLimiteVermelho,
  };

  return prisma.pcpRelatorioConfig.upsert({
    where: { relatorio: input.relatorio },
    create: { relatorio: input.relatorio, ...dados, createdById: userId },
    update: dados,
  });
}
