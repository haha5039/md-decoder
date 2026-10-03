import { getLocale, t } from './i18n.js';

export function renderDataStatus(generatedAt) {
  const label = document.getElementById('cardDataDate');
  if (!label) return;
  label.dateTime = generatedAt;
  label.textContent = t('footer.dataVersion', {
    date: new Date(generatedAt).toLocaleDateString(getLocale(), { timeZone: 'UTC' })
  });
}
