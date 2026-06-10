/** Upload Cleanup sweep cap per docs/specs/jobs.md */
export const UPLOAD_CLEANUP_SWEEP_CAP = 200;
/** Auto Deletion sweep cap per docs/specs/jobs.md */
export const AUTO_DELETION_SWEEP_CAP = 200;
/** Retention sweep cap per docs/specs/jobs.md */
export const RETENTION_SWEEP_CAP = 500;
/** Maintenance GC idempotency row cap per docs/specs/jobs.md */
export const MAINTENANCE_GC_SWEEP_CAP = 5000;
/** Workspace content blob GC sweep cap. */
export const CONTENT_BLOB_GC_SWEEP_CAP = 500;

/** Platform audit retention for maintenance GC (days). */
export const AUDIT_RETENTION_DAYS = 90;
/** Completed idempotency row retention for maintenance GC (days). */
export const IDEMPOTENCY_RETENTION_DAYS = 30;

export const CRON_UPLOAD_CLEANUP = "*/15 * * * *";
export const CRON_HOURLY_DISCOVERY = "0 * * * *";
/** Daily Stripe billing reconciliation (ADR 0074). */
export const CRON_BILLING_RECONCILE = "0 6 * * *";

export const QUEUE_BYTE_PURGE = "byte-purge";
export const QUEUE_SAFETY_SCAN = "safety-scan";
export const QUEUE_BUNDLE_GENERATE = "bundle-generate";
export const QUEUE_BUNDLE_GENERATE_DLQ = "bundle-generate-dlq";
