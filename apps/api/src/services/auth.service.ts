import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'bebetenkite-secret';
const JWT_EXPIRATION = '24h';

interface TokenPayload {
  userId: number;
  email: string;
  role: string;
  branchCodes: number[];
  moduleAccess: string[];
}

export async function createUser(
  email: string,
  password: string,
  name: string,
  role: string,
  branchCodes: number[] = [],
  sellerCode?: number,
  moduleAccess: string[] = []
) {
  const passwordHash = await bcrypt.hash(password, 10);

  return prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      role,
      branchCodes,
      sellerCode,
      moduleAccess,
    },
  });
}

export async function authenticateUser(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || !user.isActive) {
    return null;
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  const token = generateToken(user);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      branchCodes: user.branchCodes,
      sellerCode: user.sellerCode,
      moduleAccess: user.moduleAccess,
    },
  };
}

export function generateToken(user: {
  id: number;
  email: string;
  role: string;
  branchCodes: number[];
  moduleAccess: string[];
}): string {
  const payload: TokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    branchCodes: user.branchCodes,
    moduleAccess: user.moduleAccess,
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRATION });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export async function getUserById(id: number) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      branchCodes: true,
      sellerCode: true,
      isActive: true,
      moduleAccess: true,
    },
  });
}

export async function getAllUsers() {
  return prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      branchCodes: true,
      sellerCode: true,
      isActive: true,
      createdAt: true,
      moduleAccess: true,
    },
    orderBy: { name: 'asc' },
  });
}

export async function updateUser(
  id: number,
  data: {
    name?: string;
    role?: string;
    branchCodes?: number[];
    sellerCode?: number | null;
    isActive?: boolean;
    password?: string;
    moduleAccess?: string[];
  }
) {
  const updateData: Record<string, unknown> = { ...data };

  if (data.password) {
    updateData.passwordHash = await bcrypt.hash(data.password, 10);
    delete updateData.password;
  }

  return prisma.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      branchCodes: true,
      sellerCode: true,
      isActive: true,
      moduleAccess: true,
    },
  });
}

export async function deleteUser(id: number) {
  return prisma.user.delete({
    where: { id },
  });
}
