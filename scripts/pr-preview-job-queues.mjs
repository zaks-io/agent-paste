/** PR-scoped Cloudflare Queue names for per-PR jobs worker preview deploys. */
export function prPreviewJobQueues(prNumber) {
  const suffix = `-preview-pr-${prNumber}`;
  const bytePurgeDlq = `byte-purge-dlq${suffix}`;
  const safetyScanDlq = `safety-scan-dlq${suffix}`;
  const bundleGenerateDlq = `bundle-generate-dlq${suffix}`;
  const bytePurge = `byte-purge${suffix}`;
  const safetyScan = `safety-scan${suffix}`;
  const bundleGenerate = `bundle-generate${suffix}`;

  return {
    bytePurge,
    bytePurgeDlq,
    safetyScan,
    safetyScanDlq,
    bundleGenerate,
    bundleGenerateDlq,
    // DLQs must exist before consumers reference them.
    creationOrder: [bytePurgeDlq, safetyScanDlq, bundleGenerateDlq, bytePurge, safetyScan, bundleGenerate],
    // Detach consumers before deleting the jobs Worker; Cloudflare rejects
    // Worker deletion while it is attached to Queues.
    consumerDetachOrder: [bytePurge, safetyScan, bundleGenerate, bundleGenerateDlq],
    deletionOrder: [bytePurge, safetyScan, bundleGenerate, bytePurgeDlq, safetyScanDlq, bundleGenerateDlq],
  };
}
