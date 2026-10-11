/** How long to wait before retrying a rate-limited or unavailable model call. */
export function retryDelayMs(error: unknown, attempt: number, capMs = 60_000): number {
  const message = error instanceof Error ? error.message : '';
  const match = /retry in ([\d.]+)s|retryDelay"\s*:\s*"([\d.]+)s/.exec(message);
  const suggestedSec = Number(match?.[1] ?? match?.[2] ?? 0);
  const suggestedMs = Number.isFinite(suggestedSec) ? suggestedSec * 1000 : 0;
  const backoffMs = 2 ** attempt * 1000;
  return Math.min(capMs, Math.max(suggestedMs + 1_500, backoffMs));
}

/** Dropped connections and header timeouts have no HTTP status, but they are transient. */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { cause?: { code?: string } }).cause?.code ?? '';
  if (code.startsWith('UND_ERR') || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN' || code === 'ENOTFOUND') {
    return true;
  }
  return error.message === 'fetch failed';
}

/** 429, 5xx, and transport failures are worth retrying. Anything else is a real request error. */
export function retryableStatus(error: unknown): number | undefined {
  const status = (error as { status?: number }).status;
  if (status === 429 || (status ?? 0) >= 500) return status;
  if (isNetworkError(error)) return 503;
  return undefined;
}
