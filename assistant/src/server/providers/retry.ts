/** Milliseconds to wait so calls stay under a requests-per-minute cap. */
export function paceDelayMs(lastCallAt: number, now: number, minIntervalMs: number): number {
  if (minIntervalMs <= 0 || lastCallAt <= 0) return 0;
  return Math.max(0, lastCallAt + minIntervalMs - now);
}

export function geminiMinIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.GEMINI_MIN_INTERVAL_MS ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** How long Gemini asked us to wait, including "21h57m43s" and retryDelay seconds. */
export function suggestedRetryMs(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const human = /retry in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/.exec(message);
  if (human) {
    const hours = Number(human[1] ?? 0);
    const minutes = Number(human[2] ?? 0);
    const seconds = Number(human[3] ?? 0);
    return ((hours * 60 + minutes) * 60 + seconds) * 1000;
  }
  const json = /retryDelay"\s*:\s*"([\d.]+)s/.exec(message);
  return json ? Number(json[1]) * 1000 : undefined;
}

/**
 * The free daily cap tells us to wait for hours. Sleeping 60s and calling again
 * cannot succeed, and doing it for every question keeps CI busy for most of an hour.
 */
export function isLongQuotaWait(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/GenerateRequestsPerDay|per day/i.test(message)) return true;
  const wait = suggestedRetryMs(error);
  return wait !== undefined && wait > 120_000;
}

/** How long to wait before retrying a rate-limited or unavailable model call. */
export function retryDelayMs(error: unknown, attempt: number, capMs = 60_000): number {
  const suggestedMs = suggestedRetryMs(error) ?? 0;
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
  if (status === 429 || (status !== undefined && status >= 500) || isNetworkError(error)) return true;
  return /RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|high demand|Deadline expired/i.test(message);
}

/**
 * OpenRouter returns 404 when no endpoint matches the guardrail / data policy, and Google returns
 * NOT_FOUND for a retired model id. Neither is transient: another model is the only way forward.
 */
const MODEL_MISSING_PATTERN =
  /no endpoints|endpoints out of|guardrail|data policy|model not found|is not found|not supported for generateContent|NOT_FOUND/i;

export function isModelMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if ((error as { status?: number }).status === 404) return true;
  return MODEL_MISSING_PATTERN.test(message);
}

/**
 * A guardrail / data-policy rejection applies to the whole OpenRouter account,
 * not to one slug, so walking candidates cannot help: every model has the same
 * block. Distinct from a plain 404 (retired slug), which does move on.
 */
const POLICY_BLOCKED_PATTERN = /guardrail|data policy|endpoints out of|no endpoints/i;

export function isPolicyBlocked(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return POLICY_BLOCKED_PATTERN.test(message);
}

/** Stop using this provider/model entirely: either it is overloaded or the model no longer resolves. */
export function isProviderUnavailable(error: unknown): boolean {
  return isModelOutage(error) || isModelMissing(error);
}
