// src/server/config/server-environment.ts
// Reads and validates server-side environment variables once, with Zod, so a misconfigured
// deployment fails fast with a clear message instead of misbehaving at runtime.
// Every variable here is documented in .env.example and README.md §6.

import { z } from "zod";

const serverEnvironmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  /** SRS-AUTH-04: sessions end after this many hours without activity (OI-06 proposes 16). */
  SESSION_IDLE_TIMEOUT_HOURS: z.coerce.number().positive().max(168).default(16),
  /** Public origin of the app, used by the same-origin check on mutating requests. */
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** "true" forces the Secure cookie flag; defaults to on in production (SRS-AUTH-04). */
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Root folder for uploaded files (logos, pairing workbooks); must be persistent and backed up. */
  UPLOAD_DIRECTORY: z.string().min(1).default("./storage/uploads"),
});

/** Validated server environment. */
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

let cachedServerEnvironment: ServerEnvironment | undefined;

/**
 * Returns the validated server environment, parsing process.env on first use.
 *
 * @returns The validated environment values with defaults applied.
 * @throws Error listing every invalid or missing variable.
 */
export function getServerEnvironment(): ServerEnvironment {
  if (cachedServerEnvironment) {
    return cachedServerEnvironment;
  }
  const parseResult = serverEnvironmentSchema.safeParse(process.env);
  if (!parseResult.success) {
    const problems = parseResult.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server environment — ${problems}`);
  }
  cachedServerEnvironment = parseResult.data;
  return cachedServerEnvironment;
}

/**
 * Whether the session cookie must carry the Secure flag.
 * Browsers drop Secure cookies on plain-http localhost, so it is off in development unless forced.
 *
 * @returns true in production or when SESSION_COOKIE_SECURE=true.
 */
export function isSessionCookieSecure(): boolean {
  const environment = getServerEnvironment();
  if (environment.SESSION_COOKIE_SECURE !== undefined) {
    return environment.SESSION_COOKIE_SECURE === "true";
  }
  return environment.NODE_ENV === "production";
}
