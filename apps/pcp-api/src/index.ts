import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { prisma } from './config/database.js';
import { authMiddleware, moduleAccess } from './middleware/auth.middleware.js';
import estoqueRoutes from './routes/estoque.routes.js';

const app = express();
const PORT = process.env.PORT || process.env.PCP_API_PORT || 3002;

app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN } : undefined));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'pcp-api', status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/pcp', authMiddleware, moduleAccess('pcp_servico'), estoqueRoutes);

async function start() {
  try {
    await prisma.$connect();
    console.log('PCP API conectada ao PostgreSQL');
    app.listen(PORT, () => {
      console.log(`PCP API: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Erro ao iniciar PCP API:', error);
    process.exit(1);
  }
}

start();
