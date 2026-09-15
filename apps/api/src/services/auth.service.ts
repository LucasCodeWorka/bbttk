import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'bebetenkite-secret';
const JWT_EXPIRATION = '24h';
const configuredUserCacheTtl = Number(process.env.AUTH_USER_CACHE_TTL_MS);
const USER_CACHE_TTL_MS = Number.isFinite(configuredUserCacheTtl) && configuredUserCacheTtl > 0
  ? configuredUserCacheTtl
  : 30_000;

interface TokenPayload {
  userId: number;
  email: string;
  role: string;
  branchCodes: number[];
  moduleAccess: string[];
}

interface CachedUser {
  id: number;
  email: string;
  name: string;
  role: string;
  branchCodes: number[];
  sellerCode: number | null;
  isActive: boolean | null;
  moduleAccess: string[];
}

const userCache = new Map<number, { expiresAt: number; user: CachedUser }>();

function cacheUser(user: CachedUser) {
  userCache.set(user.id, { expiresAt: Date.now() + USER_CACHE_TTL_MS, user });
}

function getCachedUser(id: number): CachedUser | null {
  const cached = userCache.get(id);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    userCache.delete(id);
    return null;
  }
  return cached.user;
}

function clearCachedUser(id: number) {
  userCache.delete(id);
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

  cacheUser({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    branchCodes: user.branchCodes,
    sellerCode: user.sellerCode,
    isActive: user.isActive,
    moduleAccess: user.moduleAccess,
  });

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
  const cached = getCachedUser(id);
  if (cached) return cached;

  const user = await prisma.user.findUnique({
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

  if (user) cacheUser(user);
  return user;
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

  const user = await prisma.user.update({
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

  cacheUser(user);
  return user;
}

export async function deleteUser(id: number) {
  clearCachedUser(id);
  return prisma.user.delete({
    where: { id },
  });
}
