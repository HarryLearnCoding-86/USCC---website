// src/server/database/database-client.ts
// The client type that services accept, so one function works both standalone (with the shared
// PrismaClient) and inside a caller's transaction (one transaction per use case, CLAUDE.md §3).

import type { Prisma } from "@prisma/client";

/** Either the shared PrismaClient or an interactive-transaction client. */
export type DatabaseClient = Prisma.TransactionClient;
