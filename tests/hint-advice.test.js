import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHintAdvice } from '../src/hint-advice.js';
import { setLocale } from '../src/i18n.js';

test('one hint notice distinguishes immediate estimates from several-turn success', () => {
  setLocale('ko');
  const hint = { evaluationDepth: 1, expectedRemaining: 624.9, currentOneShotProb: 0.0036, expectedOneShotProb: 0.021 };
  const notice = formatHintAdvice({ decision: 'save', reason: 'firstJudgment' }, hint);
  assert.match(notice.title, /첫 카드 판정/);
  assert.match(notice.detail, /참고 추정/);
  assert.match(notice.detail, /1회 정답 확률/);
  assert.doesNotMatch(notice.detail, /4회 내 성공/);
});

test('waiting comparisons use a single consistent success horizon and label estimates', () => {
  setLocale('ko');
  const timing = { count: 2, nowProb: 0.925, waitProb: 1, waitHints: 0.2, exact: false };
  const notice = formatHintAdvice({ decision: 'save', reason: 'waitForJudgment', timing }, { evaluationDepth: 2 });
  assert.match(notice.detail, /92.50%/); assert.match(notice.detail, /100.00%/);
  assert.match(notice.detail, /추정/); assert.doesNotMatch(notice.reason, /hintReason/);
});

test('hint advice is translated and unavailable resources need no numeric metrics', () => {
  setLocale('en');
  const notice = formatHintAdvice({ decision: 'unavailable', reason: 'noHints' }, null);
  assert.equal(notice.title, 'No hints available'); assert.equal(notice.detail, '');
  assert.doesNotMatch(notice.reason, /hintReason/);
  setLocale('ko');
});
