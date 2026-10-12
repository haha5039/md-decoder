import assert from 'node:assert/strict';
import test from 'node:test';
import { makeCard, ruleCards } from './fixtures/cards.js';
import { filterCandidatesByHints, getGuessFeedback, hintsFromFeedback, mapFrameType } from '../src/utils.js';
import { applyAutomaticMatches } from '../src/session.js';

const revealedEffect = { type: 'direct', stat: 'frameType', value: 'effect', isCorrect: true };

test('an exact effect hint retains all pure effect cards and excludes compound frames', () => {
  const cards = [makeCard(1), makeCard(2, { frameType: 'effect_pendulum' }),
    makeCard(3, { attribute: 'EARTH', race: 'Beast-Warrior' }), makeCard(4, { frameType: 'normal' })];
  assert.deepEqual(filterCandidatesByHints(cards, [revealedEffect]).map(card => card.id), [1, 3]);
  const expanded = [...cards, makeCard(5, { attribute: 'EARTH' }), makeCard(6, { frameType: 'fusion' })];
  assert.deepEqual(filterCandidatesByHints(expanded, [revealedEffect]).map(card => card.id), [1, 3, 5]);
});

test('race and attribute clues select their intersection as new cards are added', () => {
  const cards = [makeCard(1, { race: 'Beast-Warrior', attribute: 'EARTH' }),
    makeCard(2, { race: 'Beast-Warrior' }), makeCard(3, { attribute: 'EARTH' }), makeCard(4)];
  const race = { type: 'direct', stat: 'race', value: 'Beast-Warrior', isCorrect: true };
  const attribute = { type: 'direct', stat: 'attribute', value: 'EARTH', isCorrect: true };
  assert.deepEqual(filterCandidatesByHints(cards, [race]).map(card => card.id), [1, 2]);
  assert.deepEqual(filterCandidatesByHints(cards, [attribute]).map(card => card.id), [1, 3]);
  assert.deepEqual(filterCandidatesByHints(cards, [race, attribute]).map(card => card.id), [1]);
  const expanded = [...cards, makeCard(5, { race: 'Beast-Warrior', attribute: 'EARTH' })];
  assert.deepEqual(filterCandidatesByHints(expanded, [race, attribute]).map(card => card.id), [1, 5]);
});

test('revealed compound frames are exact, even with the old partial-input flag', () => {
  const cards = ['effect', 'effect_pendulum', 'fusion', 'fusion_pendulum'].map(frameType => ({ frameType }));
  const hint = { ...revealedEffect, value: 'fusion_pendulum', isExact: false };
  assert.deepEqual(filterCandidatesByHints(cards, [hint]), [{ frameType: 'fusion_pendulum' }]);
});

test('the Pendulum frame filter includes every compound Pendulum frame', () => {
  const cards = ['effect', 'normal_pendulum', 'effect_pendulum', 'fusion_pendulum', 'link'].map(frameType => ({ frameType }));
  const hint = { type: 'direct', stat: 'frameType', value: 'pendulum', isCorrect: true };
  assert.deepEqual(filterCandidatesByHints(cards, [hint]).map(card => card.frameType), ['normal_pendulum', 'effect_pendulum', 'fusion_pendulum']);
});

test('guess feedback still matches either part of a Pendulum frame', () => {
  const cards = ['fusion', 'fusion_pendulum', 'synchro_pendulum', 'effect'].map(frameType => ({ frameType }));
  const guess = { type: 'guess', stat: 'frameType', value: 'fusion_pendulum', isCorrect: true };
  assert.deepEqual(filterCandidatesByHints(cards, [guess]), cards.slice(0, 3));
  assert.deepEqual(filterCandidatesByHints(cards, [{ ...guess, isCorrect: false }]), cards.slice(3));
});

test('partial frame matches reveal the full frame but do not make a different frame an accepted answer', () => {
  const target = { id: 1, frameType: 'synchro_pendulum', attribute: 'DARK', level: 8, race: 'Dragon', atk: 3000, def: 2500 };
  for (const frameType of ['synchro', 'effect_pendulum', 'fusion_pendulum']) {
    const guess = { ...target, id: 2, frameType };
    const feedback = getGuessFeedback(guess, target);
    assert.ok(Object.values(feedback.matches).every(Boolean));
    assert.equal(feedback.revealed.frameType, 'synchro_pendulum');
    assert.equal(feedback.won, false);
    assert.deepEqual(filterCandidatesByHints([guess, target], hintsFromFeedback(guess, feedback, 'g')), [target]);
    assert.equal(getGuessFeedback(target, guess).won, false);
  }
  assert.equal(getGuessFeedback({ ...target, id: 3, name: 'Equivalent card' }, target).won, true);
});

test('API frame normalization preserves each authoritative frame and exact filtering', () => {
  const cards = [makeCard(1, { type: 'Normal Tuner Monster', frameType: 'normal' }),
    makeCard(2, { type: 'Effect Monster', frameType: 'effect_pendulum' }), makeCard(3)];
  const updated = cards.map(card => ({ ...card, frameType: mapFrameType(card.type, card.frameType) }));
  assert.deepEqual(updated.map(card => [card.id, card.frameType]), [[1, 'normal'], [2, 'effect_pendulum'], [3, 'effect']]);
  assert.deepEqual(filterCandidatesByHints(updated, [revealedEffect]).map(card => card.id), [3]);
  assert.equal(mapFrameType('Normal Tuner Monster', 'normal'), 'normal');
  assert.equal(mapFrameType('Pendulum Tuner Effect Monster', 'normal_pendulum'), 'normal_pendulum');
  assert.equal(mapFrameType('Spirit Monster', 'effect_pendulum'), 'effect_pendulum');
  assert.equal(mapFrameType('Normal Tuner Monster'), 'normal');
  assert.equal(mapFrameType('Pendulum Effect Fusion Monster'), 'fusion_pendulum');
});

test('R-Genex Turing O/X input retains matching targets and rejects each conflicting stat', () => {
  const guess = ruleCards.find(card => card.nameEn === 'R-Genex Turing');
  const target = { ...guess, id: 101, attribute: 'EARTH', race: 'Machine', def: 400 };
  const cards = [guess, target, { ...target, id: 102, race: 'Warrior' },
    ...[
      { frameType: 'normal' }, { frameType: 'effect_pendulum' }, { level: 3 },
      { attribute: 'DARK' }, { race: 'Spellcaster' }, { atk: 700 }, { def: 600 }
    ].map((extra, index) => ({ ...target, id: 200 + index, ...extra }))];
  const results = {
    frameType: true,
    level: true,
    attribute: false,
    race: false,
    atk: true,
    def: false
  };
  const batch = Object.entries(results).map(([stat, isCorrect]) => ({
    type: 'guess',
    stat,
    isCorrect,
    value: stat === 'level' ? [guess.level] : guess[stat],
    cardId: guess.id,
    batchId: 'r-genex-turing'
  }));
  const hints = applyAutomaticMatches(batch, [guess], { revealedFrames: { 'r-genex-turing': 'effect' } });
  assert.deepEqual(filterCandidatesByHints(cards, hints).map(card => card.id), [101, 102]);
});

test('revealed Pendulum frame keeps the official Z-ARC example target', () => {
  const guess = ruleCards.find(card => card.nameEn === 'The Unstoppable Exodia Incarnate');
  const target = ruleCards.find(card => card.nameEn === 'Supreme King Z-ARC');
  const feedback = getGuessFeedback(guess, target);
  assert.equal(feedback.matches.frameType, true);
  assert.equal(feedback.revealed.frameType, 'fusion_pendulum');
  assert.ok(filterCandidatesByHints(ruleCards, hintsFromFeedback(guess, feedback, 'zarc')).some(card => card.id === target.id));
});
