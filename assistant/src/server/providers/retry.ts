/** Milliseconds to wait so calls stay under a requests-per-minute cap. */
export function paceDelayMs(lastCallAt: number, now: number, minIntervalMs: number): number {
  if (minIntervalMs <= 0 || lastCallAt <= 0) return 0;
  return Math.max(0, lastCallAt + minIntervalMs - now);
}

export function geminiMinIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.GEMINI_MIN_INTERVAL_MS ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

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

function statusFromMessage(message: string): number | undefined {
  const match = /"code"\s*:\s*(429|5\d\d)/.exec(message);
  return match ? Number(match[1]) : undefined;
}

/** 429, 5xx, and transport failures are worth retrying. Anything else is a real request error. */
export function retryableStatus(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : '';
  const status = (error as { status?: number }).status ?? statusFromMessage(message);
  if (status === 429 || (status ?? 0) >= 500) return status;
  if (isNetworkError(error)) return 503;
  return undefined;
}

/** Gemini was overloaded or missed its deadline. That is not a wrong answer. */
export function isModelOutage(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status = retryableStatus(error);
  if (status === 429 || status === 503 || status === 504) return true;
  return /RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|high demand|Deadline expired/i.test(message);
}
