import { FRAME_ORDER } from './i18n.js';
import { filterCandidatesByHints, isFrameMatch } from './utils.js';

// Exact revealed frames are alternatives to X, not a second input after O.
export function getFrameResults(cards, guess, otherJudgments = []) {
  const candidates = filterCandidatesByHints(cards, otherJudgments);
  const matches = new Set();
  let mismatch = false;
  for (const card of candidates) {
    if (isFrameMatch(card, guess.frameType)) matches.add(card.frameType);
    else mismatch = true;
  }
  const frames = [...matches].sort((a, b) => FRAME_ORDER.indexOf(a) - FRAME_ORDER.indexOf(b));
  const values = [...(mismatch ? ['wrong'] : []), ...frames];
  return { values, automatic: values.length === 1 ? values[0] : null, valid: candidates.length > 0 };
}
