// src/instrumentation.ts
// Next.js startup hook. In the Node.js server runtime it starts the hourly maintenance job (expired sessions,
// idempotency records, old login attempts). The import sits inside a literal NEXT_RUNTIME check so the Edge build
// drops it entirely; the Node-only code (node:crypto, Prisma) never reaches the Edge bundle.

/**
 * Called once when the server starts.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startMaintenanceScheduler } = await import("@/server/services/maintenance-scheduler");
    startMaintenanceScheduler();
  }
}
