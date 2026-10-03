import { FRAME_ORDER } from './i18n.js';
import { filterCandidatesByHints, isFrameMatch } from './utils.js';

// Only frames that can match the submitted card remain eligible revelations.
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

// Ordinary O/X stays unchanged. Ask about Pendulum only on the first frame
// revelation; a non-Pendulum match determines the submitted card's base frame.
export function getFrameInput(cards, guess, {
  judgment = null, pendulum = false, frame = null, knownFrame = null, otherJudgments = []
} = {}) {
  const eligible = getFrameResults(cards, guess, otherJudgments);
  const confirmed = knownFrame && knownFrame !== 'pendulum' ? knownFrame : null;
  const frames = eligible.values.filter(value => value !== 'wrong' && value.split('_').includes('pendulum'));
  const showPendulum = judgment === 'correct' && !confirmed;
  const showKinds = showPendulum && pendulum;
  let result = null;
  if (judgment === 'wrong') result = 'wrong';
  else if (judgment === 'correct') {
    if (confirmed) result = confirmed;
    else if (!pendulum) result = guess.frameType.split('_').filter(part => part !== 'pendulum').join('_');
    // Never replace a user's explicit frame with a different automatic choice.
    else result = frame || (frames.length === 1 ? frames[0] : null);
  }
  const conflict = judgment !== null && (!eligible.valid
    || (result !== null && !eligible.values.includes(result))
    || (showKinds && frames.length === 0));
  return { showPendulum, showKinds, frames, result, conflict,
    ready: judgment !== null && result !== null && !conflict,
    automaticKind: showKinds && !frame && frames.length === 1 };
}
