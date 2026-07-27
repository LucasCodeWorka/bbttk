import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { prisma } from './config/database.js';

// Routes
import vendasRoutes from './routes/vendas.routes.js';
import authRoutes from './routes/auth.routes.js';
import metasRoutes from './routes/metas.routes.js';
import entregasRoutes from './routes/entregas.routes.js';
import produtosRoutes from './routes/produtos.routes.js';
import agrupamentosRoutes from './routes/agrupamentos.routes.js';
import pcpConfigRoutes from './routes/pcpConfig.routes.js';

const app = express();
// Render (e outras plataformas de hospedagem) definem PORT automaticamente;
// API_PORT fica como fallback pra uso local.
const PORT = process.env.PORT || process.env.API_PORT || 3001;

// Middlewares
// CORS_ORIGIN opcional: restringe a origem permitida em producao (ex: https://meuapp.onrender.com).
// Sem essa variavel, mantem o comportamento atual (aberto).
app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN } : undefined));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api', vendasRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', metasRoutes);
app.use('/api', entregasRoutes);
app.use('/api', produtosRoutes);
app.use('/api', agrupamentosRoutes);
app.use('/api', pcpConfigRoutes);

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// Start server
async function start() {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('Conectado ao PostgreSQL');

    app.listen(PORT, () => {
      console.log('='.repeat(50));
      console.log('DASHBOARD VENDAS - BEBETENKITE');
      console.log('='.repeat(50));
      console.log(`API Node.js: http://localhost:${PORT}`);
      console.log('='.repeat(50));
    });
  } catch (error) {
    console.error('Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

start();
