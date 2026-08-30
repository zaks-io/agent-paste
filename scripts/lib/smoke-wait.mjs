export async function waitForStatus(url, expectedStatus, label, { timeoutMs = 30_000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    const response = await fetch(url, { cache: "no-store", redirect: "manual" });
    lastStatus = response.status;
    if (response.status === expectedStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label} returned ${lastStatus}, expected ${expectedStatus}`);
}
