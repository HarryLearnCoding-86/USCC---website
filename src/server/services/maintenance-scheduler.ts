// src/server/services/maintenance-scheduler.ts
// Schedules runMaintenance hourly in the Node.js server process (started from src/instrumentation.ts).
// Skipped during `next build`, which also loads instrumentation. Failures are reported, never thrown, so a
// maintenance problem cannot take the server down.

import { reportServerError } from "@/server/observability/server-logger";
import { runMaintenance } from "@/server/services/maintenance-service";

/** One hour between maintenance runs. */
const MAINTENANCE_INTERVAL_MILLISECONDS = 60 * 60 * 1000;
/** Let the server finish starting before the first run. */
const FIRST_MAINTENANCE_DELAY_MILLISECONDS = 60 * 1000;

let isSchedulerStarted = false;

/**
 * Starts the hourly maintenance timer once per process.
 */
export function startMaintenanceScheduler(): void {
  if (isSchedulerStarted || process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  isSchedulerStarted = true;
  const runMaintenanceSafely = () => {
    runMaintenance().catch((error: unknown) => reportServerError(error, { job: "maintenance" }));
  };
  setTimeout(runMaintenanceSafely, FIRST_MAINTENANCE_DELAY_MILLISECONDS).unref();
  setInterval(runMaintenanceSafely, MAINTENANCE_INTERVAL_MILLISECONDS).unref();
}
