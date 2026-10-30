// src/server/database/prisma-client.ts
// Single shared PrismaClient for the server process.
// In development, Next.js hot reload re-evaluates modules; caching the client on globalThis
// prevents exhausting PostgreSQL connections with a new pool on every reload.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prismaClient?: PrismaClient };

/** The process-wide Prisma client. Services import this; routes and components never do. */
export const prisma: PrismaClient = globalForPrisma.prismaClient ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaClient = prisma;
}
