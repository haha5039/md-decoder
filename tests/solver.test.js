import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateAttempts, chooseCriteria, createSolver, distinctScores, recommendHintUse, sortScores } from '../src/solver.js';
import { getGuessFeedback, getValidLevels, getTargetRulesLevel, filterCandidatesByHints, hintsFromFeedback, STAT_KEYS } from '../src/utils.js';
import { allCards } from '../src/cards_data.js';

const card = (id, extra = {}) => ({ id, name: `Card ${id}`, frameType: 'effect', level: 4, attribute: 'DARK', race: 'Dragon', atk: 1000, def: 1000, ...extra });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

// Deliberately simple reference model, independent of bit packing and profile compression.
function reference(guess, targets, guesses) {
  const buckets = new Map(); let wins = 0; let eliminated = 0;
  for (const target of targets) {
    const result = getGuessFeedback(guess, target);
    if (result.won) { wins++; continue; }
    const survives = !result.matches.level || getTargetRulesLevel(target) === getTargetRulesLevel(guess);
    if (!survives) { eliminated++; continue; }
    const key = JSON.stringify([result.matches, result.matches.frameType ? target.frameType : null]);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(target);
  }
  const counts = [...buckets.values()].map(bucket => bucket.length);
  let two = wins;
  for (const bucket of buckets.values()) two += Math.max(0, ...guesses.map(next => bucket.filter(target => getGuessFeedback(next, target).won).length));
  const outcomes = [...counts, wins, eliminated].filter(Boolean);
  return { entropy: -outcomes.reduce((sum, n) => sum + n / targets.length * Math.log2(n / targets.length), 0),
    expectedRemaining: (counts.reduce((sum, n) => sum + n * n, 0) + eliminated * targets.length) / targets.length,
    minimax: eliminated ? targets.length : Math.max(0, ...counts), oneShotProb: wins / targets.length,
    twoShotProb: two / targets.length, eliminationProb: eliminated / targets.length };
}

test('two distinct targets: 50% now, 100% within two submissions', () => {
  const cards = [card(1), card(2, { atk: 2000 })];
  const result = createSolver(cards)({ candidateIds: [1, 2] });
  for (const score of result.snipes) { close(score.oneShotProb, 0.5); close(score.twoShotProb, 1); }
});

test('identical O/X outcomes split when different full frames are revealed', () => {
  const cards = [card(1, { frameType: 'fusion', atk: 0 }), card(2, { frameType: 'fusion' }), card(3, { frameType: 'fusion_pendulum' })];
  const result = createSolver(cards)({ candidateIds: [2, 3] });
  const score = result.scouts.find(score => score.card.id === 1);
  close(score.entropy, 1); close(score.expectedRemaining, 1); close(score.twoShotProb, 1); close(score.eliminationProb, 0);
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
  assert.equal(result.twoTurnExact, true); assert.equal(result.profileCount, 1); close(result.snipes[0].twoShotProb, 1);
  assert.deepEqual(solve({ candidateIds: [] }).snipes, []);
});

test('recommendation display removes duplicate statistical profiles', () => {
  const cards = [card(1), card(2), card(3, { atk: 2000 })];
  const result = createSolver(cards)({ candidateIds: cards.map(card => card.id) });
  assert.equal(result.snipes.length, 3);
  const distinct = distinctScores(result.snipes, 'entropy');
  assert.equal(distinct.length, 2);
  assert.equal(distinct.find(score => score.card.atk === 1000).equivalentChoices, 2);
});

test('automatic strategy matches the computed horizon and keeps exploration beyond two attempts', () => {
  assert.equal(chooseCriteria({ attempts: 2, twoTurnExact: true, candidateCount: 20 }), 'twoShot');
  assert.equal(chooseCriteria({ attempts: 4, twoTurnExact: true, horizonDepth: 4, candidateCount: 12 }), 'horizon');
  assert.equal(chooseCriteria({ attempts: 3, twoTurnExact: true, horizonDepth: 3, candidateCount: 20 }), 'horizon');
  assert.equal(chooseCriteria({ attempts: 4, twoTurnExact: true, horizonDepth: 2, candidateCount: 50 }), 'expected');
  assert.equal(chooseCriteria({ attempts: 5, twoTurnExact: true, candidateCount: 20 }), 'expected');
  assert.equal(chooseCriteria({ attempts: 1, twoTurnExact: true, candidateCount: 2 }), 'oneShot');
});

test('planning horizon does not force a one-shot gamble just because several challenges remain', () => {
  assert.equal(allocateAttempts(7, 3), 7);
  assert.equal(allocateAttempts(4, 4), 4);
  assert.equal(allocateAttempts(4, 8), 4);
  assert.equal(allocateAttempts(4, 1), 4);
  assert.equal(allocateAttempts(0, 3), 0);
  assert.equal(allocateAttempts(1, 3), 1);
});

test('three-turn lookahead improves a concrete ordinary-card state over the two-turn first move', () => {
  const profiles = [[2,0,4],[1,1,1],[1,0,0],[3,1,3],[3,2,2],[2,0,0],[2,2,2],[2,1,4],
    [4,0,2],[4,0,4],[2,0,2],[2,1,2],[2,2,4],[2,0,0],[3,1,4],[4,2,2],[2,0,3],
    [2,2,0],[4,1,2],[4,0,4],[1,2,0],[3,0,2],[2,2,0],[1,2,1],[1,1,1],[4,1,0]];
  const cards = profiles.map(([level, race, atk], i) => card(i + 1, { level, race: ['Dragon', 'Warrior', 'Machine'][race], atk: atk * 1000 }));
  const result = createSolver(cards)({ candidateIds: cards.map(item => item.id), attempts: 3 });
  assert.equal(result.horizonDepth, 3); assert.equal(result.horizonExact, true);
  const scores = [...result.snipes, ...result.scouts];
  close(sortScores(scores, 'horizon')[0].horizonProb, 25 / 26);
  close(sortScores(scores, 'twoShot')[0].horizonProb, 24 / 26);
});

test('four-turn search retains target multiplicity and prefers saving attempts at equal success', () => {
  const cards = [card(1), card(2), card(3, { atk: 2000 }), card(4, { atk: 3000 })];
  const result = createSolver(cards)({ candidateIds: [1, 2, 3, 4], attempts: 4 });
  const best = sortScores(result.snipes, 'horizon')[0];
  assert.equal(result.horizonDepth, 4); assert.equal(result.horizonExact, true);
  close(best.horizonProb, 1); close(best.horizonExpectedAttempts, 1.75);
  assert.equal(best.card.atk, 1000);
});

test('a hint that raises immediate success can still be saved when two guesses already guarantee success', () => {
  const cards = [card(1), card(2, { atk: 2000 })];
  const result = createSolver(cards)({ candidateIds: [1, 2], attempts: 2, revealedStats: ['frameType', 'level', 'attribute', 'race', 'def'] });
  close(result.hint.oneShotGain, 0.5); close(result.hint.solveGain, 0); close(result.hint.attemptsSaved, 0.5);
  const request = { attempts: 4, remainingHints: 1, problemsLeft: 1, candidateCount: 2, hint: result.hint, bestGuessExpectedRemaining: result.bestGuessExpectedRemaining };
  assert.equal(recommendHintUse(request).decision, 'save');
  assert.equal(recommendHintUse({ ...request, remainingHints: 8 }).decision, 'use');
});

test('guaranteed immediate answers do not spend hints even when many named candidates remain', () => {
  const cards = [card(1), card(2)];
  const result = createSolver(cards)({ candidateIds: [1, 2], attempts: 4 });
  assert.equal(recommendHintUse({ attempts: 4, remainingHints: 5, candidateCount: 2, hint: result.hint,
    bestGuessExpectedRemaining: result.bestGuessExpectedRemaining }).decision, 'save');
});

test('random hint value uses the current candidate distribution and best follow-up guess', () => {
  const cards = [1000, 2000, 3000, 4000].map((atk, index) => card(index + 1, { atk }));
  const revealedStats = ['frameType', 'level', 'attribute', 'race', 'def'];
  const result = createSolver(cards)({ candidateIds: cards.map(item => item.id), revealedStats });
  close(result.hint.expectedRemaining, 1);
  close(result.hint.currentOneShotProb, 0.25);
  close(result.hint.expectedOneShotProb, 1);
  close(result.hint.oneShotGain, 0.75);
});

test('hint recommendations react to measured current value instead of dividing by challenge count', () => {
  const valuable = { unknownCount: 3, expectedRemaining: 20, currentOneShotProb: 0.10, expectedOneShotProb: 0.22, oneShotGain: 0.12 };
  const weak = { unknownCount: 3, expectedRemaining: 55, currentOneShotProb: 0.01, expectedOneShotProb: 0.012, oneShotGain: 0.002 };
  assert.equal(recommendHintUse({ attempts: 1, remainingHints: 1, problemsLeft: 10, candidateCount: 100, hint: valuable, bestGuessExpectedRemaining: 60 }).decision, 'use');
  const noAttempts = recommendHintUse({ attempts: 0, remainingHints: 5, problemsLeft: 1, candidateCount: 100, hint: valuable, bestGuessExpectedRemaining: 60 });
  assert.equal(noAttempts.decision, 'save'); assert.equal(noAttempts.reason, 'noAttempts');
  assert.equal(recommendHintUse({ attempts: 4, remainingHints: 9, problemsLeft: 10, candidateCount: 100, hint: weak, bestGuessExpectedRemaining: 20 }).decision, 'save');
  assert.equal(recommendHintUse({ attempts: 4, remainingHints: 0, candidateCount: 100, hint: valuable, bestGuessExpectedRemaining: 60 }).reason, 'noHints');
});

test('routine early-game narrowing does not spend a scarce daily hint', () => {
  const early = { unknownCount: 5, expectedRemaining: 3000, currentOneShotProb: 0.001, expectedOneShotProb: 0.006, oneShotGain: 0.005 };
  const advice = recommendHintUse({ attempts: 4, remainingHints: 1, problemsLeft: 8, candidateCount: 6000, hint: early, bestGuessExpectedRemaining: 500 });
  assert.equal(advice.decision, 'save');
  assert.equal(advice.reason, 'firstJudgment');
  assert.equal(recommendHintUse({ attempts: 4, remainingHints: 1, problemsLeft: 8, candidateCount: 6000,
    hint: early, bestGuessExpectedRemaining: 500, guessedCount: 1 }).reason, 'scarceResource');
});

test('observed effect and fusion starts conserve one hint until the first judgment', () => {
  const solve = createSolver(allCards);
  for (const frame of ['effect', 'fusion']) {
    const candidates = filterCandidatesByHints(allCards, [{ type: 'direct', stat: 'frameType', value: frame, isCorrect: true }]);
    const result = solve({ candidateIds: candidates.map(item => item.id), revealedStats: ['frameType'], attempts: 4 });
    const advice = recommendHintUse({ attempts: 4, remainingHints: 1, problemsLeft: 1,
      candidateCount: candidates.length, hint: result.hint, bestGuessExpectedRemaining: result.bestGuessExpectedRemaining });
    assert.equal(advice.decision, 'save'); assert.equal(advice.reason, 'firstJudgment');
  }
});

test('hint timing equals an independent two-turn enumeration with conditional hint use', () => {
  const profiles = [[3,1,2,0],[2,0,2,2],[3,0,2,0],[3,1,2,2],[2,0,3,1],
    [1,1,1,2],[3,1,3,2],[3,1,0,2],[1,1,3,1],[3,0,0,1]];
  const cards = profiles.map(([level, race, atk, def], i) => card(i + 1, { level,
    race: ['Dragon', 'Warrior'][race], atk: atk * 1000, def: def * 1000 }));
  const revealed = ['frameType', 'attribute'];
  const unknown = STAT_KEYS.filter(stat => !revealed.includes(stat));
  const result = createSolver(cards)({ candidateIds: cards.map(item => item.id), revealedStats: revealed, attempts: 2 });
  const first = sortScores([...result.snipes, ...result.scouts], 'twoShot')[0].card;
  const buckets = (targets, key) => {
    const values = new Map();
    for (const target of targets) {
      const value = key(target);
      if (!values.has(value)) values.set(value, []);
      values.get(value).push(target);
    }
    return [...values.values()];
  };
  const winningCount = targets => Math.max(...cards.map(guess => targets.filter(target => getGuessFeedback(guess, target).won).length));
  const noHintTwo = targets => {
    let wins = -1, spent = Infinity;
    for (const guess of cards) {
      const direct = targets.filter(target => getGuessFeedback(guess, target).won).length;
      const branches = buckets(targets.filter(target => !getGuessFeedback(guess, target).won),
        target => JSON.stringify(getGuessFeedback(guess, target).matches));
      const solved = direct + branches.reduce((sum, branch) => sum + winningCount(branch), 0);
      const cost = 2 * targets.length - direct;
      if (solved > wins || (solved === wins && cost < spent)) { wins = solved; spent = cost; }
    }
    return { wins, spent };
  };
  let nowWins = 0, nowSpent = 0;
  for (const stat of unknown) for (const bucket of buckets(cards, target => target[stat])) {
    const outcome = noHintTwo(bucket); nowWins += outcome.wins / unknown.length; nowSpent += outcome.spent / unknown.length;
  }
  const direct = cards.filter(target => getGuessFeedback(first, target).won).length;
  let waitWins = direct, waitHints = 0;
  for (const branch of buckets(cards.filter(target => !getGuessFeedback(first, target).won),
    target => JSON.stringify(getGuessFeedback(first, target).matches))) {
    const feedback = getGuessFeedback(first, branch[0]);
    const remaining = unknown.filter(stat => !feedback.matches[stat]);
    const plain = winningCount(branch);
    const withHint = remaining.length ? remaining.reduce((sum, stat) => sum +
      buckets(branch, target => target[stat]).reduce((count, bucket) => count + winningCount(bucket), 0), 0) / remaining.length : plain;
    waitWins += Math.max(plain, withHint);
    if (withHint > plain) waitHints += branch.length;
  }
  const timing = result.hint.timing;
  assert.equal(timing.exact, true);
  close(timing.nowProb, nowWins / cards.length); close(timing.nowAttempts, nowSpent / cards.length);
  close(timing.waitProb, waitWins / cards.length); close(timing.waitAttempts, 2 - direct / cards.length);
  close(timing.waitHints, waitHints / cards.length);
  assert.ok(timing.waitProb > timing.nowProb);
  const advice = recommendHintUse({ attempts: 2, remainingHints: 1, problemsLeft: 1,
    candidateCount: cards.length, hint: result.hint, bestGuessExpectedRemaining: result.bestGuessExpectedRemaining });
  assert.equal(advice.reason, 'waitForJudgment');
});

test('the last attempt on the final challenge uses even a modest helpful hint', () => {
  const hint = { unknownCount: 3, expectedRemaining: 80, currentOneShotProb: 0.01, expectedOneShotProb: 0.011, oneShotGain: 0.001 };
  const advice = recommendHintUse({ attempts: 1, remainingHints: 1, problemsLeft: 1, candidateCount: 100, hint });
  assert.equal(advice.decision, 'use'); assert.equal(advice.reason, 'protectLastAttempt');
});

test('a substantial measured success gain can justify a hint before the first judgment', () => {
  const hint = { unknownCount: 3, expectedRemaining: 3, currentOneShotProb: 0.05, expectedOneShotProb: 0.5,
    oneShotGain: 0.45, evaluationDepth: 2, currentSolveProb: 0.5, expectedSolveProb: 1, solveGain: 0.5, attemptsSaved: 0.3 };
  assert.equal(recommendHintUse({ attempts: 2, remainingHints: 1, problemsLeft: 1, candidateCount: 20, hint }).decision, 'use');
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
