// GraphQL Context

import { prisma, type PrismaClient } from '@ottochain/shared';

export interface Context {
  prisma: PrismaClient;
  // Future: add auth info, request metadata, etc.
}

export async function createContext(): Promise<Context> {
  return {
    prisma,
  };
}
