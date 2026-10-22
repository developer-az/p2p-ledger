/** Bundled photos (sourced from Unsplash, stored under `public/media/` — no runtime CDN dependency). */
export const MEDIA = {
  coins: '/media/coins.jpg',
  coffee: '/media/coffee.jpg',
  desk: '/media/desk.jpg',
  charts: '/media/charts.jpg',
  fallback: '/media/fallback.svg',
} as const;

/** Free Lottie JSON (LottieFiles CDN). Falls back silently if blocked offline. */
export const LOTTIE = {
  savings: 'https://assets10.lottiefiles.com/packages/lf20_w51pvg12.json',
} as const;

export const PHOTO = {
  welcomeScene: MEDIA.coins,
  welcomeAmbient: MEDIA.desk,
  featureBaseline: MEDIA.coins,
  featureLog: MEDIA.coffee,
  featurePatterns: MEDIA.charts,
  setupHero: MEDIA.desk,
  patternsEmpty: MEDIA.charts,
} as const;

export const DEMO_STEP_PHOTO: Record<'baseline' | 'log' | 'income' | 'patterns' | 'pace', string> = {
  baseline: MEDIA.coins,
  log: MEDIA.coffee,
  income: MEDIA.desk,
  patterns: MEDIA.charts,
  pace: MEDIA.desk,
};
