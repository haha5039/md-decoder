import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { allCards, dataGeneratedAt } from '../src/cards_data.js';
import { MASTER_DUEL_DATA_URL, YGOPRO_ALL_DATA_URL, validateCards } from '../src/data.js';
import { filterCandidatesByHints, getGuessFeedback, hintsFromFeedback } from '../src/utils.js';
import { makeCard } from './fixtures/cards.js';

const isMonster = card => !['spell', 'trap'].includes(card.frameType);

function assertHealthyCards(cards) {
  validateCards(cards);
  for (const card of cards) {
    assert.ok(typeof card.nameEn === 'string' && card.nameEn.trim(), `Missing English name for ${card.id}`);
    assert.ok(typeof card.type === 'string' && card.type.trim(), `Missing card type for ${card.id}`);
    if (card.image_url != null) assert.match(card.image_url, /^https:\/\//, `Invalid image URL for ${card.id}`);
  }
}

function assertFeedbackKeepsTargets(cards) {
  const monsters = cards.filter(isMonster);
  assert.ok(monsters.length > 0);
  // These positions select cases, not expected outcomes. Every selected target
  // must survive its real feedback regardless of DB size, order or card values.
  for (let index = 0; index < Math.min(30, monsters.length); index++) {
    const target = monsters[(index * 307) % monsters.length];
    const guess = monsters[(index * 521 + 17) % monsters.length];
    const feedback = getGuessFeedback(guess, target);
    for (const stat of Object.keys(feedback.revealed)) assert.equal(feedback.matches[stat], true);
    assert.ok(filterCandidatesByHints(monsters, hintsFromFeedback(guess, feedback, 'data-check'))
      .some(card => card.id === target.id), `Feedback removed target ${target.id} after guess ${guess.id}`);
  }
}

test('bundled or refreshed data has valid identities, stats, names and images', context => {
  assertHealthyCards(allCards);
  assert.ok(Number.isFinite(Date.parse(dataGeneratedAt)), 'Missing or invalid data generation date');
  context.diagnostic(`Card data: ${allCards.length} cards, ${allCards.filter(isMonster).length} monsters.`);
});

test('deployment manifest describes exactly the generated module without fixed card totals', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../public/master_duel_manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.generatedAt, dataGeneratedAt);
  assert.deepEqual(manifest.sources, { masterDuel: MASTER_DUEL_DATA_URL, cardDetails: YGOPRO_ALL_DATA_URL });
  assert.equal(manifest.counts.cards, manifest.cards.length);
  assert.equal(manifest.counts.monsters, manifest.cards.filter(isMonster).length);
  assert.deepEqual(manifest.cards, allCards);
});

test('current data feedback keeps the true target after source ordering changes', () => {
  assertFeedbackKeepsTargets(allCards);
  assertFeedbackKeepsTargets([...allCards].reverse());
});

test('new releases, same-name variants and valid stat corrections do not impose snapshot totals', () => {
  const usedIds = new Set(allCards.map(card => card.id));
  let nextId = 2_000_000_000;
  const freshId = () => { while (usedIds.has(nextId)) nextId++; usedIds.add(nextId); return nextId++; };
  const added = [
    makeCard(freshId(), { race: 'Beast-Warrior', attribute: 'EARTH' }),
    makeCard(freshId(), { frameType: 'synchro_pendulum', type: 'Synchro Monster', level: 7 }),
    makeCard(freshId(), { nameEn: 'Black Luster Soldier', frameType: 'normal', type: 'Normal Monster' })
  ];
  const firstMonster = allCards.find(isMonster);
  const expanded = [...added, ...allCards.map(card => card.id === firstMonster.id
    ? { ...card, attribute: card.attribute === 'EARTH' ? 'LIGHT' : 'EARTH', atk: card.atk === -1 ? 0 : -1 }
    : card)];
  assertHealthyCards(expanded);
  assertFeedbackKeepsTargets(expanded);
});
