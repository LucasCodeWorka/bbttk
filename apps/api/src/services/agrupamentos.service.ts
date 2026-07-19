import { prisma } from '../config/database.js';
import { colorMatchKeyOf } from './produtos.service.js';

export interface CreateGrupoInput {
  tipo: string;
  nome: string;
  createdById?: number;
  membros: Array<{
    referenceCode: string;
    colorCode: string | null;
    colorName: string | null;
  }>;
}

export async function createGrupo(data: CreateGrupoInput) {
  if (!data.nome || !data.nome.trim()) {
    throw new Error('Informe o nome do agrupamento');
  }
  if (data.membros.length === 0) {
    throw new Error('Informe ao menos um membro para o agrupamento');
  }

  return prisma.$transaction(async (tx) => {
    const nomeExistente = await tx.agrupamentoGrupo.findUnique({
      where: { tipo_nome: { tipo: data.tipo, nome: data.nome.trim() } },
    });
    if (nomeExistente) {
      throw new Error(`Ja existe um agrupamento chamado "${data.nome.trim()}". Escolha outro nome.`);
    }

    // Verifica conflitos: referencia+cor ja usada em outro grupo do mesmo tipo
    const matchKeys = data.membros.map(m => colorMatchKeyOf(m.colorCode, m.colorName));

    const conflitos = await tx.agrupamentoMembro.findMany({
      where: {
        tipo: data.tipo,
        OR: data.membros.map((m, i) => ({
          referenceCode: m.referenceCode,
          colorMatchKey: matchKeys[i],
        })),
      },
    });

    if (conflitos.length > 0) {
      throw new Error(
        `Ja existem ${conflitos.length} combinacao(oes) referencia+cor em outro agrupamento. Atualize a tela e tente novamente.`
      );
    }

    const grupo = await tx.agrupamentoGrupo.create({
      data: {
        tipo: data.tipo,
        nome: data.nome.trim(),
        createdById: data.createdById,
      },
    });

    await tx.agrupamentoMembro.createMany({
      data: data.membros.map((m, i) => ({
        grupoId: grupo.id,
        tipo: data.tipo,
        referenceCode: m.referenceCode,
        colorCode: m.colorCode,
        colorName: m.colorName,
        colorMatchKey: matchKeys[i],
      })),
    });

    return tx.agrupamentoGrupo.findUniqueOrThrow({
      where: { id: grupo.id },
      include: { membros: true },
    });
  });
}

export async function updateGrupoNome(id: number, nome: string) {
  if (!nome || !nome.trim()) {
    throw new Error('Informe o nome do agrupamento');
  }
  const nomeTrimmed = nome.trim();

  const grupoAtual = await prisma.agrupamentoGrupo.findUniqueOrThrow({ where: { id } });

  const nomeExistente = await prisma.agrupamentoGrupo.findUnique({
    where: { tipo_nome: { tipo: grupoAtual.tipo, nome: nomeTrimmed } },
  });
  if (nomeExistente && nomeExistente.id !== id) {
    throw new Error(`Ja existe um agrupamento chamado "${nomeTrimmed}". Escolha outro nome.`);
  }

  return prisma.agrupamentoGrupo.update({ where: { id }, data: { nome: nomeTrimmed } });
}

export async function addMembros(grupoId: number, membros: CreateGrupoInput['membros']) {
  if (membros.length === 0) {
    throw new Error('Informe ao menos uma cor para adicionar');
  }

  return prisma.$transaction(async (tx) => {
    const grupo = await tx.agrupamentoGrupo.findUniqueOrThrow({ where: { id: grupoId } });
    const matchKeys = membros.map(m => colorMatchKeyOf(m.colorCode, m.colorName));

    const conflitos = await tx.agrupamentoMembro.findMany({
      where: {
        tipo: grupo.tipo,
        OR: membros.map((m, i) => ({
          referenceCode: m.referenceCode,
          colorMatchKey: matchKeys[i],
        })),
      },
    });

    if (conflitos.length > 0) {
      throw new Error(
        `Ja existem ${conflitos.length} combinacao(oes) referencia+cor em outro agrupamento. Atualize a tela e tente novamente.`
      );
    }

    await tx.agrupamentoMembro.createMany({
      data: membros.map((m, i) => ({
        grupoId,
        tipo: grupo.tipo,
        referenceCode: m.referenceCode,
        colorCode: m.colorCode,
        colorName: m.colorName,
        colorMatchKey: matchKeys[i],
      })),
    });

    return tx.agrupamentoGrupo.findUniqueOrThrow({
      where: { id: grupoId },
      include: { membros: true },
    });
  });
}

export async function getGrupos(tipo: string) {
  return prisma.agrupamentoGrupo.findMany({
    where: { tipo },
    include: { membros: true, createdBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function deleteGrupo(id: number) {
  return prisma.agrupamentoGrupo.delete({ where: { id } });
}

export async function deleteMembro(id: number) {
  return prisma.agrupamentoMembro.delete({ where: { id } });
}
