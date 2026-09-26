import { createSolver } from './solver.js';
let solve;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      solve = createSolver(data.cards);
      return;
    }
    if (!solve) throw new Error('카드 데이터가 준비되지 않았습니다.');
    self.postMessage({ id: data.id, result: solve(data.request) });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
