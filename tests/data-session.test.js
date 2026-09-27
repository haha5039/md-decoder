import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCards, validateCards } from '../src/data.js';
import { applyAutomaticMatches, budget, createBatchId, nextChallenge, parseStatInput, removeInputBatch, restoreSession, saveSession, hasSolvedGuess } from '../src/session.js';
import { escapeHTML } from '../src/utils.js';

const api = { id: 1, name: 'Card', type: 'Effect Monster', frameType: 'effect', attribute: 'DARK', level: 0, race: 'Dragon', atk: -1, def: 0 };

test('normalization preserves zero, unknown ATK, translations and authoritative frames', () => {
  const [card] = normalizeCards([api], [], [{ id: 1, name: '기존 번역' }]);
  assert.equal(card.level, 0); assert.equal(card.atk, -1); assert.equal(card.def, 0); assert.equal(card.name, '기존 번역');
  assert.equal(normalizeCards([{ ...api, type: 'Normal Tuner Monster', frameType: 'normal' }])[0].frameType, 'normal');
});

test('bad responses cannot replace the database; alternate artwork is deduplicated', () => {
  assert.throws(() => normalizeCards([])); assert.throws(() => validateCards([]));
  assert.throws(() => normalizeCards([{ ...api, attribute: null }]));
  assert.throws(() => normalizeCards([{ ...api, level: 99 }]));
  assert.equal(normalizeCards([api, { ...api, id: 2 }, { ...api, id: 3, name: 'Token', type: 'Token' }]).length, 1);
  assert.throws(() => normalizeCards([api], [], Array.from({ length: 5 }, (_, i) => ({ id: i, name: 'Old' }))));
});

test('recording free revelations never consumes or refunds paid hints', () => {
  const hints = [{ type: 'guess', batchId: 'g', attemptCost: 1 }, { type: 'direct', batchId: 'g', hintCost: 0 }, { type: 'direct', batchId: 'h', hintCost: 1 }];
  assert.deepEqual(removeInputBatch(hints, 'g'), { hints: [hints[2]], attemptsRefund: 1, hintsRefund: 0 });
  assert.equal(removeInputBatch(hints, 'h').hintsRefund, 1);
  assert.equal(budget(-1), 0); assert.equal(budget('abc'), 0); assert.equal(budget(0, 1), 1);
  assert.equal(budget(10000), 999);
});

test('batch IDs work without secure-context browser APIs', () => {
  const first = createBatchId('direct');
  const second = createBatchId('direct');
  assert.match(first, /^direct_[a-z0-9]+_[a-z0-9]+$/);
  assert.notEqual(first, second);
});

test('stat input distinguishes unknown ?, absent DEF, zero and invalid numbers', () => {
  assert.equal(parseStatInput('?', 'atk'), -1); assert.equal(parseStatInput('0', 'def'), 0);
  assert.equal(parseStatInput('', 'level'), undefined);
  assert.throws(() => parseStatInput('4.5', 'level')); assert.throws(() => parseStatInput('14', 'level')); assert.throws(() => parseStatInput('Infinity', 'atk'));
});

test('sessions round-trip and storage failure or removed cards are handled', () => {
  const values = new Map(); const storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) };
  const saved = { hints: [{ type: 'guess', stat: 'level', value: [4], isCorrect: true, cardId: 1, batchId: 'a' }], attempts: 3, remainingHints: 2, problems: 1 };
  assert.equal(saveSession(storage, saved), true); assert.deepEqual(restoreSession(storage, [api]), saved);
  assert.equal(restoreSession(storage, []), null);
  assert.equal(saveSession({ setItem() { throw new Error('quota'); } }, saved), false);
});

test('card names and attributes cannot inject HTML', () => {
  assert.equal(escapeHTML('<img src=x onerror="x"> & \'test\''), '&lt;img src=x onerror=&quot;x&quot;&gt; &amp; &#39;test&#39;');
});

test('a complete correct submission ends the challenge; partial rows do not', () => {
  const hints = ['frameType', 'level', 'attribute', 'race', 'atk', 'def'].map(stat => ({ type: 'guess', stat, isCorrect: true, batchId: 'g' }));
  assert.equal(hasSolvedGuess(hints), true);
  assert.equal(hasSolvedGuess(hints.slice(0, 5)), false);
  assert.equal(hasSolvedGuess(hints.map(hint => ({ ...hint, isCorrect: hint.stat !== 'atk' }))), false);
});

test('session restore removes unsafe inferred values from older versions', () => {
  const values = new Map();
  values.set('md-decoder-session-v1', JSON.stringify({ hints: [
    { type: 'guess', stat: 'frameType', value: 'fusion', isCorrect: true, cardId: 1, batchId: 'g' },
    { type: 'direct', stat: 'frameType', value: 'fusion', isCorrect: true, inferred: true, batchId: 'g' }
  ], attempts: 3, remainingHints: 1, problems: 2 }));
  const restored = restoreSession({ getItem: key => values.get(key) }, [api]);
  assert.equal(restored.hints.length, 1);
  assert.equal(restored.hints[0].type, 'guess');
  assert.equal(restored.migrated, true);
});

test('next challenge preserves resources and decreases remaining problems', () => {
  assert.deepEqual(nextChallenge({ attempts: 7, remainingHints: 2, problems: 3 }), { hints: [], attempts: 7, remainingHints: 2, problems: 2 });
  assert.equal(nextChallenge({ attempts: 0, remainingHints: 0, problems: 1 }).problems, 1);
});

test('matching frame and level are applied automatically', () => {
  const card = { ...api, id: 7, frameType: 'effect', level: 2 };
  const batch = [
    { type: 'guess', stat: 'frameType', value: 'effect', isCorrect: true, cardId: 7, batchId: 'g' },
    { type: 'guess', stat: 'level', value: [2], isCorrect: true, cardId: 7, batchId: 'g' }
  ];
  const completed = applyAutomaticMatches(batch, [card]);
  assert.ok(completed.some(hint => hint.supplemental && hint.stat === 'frameType' && hint.value === 'effect'));
  assert.ok(completed.some(hint => hint.supplemental && hint.stat === 'level' && hint.value === 2));
});
