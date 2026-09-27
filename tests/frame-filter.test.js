import assert from 'node:assert/strict';
import test from 'node:test';
import { allCards } from '../src/cards_data.js';
import { filterCandidatesByHints, getGuessFeedback, hintsFromFeedback, mapFrameType } from '../src/utils.js';
import { applyAutomaticMatches } from '../src/session.js';

const monsters = allCards.filter(card => !['spell', 'trap'].includes(card.frameType));
const revealedEffect = { type: 'direct', stat: 'frameType', value: 'effect', isCorrect: true };

test('Master Duel source contains 5796 effect monsters', () => {
  assert.ok(monsters.length >= 9059);
  const candidates = filterCandidatesByHints(monsters, [revealedEffect]);
  assert.ok(candidates.length >= 5796);
  assert.ok(candidates.every(card => card.frameType === 'effect'));
});

test('Master Duel source includes observed live cards and a sane race distribution', () => {
  assert.ok(monsters.filter(card => card.race === 'Beast-Warrior').length >= 261);
  assert.ok(monsters.some(card => card.id === 14556954));
  assert.ok(monsters.some(card => card.id === 68059897));
});

test('revealed compound frames are exact, even with the old partial-input flag', () => {
  const cards = ['effect', 'effect_pendulum', 'fusion', 'fusion_pendulum'].map(frameType => ({ frameType }));
  const hint = { ...revealedEffect, value: 'fusion_pendulum', isExact: false };
  assert.deepEqual(filterCandidatesByHints(cards, [hint]), [{ frameType: 'fusion_pendulum' }]);
});

test('guess feedback still matches either part of a Pendulum frame', () => {
  const cards = ['fusion', 'fusion_pendulum', 'synchro_pendulum', 'effect'].map(frameType => ({ frameType }));
  const guess = { type: 'guess', stat: 'frameType', value: 'fusion_pendulum', isCorrect: true };
  assert.deepEqual(filterCandidatesByHints(cards, [guess]), cards.slice(0, 3));
  assert.deepEqual(filterCandidatesByHints(cards, [{ ...guess, isCorrect: false }]), cards.slice(3));
});

test('database update preserves API frames and the same event count', () => {
  const updated = monsters.map(card => ({ ...card, frameType: mapFrameType(card.type, card.frameType) }));
  assert.equal(filterCandidatesByHints(updated, [revealedEffect]).length, 5796);
  assert.equal(mapFrameType('Normal Tuner Monster', 'normal'), 'normal');
  assert.equal(mapFrameType('Pendulum Tuner Effect Monster', 'normal_pendulum'), 'normal_pendulum');
  assert.equal(mapFrameType('Spirit Monster', 'effect_pendulum'), 'effect_pendulum');
  assert.equal(mapFrameType('Normal Tuner Monster'), 'normal');
  assert.equal(mapFrameType('Pendulum Effect Fusion Monster'), 'fusion_pendulum');
});

test('R-Genex Turing O/X input matches the observed in-game count', () => {
  const guess = monsters.find(card => card.nameEn === 'R-Genex Turing');
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
  const hints = applyAutomaticMatches(batch, [guess]);
  assert.ok(filterCandidatesByHints(monsters, hints).length >= 18);
});

test('revealed Pendulum frame keeps the official Z-ARC example target', () => {
  const guess = monsters.find(card => card.nameEn === 'The Unstoppable Exodia Incarnate');
  const target = monsters.find(card => card.nameEn === 'Supreme King Z-ARC');
  const feedback = getGuessFeedback(guess, target);
  assert.equal(feedback.matches.frameType, true);
  assert.equal(feedback.revealed.frameType, 'fusion_pendulum');
  assert.ok(filterCandidatesByHints(monsters, hintsFromFeedback(guess, feedback, 'zarc')).some(card => card.id === target.id));
});
