import { t } from './i18n.js';

const percent = value => `${(Math.max(0, Number(value) || 0) * 100).toFixed(2)}%`;

// One decision with one explanation and one set of relevant metrics.
export function formatHintAdvice(advice, hint) {
  const title = advice.reason === 'firstJudgment' ? t('hintAdvice.firstJudgment')
    : t(`hintAdvice.${advice.decision}`);
  const reason = t(`hintReason.${advice.reason}`);
  if (!hint || advice.decision === 'unavailable') return { title, reason, detail: '' };

  const timing = advice.timing;
  let detail;
  if (timing) {
    detail = t('hintMetrics.timing', {
      count: timing.count, now: percent(timing.nowProb), wait: percent(timing.waitProb),
      hints: timing.waitHints.toFixed(2)
    });
    if (!timing.exact) detail += ` (${t('dynamic.estimate')})`;
  } else if (hint.evaluationDepth >= 2) {
    detail = t('hintMetrics.multiple', {
      count: hint.evaluationDepth, before: percent(hint.currentSolveProb), after: percent(hint.expectedSolveProb),
      saved: Math.max(0, hint.attemptsSaved || 0).toFixed(2)
    });
    if (!hint.exact) detail += ` (${t('dynamic.estimate')})`;
  } else {
    detail = t('hintMetrics.estimate', {
      expected: hint.expectedRemaining.toFixed(1), before: percent(hint.currentOneShotProb), after: percent(hint.expectedOneShotProb)
    });
  }
  return { title, reason, detail };
}
