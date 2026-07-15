import { Router, Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import { authMiddleware, adminOnly } from '../middleware/auth.middleware.js';

const router = Router();

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email e senha são obrigatórios' });
      return;
    }

    const result = await authService.authenticateUser(email, password);

    if (!result) {
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Verificar token / Obter usuário atual
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = await authService.getUserById(req.user!.userId);

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Listar usuários (admin only)
router.get('/users', authMiddleware, adminOnly, async (_req: Request, res: Response) => {
  try {
    const users = await authService.getAllUsers();
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Criar usuário (admin only)
router.post('/users', authMiddleware, adminOnly, async (req: Request, res: Response) => {
  try {
    const { email, password, name, role, branchCodes, sellerCode } = req.body;

    if (!email || !password || !name || !role) {
      res.status(400).json({ error: 'Campos obrigatórios: email, password, name, role' });
      return;
    }

    const user = await authService.createUser(
      email,
      password,
      name,
      role,
      branchCodes || [],
      sellerCode
    );

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        branchCodes: user.branchCodes,
        sellerCode: user.sellerCode,
      },
    });
  } catch (error) {
    if (String(error).includes('Unique constraint')) {
      res.status(400).json({ error: 'Email já cadastrado' });
      return;
    }
    res.status(500).json({ error: String(error) });
  }
});

// Atualizar usuário (admin only)
router.put('/users/:id', authMiddleware, adminOnly, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { name, role, branchCodes, sellerCode, isActive, password } = req.body;

    const user = await authService.updateUser(id, {
      name,
      role,
      branchCodes,
      sellerCode,
      isActive,
      password,
    });

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Deletar usuário (admin only)
router.delete('/users/:id', authMiddleware, adminOnly, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await authService.deleteUser(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
