import test from 'node:test';
import assert from 'node:assert/strict';
import { getFrameInput, getFrameResults } from '../src/frame-result.js';
import { allCards } from '../src/cards_data.js';
import { applyAutomaticMatches, removeInputBatch } from '../src/session.js';
import { filterCandidatesByHints, getGuessFeedback, hintsFromFeedback } from '../src/utils.js';

test('ordinary guesses restrict eligible revelations to matching full frames', () => {
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

test('a frame X for MiSolfachord Eliteia excludes all Pendulum questions on later guesses', () => {
  const monsters = allCards.filter(card => !['spell', 'trap'].includes(card.frameType));
  const first = monsters.find(card => card.nameEn === 'MiSolfachord Eliteia');
  const remaining = filterCandidatesByHints(monsters, [{ type: 'guess', stat: 'frameType',
    value: first.frameType, isCorrect: false }]);
  assert.ok(remaining.length > 0);
  assert.ok(remaining.every(card => !card.frameType.split('_').includes('effect')
    && !card.frameType.split('_').includes('pendulum')));
  for (const name of ['Clear Wing Synchro Dragon', 'Clear Wing Fast Dragon']) {
    const next = monsters.find(card => card.nameEn === name);
    const input = getFrameInput(remaining, next, { judgment: 'correct' });
    assert.equal(input.showPendulum, false); assert.equal(input.showKinds, false);
    assert.equal(input.result, 'synchro'); assert.equal(input.ready, true);
    assert.equal(input.conflict, false);
  }
});

test('a non-Pendulum frame X preserves questions about unrelated Pendulum frames', () => {
  const cards = ['effect', 'effect_pendulum', 'fusion', 'fusion_pendulum'].map(frameType => ({ frameType }));
  const remaining = filterCandidatesByHints(cards, [{ type: 'guess', stat: 'frameType', value: 'effect', isCorrect: false }]);
  const input = getFrameInput(remaining, { frameType: 'fusion' }, { judgment: 'correct' });
  assert.equal(input.showPendulum, true);
  assert.deepEqual(input.frames, ['fusion_pendulum']);
});

test('other pending judgments can rule out Pendulum without an additional question', () => {
  const guess = { frameType: 'effect', attribute: 'DARK' };
  const cards = [{ frameType: 'effect', attribute: 'DARK' }, { frameType: 'effect_pendulum', attribute: 'LIGHT' }];
  const input = getFrameInput(cards, guess, { judgment: 'correct',
    otherJudgments: [{ type: 'guess', stat: 'attribute', value: 'DARK', isCorrect: true }] });
  assert.equal(input.showPendulum, false); assert.equal(input.result, 'effect');
  assert.equal(input.ready, true);
});

test('a conflicting non-frame result is reported before the frame judgment is selected', () => {
  const input = getFrameInput([{ frameType: 'effect', attribute: 'DARK' }],
    { frameType: 'fusion', attribute: 'LIGHT' }, {
      otherJudgments: [{ type: 'guess', stat: 'attribute', value: 'LIGHT', isCorrect: true }]
    });
  assert.equal(input.conflict, true); assert.equal(input.ready, false);
  assert.equal(input.showPendulum, false);
});

test('an explicit impossible Pendulum O stays visible for correction and blocks recording', () => {
  const input = getFrameInput([{ frameType: 'synchro' }], { frameType: 'synchro_pendulum' },
    { judgment: 'correct', pendulum: true, frame: 'synchro_pendulum' });
  assert.equal(input.showPendulum, true); assert.equal(input.conflict, true);
  assert.equal(input.ready, false);
});

test('all official Pendulum examples keep the target with progressive frame input', () => {
  for (const [guessName, targetName] of [
    ['The Unstoppable Exodia Incarnate', 'Supreme King Z-ARC'],
    ['Clear Wing Fast Dragon', 'Supreme King Z-ARC'],
    ['Supreme King Z-ARC', 'The Unstoppable Exodia Incarnate']
  ]) {
    const guess = allCards.find(card => card.nameEn === guessName);
    const target = allCards.find(card => card.nameEn === targetName);
    const feedback = getGuessFeedback(guess, target);
    const input = getFrameInput(allCards, guess, { judgment: 'correct',
      pendulum: target.frameType.includes('_pendulum'), frame: target.frameType.includes('_pendulum') ? target.frameType : null });
    assert.equal(input.ready, true);
    assert.equal(input.result, target.frameType);
    const batch = hintsFromFeedback(guess, feedback, 'g').filter(hint => hint.type === 'guess');
    batch[0].attemptCost = 1;
    const hints = applyAutomaticMatches(batch, [guess], { revealedFrames: { g: input.result } });
    assert.ok(filterCandidatesByHints(allCards, hints).some(card => card.id === target.id));
    assert.equal(hints.find(hint => hint.type === 'direct' && hint.stat === 'frameType').value, target.frameType);
    assert.equal(removeInputBatch(hints, 'g').hintsRefund, 0);
    assert.equal(removeInputBatch(hints, 'g').attemptsRefund, 1);
  }
});

test('additional questions appear only on O, with a non-Pendulum default and one automatic kind', () => {
  const cards = ['effect', 'effect_pendulum', 'fusion'].map(frameType => ({ frameType }));
  const guess = { frameType: 'effect' };
  assert.equal(getFrameInput(cards, guess).showPendulum, false);
  const wrong = getFrameInput(cards, guess, { judgment: 'wrong' });
  assert.equal(wrong.showPendulum, false); assert.equal(wrong.ready, true);
  const ordinary = getFrameInput(cards, guess, { judgment: 'correct' });
  assert.equal(ordinary.showPendulum, true); assert.equal(ordinary.showKinds, false);
  assert.equal(ordinary.result, 'effect'); assert.equal(ordinary.ready, true);
  const pendulum = getFrameInput(cards, guess, { judgment: 'correct', pendulum: true });
  assert.deepEqual(pendulum.frames, ['effect_pendulum']);
  assert.equal(pendulum.showKinds, true); assert.equal(pendulum.automaticKind, true);
  assert.equal(pendulum.result, 'effect_pendulum'); assert.equal(pendulum.ready, true);
});

test('a Pendulum-only match needs the actual kind and never defaults to the submitted kind', () => {
  const cards = ['fusion', 'effect', 'fusion_pendulum', 'synchro_pendulum'].map(frameType => ({ frameType }));
  const guess = { frameType: 'fusion_pendulum' };
  const pending = getFrameInput(cards, guess, { judgment: 'correct', pendulum: true });
  assert.deepEqual(pending.frames, ['fusion_pendulum', 'synchro_pendulum']);
  assert.equal(pending.result, null); assert.equal(pending.ready, false);
  assert.equal(getFrameInput(cards, guess, { judgment: 'correct', pendulum: true, frame: 'synchro_pendulum' }).ready, true);
  assert.equal(getFrameInput(cards, guess, { judgment: 'correct' }).result, 'fusion');
});

test('an already revealed exact frame skips both additional questions, including subsequent guesses', () => {
  const cards = [{ frameType: 'fusion_pendulum' }];
  const input = getFrameInput(cards, { frameType: 'synchro_pendulum' }, { judgment: 'correct', knownFrame: 'fusion_pendulum' });
  assert.equal(input.showPendulum, false); assert.equal(input.showKinds, false);
  assert.equal(input.result, 'fusion_pendulum'); assert.equal(input.ready, true);
  const wrongO = getFrameInput(cards, { frameType: 'effect' }, { judgment: 'correct', knownFrame: 'fusion_pendulum' });
  assert.equal(wrongO.conflict, true); assert.equal(wrongO.ready, false);
});

test('contradictory results and generic Pendulum hints cannot invent or replace exact revelations', () => {
  const cards = [{ frameType: 'fusion_pendulum' }];
  const guess = { frameType: 'fusion' };
  assert.equal(getFrameInput(cards, guess, { judgment: 'correct' }).conflict, true);
  assert.equal(getFrameInput(cards, guess, { judgment: 'correct', knownFrame: 'pendulum' }).showPendulum, true);
  const conflicting = getFrameInput(cards, guess, { judgment: 'correct', pendulum: true, frame: 'synchro_pendulum' });
  assert.equal(conflicting.result, 'synchro_pendulum');
  assert.equal(conflicting.conflict, true); assert.equal(conflicting.ready, false);
});

test('a positive O alone preserves possible compound targets, and invalid exact results are rejected', () => {
  const cards = ['fusion', 'fusion_pendulum'].map((frameType, index) => ({ id: index + 1, frameType, level: 4 }));
  const batch = [{ type: 'guess', stat: 'frameType', value: 'fusion', isCorrect: true, cardId: 1, batchId: 'g' }];
  assert.equal(filterCandidatesByHints(cards, applyAutomaticMatches(batch, cards)).length, 2);
  assert.throws(() => applyAutomaticMatches(batch, cards, { revealedFrames: { g: 'link' } }));
});
