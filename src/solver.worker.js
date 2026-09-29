import { createSolver } from './solver.js';
let solve;
const compact = ({ card, ...score }) => ({ ...score, cardId: card.id });
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      solve = createSolver(data.cards);
      return;
    }
    if (!solve) throw new Error('SOLVER_NOT_READY');
    const result = solve(data.request);
    self.postMessage({ id: data.id, result: {
      ...result,
      snipes: result.snipes.map(compact),
      scouts: result.scouts.map(compact)
    } });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
