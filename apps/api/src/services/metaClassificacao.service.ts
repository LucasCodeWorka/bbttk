import { prisma } from '../config/database.js';

// Meta de venda mensal por classificacao (categoria/linha/genero/colecao) - usada pela
// tela PCP "Acompanhamento por Linha". Cadastrada direto no modal da propria tela de
// relatorio (apps/pcp-api nao grava, so le pra comparar - cadastro fica aqui, junto do
// resto das telas de config/cadastro do projeto).
const TIPOS_VALIDOS = ['categoria', 'linha', 'genero', 'colecao'];
const CAMPO_POR_TIPO: Record<string, string> = {
  categoria: 'class_categoria',
  linha: 'class_linha',
  genero: 'class_genero',
  colecao: 'class_colecao',
};

export interface MetaClassificacaoItem {
  tipoClassificacao: string;
  valorClassificacao: string;
  metaValor: number;
}

export async function getMetasClassificacao(ano: number, mes: number) {
  return prisma.pcpMetaClassificacao.findMany({
    where: { ano, mes },
    orderBy: [{ tipoClassificacao: 'asc' }, { valorClassificacao: 'asc' }],
  });
}

export async function upsertMetasClassificacao(ano: number, mes: number, items: MetaClassificacaoItem[], userId?: number) {
  for (const item of items) {
    if (!TIPOS_VALIDOS.includes(item.tipoClassificacao)) {
      throw new Error(`tipoClassificacao invalido: ${item.tipoClassificacao}`);
    }
    if (!item.valorClassificacao || !item.valorClassificacao.trim()) {
      throw new Error('valorClassificacao e obrigatorio em todos os itens');
    }
    if (typeof item.metaValor !== 'number' || !(item.metaValor > 0)) {
      throw new Error(`metaValor precisa ser um numero positivo (${item.valorClassificacao})`);
    }
  }

  return prisma.$transaction(
    items.map((item) =>
      prisma.pcpMetaClassificacao.upsert({
        where: {
          ano_mes_tipoClassificacao_valorClassificacao: {
            ano,
            mes,
            tipoClassificacao: item.tipoClassificacao,
            valorClassificacao: item.valorClassificacao,
          },
        },
        create: { ano, mes, tipoClassificacao: item.tipoClassificacao, valorClassificacao: item.valorClassificacao, metaValor: item.metaValor, createdById: userId },
        update: { metaValor: item.metaValor },
      })
    )
  );
}

export async function deleteMetaClassificacao(id: number) {
  await prisma.pcpMetaClassificacao.delete({ where: { id } });
}

// Valores distintos de uma classificacao (pra popular o dropdown do modal de cadastro,
// independente de ter venda ou nao no periodo - diferente da tabela do relatorio, que so
// mostra quem teve venda).
export async function getValoresClassificacao(tipo: string): Promise<string[]> {
  if (!TIPOS_VALIDOS.includes(tipo)) throw new Error(`tipoClassificacao invalido: ${tipo}`);
  const campo = CAMPO_POR_TIPO[tipo];
  const rows = await prisma.$queryRawUnsafe<Array<{ valor: string }>>(`
    SELECT DISTINCT TRIM(${campo}) as valor
    FROM produto_analitico
    WHERE ${campo} IS NOT NULL AND TRIM(${campo}) NOT IN ('', '.')
    ORDER BY TRIM(${campo})
  `);
  return rows.map((r) => r.valor);
}
