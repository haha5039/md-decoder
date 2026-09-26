import { createSolver, sortScores, chooseCriteria } from './solver.js';
import { filterCandidatesByHints, getRevealedValue, STAT_KEYS, getGuessFeedback, hintsFromFeedback } from './utils.js';

export function makeScenarios(cards, count = 12, seed = 20260926) {
  let state = seed >>> 0;
  return Array.from({ length: count }, (_, i) => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return { target: cards[state % cards.length], initialStat: STAT_KEYS[i % STAT_KEYS.length] };
  });
}

export function simulateScenario(cards, solve, { target, initialStat }, criteria = 'adaptive', limit = 8) {
  let hints = [{ type: 'direct', stat: initialStat, value: getRevealedValue(target, initialStat), isCorrect: true }];
  const used = [];
  let durationMs = 0;
  for (let attempt = 1; attempt <= limit; attempt++) {
    const candidates = filterCandidatesByHints(cards, hints);
    if (!candidates.some(card => card.id === target.id)) {
      return { success: false, eliminated: true, attempts: attempt - 1, durationMs };
    }
    const result = solve({ candidateIds: candidates.map(card => card.id), guessedIds: used,
      revealedStats: [...new Set(hints.filter(hint => hint.isCorrect).map(hint => hint.stat))] });
    durationMs += result.durationMs;
    let metric = criteria;
    if (criteria === 'adaptive') {
      metric = chooseCriteria({ attempts: limit - attempt + 1, twoTurnExact: result.twoTurnExact, candidateCount: candidates.length });
    }
    const guess = sortScores([...result.snipes, ...result.scouts], metric)[0]?.card;
    if (!guess) return { success: false, eliminated: false, attempts: attempt - 1, durationMs };
    if (used.includes(guess.id)) throw new Error('Repeated guess');
    used.push(guess.id);
    const feedback = getGuessFeedback(guess, target);
    if (feedback.won) return { success: true, eliminated: false, attempts: attempt, durationMs };
    hints.push(...hintsFromFeedback(guess, feedback, String(attempt)));
  }
  return { success: false, eliminated: false, attempts: limit, durationMs };
}

export function evaluateStrategies(cards, { count = 12, seed = 20260926, criteria = ['adaptive'], limit = 8 } = {}) {
  const scenarios = makeScenarios(cards, count, seed);
  const solve = createSolver(cards);
  return criteria.map(metric => {
    const results = scenarios.map(scenario => simulateScenario(cards, solve, scenario, metric, limit));
    const successes = results.filter(result => result.success);
    const sorted = successes.map(result => result.attempts).sort((a, b) => a - b);
    const within = n => results.filter(result => result.success && result.attempts <= n).length / count;
    return { criteria: metric, seed, games: count, maxAttempts: limit, failures: count - successes.length,
      eliminations: results.filter(result => result.eliminated).length,
      meanAttemptsSpent: results.reduce((sum, result) => sum + result.attempts, 0) / count,
      meanAttemptsOnSuccess: successes.length ? successes.reduce((sum, result) => sum + result.attempts, 0) / successes.length : null,
      p95AttemptsOnSuccess: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
      within2: within(2), within3: within(3), within4: within(4),
      averageCalculationMs: results.reduce((sum, result) => sum + result.durationMs, 0) / count };
  });
}
