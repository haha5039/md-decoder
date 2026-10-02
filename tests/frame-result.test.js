import test from 'node:test';
import assert from 'node:assert/strict';
import { getFrameResults } from '../src/frame-result.js';
import { allCards } from '../src/cards_data.js';
import { applyAutomaticMatches, removeInputBatch } from '../src/session.js';
import { filterCandidatesByHints, getGuessFeedback, hintsFromFeedback } from '../src/utils.js';

test('ordinary guesses offer exact frame results instead of an extra input after O', () => {
  const cards = ['effect', 'effect_pendulum', 'fusion'].map(frameType => ({ frameType }));
  assert.deepEqual(getFrameResults(cards, { frameType: 'effect' }).values, ['wrong', 'effect', 'effect_pendulum']);
});

test('a Pendulum guess offers either base matches or any matching Pendulum frame', () => {
  const cards = ['fusion', 'effect', 'normal_pendulum', 'effect_pendulum', 'fusion_pendulum', 'synchro_pendulum', 'xyz_pendulum'].map(frameType => ({ frameType }));
  assert.deepEqual(getFrameResults(cards, { frameType: 'fusion_pendulum' }).values,
    ['wrong', 'fusion', 'normal_pendulum', 'effect_pendulum', 'fusion_pendulum', 'synchro_pendulum', 'xyz_pendulum']);
});

test('known clues and other judgments fill only a logically determined frame result', () => {
  const guess = { frameType: 'effect', attribute: 'DARK' };
  const cards = [{ frameType: 'effect', attribute: 'DARK' }, { frameType: 'effect_pendulum', attribute: 'LIGHT' }];
  assert.equal(getFrameResults(cards, guess).automatic, null);
  assert.equal(getFrameResults(cards, guess, [{ type: 'guess', stat: 'attribute', value: 'DARK', isCorrect: true }]).automatic, 'effect');
  assert.equal(getFrameResults([{ frameType: 'fusion' }], guess).automatic, 'wrong');
  assert.equal(getFrameResults([], guess).automatic, null);
});

test('all official Pendulum examples keep the target with one exact result selection', () => {
  for (const [guessName, targetName] of [
    ['The Unstoppable Exodia Incarnate', 'Supreme King Z-ARC'],
    ['Clear Wing Fast Dragon', 'Supreme King Z-ARC'],
    ['Supreme King Z-ARC', 'The Unstoppable Exodia Incarnate']
  ]) {
    const guess = allCards.find(card => card.nameEn === guessName);
    const target = allCards.find(card => card.nameEn === targetName);
    const feedback = getGuessFeedback(guess, target);
    const batch = hintsFromFeedback(guess, feedback, 'g').filter(hint => hint.type === 'guess');
    batch[0].attemptCost = 1;
    const hints = applyAutomaticMatches(batch, [guess], { revealedFrames: { g: target.frameType } });
    assert.ok(filterCandidatesByHints(allCards, hints).some(card => card.id === target.id));
    assert.equal(hints.find(hint => hint.type === 'direct' && hint.stat === 'frameType').value, target.frameType);
    assert.equal(removeInputBatch(hints, 'g').hintsRefund, 0);
    assert.equal(removeInputBatch(hints, 'g').attemptsRefund, 1);
  }
});

test('a positive O alone preserves possible compound targets, and invalid exact results are rejected', () => {
  const cards = ['fusion', 'fusion_pendulum'].map((frameType, index) => ({ id: index + 1, frameType, level: 4 }));
  const batch = [{ type: 'guess', stat: 'frameType', value: 'fusion', isCorrect: true, cardId: 1, batchId: 'g' }];
  assert.equal(filterCandidatesByHints(cards, applyAutomaticMatches(batch, cards)).length, 2);
  assert.throws(() => applyAutomaticMatches(batch, cards, { revealedFrames: { g: 'link' } }));
});
