// Keep THEME_KEY and the theme-color values in sync with src/web/app/theme.ts,
// and DENSITY_KEY in src/web/app/density.ts.
try {
  const theme = localStorage.getItem('settle-theme');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute('content', theme === 'light' ? '#fafaf9' : '#0f1012');
    });
  }

  const density = localStorage.getItem('settle-density');
  if (density === 'compact' || density === 'comfortable') {
    document.documentElement.dataset.density = density;
  }
} catch {
  // Keep the system theme when storage is unavailable.
}
