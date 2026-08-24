const origin = serviceOrigin(process.env.LOCUS_SYNC_URL);
const ready = await request("/ready");
if (ready.response.status !== 200 || ready.body?.ok !== true || ready.body?.database !== "ready" || ready.body?.objectStorage !== "ready") {
  throw new Error(`Sync readiness failed with HTTP ${ready.response.status}`);
}
for (const header of ["strict-transport-security", "x-content-type-options", "x-request-id"]) {
  if (!ready.response.headers.get(header)) throw new Error(`Sync readiness is missing ${header}`);
}

const unauthenticated = await request("/v1/sync/pull");
if (unauthenticated.response.status !== 401 || unauthenticated.body?.error !== "Device authentication required") {
  throw new Error("Sync authentication boundary is not enforcing device tokens");
}

process.stdout.write(`Sync deployment is ready at ${origin}.\n`);

async function request(path) {
  const response = await fetch(`${origin}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => undefined);
  return { response, body };
}

function serviceOrigin(raw) {
  const url = new URL(raw ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("LOCUS_SYNC_URL must be a credential-free HTTPS origin");
  }
  return url.origin;
}
