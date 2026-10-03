import test from 'node:test';
import assert from 'node:assert/strict';
import { isCardDecoderEligible, mergeMasterDuelCards, normalizeCards, validateCards } from '../src/data.js';
import { applyAutomaticMatches, budget, consumeAttempt, createBatchId, initialHintAvailable, recordDirectHints, nextChallenge, parseStatInput, removeInputBatch, restoreSession, saveSession, hasSolvedGuess } from '../src/session.js';
import { escapeHTML, getGuessFeedback, hintsFromFeedback } from '../src/utils.js';
import { ATTRIBUTE_ORDER, FRAME_ORDER, RACE_ORDER, localizeCardName, setLocale, t } from '../src/i18n.js';

const api = { id: 1, name: 'Card', type: 'Effect Monster', frameType: 'effect', attribute: 'DARK', level: 0, race: 'Dragon', atk: -1, def: 0 };

test('normalization preserves zero, unknown ATK, translations and authoritative frames', () => {
  const [card] = normalizeCards([api], [], [{ id: 1, name: '기존 번역' }]);
  assert.equal(card.level, 0); assert.equal(card.atk, -1); assert.equal(card.def, 0); assert.equal(card.name, '기존 번역');
  assert.equal(normalizeCards([{ ...api, type: 'Normal Tuner Monster', frameType: 'normal' }])[0].frameType, 'normal');
});

test('bad responses cannot replace the database; alternate artwork is deduplicated', () => {
  assert.throws(() => normalizeCards([])); assert.throws(() => validateCards([]));
  assert.throws(() => normalizeCards([{ ...api, attribute: null }]));
  assert.throws(() => normalizeCards([{ ...api, level: 99 }]));
  assert.equal(normalizeCards([api, { ...api, id: 2 }, { ...api, id: 3, name: 'Token', type: 'Token' }]).length, 1);
  assert.throws(() => normalizeCards([api], [], Array.from({ length: 5 }, (_, i) => ({ id: i, name: 'Old' }))));
});

test('Master Duel allowlist controls inclusion while YGOPRO supplies card details', () => {
  const details = [api, { ...api, id: 2, name: 'VIP Whale' }, { ...api, id: 3, name: 'Shiba-Warrior Taro' }];
  const masterDuel = [{ en_name: 'Card', ko_name: '카드' }, { en_name: 'VIP Whale', ko_name: 'VIP 웨일' }];
  const cards = mergeMasterDuelCards(masterDuel, details);
  assert.deepEqual(cards.map(card => card.id), [1, 2]);
  assert.equal(cards[0].name, '카드');
  assert.ok(!cards.some(card => card.id === 3));
});

test('Master Duel values override conflicting generic API stats', () => {
  const details = [{
    ...api,
    id: 72246674,
    name: 'Gladiator Beast Dareios',
    type: 'Link Monster',
    frameType: 'link',
    attribute: 'DARK',
    level: 2,
    race: 'Beast-Warrior',
    atk: 1700,
    def: null,
    card_images: [{ id: 72246674, image_url_cropped: 'https://example.com/dareios.jpg' }]
  }];
  const source = [{
    title: 'Gladiator Beast Dareios (Master Duel)',
    en_name: 'Gladiator Beast Dareios',
    ko_name: '검투수 다레이오스',
    types: 'Beast-Warrior  / Link / Effect',
    attribute: 'EARTH',
    link_arrows: 'Bottom-Center, Bottom-Right',
    atk: '1700',
    yugipedia_page_id: 1248708
  }];

  const [card] = mergeMasterDuelCards(source, details);
  assert.deepEqual({
    id: card.id,
    frameType: card.frameType,
    attribute: card.attribute,
    level: card.level,
    race: card.race,
    atk: card.atk,
    def: card.def
  }, {
    id: 72246674,
    frameType: 'link',
    attribute: 'EARTH',
    level: 2,
    race: 'Beast-Warrior',
    atk: 1700,
    def: null
  });
});

test('Master Duel ranks are retained as the event level value', () => {
  const detail = { ...api, id: 65301952, name: 'Alchemic Magician', type: 'XYZ Monster', frameType: 'xyz', level: 4 };
  const source = [{
    title: 'Alchemic Magician (Master Duel)',
    en_name: 'Alchemic Magician',
    ko_name: '알케믹 매지션',
    types: 'Spellcaster / Xyz / Effect',
    attribute: 'DARK',
    rank: '4',
    atk: '1500',
    def: '1500',
    yugipedia_page_id: 110744
  }];

  const [card] = mergeMasterDuelCards(source, [detail]);
  assert.equal(card.frameType, 'xyz');
  assert.equal(card.level, 4);
});

test('hybrid merge preserves an existing alternate-art card ID', () => {
  const detail = { ...api, id: 20, name: 'Card', card_images: [
    { id: 20, image_url_cropped: 'https://example.com/20.jpg' },
    { id: 10, image_url_cropped: 'https://example.com/10.jpg' }
  ] };
  const [card] = mergeMasterDuelCards([{ en_name: 'Card', ko_name: '카드' }], [detail], [{ ...api, id: 10, nameEn: 'Card', name: '기존 카드' }]);
  assert.equal(card.id, 10);
  assert.equal(card.image_url, 'https://example.com/10.jpg');
});

test('collaboration campaign records are excluded by metadata', () => {
  assert.equal(isCardDecoderEligible({ releases: '"Power Pros" Collab Campaign; February 24, 2023' }), false);
  assert.equal(isCardDecoderEligible({ releases: 'Legacy Pack; January 27, 2026' }), true);
});

test('same-name Master Duel variants remain separate cards', () => {
  const ritual = { ...api, id: 10, name: 'Black Luster Soldier', type: 'Ritual Monster', frameType: 'ritual', level: 8, race: 'Warrior', atk: 3000, def: 2500 };
  const records = [
    { title: 'Black Luster Soldier (Master Duel Normal)', main: 'Black Luster Soldier (Normal)', en_name: 'Black Luster Soldier', ko_name: '카오스 솔저', types: 'Warrior / Normal', attribute: 'EARTH', level: '8', atk: '3000', def: '2500', yugipedia_page_id: 1163701 },
    { title: 'Black Luster Soldier (Master Duel)', en_name: 'Black Luster Soldier', ko_name: '카오스 솔저', types: 'Warrior / Ritual', attribute: 'EARTH', level: '8', atk: '3000', def: '2500', yugipedia_page_id: 713774 }
  ];
  const cards = mergeMasterDuelCards(records, [ritual]);
  assert.equal(cards.length, 2);
  assert.deepEqual(new Set(cards.map(card => card.frameType)), new Set(['normal', 'ritual']));
  assert.equal(cards.find(card => card.frameType === 'normal').id, 1_501_163_701);
});

test('normalized name collisions are resolved by card frame', () => {
  const details = [
    { ...api, id: 1, name: 'Rai-Mei', frameType: 'effect', type: 'Effect Monster', race: 'Thunder' },
    { ...api, id: 2, name: 'Raimei', frameType: 'spell', type: 'Spell Card', race: 'Normal', attribute: null, level: null, atk: null, def: null }
  ];
  const records = [
    { title: 'Rai-Mei (Master Duel)', en_name: 'Rai-Mei', ko_name: 'RAI－MEI', types: 'Thunder / Effect', attribute: 'LIGHT', level: '3', atk: '1400', def: '1200', yugipedia_page_id: 812743 },
    { title: 'Raimei (Master Duel)', en_name: 'Raimei', ko_name: '뇌명', card_type: 'Spell', property: 'Normal', yugipedia_page_id: 712744 }
  ];
  const cards = mergeMasterDuelCards(records, details);
  assert.deepEqual(cards.map(card => [card.id, card.frameType]), [[1, 'effect'], [2, 'spell']]);
});

test('recording free revelations never consumes or refunds paid hints', () => {
  const hints = [{ type: 'guess', batchId: 'g', attemptCost: 1 }, { type: 'direct', batchId: 'g', hintCost: 0 }, { type: 'direct', batchId: 'h', hintCost: 1 }];
  assert.deepEqual(removeInputBatch(hints, 'g'), { hints: [hints[2]], attemptsRefund: 1, hintsRefund: 0 });
  assert.equal(removeInputBatch(hints, 'h').hintsRefund, 1);
  assert.equal(budget(-1), 0); assert.equal(budget('abc'), 0); assert.equal(budget(0, 1), 1);
  assert.equal(budget(10000), 999);
});

test('guess results remain recordable when no attempts are left', () => {
  assert.deepEqual(consumeAttempt(4), { remaining: 3, cost: 1 });
  assert.deepEqual(consumeAttempt(0), { remaining: 0, cost: 0 });
});

const direct = (stat, value, batchId) => ({ type: 'direct', stat, value, isCorrect: true, isExact: true, batchId });

test('first property is free, each later hint costs one, and undo refunds only actual deductions', () => {
  const first = recordDirectHints([], [direct('attribute', 'DARK', 'first')], 2);
  assert.equal(first.remaining, 2); assert.equal(first.hints[0].hintKind, 'initial');
  const second = recordDirectHints(first.hints, [direct('atk', 1000, 'second')], first.remaining);
  assert.equal(second.remaining, 1); assert.equal(second.cost, 1);
  assert.equal(removeInputBatch([...first.hints, ...second.hints], 'second').hintsRefund, 1);
  assert.equal(removeInputBatch(first.hints, 'first').hintsRefund, 0);
});

test('multi-property input includes only one initial free property and remains recordable at zero', () => {
  const recorded = recordDirectHints([], [direct('attribute', 'DARK', 'a'), direct('atk', 1000, 'a'), direct('def', 1000, 'a')], 1);
  assert.equal(recorded.remaining, 0); assert.equal(recorded.cost, 1);
  assert.deepEqual(recorded.hints.map(hint => hint.hintCost), [0, 1, 0]);
  const extra = recordDirectHints(recorded.hints, [direct('race', 'Dragon', 'b')], 0);
  assert.equal(extra.hints.length, 1); assert.equal(extra.remaining, 0);
  assert.equal(removeInputBatch(extra.hints, 'b').hintsRefund, 0);
});

test('bonus revelations and automatic guess matches do not consume the initial free recording', () => {
  const automatic = applyAutomaticMatches([{ type: 'guess', stat: 'frameType', isCorrect: true, cardId: 1, batchId: 'guess' }], [api]);
  assert.equal(initialHintAvailable(automatic), true);
  const bonus = recordDirectHints(automatic, [direct('atk', 1000, 'bonus')], 2, { bonus: true });
  assert.equal(bonus.remaining, 2); assert.equal(initialHintAvailable(bonus.hints), true);
  const initial = recordDirectHints(bonus.hints, [direct('attribute', 'DARK', 'initial')], 2);
  assert.equal(initial.cost, 0);
});

test('hint costs survive reload, old clues are not charged retroactively, and next challenge is free again', () => {
  const recorded = recordDirectHints([], [direct('attribute', 'DARK', 'a'), direct('atk', 1000, 'b')], 3);
  let saved;
  const storage = { setItem: (_, value) => { saved = value; }, getItem: () => saved };
  saveSession(storage, { hints: recorded.hints, attempts: 4, remainingHints: recorded.remaining, problems: 2 });
  const restored = restoreSession(storage, [api]);
  assert.equal(initialHintAvailable(restored.hints), false);
  assert.equal(removeInputBatch(restored.hints, 'b').hintsRefund, 1);
  assert.equal(initialHintAvailable([direct('attribute', 'DARK', 'legacy')]), false);
  const next = nextChallenge(restored);
  assert.equal(initialHintAvailable(next.hints), true);
  assert.equal(recordDirectHints(next.hints, [direct('race', 'Dragon', 'next')], next.remainingHints).cost, 0);
});

test('batch IDs work without secure-context browser APIs', () => {
  const first = createBatchId('direct');
  const second = createBatchId('direct');
  assert.match(first, /^direct_[a-z0-9]+_[a-z0-9]+$/);
  assert.notEqual(first, second);
});

test('stat input distinguishes unknown ?, absent DEF, zero and invalid numbers', () => {
  assert.equal(parseStatInput('?', 'atk'), -1); assert.equal(parseStatInput('0', 'def'), 0);
  assert.equal(parseStatInput('', 'level'), undefined);
  assert.throws(() => parseStatInput('4.5', 'level')); assert.throws(() => parseStatInput('14', 'level')); assert.throws(() => parseStatInput('Infinity', 'atk'));
});

test('sessions round-trip and storage failure or removed cards are handled', () => {
  const values = new Map(); const storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) };
  const saved = { hints: [{ type: 'guess', stat: 'level', value: [4], isCorrect: true, cardId: 1, batchId: 'a' }], attempts: 3, remainingHints: 2, problems: 1 };
  assert.equal(saveSession(storage, saved), true); assert.deepEqual(restoreSession(storage, [api]), saved);
  assert.equal(restoreSession(storage, []), null);
  assert.equal(saveSession({ setItem() { throw new Error('quota'); } }, saved), false);
});

test('card names and attributes cannot inject HTML', () => {
  assert.equal(escapeHTML('<img src=x onerror="x"> & \'test\''), '&lt;img src=x onerror=&quot;x&quot;&gt; &amp; &#39;test&#39;');
});

test('a complete correct submission ends the challenge; partial rows do not', () => {
  const hints = hintsFromFeedback(api, getGuessFeedback(api, api), 'g');
  assert.equal(hasSolvedGuess(hints, [api]), true);
  assert.equal(hasSolvedGuess(hints.filter(hint => hint.stat !== 'def'), [api]), false);
  assert.equal(hasSolvedGuess(hints.map(hint => ({ ...hint, isCorrect: hint.stat !== 'atk' })), [api]), false);
});

test('all-O partial frame results do not end the challenge, including restored sessions', () => {
  const target = { ...api, frameType: 'synchro_pendulum' };
  const guess = { ...api, frameType: 'synchro' };
  const hints = hintsFromFeedback(guess, getGuessFeedback(guess, target), 'g');
  assert.ok(hints.filter(hint => hint.type === 'guess').every(hint => hint.isCorrect));
  assert.equal(hasSolvedGuess(hints, [guess]), false);
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) };
  saveSession(storage, { hints, attempts: 3, remainingHints: 1, problems: 1 });
  const restored = restoreSession(storage, [guess]);
  assert.equal(hasSolvedGuess(restored.hints, [guess]), false);
  assert.equal(restored.attempts, 3); assert.equal(restored.remainingHints, 1);
  assert.equal(hasSolvedGuess(hints.filter(hint => hint.type !== 'direct'), [guess]), false);
});

test('session restore removes unsafe inferred values from older versions', () => {
  const values = new Map();
  values.set('md-decoder-session-v1', JSON.stringify({ hints: [
    { type: 'guess', stat: 'frameType', value: 'fusion', isCorrect: true, cardId: 1, batchId: 'g' },
    { type: 'direct', stat: 'frameType', value: 'fusion', isCorrect: true, inferred: true, batchId: 'g' }
  ], attempts: 3, remainingHints: 1, problems: 2 }));
  const restored = restoreSession({ getItem: key => values.get(key) }, [api]);
  assert.equal(restored.hints.length, 1);
  assert.equal(restored.hints[0].type, 'guess');
  assert.equal(restored.migrated, true);
});

test('next challenge preserves resources and decreases remaining problems', () => {
  assert.deepEqual(nextChallenge({ attempts: 7, remainingHints: 2, problems: 3 }), { hints: [], attempts: 7, remainingHints: 2, problems: 2 });
  assert.equal(nextChallenge({ attempts: 0, remainingHints: 0, problems: 1 }).problems, 1);
});

test('only level is automatic; a frame match does not invent an exact frame', () => {
  const card = { ...api, id: 7, frameType: 'effect', level: 2 };
  const batch = [
    { type: 'guess', stat: 'frameType', value: 'effect', isCorrect: true, cardId: 7, batchId: 'g' },
    { type: 'guess', stat: 'level', value: [2], isCorrect: true, cardId: 7, batchId: 'g' }
  ];
  const completed = applyAutomaticMatches(batch, [card]);
  assert.equal(completed.some(hint => hint.type === 'direct' && hint.stat === 'frameType'), false);
  assert.ok(completed.some(hint => hint.supplemental && hint.stat === 'level' && hint.value === 2));
});

test('restoring a session drops generated frame assumptions and retains actual revealed frames', () => {
  const stored = { hints: [
    { type: 'guess', stat: 'frameType', value: 'effect', isCorrect: true, cardId: 1, batchId: 'old' },
    { type: 'direct', stat: 'frameType', value: 'effect', isCorrect: true, supplemental: true, automatic: true, batchId: 'old' },
    { type: 'direct', stat: 'frameType', value: 'effect_pendulum', isCorrect: true, supplemental: true, source: 'judgment', hintCost: 0, batchId: 'real' }
  ], attempts: 3, remainingHints: 1, problems: 1 };
  const restored = restoreSession({ getItem: () => JSON.stringify(stored) }, [api]);
  assert.equal(restored.hints.length, 2); assert.equal(restored.migrated, true);
  assert.equal(restored.hints[1].value, 'effect_pendulum');
  assert.equal(restored.remainingHints, 1);
});

test('correcting an already revealed frame is free and does not consume the initial hint allowance', () => {
  const revealed = { ...direct('frameType', 'effect_pendulum', 'guess'), source: 'judgment', supplemental: true };
  const recorded = recordDirectHints([], [revealed], 1);
  assert.equal(recorded.cost, 0); assert.equal(recorded.remaining, 1);
  assert.equal(initialHintAvailable(recorded.hints), true);
});

test('filter options follow the requested in-game order', () => {
  assert.deepEqual(FRAME_ORDER, ['normal', 'effect', 'fusion', 'ritual', 'synchro', 'xyz', 'pendulum', 'link',
    'normal_pendulum', 'effect_pendulum', 'fusion_pendulum', 'ritual_pendulum', 'synchro_pendulum', 'xyz_pendulum']);
  assert.deepEqual(ATTRIBUTE_ORDER, ['LIGHT', 'DARK', 'WATER', 'FIRE', 'EARTH', 'WIND', 'DIVINE']);
  assert.deepEqual(RACE_ORDER, ['Spellcaster', 'Dragon', 'Zombie', 'Warrior', 'Beast-Warrior', 'Beast', 'Winged Beast', 'Machine',
    'Fiend', 'Fairy', 'Insect', 'Dinosaur', 'Reptile', 'Fish', 'Sea Serpent', 'Aqua', 'Pyro', 'Thunder', 'Rock', 'Plant',
    'Psychic', 'Wyrm', 'Cyberse', 'Divine-Beast', 'Illusion']);
});

test('Korean and English labels and card names are available', () => {
  const bilingualCard = { name: '검투수 다레이오스', nameEn: 'Gladiator Beast Dareios' };
  setLocale('en');
  assert.equal(t('stats.attribute'), 'Attribute');
  assert.equal(t('stats.level'), 'Level');
  assert.equal(t('theme.light'), 'Light');
  assert.equal(t('dynamic.bestOneShotCompact', { card: 'Card', oneShot: '1%' }).includes('—'), false);
  assert.equal(localizeCardName(bilingualCard), 'Gladiator Beast Dareios');
  setLocale('ko');
  assert.equal(t('stats.attribute'), '속성');
  assert.equal(localizeCardName(bilingualCard), '검투수 다레이오스');
});
