import { STAT_KEYS, getTargetRulesLevel } from './utils.js';
import { t } from './i18n.js';
const SESSION_KEY = 'md-decoder-session-v1';
let batchSequence = 0;

export function createBatchId(prefix = 'input') {
  batchSequence = (batchSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}_${Date.now().toString(36)}_${batchSequence.toString(36)}`;
}

export function budget(value, minimum = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(999, Math.max(minimum, Math.floor(number))) : minimum;
}
export function consumeAttempt(value) {
  const available = budget(value);
  const cost = available > 0 ? 1 : 0;
  return { remaining: available - cost, cost };
}
// One newly recorded property corresponds to one in-game hint. Old sessions
// already containing a manual revelation have used their initial free hint.
export function initialHintAvailable(hints) {
  return !hints.some(hint => hint.type === 'direct' && !hint.supplemental && !hint.automatic
    && hint.source !== 'reveal' && (hint.hintKind === 'initial' || !hint.hintKind));
}

export function recordDirectHints(hints, additions, remainingHints, { bonus = false } = {}) {
  let remaining = budget(remainingHints);
  let free = initialHintAvailable(hints);
  const recorded = additions.map(hint => {
    const hintKind = bonus ? 'bonus' : free ? 'initial' : 'paid';
    if (!bonus) free = false;
    const hintCost = hintKind === 'paid' && remaining > 0 ? 1 : 0;
    remaining -= hintCost;
    return { ...hint, hintKind, hintCost };
  });
  return { hints: recorded, remaining, cost: budget(remainingHints) - remaining };
}
export function parseStatInput(value, stat) {
  const text = value.trim();
  if (!text) return undefined;
  if (!['level', 'atk', 'def'].includes(stat)) return text;
  if (text === '?' && stat !== 'level') return -1;
  const number = Number(text);
  const minimum = stat === 'level' ? 0 : -1;
  if (!Number.isInteger(number) || number < minimum || (stat === 'level' && number > 13)) throw new Error(t('dynamic.invalidStats'));
  return number;
}
export function removeInputBatch(hints, batchId) {
  const removed = hints.filter(hint => hint.batchId === batchId);
  return { hints: hints.filter(hint => hint.batchId !== batchId),
    attemptsRefund: removed.reduce((sum, hint) => sum + budget(hint.attemptCost), 0),
    hintsRefund: removed.reduce((sum, hint) => sum + budget(hint.hintCost), 0) };
}
export function saveSession(storage, state) {
  try { storage.setItem(SESSION_KEY, JSON.stringify(state)); return true; } catch { return false; }
}
export function restoreSession(storage, cards) {
  try {
    const saved = JSON.parse(storage.getItem(SESSION_KEY));
    if (!saved || !Array.isArray(saved.hints) || saved.hints.length > 500) return null;
    // Older versions invented exact values from partial frame/level matches.
    // Remove only generated constraints; retain user-entered values and input order.
    const hints = saved.hints.filter(hint => hint?.inferred !== true);
    const ids = new Set(cards.map(card => card.id));
    for (const hint of hints) {
      if (!hint || !['guess', 'direct'].includes(hint.type) || !STAT_KEYS.includes(hint.stat) || typeof hint.isCorrect !== 'boolean' || typeof hint.batchId !== 'string' || !hint.batchId) return null;
      if (hint.type === 'guess' && !ids.has(hint.cardId)) return null;
      if (['frameType', 'attribute', 'race'].includes(hint.stat)) {
        if (typeof hint.value !== 'string' || !hint.value) return null;
      } else if (hint.stat === 'level') {
        const values = hint.type === 'guess' ? hint.value : [hint.value];
        if (!Array.isArray(values) || !values.length || !values.every(value => Number.isInteger(value) && value >= 0 && value <= 13)) return null;
      } else if (hint.value !== null && (!Number.isSafeInteger(hint.value) || hint.value < -1)) return null;
      if (['attemptCost', 'hintCost'].some(key => hint[key] !== undefined && hint[key] !== 0 && hint[key] !== 1)) return null;
    }
    const migrated = hints.length !== saved.hints.length;
    return { hints, attempts: budget(saved.attempts), remainingHints: budget(saved.remainingHints), problems: budget(saved.problems, 1), ...(migrated ? { migrated: true } : {}) };
  } catch { return null; }
}

export function hasSolvedGuess(hints) {
  const batches = new Map();
  for (const hint of hints) {
    if (hint.type !== 'guess') continue;
    if (!batches.has(hint.batchId)) batches.set(hint.batchId, new Map());
    batches.get(hint.batchId).set(hint.stat, hint.isCorrect);
  }
  return [...batches.values()].some(batch => STAT_KEYS.every(stat => batch.get(stat) === true));
}

export function nextChallenge(state) {
  return { hints: [], attempts: budget(state.attempts), remainingHints: budget(state.remainingHints), problems: Math.max(1, budget(state.problems, 1) - 1) };
}

export function applyAutomaticMatches(hints, cards) {
  const cardById = new Map(cards.map(card => [card.id, card]));
  const result = [...hints];
  const batches = new Map();
  for (const hint of hints) {
    if (hint.type !== 'guess') continue;
    if (!batches.has(hint.batchId)) batches.set(hint.batchId, []);
    batches.get(hint.batchId).push(hint);
  }
  for (const [batchId, batchHints] of batches) {
    const card = cardById.get(batchHints[0]?.cardId);
    if (!card) continue;
    for (const stat of ['frameType', 'level']) {
      if (!batchHints.some(hint => hint.stat === stat && hint.isCorrect)) continue;
      if (hints.some(hint => hint.type === 'direct' && hint.batchId === batchId && hint.stat === stat)) continue;
      result.push({
        type: 'direct', stat,
        value: stat === 'level' ? getTargetRulesLevel(card) : card.frameType,
        isCorrect: true, isExact: true, supplemental: true, automatic: true, batchId
      });
    }
  }
  return result;
}
