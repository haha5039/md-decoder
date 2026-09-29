import { STAT_KEYS, getValidLevels, getTargetRulesLevel, getRevealedValue } from './utils.js';

// Cards are equiprobable targets. Merge identical behavior only, retaining card multiplicity.
export const TWO_TURN_LIMIT = 60;
const FRAME_PARTS = ['normal', 'effect', 'fusion', 'synchro', 'xyz', 'link', 'ritual', 'pendulum'];
const mask = (card) => card.frameType.split('_').reduce((bits, part) => bits | (1 << FRAME_PARTS.indexOf(part)), 0);
const signature = card => JSON.stringify([card.frameType, getValidLevels(card), getTargetRulesLevel(card), card.attribute, card.race, card.atk, card.def]);
const matchMask = (guess, target) =>
  ((guess.frameMask & target.frameMask) ? 1 : 0) |
  ((guess.levelMask & target.levelMask) ? 2 : 0) |
  ((guess.card.attribute === target.card.attribute) ? 4 : 0) |
  ((guess.card.race === target.card.race) ? 8 : 0) |
  ((guess.card.atk === target.card.atk) ? 16 : 0) |
  ((guess.card.def === target.card.def) ? 32 : 0);

export function createSolver(cards) {
  const records = cards.map(card => ({
    card, key: signature(card), frameMask: mask(card),
    levelMask: getValidLevels(card).reduce((bits, level) => bits | (1 << level), 0),
    rulesLevel: getTargetRulesLevel(card)
  }));
  const bucketCapacity = 64;

  return function solve({ candidateIds, guessedIds = [], revealedStats = [] }) {
    const started = performance.now();
    const ids = new Set(candidateIds);
    const used = new Set(guessedIds);
    const targetsByKey = new Map();
    for (const record of records) {
      if (!ids.has(record.card.id)) continue;
      const target = targetsByKey.get(record.key);
      if (target) target.weight++;
      else targetsByKey.set(record.key, { ...record, weight: 1 });
    }
    const targets = [...targetsByKey.values()];
    const total = targets.reduce((sum, target) => sum + target.weight, 0);
    const availableByKey = new Map();
    for (const record of records) {
      if (used.has(record.card.id)) continue;
      if (!availableByKey.has(record.key)) availableByKey.set(record.key, []);
      availableByKey.get(record.key).push(record);
    }
    const groups = [...availableByKey.values()];
    const twoTurnExact = total > 0 && targets.length <= TWO_TURN_LIMIT;
    const scores = [];
    if (!total) return { snipes: [], scouts: [], twoTurnExact: false, total, hint: null, durationMs: 0 };
    const counts = new Int32Array(bucketCapacity);
    const touched = [];
    const targetBits = twoTurnExact ? targets.map((_, index) => 1n << BigInt(index)) : [];
    const winMasks = new Set();

    for (const group of groups) {
      const guess = group[0];
      const branches = twoTurnExact ? new Map() : null;
      const winningTargets = [];
      let winning = 0;
      let eliminated = 0;
      let winBits = 0n;
      touched.length = 0;
      for (let j = 0; j < targets.length; j++) {
        const target = targets[j];
        const profile = matchMask(guess, target);
        if (profile === 63) {
          winning += target.weight;
          winningTargets.push(j);
          if (twoTurnExact) winBits |= targetBits[j];
          continue;
        }
        const survivesAutomaticValues = (!(profile & 1) || target.card.frameType === guess.card.frameType)
          && (!(profile & 2) || target.rulesLevel === guess.rulesLevel);
        if (!survivesAutomaticValues) {
          eliminated += target.weight;
          continue;
        }
        const key = profile;
        if (counts[key] === 0) touched.push(key);
        counts[key] += target.weight;
        if (twoTurnExact) branches.set(key, (branches.get(key) || 0n) | targetBits[j]);
      }
      let entropy = winning ? -(winning / total) * Math.log2(winning / total) : 0;
      if (eliminated) entropy -= (eliminated / total) * Math.log2(eliminated / total);
      let squares = eliminated * total;
      let minimax = eliminated ? total : 0;
      for (const key of touched) {
        const count = counts[key];
        const probability = count / total;
        entropy -= probability * Math.log2(probability);
        squares += count * count;
        minimax = Math.max(minimax, count);
        counts[key] = 0;
      }
      const eliminationProb = eliminated / total;
      scores.push({ group, entropy, adjustedEntropy: entropy - eliminationProb * 2, expectedRemaining: squares / total, minimax,
        oneShotProb: winning / total, twoShotProb: null, eliminationProb, winning,
        winningTargets, branches: twoTurnExact ? [...branches.values()] : null });
      if (winBits) winMasks.add(winBits);
    }

    if (twoTurnExact) {
      const weights = new Map([[0n, 0]]);
      const weightOf = bits => {
        if (weights.has(bits)) return weights.get(bits);
        let count = 0;
        for (let i = 0; i < targets.length; i++) if (bits & targetBits[i]) count += targets[i].weight;
        weights.set(bits, count);
        return count;
      };
      const bestWins = new Map();
      const coverages = [...winMasks];
      const bestWin = branch => {
        if (bestWins.has(branch)) return bestWins.get(branch);
        let best = 0;
        const size = weightOf(branch);
        for (const coverage of coverages) {
          best = Math.max(best, weightOf(branch & coverage));
          if (best === size) break;
        }
        bestWins.set(branch, best);
        return best;
      };
      for (const score of scores) {
        score.twoShotProb = (score.winning + score.branches.reduce((sum, branch) => sum + bestWin(branch), 0)) / total;
      }
    }

    const unknown = STAT_KEYS.filter(stat => !revealedStats.includes(stat));
    let hint = null;
    if (unknown.length) {
      const outcomes = unknown.map(stat => {
        const buckets = new Map();
        const targetValues = targets.map(target => JSON.stringify(getRevealedValue(target.card, stat)));
        for (let index = 0; index < targets.length; index++) {
          const target = targets[index];
          const value = getRevealedValue(target.card, stat);
          const key = targetValues[index];
          const bucket = buckets.get(key) || { value, weight: 0, bestWins: 0 };
          bucket.weight += target.weight;
          buckets.set(key, bucket);
        }
        for (const score of scores) {
          const winsByValue = new Map();
          for (const index of score.winningTargets) {
            const key = targetValues[index];
            winsByValue.set(key, (winsByValue.get(key) || 0) + targets[index].weight);
          }
          for (const [key, wins] of winsByValue) {
            const bucket = buckets.get(key);
            if (wins > bucket.bestWins) bucket.bestWins = wins;
          }
        }
        const values = [...buckets.values()];
        return {
          stat,
          expectedRemaining: values.reduce((sum, bucket) => sum + bucket.weight * bucket.weight / total, 0),
          expectedOneShotProb: values.reduce((sum, bucket) => sum + bucket.bestWins, 0) / total
        };
      });
      const currentOneShotProb = Math.max(0, ...scores.map(score => score.oneShotProb));
      const expectedOneShotProb = outcomes.reduce((sum, outcome) => sum + outcome.expectedOneShotProb, 0) / unknown.length;
      hint = {
        unknownCount: unknown.length,
        expectedRemaining: outcomes.reduce((sum, outcome) => sum + outcome.expectedRemaining, 0) / unknown.length,
        bestExpectedRemaining: Math.min(...outcomes.map(outcome => outcome.expectedRemaining)),
        worstExpectedRemaining: Math.max(...outcomes.map(outcome => outcome.expectedRemaining)),
        currentOneShotProb,
        expectedOneShotProb,
        oneShotGain: Math.max(0, expectedOneShotProb - currentOneShotProb),
        outcomes
      };
    }
    const snipes = [], scouts = [];
    for (const { group, branches, winning, winningTargets, ...score } of scores) {
      for (const { card } of group) {
        const item = { card, profileKey: group[0].key, equivalentChoices: group.length, ...score };
        // A card outside the candidate set may still win via partial-frame matching.
        (score.oneShotProb > 0 ? snipes : scouts).push(item);
      }
    }
    return {
      snipes, scouts, twoTurnExact, profileCount: targets.length, total, hint,
      bestGuessExpectedRemaining: Math.min(...scores.map(score => score.expectedRemaining)),
      durationMs: performance.now() - started
    };
  };
}

export function sortScores(list, criteria) {
  return [...list].sort((a, b) => {
    let difference = 0;
    if (criteria === 'oneShot') difference = b.oneShotProb - a.oneShotProb;
    else if (criteria === 'twoShot') difference = (b.twoShotProb ?? -1) - (a.twoShotProb ?? -1);
    else if (criteria === 'expected') difference = a.expectedRemaining - b.expectedRemaining;
    else if (criteria === 'minimax') difference = a.minimax - b.minimax;
    else difference = (b.adjustedEntropy ?? b.entropy) - (a.adjustedEntropy ?? a.entropy);
    return difference || (a.eliminationProb ?? 0) - (b.eliminationProb ?? 0) || b.oneShotProb - a.oneShotProb || a.expectedRemaining - b.expectedRemaining || b.entropy - a.entropy || a.card.id - b.card.id;
  });
}

export function chooseCriteria({ attempts, twoTurnExact, candidateCount }) {
  if (attempts <= 1) return 'oneShot';
  if (attempts <= 4 && twoTurnExact) return 'twoShot';
  return candidateCount <= TWO_TURN_LIMIT ? 'expected' : 'entropy';
}

export function allocateAttempts(totalAttempts, problemsLeft) {
  const total = Number.isFinite(Number(totalAttempts)) ? Math.max(0, Math.floor(Number(totalAttempts))) : 0;
  const problems = Number.isFinite(Number(problemsLeft)) ? Math.max(1, Math.floor(Number(problemsLeft))) : 1;
  return problems > 1 ? Math.floor(total / problems) : total;
}

export function recommendHintUse({ attempts, remainingHints, problemsLeft = 1, candidateCount, hint, bestGuessExpectedRemaining }) {
  const hints = Number.isFinite(Number(remainingHints)) ? Math.max(0, Math.floor(Number(remainingHints))) : 0;
  const tries = Number.isFinite(Number(attempts)) ? Math.max(0, Math.floor(Number(attempts))) : 0;
  const problems = Number.isFinite(Number(problemsLeft)) ? Math.max(1, Math.floor(Number(problemsLeft))) : 1;
  const candidates = Number.isFinite(Number(candidateCount)) ? Math.max(0, Number(candidateCount)) : 0;
  if (!hints) return { decision: 'unavailable', reason: 'noHints' };
  if (!hint?.unknownCount || candidates <= 1) return {
    decision: 'save', reason: 'noUnknownStats', expectedRemaining: candidates,
    reductionRate: 0, oneShotGain: 0, relativeToGuess: 0
  };

  const expectedRemaining = Math.min(candidates, Math.max(0, hint.expectedRemaining));
  const reductionRate = candidates ? (candidates - expectedRemaining) / candidates : 0;
  const oneShotGain = Math.max(0, hint.oneShotGain || 0);
  const guessRemaining = Number.isFinite(bestGuessExpectedRemaining) ? Math.max(0, bestGuessExpectedRemaining) : candidates;
  const guessReduction = Math.max(0, candidates - guessRemaining);
  const hintReduction = Math.max(0, candidates - expectedRemaining);
  const relativeToGuess = guessReduction > 0 ? hintReduction / guessReduction : (hintReduction > 0 ? Infinity : 0);
  const currentOneShotProb = Math.max(0, hint.currentOneShotProb || 0);
  const expectedOneShotProb = Math.max(currentOneShotProb, hint.expectedOneShotProb || currentOneShotProb);
  const hintAvailability = hints / problems;
  const scarcity = hintAvailability < 0.75 ? 'scarce' : hintAvailability < 1.5 ? 'balanced' : 'abundant';
  const metrics = { expectedRemaining, reductionRate, oneShotGain, relativeToGuess, currentOneShotProb, expectedOneShotProb, scarcity };

  if (hintReduction < 0.5 && oneShotGain < 0.001) return { decision: 'save', reason: 'noValue', ...metrics };
  // Hints are granted at one quarter of the daily attempt rate. Preserve their
  // option value until an attempt can immediately use the revealed property.
  if (tries === 0) return { decision: 'save', reason: 'noAttempts', ...metrics };

  const tier = scarcity === 'scarce'
    ? (tries === 1 ? [0.08, 0.55, 0.75] : tries === 2 ? [0.10, 0.65, 0.85] : [0.15, 0.75, 0.95])
    : scarcity === 'balanced'
      ? (tries === 1 ? [0.05, 0.45, 0.65] : tries === 2 ? [0.08, 0.55, 0.75] : [0.12, 0.65, 0.85])
      : (tries === 1 ? [0.03, 0.35, 0.50] : tries === 2 ? [0.05, 0.45, 0.60] : [0.08, 0.55, 0.70]);
  const [minimumGain, minimumReduction, minimumRelativeValue] = tier;
  const nearSolution = expectedRemaining <= 3 && expectedOneShotProb >= 0.5;
  const decisive = expectedOneShotProb >= 0.5 && oneShotGain >= 0.10;
  const measuredValue = oneShotGain >= minimumGain
    && (reductionRate >= minimumReduction || relativeToGuess >= minimumRelativeValue);
  const use = nearSolution || decisive || measuredValue;
  return {
    decision: use ? 'use' : 'save',
    reason: use ? (tries === 1 ? 'protectLastAttempt' : 'strongCurrentValue') : (scarcity === 'scarce' ? 'scarceResource' : 'weakValue'),
    ...metrics
  };
}

export function distinctScores(list, criteria) {
  const seen = new Set();
  return sortScores(list, criteria).filter(score => {
    const key = score.profileKey ?? score.card.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
