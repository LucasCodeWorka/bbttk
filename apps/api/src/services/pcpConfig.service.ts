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

// Limiares da Curva ABC por representatividade acumulada do valor vendido.
// Curva C vai ate 100% (nao existe mais curva D).
export async function getCurvaAbcConfig(relatorio: string) {
  const config = await prisma.pcpCurvaAbcConfig.upsert({
    where: { relatorio },
    create: { relatorio },
    update: {},
  });
  const a = Number(config.curvaALimitePercent);
  const b = Number(config.curvaBLimitePercent);
  const c = Number(config.curvaCLimitePercent);
  // Valida que os limites estao em ordem crescente e C vai ate 100
  if (!(a > 0 && a < b && b < c && c <= 100)) {
    return prisma.pcpCurvaAbcConfig.update({
      where: { relatorio },
      data: { curvaALimitePercent: 80, curvaBLimitePercent: 95, curvaCLimitePercent: 100 },
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
  // Curva C sempre vai ate 100% (nao existe mais curva D)
  const curvaCLimitePercent = 100;

  if (!Number.isFinite(input.curvaALimitePercent) || input.curvaALimitePercent <= 0 || input.curvaALimitePercent >= 100) {
    throw new Error('curvaALimitePercent precisa ser um numero entre 0 e 100');
  }
  if (!Number.isFinite(curvaBLimitePercent) || curvaBLimitePercent <= 0 || curvaBLimitePercent >= 100) {
    throw new Error('curvaBLimitePercent precisa ser um numero entre 0 e 100');
  }
  if (!(input.curvaALimitePercent < curvaBLimitePercent)) {
    throw new Error('Os limites precisam estar em ordem crescente: A < B');
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

export interface UpdateTransferenciaConfigInput {
  relatorio: string;
  diasAnaliseVendas: number;
  transferenciaCoberturaDiasVerde: number;
  transferenciaCoberturaDiasAmarelo: number;
}

export interface UpdateSugestaoProducaoConfigInput {
  relatorio: string;
  giroDias: number;
  coberturaMeses: number;
  coberturaAlvoMeses: number;
  corteMinimoDefault: number;
}

export interface CorteMinimoSkuItem {
  sku: string;
  corteMinimo: number;
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

// Configuracoes do relatorio de Gestao de Transferencia (periodo de analise de vendas)
export async function getTransferenciaConfig(relatorio: string) {
  return prisma.pcpRelatorioConfig.upsert({
    where: { relatorio },
    create: { relatorio },
    update: {},
  });
}

export async function updateTransferenciaConfig(input: UpdateTransferenciaConfigInput, userId?: number) {
  if (!Number.isInteger(input.diasAnaliseVendas) || input.diasAnaliseVendas <= 0) {
    throw new Error('diasAnaliseVendas precisa ser um numero inteiro positivo');
  }
  if (!Number.isInteger(input.transferenciaCoberturaDiasVerde) || input.transferenciaCoberturaDiasVerde <= 0) {
    throw new Error('transferenciaCoberturaDiasVerde precisa ser um numero inteiro positivo');
  }
  if (!Number.isInteger(input.transferenciaCoberturaDiasAmarelo) || input.transferenciaCoberturaDiasAmarelo <= 0) {
    throw new Error('transferenciaCoberturaDiasAmarelo precisa ser um numero inteiro positivo');
  }

  const dados = {
    diasAnaliseVendas: input.diasAnaliseVendas,
    transferenciaCoberturaDiasVerde: input.transferenciaCoberturaDiasVerde,
    transferenciaCoberturaDiasAmarelo: input.transferenciaCoberturaDiasAmarelo,
  };

  return prisma.pcpRelatorioConfig.upsert({
    where: { relatorio: input.relatorio },
    create: { relatorio: input.relatorio, ...dados, createdById: userId },
    update: dados,
  });
}

// Sugestao de Producao: giroDias = tamanho de cada um dos 2 periodos de venda
// comparados, coberturaMeses = janela da venda media, coberturaAlvoMeses = quantos
// meses de venda media viram estoque minimo alvo, corteMinimoDefault = corte usado
// quando o SKU nao tem override em PcpCorteMinimoSku.
export async function getSugestaoProducaoConfig(relatorio: string) {
  return prisma.pcpRelatorioConfig.upsert({
    where: { relatorio },
    create: { relatorio },
    update: {},
  });
}

export async function updateSugestaoProducaoConfig(input: UpdateSugestaoProducaoConfigInput, userId?: number) {
  if (!Number.isInteger(input.giroDias) || input.giroDias <= 0) {
    throw new Error('giroDias precisa ser um numero inteiro positivo');
  }
  if (!Number.isInteger(input.coberturaMeses) || input.coberturaMeses <= 0) {
    throw new Error('coberturaMeses precisa ser um numero inteiro positivo');
  }
  if (typeof input.coberturaAlvoMeses !== 'number' || input.coberturaAlvoMeses <= 0) {
    throw new Error('coberturaAlvoMeses precisa ser um numero positivo');
  }
  if (typeof input.corteMinimoDefault !== 'number' || input.corteMinimoDefault <= 0) {
    throw new Error('corteMinimoDefault precisa ser um numero positivo');
  }

  const dados = {
    giroDias: input.giroDias,
    coberturaMeses: input.coberturaMeses,
    coberturaAlvoMeses: input.coberturaAlvoMeses,
    corteMinimoDefault: input.corteMinimoDefault,
  };

  return prisma.pcpRelatorioConfig.upsert({
    where: { relatorio: input.relatorio },
    create: { relatorio: input.relatorio, ...dados, createdById: userId },
    update: dados,
  });
}

// Corte minimo por SKU (lista esparsa - so os overrides ja salvos; SKU sem entrada
// aqui usa o corteMinimoDefault da config acima).
export async function getCorteMinimoSkus(relatorio: string) {
  return prisma.pcpCorteMinimoSku.findMany({
    where: { relatorio },
    orderBy: { sku: 'asc' },
  });
}

export async function upsertCorteMinimoSkus(relatorio: string, items: CorteMinimoSkuItem[], userId?: number) {
  for (const item of items) {
    if (!item.sku || !item.sku.trim()) {
      throw new Error('sku invalido em um dos itens');
    }
    if (typeof item.corteMinimo !== 'number' || !(item.corteMinimo > 0)) {
      throw new Error(`corteMinimo precisa ser um numero positivo (sku ${item.sku})`);
    }
  }

  return prisma.$transaction(
    items.map((item) =>
      prisma.pcpCorteMinimoSku.upsert({
        where: { relatorio_sku: { relatorio, sku: item.sku.trim() } },
        create: { relatorio, sku: item.sku.trim(), corteMinimo: item.corteMinimo, createdById: userId },
        update: { corteMinimo: item.corteMinimo },
      })
    )
  );
}

export async function deleteCorteMinimoSku(relatorio: string, sku: string) {
  await prisma.pcpCorteMinimoSku.deleteMany({ where: { relatorio, sku } });
}

// Parser do CSV de upload (SKU;VALOR ou SKU,VALOR - uma linha por SKU, sem cabecalho
// obrigatorio; linha cujo primeiro campo bater com "sku"/"produto" e maiusc/minusc e
// tratada como cabecalho e ignorada). Mesmo estilo de parsing manual (sem lib) usado em
// produtosService.matchColorsFromCsv - nao ha nenhuma lib de CSV no projeto.
export function parseCorteMinimoCsv(conteudo: string): { items: CorteMinimoSkuItem[]; linhasInvalidas: number } {
  const linhas = conteudo
    .split(/\r?\n/)
    .map((l) => l.replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);

  const items: CorteMinimoSkuItem[] = [];
  let linhasInvalidas = 0;

  for (const linha of linhas) {
    const partes = linha.split(/[;,\t]/).map((p) => p.trim());
    if (partes.length < 2) {
      linhasInvalidas++;
      continue;
    }
    const [skuRaw, valorRaw] = partes;
    if (/^(sku|produto|product_sku)$/i.test(skuRaw)) continue; // cabecalho, ignora

    const valor = Number(valorRaw.replace(',', '.'));
    if (!skuRaw || !Number.isFinite(valor) || valor <= 0) {
      linhasInvalidas++;
      continue;
    }
    items.push({ sku: skuRaw, corteMinimo: valor });
  }

  return { items, linhasInvalidas };
}
