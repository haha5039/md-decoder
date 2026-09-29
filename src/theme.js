import { t } from './i18n.js';

const STORAGE_KEY = 'md-decoder-theme';

function readTheme() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* Storage is optional. */ }
  return 'dark';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* Storage is optional. */ }
  const button = document.getElementById('themeToggle');
  if (!button) return;
  const switchingToLight = theme === 'dark';
  button.querySelector('[data-theme-icon]').textContent = switchingToLight ? '☀️' : '🌙';
  button.querySelector('[data-theme-label]').textContent = t(switchingToLight ? 'theme.light' : 'theme.dark');
  button.setAttribute('aria-label', t(switchingToLight ? 'theme.switchToLight' : 'theme.switchToDark'));
  button.setAttribute('title', button.getAttribute('aria-label'));
}

export function initializeTheme() {
  let theme = readTheme();
  applyTheme(theme);
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
  });
}
