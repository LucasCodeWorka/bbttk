import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE pcp_relatorio_configs ADD COLUMN IF NOT EXISTS risco_cobertura_meses numeric(6,2) NOT NULL DEFAULT 1'
  );
  console.log('risco_cobertura_meses ok');
} finally {
  await prisma.$disconnect();
}
