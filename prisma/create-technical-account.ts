// prisma/create-technical-account.ts
// `pnpm admin:create` — creates the first technical-arbiter (TD) account on a fresh deployment, since there is no
// public signup (SRS-AUTH-02). Reads ADMIN_USERNAME and ADMIN_PASSWORD from the environment so nothing is typed
// into shell history as an argument, applies the same rules as the account page, and never overwrites an
// existing account.
//   docker compose -f docker-compose.prod.yml run --rm -e ADMIN_USERNAME=td -e ADMIN_PASSWORD='…' tools pnpm admin:create

import { PrismaClient } from "@prisma/client";
import { createUserInputSchema } from "../src/server/auth/account-input-schemas";
import { hashPassword } from "../src/server/auth/password-hasher";

/**
 * Validates the environment input and creates the account.
 *
 * @throws Error when input is invalid or the username already exists.
 */
async function createTechnicalAccount(): Promise<void> {
  const parseResult = createUserInputSchema.safeParse({
    username: process.env.ADMIN_USERNAME ?? "",
    password: process.env.ADMIN_PASSWORD ?? "",
    role: "TECHNICAL",
  });
  if (!parseResult.success) {
    const problems = parseResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Set ADMIN_USERNAME and ADMIN_PASSWORD correctly — ${problems}`);
  }
  const prisma = new PrismaClient();
  try {
    const existingUser = await prisma.user.findUnique({ where: { username: parseResult.data.username } });
    if (existingUser) {
      throw new Error(`Account "${parseResult.data.username}" already exists; reset its password from /admin/users instead.`);
    }
    await prisma.user.create({
      data: { username: parseResult.data.username, passwordHash: await hashPassword(parseResult.data.password), role: "TECHNICAL" },
    });
    console.warn(`Created TECHNICAL account "${parseResult.data.username}".`);
  } finally {
    await prisma.$disconnect();
  }
}

createTechnicalAccount().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
