import { STAT_KEYS, getValidLevels, getTargetRulesLevel, getRevealedValue } from './utils.js';

// Cards are equiprobable targets. Merge identical behavior only, retaining card multiplicity.
export const TWO_TURN_LIMIT = 60;
export const THREE_TURN_LIMIT = 30;
export const FOUR_TURN_LIMIT = 16;
export const HINT_TIMING_LIMIT = 12;
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

// Search the existing result branches without changing any matching or
// automatic-filter semantics. Repeated actions cannot win in a failure branch.
function createPlanner(scores, targets, targetBits) {
  const weights = new Map([[0n, 0]]);
  const weightOf = bits => {
    if (!weights.has(bits)) weights.set(bits, targets.reduce((sum, target, index) =>
      sum + ((bits & targetBits[index]) ? target.weight : 0), 0));
    return weights.get(bits);
  };
  const coverages = [...new Set(scores.map(score => score.winBits).filter(Boolean))];
  const winCache = new Map();
  const bestWin = bits => {
    if (winCache.has(bits)) return winCache.get(bits);
    let best = 0;
    const size = weightOf(bits);
    for (const coverage of coverages) {
      best = Math.max(best, weightOf(bits & coverage));
      if (best === size) break;
    }
    winCache.set(bits, best);
    return best;
  };
  const actionsByKey = new Map();
  for (const score of scores) {
    const branches = [...score.branches].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const key = `${score.winBits}:${branches.join(',')}`;
    if (!actionsByKey.has(key)) actionsByKey.set(key, { winBits: score.winBits, branches });
    score.actionKey = key;
  }
  // Keep exact one/two-turn coverage. For deeper search, a bounded union of
  // strong actions avoids exponential work on a 9,000-card database.
  const exact = actionsByKey.size <= 96;
  const selectedKeys = exact ? new Set(actionsByKey.keys()) : new Set();
  if (!exact) {
    for (const score of scores) score.twoShotProb = (score.winning
      + score.branches.reduce((sum, branch) => sum + bestWin(branch), 0)) / targets.reduce((sum, target) => sum + target.weight, 0);
    const rankingScores = scores.map(score => ({ ...score, card: score.group[0].card }));
    for (const metric of ['entropy', 'expected', 'minimax', 'oneShot', 'twoShot']) {
      let count = 0;
      const seen = new Set();
      for (const score of sortScores(rankingScores, metric)) {
        if (seen.has(score.actionKey)) continue;
        seen.add(score.actionKey); selectedKeys.add(score.actionKey);
        if (++count === 12) break;
      }
    }
  }
  const actions = [...selectedKeys].map(key => actionsByKey.get(key));
  const allActions = [...actionsByKey.values()];
  const projected = new Map();
  const memo = new Map();
  const evaluateAction = (bits, action, turns) => {
    const size = weightOf(bits);
    let wins = weightOf(bits & action.winBits);
    let spent = size;
    if (turns === 1) return { wins, spent };
    let surviving = wins;
    for (const branch of action.branches) {
      const remaining = bits & branch;
      if (!remaining) continue;
      surviving += weightOf(remaining);
      const next = evaluate(remaining, turns - 1);
      wins += next.wins;
      spent += next.spent;
    }
    // Preserve the existing conservative treatment of unreachable outcomes.
    spent += (size - surviving) * (turns - 1);
    return { wins, spent };
  };
  const evaluate = (bits, turns) => {
    const size = weightOf(bits);
    if (!size || !turns) return { wins: 0, spent: 0 };
    const immediate = bestWin(bits);
    if (turns === 1 || immediate === size) return { wins: immediate, spent: size };
    const key = `${turns}:${bits}`;
    if (memo.has(key)) return memo.get(key);
    const projectionKey = `${turns === 2 ? 'all' : 'shortlist'}:${bits}`;
    if (!projected.has(projectionKey)) {
      const unique = new Map();
      for (const action of turns === 2 ? allActions : actions) {
        const winBits = bits & action.winBits;
        const branches = action.branches.map(branch => bits & branch).filter(Boolean);
        if (!winBits && branches.length === 1 && branches[0] === bits) continue;
        const resultKey = `${winBits}:${branches.join(',')}`;
        if (!unique.has(resultKey)) unique.set(resultKey, { winBits, branches });
      }
      projected.set(projectionKey, [...unique.values()]);
    }
    let best = { wins: 0, spent: size * turns };
    for (const action of projected.get(projectionKey)) {
      const result = evaluateAction(bits, action, turns);
      if (result.wins > best.wins || (result.wins === best.wins && result.spent < best.spent)) best = result;
      if (best.wins === size && best.spent <= 2 * size - immediate) break;
    }
    memo.set(key, best);
    return best;
  };
  return { weightOf, bestWin, evaluate, evaluateAction, actionsByKey, selectedKeys, exact };
}

// Compare paying now with one ordinary judgment followed by a conditional hint.
// Use the existing branches and no-hint planner; card matching is unchanged.
function addHintTiming(scores, targets, targetBits, planner, unknown, turns, opportunityCost) {
  const allBits = targetBits.reduce((bits, bit) => bits | bit, 0n);
  const total = planner.weightOf(allBits);
  const unknownMask = unknown.reduce((bits, stat) => bits | (1 << STAT_KEYS.indexOf(stat)), 0);
  const valueMasks = STAT_KEYS.map(stat => {
    const values = new Map();
    targets.forEach((target, index) => {
      const key = JSON.stringify(getRevealedValue(target.card, stat));
      values.set(key, (values.get(key) || 0n) | targetBits[index]);
    });
    return [...values.values()];
  });
  const hintCache = new Map();
  const reveal = (bits, unrevealed, depth) => {
    if (!unrevealed || !depth) return null;
    const key = `${bits}:${unrevealed}:${depth}`;
    if (hintCache.has(key)) return hintCache.get(key);
    const result = { wins: 0, spent: 0, hints: planner.weightOf(bits) };
    let count = 0;
    for (let stat = 0; stat < STAT_KEYS.length; stat++) {
      if (!(unrevealed & (1 << stat))) continue;
      count++;
      for (const value of valueMasks[stat]) {
        const bucket = bits & value;
        if (!bucket) continue;
        const next = planner.evaluate(bucket, depth);
        result.wins += next.wins; result.spent += next.spent;
      }
    }
    result.wins /= count; result.spent /= count;
    hintCache.set(key, result);
    return result;
  };
  const preferHint = (hint, baseline) => {
    if (!hint) return false;
    if (hint.wins > baseline.wins + 1e-9) return true;
    return Math.abs(hint.wins - baseline.wins) <= 1e-9
      && hint.spent + opportunityCost * hint.hints < baseline.spent - 1e-9;
  };
  const actions = new Map();
  for (const score of scores) {
    score.hintActionKey = `${score.winBits}:${score.branchProfiles.map(([profile, bits]) => `${profile & unknownMask}=${bits}`).sort().join(',')}`;
    if (!actions.has(score.hintActionKey)) actions.set(score.hintActionKey, score);
  }
  const exact = planner.exact && actions.size <= 96;
  const chosen = actions.size <= 96 ? new Set(actions.keys()) : new Set();
  if (actions.size > 96) {
    const ranking = scores.map(score => ({ ...score, card: score.group[0].card }));
    for (const metric of ['oneShot', 'twoShot', 'horizon', 'entropy', 'expected', 'minimax']) {
      const seen = new Set();
      for (const score of sortScores(ranking, metric)) {
        if (seen.has(score.hintActionKey)) continue;
        seen.add(score.hintActionKey); chosen.add(score.hintActionKey);
        if (seen.size === 8) break;
      }
    }
  }
  const now = reveal(allBits, unknownMask, turns);
  const results = new Map();
  for (const key of chosen) {
    const action = actions.get(key);
    let wins = action.winning, spent = total, hintsUsed = 0, surviving = action.winning;
    for (const [profile, branch] of action.branchProfiles) {
      const size = planner.weightOf(branch);
      surviving += size;
      const baseline = planner.evaluate(branch, turns - 1);
      const after = reveal(branch, unknownMask & ~profile, turns - 1);
      const use = preferHint(after, baseline);
      const next = use ? after : baseline;
      wins += next.wins; spent += next.spent;
      if (use) hintsUsed += after.hints;
    }
    spent += (total - surviving) * (turns - 1);
    results.set(key, {
      count: turns, exact,
      nowProb: now.wins / total, waitProb: wins / total,
      nowAttempts: now.spent / total, waitAttempts: spent / total,
      waitHints: hintsUsed / total,
      nowCost: now.spent / total + opportunityCost,
      waitCost: spent / total + opportunityCost * hintsUsed / total
    });
  }
  for (const score of scores) score.hintTiming = results.get(score.hintActionKey) ?? null;
}

export function createSolver(cards) {
  const frameCodes = new Map([...new Set(cards.map(card => card.frameType))].map((frame, index) => [frame, index + 1]));
  const records = cards.map(card => ({
    card, key: signature(card), frameMask: mask(card),
    frameCode: frameCodes.get(card.frameType),
    levelMask: getValidLevels(card).reduce((bits, level) => bits | (1 << level), 0),
    rulesLevel: getTargetRulesLevel(card)
  }));
  const bucketCapacity = 64 * (frameCodes.size + 1);

  return function solve({ candidateIds, guessedIds = [], revealedStats = [], attempts = 2,
    remainingHints = 1, problemsLeft = 1, resourceAttempts = attempts }) {
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
    const requestedDepth = Math.max(1, Math.min(4, Math.floor(Number(attempts) || 1)));
    const horizonDepth = requestedDepth >= 4 && targets.length <= FOUR_TURN_LIMIT ? 4
      : requestedDepth >= 3 && targets.length <= THREE_TURN_LIMIT ? 3
        : requestedDepth >= 2 && twoTurnExact ? 2 : 1;
    const collectTiming = targets.length <= HINT_TIMING_LIMIT && horizonDepth >= 2 && remainingHints > 0;
    const scores = [];
    if (!total) return { snipes: [], scouts: [], twoTurnExact: false, total, hint: null, durationMs: 0 };
    const counts = new Int32Array(bucketCapacity);
    const touched = [];
    const targetBits = twoTurnExact ? targets.map((_, index) => 1n << BigInt(index)) : [];

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
        const survivesAutomaticLevel = !(profile & 2) || target.rulesLevel === guess.rulesLevel;
        if (!survivesAutomaticLevel) {
          eliminated += target.weight;
          continue;
        }
        // A frame match reveals the target's full frame, including Pendulum.
        const key = profile + ((profile & 1) ? 64 * target.frameCode : 0);
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
        winningTargets, winBits, branches: twoTurnExact ? [...branches.values()] : null,
        branchProfiles: collectTiming ? [...branches.entries()] : null });
    }

    const allBits = twoTurnExact ? targetBits.reduce((bits, bit) => bits | bit, 0n) : 0n;
    const planner = twoTurnExact ? createPlanner(scores, targets, targetBits) : null;
    if (planner) {
      const horizonScores = new Map();
      for (const score of scores) {
        score.twoShotProb = (score.winning + score.branches.reduce((sum, branch) => sum + planner.bestWin(branch), 0)) / total;
        if (horizonDepth > 2 && !planner.selectedKeys.has(score.actionKey)) {
          score.horizonProb = null; score.horizonExpectedAttempts = null;
          continue;
        }
        if (!horizonScores.has(score.actionKey)) horizonScores.set(score.actionKey,
          planner.evaluateAction(allBits, planner.actionsByKey.get(score.actionKey), horizonDepth));
        const horizon = horizonScores.get(score.actionKey);
        score.horizonProb = horizon.wins / total;
        score.horizonExpectedAttempts = horizon.spent / total;
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
          const bucket = buckets.get(key) || { value, weight: 0, bestWins: 0, bits: 0n };
          bucket.weight += target.weight;
          if (planner) bucket.bits |= targetBits[index];
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
          expectedOneShotProb: values.reduce((sum, bucket) => sum + bucket.bestWins, 0) / total,
          entropy: -values.reduce((sum, bucket) => sum + bucket.weight / total * Math.log2(bucket.weight / total), 0),
          expectedSolveProb: planner ? values.reduce((sum, bucket) => sum + planner.evaluate(bucket.bits, horizonDepth).wins, 0) / total : null,
          expectedAttempts: planner ? values.reduce((sum, bucket) => sum + planner.evaluate(bucket.bits, horizonDepth).spent, 0) / total : null
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
        evaluationDepth: horizonDepth,
        currentSolveProb: planner ? planner.evaluate(allBits, horizonDepth).wins / total : currentOneShotProb,
        expectedSolveProb: planner ? outcomes.reduce((sum, outcome) => sum + outcome.expectedSolveProb, 0) / unknown.length : expectedOneShotProb,
        currentExpectedAttempts: planner ? planner.evaluate(allBits, horizonDepth).spent / total : null,
        expectedAttemptsAfterHint: planner ? outcomes.reduce((sum, outcome) => sum + outcome.expectedAttempts, 0) / unknown.length : null,
        informationEquivalentAttempts: outcomes.reduce((sum, outcome) => sum + outcome.entropy, 0) / unknown.length
          / Math.max(0.1, ...scores.map(score => score.adjustedEntropy)),
        outcomes
      };
      hint.solveGain = Math.max(0, hint.expectedSolveProb - hint.currentSolveProb);
      hint.attemptsSaved = planner ? Math.max(0, hint.currentExpectedAttempts - hint.expectedAttemptsAfterHint) : null;
      hint.guessedCount = used.size;
      hint.exact = horizonDepth <= 2 || planner?.exact === true;
      if (collectTiming) {
        addHintTiming(scores, targets, targetBits, planner, unknown, horizonDepth,
          getHintOpportunityCost(resourceAttempts, remainingHints, problemsLeft));
        const criteria = currentOneShotProb >= 1 - 1e-10 ? 'oneShot'
          : chooseCriteria({ attempts: requestedDepth, twoTurnExact, horizonDepth, candidateCount: total });
        hint.timing = sortScores(scores.map(score => ({ ...score, card: score.group[0].card })), criteria)[0]?.hintTiming ?? null;
      }
    }
    const snipes = [], scouts = [];
    for (const { group, branches, branchProfiles, winBits, actionKey, hintActionKey, winning, winningTargets, ...score } of scores) {
      for (const { card } of group) {
        const item = { card, profileKey: group[0].key, equivalentChoices: group.length, ...score };
        // A card outside the candidate set may still win via partial-frame matching.
        (score.oneShotProb > 0 ? snipes : scouts).push(item);
      }
    }
    return {
      snipes, scouts, twoTurnExact, horizonDepth, horizonExact: horizonDepth <= 2 || planner?.exact,
      planningAttempts: requestedDepth, profileCount: targets.length, total, hint,
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
    else if (criteria === 'horizon') difference = (b.horizonProb ?? -1) - (a.horizonProb ?? -1)
      || (a.horizonExpectedAttempts ?? Infinity) - (b.horizonExpectedAttempts ?? Infinity);
    else if (criteria === 'expected') difference = a.expectedRemaining - b.expectedRemaining;
    else if (criteria === 'minimax') difference = a.minimax - b.minimax;
    else difference = (b.adjustedEntropy ?? b.entropy) - (a.adjustedEntropy ?? a.entropy);
    return difference || (a.eliminationProb ?? 0) - (b.eliminationProb ?? 0) || b.oneShotProb - a.oneShotProb || a.expectedRemaining - b.expectedRemaining || b.entropy - a.entropy || a.card.id - b.card.id;
  });
}

export function chooseCriteria({ attempts, twoTurnExact, horizonDepth = 2, candidateCount }) {
  if (attempts <= 1) return 'oneShot';
  if (attempts >= 3 && horizonDepth >= 3) return 'horizon';
  if (attempts === 2 && twoTurnExact) return 'twoShot';
  return candidateCount <= TWO_TURN_LIMIT ? 'expected' : 'entropy';
}

export function allocateAttempts(totalAttempts) {
  const total = Number.isFinite(Number(totalAttempts)) ? Math.max(0, Math.floor(Number(totalAttempts))) : 0;
  // Future challenge difficulty is unknown. Use the available pool for the
  // current decision, then conserve resources by preferring fewer guesses.
  return total;
}

export function getHintOpportunityCost(attempts, remainingHints, problemsLeft = 1) {
  const tries = Number.isFinite(Number(attempts)) ? Math.max(0, Number(attempts)) : 0;
  const hints = Number.isFinite(Number(remainingHints)) ? Math.max(1, Number(remainingHints)) : 1;
  const problems = Number.isFinite(Number(problemsLeft)) ? Math.max(1, Number(problemsLeft)) : 1;
  return Math.min(2, Math.max(0.35, Math.sqrt(tries / (4 * hints))))
    + Math.min(0.5, Math.max(0, problems / hints - 1) * 0.1);
}

export function recommendHintUse({ attempts, remainingHints, problemsLeft = 1, candidateCount, hint, bestGuessExpectedRemaining,
  guessedCount = hint?.guessedCount ?? 0 }) {
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
  const evaluationDepth = hint.evaluationDepth ?? 1;
  const solveGain = Math.max(0, hint.solveGain ?? oneShotGain);
  const attemptsSaved = Math.max(0, hint.attemptsSaved ?? 0);
  const opportunityCost = getHintOpportunityCost(tries, hints, problems);
  const judgments = Number.isFinite(Number(guessedCount)) ? Math.max(0, Math.floor(Number(guessedCount))) : 0;
  const metrics = { expectedRemaining, reductionRate, oneShotGain, relativeToGuess, currentOneShotProb,
    expectedOneShotProb, scarcity, evaluationDepth, solveGain, attemptsSaved, opportunityCost, guessedCount: judgments };

  if (hintReduction < 0.5 && oneShotGain < 0.001) return { decision: 'save', reason: 'noValue', ...metrics };
  // Hints are granted at one quarter of the daily attempt rate. Preserve their
  // option value until an attempt can immediately use the revealed property.
  if (tries === 0) return { decision: 'save', reason: 'noAttempts', ...metrics };

  if (currentOneShotProb >= 1 - 1e-10) return { decision: 'save', reason: 'guaranteedGuess', ...metrics };
  if (problems === 1 && hints >= hint.unknownCount && opportunityCost <= 0.5) {
    return { decision: 'use', reason: 'finishRevealing', ...metrics };
  }

  const timing = hint.timing;
  if (timing) {
    const nowCost = timing.nowAttempts + opportunityCost;
    const waitCost = timing.waitAttempts + opportunityCost * timing.waitHints;
    const gainOverWaiting = timing.nowProb - timing.waitProb;
    if (gainOverWaiting < -1e-9 || (Math.abs(gainOverWaiting) <= 1e-9 && nowCost >= waitCost - 1e-9)) {
      return { decision: 'save', reason: 'waitForJudgment', ...metrics, timing };
    }
    const use = gainOverWaiting >= 0.02 * opportunityCost || (Math.abs(gainOverWaiting) <= 1e-9 && nowCost < waitCost - 1e-9);
    return { decision: use ? 'use' : 'save', reason: use ? (gainOverWaiting > 1e-9 ? 'betterThanWaiting' : 'saveAttempts') : 'weakValue', ...metrics, timing };
  }

  // A big initial pool supplies only a one-step estimate. Inspect the first
  // judgment before committing a scarce hint, unless the measured improvement
  // can already protect a short, nearly certain solution.
  const decisiveMeasuredGain = evaluationDepth >= 2 && hint.expectedSolveProb >= 0.9 && solveGain >= 0.25;
  if (tries > 1 && judgments === 0 && !decisiveMeasuredGain) {
    return { decision: 'save', reason: 'firstJudgment', ...metrics };
  }
  const informationValue = hint.informationEquivalentAttempts ?? 0;
  const protectsLastAttempt = tries === 1 && (problems === 1 ? solveGain > 1e-10 : solveGain >= Math.max(0.03, 0.08 * opportunityCost));
  const improvesSuccess = solveGain >= Math.min(0.35, 0.15 * opportunityCost);
  const savesAttempts = evaluationDepth >= 2 && attemptsSaved >= opportunityCost;
  const valuableInformation = judgments > 0 && evaluationDepth === 1 && informationValue >= opportunityCost
    && reductionRate >= 0.5 && oneShotGain >= 0.01;
  const use = protectsLastAttempt || improvesSuccess || savesAttempts || valuableInformation;
  return {
    decision: use ? 'use' : 'save',
    reason: use ? (protectsLastAttempt ? 'protectLastAttempt' : savesAttempts ? 'saveAttempts' : 'strongCurrentValue')
      : (scarcity === 'scarce' ? 'scarceResource' : 'weakValue'),
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
