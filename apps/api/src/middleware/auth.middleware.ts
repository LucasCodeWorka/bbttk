import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/auth.service.js';

// Estender Request para incluir user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        email: string;
        role: string;
        branchCodes: number[];
        moduleAccess: string[];
      };
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'Token não fornecido' });
    return;
  }

  const [, token] = authHeader.split(' ');

  if (!token) {
    res.status(401).json({ error: 'Token mal formatado' });
    return;
  }

  const payload = verifyToken(token);

  if (!payload) {
    res.status(401).json({ error: 'Token inválido ou expirado' });
    return;
  }

  req.user = payload;
  next();
}

export function adminOnly(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Acesso não autorizado' });
    return;
  }
  next();
}

// Exige que o usuario tenha o modulo liberado (admin sempre tem acesso a tudo).
// Usar depois de authMiddleware.
export function moduleAccess(moduleKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role === 'admin') {
      next();
      return;
    }
    if (!req.user?.moduleAccess?.includes(moduleKey)) {
      res.status(403).json({ error: 'Acesso não autorizado a este modulo' });
      return;
    }
    next();
  };
}

export function branchAccessMiddleware(req: Request, res: Response, next: NextFunction) {
  const branchCode = parseInt(req.params.branchCode || req.query.branch_code as string);

  if (!branchCode) {
    // Se não especificou filial, permite acesso a todas (admin) ou filtra depois
    next();
    return;
  }

  if (req.user?.role === 'admin') {
    // Admin tem acesso a todas as filiais
    next();
    return;
  }

  if (req.user?.branchCodes.includes(branchCode)) {
    // Usuário tem acesso a esta filial
    next();
    return;
  }

  res.status(403).json({ error: 'Acesso não autorizado a esta filial' });
}
