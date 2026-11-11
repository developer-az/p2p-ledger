// Keep THEME_KEY and the theme-color values in sync with src/web/app/theme.ts.
try {
  const theme = localStorage.getItem('settle-theme');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute('content', theme === 'light' ? '#fafaf9' : '#0f1012');
    });
  }
} catch {
  // Keep the system theme when storage is unavailable.
}
