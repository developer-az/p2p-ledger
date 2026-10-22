/** Stable Unsplash photo IDs — no API key; `images.unsplash.com` CDN. */
function unsplash(photoId: string, width = 900): string {
  return `https://images.unsplash.com/photo-${photoId}?auto=format&fit=crop&w=${width}&q=80`;
}

/** Free Lottie JSON (LottieFiles CDN). */
export const LOTTIE = {
  /** Soft coin / savings loop for marketing surfaces */
  savings: 'https://assets10.lottiefiles.com/packages/lf20_w51pvg12.json',
} as const;

export const PHOTO = {
  welcomeScene: unsplash('1554224155-8d04cb05cd39', 1400),
  welcomeAmbient: unsplash('1611974789855-9417425534cd', 1200),
  featureBaseline: unsplash('1579621970563-ebec7560ff3e', 600),
  featureLog: unsplash('1495474472287-4d71bcdd2085', 600),
  featurePatterns: unsplash('1506784365847-bbad939e9332', 600),
  setupHero: unsplash('1579621970790-0462d9cc0d45', 1000),
  patternsEmpty: unsplash('1553729459-efe14ef7245f', 800),
} as const;

export const DEMO_STEP_PHOTO: Record<'baseline' | 'log' | 'income' | 'patterns' | 'pace', string> = {
  baseline: unsplash('1579621970563-ebec7560ff3e', 480),
  log: unsplash('1495474472287-4d71bcdd2085', 480),
  income: unsplash('1454165804606-c3d57bc86b40', 480),
  patterns: unsplash('1506784365847-bbad939e9332', 480),
  pace: unsplash('1434030216411-0b7930884a85', 480),
};
