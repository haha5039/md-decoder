import { STAT_KEYS, getTargetRulesLevel } from './utils.js';
const SESSION_KEY = 'md-decoder-session-v1';
let batchSequence = 0;

export function createBatchId(prefix = 'input') {
  batchSequence = (batchSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}_${Date.now().toString(36)}_${batchSequence.toString(36)}`;
}

export function budget(value, minimum = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.floor(number)) : minimum;
}
export function parseStatInput(value, stat) {
  const text = value.trim();
  if (!text) return undefined;
  if (!['level', 'atk', 'def'].includes(stat)) return text;
  if (text === '?' && stat !== 'level') return -1;
  const number = Number(text);
  const minimum = stat === 'level' ? 0 : -1;
  if (!Number.isInteger(number) || number < minimum || (stat === 'level' && number > 13)) throw new Error('레벨은 0~13의 정수, 공격력·수비력은 정수 또는 ?로 입력하세요.');
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
    if (!saved || !Array.isArray(saved.hints)) return null;
    const ids = new Set(cards.map(card => card.id));
    for (const hint of saved.hints) {
      if (!['guess', 'direct'].includes(hint.type) || !STAT_KEYS.includes(hint.stat) || typeof hint.isCorrect !== 'boolean' || typeof hint.batchId !== 'string') return null;
      if (hint.type === 'guess' && !ids.has(hint.cardId)) return null;
      if (hint.value !== null && !['string', 'number'].includes(typeof hint.value) && !(Array.isArray(hint.value) && hint.value.every(Number.isInteger))) return null;
    }
    return { hints: saved.hints, attempts: budget(saved.attempts), remainingHints: budget(saved.remainingHints), problems: budget(saved.problems, 1) };
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

export function inferRevealedValues(hints, cards) {
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
      const matched = batchHints.some(hint => hint.stat === stat && hint.isCorrect);
      const alreadyRevealed = hints.some(hint => hint.type === 'direct' && hint.batchId === batchId && hint.stat === stat);
      if (!matched || alreadyRevealed) continue;
      result.push({
        type: 'direct',
        stat,
        value: stat === 'level' ? getTargetRulesLevel(card) : card.frameType,
        isCorrect: true,
        isExact: true,
        inferred: true,
        batchId
      });
    }
  }

  return result;
}
