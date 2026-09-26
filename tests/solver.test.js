import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolver, sortScores } from '../src/solver.js';
import { getGuessFeedback, getValidLevels, getTargetRulesLevel, filterCandidatesByHints, hintsFromFeedback } from '../src/utils.js';
import { allCards } from '../src/cards_data.js';

const card = (id, extra = {}) => ({ id, name: `Card ${id}`, frameType: 'effect', level: 4, attribute: 'DARK', race: 'Dragon', atk: 1000, def: 1000, ...extra });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

// Deliberately simple reference model, independent of bit packing and profile compression.
function reference(guess, targets, guesses) {
  const buckets = new Map(); let wins = 0;
  for (const target of targets) {
    const result = getGuessFeedback(guess, target);
    if (result.won) { wins++; continue; }
    const key = JSON.stringify(result.matches);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(target);
  }
  const counts = [...buckets.values()].map(bucket => bucket.length);
  let two = wins;
  for (const bucket of buckets.values()) two += Math.max(0, ...guesses.map(next => bucket.filter(target => getGuessFeedback(next, target).won).length));
  const outcomes = [...counts, wins].filter(Boolean);
  return { entropy: -outcomes.reduce((sum, n) => sum + n / targets.length * Math.log2(n / targets.length), 0),
    expectedRemaining: counts.reduce((sum, n) => sum + n * n, 0) / targets.length,
    minimax: Math.max(0, ...counts), oneShotProb: wins / targets.length, twoShotProb: two / targets.length };
}

test('two distinct targets: 50% now, 100% within two submissions', () => {
  const cards = [card(1), card(2, { atk: 2000 })];
  const result = createSolver(cards)({ candidateIds: [1, 2] });
  for (const score of result.snipes) { close(score.oneShotProb, 0.5); close(score.twoShotProb, 1); }
});

test('streamlined O/X workflow keeps identical outcomes in one branch', () => {
  const cards = [card(1, { frameType: 'fusion', atk: 0 }), card(2, { frameType: 'fusion' }), card(3, { frameType: 'fusion_pendulum' })];
  const result = createSolver(cards)({ candidateIds: [2, 3] });
  const score = result.scouts.find(score => score.card.id === 1);
  close(score.entropy, 0); close(score.expectedRemaining, 2); close(score.twoShotProb, 1);
});

test('optimized metrics equal exhaustive reference including duplicates and Pendulum overlaps', () => {
  const cards = [card(1, { frameType: 'fusion' }), card(2, { frameType: 'fusion_pendulum' }), card(3, { frameType: 'synchro_pendulum' }), card(4, { frameType: 'synchro' }), card(5, { atk: 0 }), card(6, { frameType: 'fusion' })];
  const targets = cards.filter(card => card.id !== 5);
  const result = createSolver(cards)({ candidateIds: targets.map(card => card.id) });
  for (const score of [...result.snipes, ...result.scouts]) {
    const expected = reference(score.card, targets, cards);
    for (const key of Object.keys(expected)) close(score[key], expected[key]);
  }
  const group = result.snipes.find(score => score.card.id === 1);
  close(group.oneShotProb, 3 / 5);
});

test('cards outside target candidates can still be accepted answers; exclude submitted IDs', () => {
  const cards = [card(1, { frameType: 'fusion' }), card(2, { frameType: 'synchro_pendulum' }), card(3, { frameType: 'fusion_pendulum' })];
  const result = createSolver(cards)({ candidateIds: [1, 2], guessedIds: [1] });
  assert.ok(!result.snipes.some(score => score.card.id === 1));
  const bridge = result.snipes.find(score => score.card.id === 3);
  close(bridge.oneShotProb, 1);
  assert.equal(sortScores(result.snipes, 'oneShot')[0].card.id, 3);
});

test('all equivalent targets are a guaranteed win; empty and large states are explicit', () => {
  const cards = Array.from({ length: 61 }, (_, i) => card(i + 1));
  const solve = createSolver(cards);
  const result = solve({ candidateIds: cards.map(card => card.id) });
  close(result.snipes[0].oneShotProb, 1); close(result.snipes[0].expectedRemaining, 0);
  assert.equal(result.twoTurnExact, false); assert.equal(result.snipes[0].twoShotProb, null);
  assert.deepEqual(solve({ candidateIds: [] }).snipes, []);
});

test('known rules exceptions use correct identities and retain printed zero', () => {
  const alchemic = allCards.find(card => card.id === 65301952);
  assert.equal(getTargetRulesLevel(alchemic), 4);
  assert.deepEqual(getValidLevels(alchemic), [4]);
  for (const id of [65305468, 43490025, 26973555, 41522092, 52653092]) {
    const target = allCards.find(card => card.id === id);
    assert.deepEqual(getValidLevels(target), [0, 1]); assert.equal(getTargetRulesLevel(target), 1);
  }
  const tzolkin = allCards.find(card => card.id === 1686814);
  const future = allCards.find(card => card.id === 65305468);
  const feedback = getGuessFeedback(future, tzolkin);
  assert.equal(feedback.matches.level, true); assert.equal(feedback.revealed.level, 12);
  assert.ok(filterCandidatesByHints([tzolkin, future], hintsFromFeedback(future, feedback, 'guess')).includes(tzolkin));
});

test('feedback replay always keeps the true target; hints expose only matched properties', () => {
  const cards = allCards.filter(card => !['spell', 'trap'].includes(card.frameType));
  for (let i = 0; i < 30; i++) {
    const target = cards[(i * 307) % cards.length];
    const guess = cards[(i * 521 + 17) % cards.length];
    const feedback = getGuessFeedback(guess, target);
    for (const stat of Object.keys(feedback.revealed)) assert.equal(feedback.matches[stat], true);
    assert.ok(filterCandidatesByHints(cards, hintsFromFeedback(guess, feedback, 'guess')).some(card => card.id === target.id));
  }
});
