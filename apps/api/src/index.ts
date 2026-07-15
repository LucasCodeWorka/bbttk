import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { prisma } from './config/database.js';

// Routes
import vendasRoutes from './routes/vendas.routes.js';
import authRoutes from './routes/auth.routes.js';
import metasRoutes from './routes/metas.routes.js';

const app = express();
const PORT = process.env.API_PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api', vendasRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', metasRoutes);

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
