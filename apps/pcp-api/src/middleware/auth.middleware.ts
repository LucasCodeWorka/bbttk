import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'bebetenkite-secret';

interface TokenPayload {
  userId: number;
  email: string;
  role: string;
  branchCodes: number[];
  moduleAccess: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'Token nao fornecido' });
    return;
  }

  const [, token] = authHeader.split(' ');

  if (!token) {
    res.status(401).json({ error: 'Token mal formatado' });
    return;
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET) as TokenPayload;
    next();
  } catch {
    res.status(401).json({ error: 'Token invalido ou expirado' });
  }
}

export function moduleAccess(moduleKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role === 'admin') {
      next();
      return;
    }

    if (!req.user?.moduleAccess?.includes(moduleKey)) {
      res.status(403).json({ error: 'Acesso nao autorizado a este modulo' });
      return;
    }

    next();
  };
}
