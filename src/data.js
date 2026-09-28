import { mapFrameType } from './utils.js';

export const MASTER_DUEL_DATA_URL = 'https://dawnbrandbots.github.io/yaml-yugi/master-duel-raw.json';
export const YGOPRO_ALL_DATA_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes';

const MASTER_DUEL_NAME_ALIASES = new Map(Object.entries({
  'Fairy Tale Tails': 'Fairy Tail Tales',
  'Layer 19 "Sudden Incursion! Super Quantum Black!!"': 'Layer 19: "Preventing the Invasion! The Pitch-Black Super Quantum!!"',
  'El Shaddoll Meshachrer': 'El Shaddoll Meshahrail',
  'Thorns of Violet Poison': 'Thorn Fangs of Violet Poison',
  'Arrow of Regulus': "Regulus' Arrow",
  'Reeshaddoll Wendikuruhu': 'Reeshaddoll Wendikurhu',
  'Synch Blast Wave': 'Synchro Blast Wave',
  'Empire of Endymion': 'Endymion Empire',
  'Stellarnova Binding': 'Stellarnova Bonds',
  'Synch Realm': 'Synchronized Realm',
  'Saiba the Soldier Swordsmith': 'Saiba the Fighting Swordsmith'
}));

const MASTER_DUEL_IMAGE_OVERRIDES = new Map([
  ['Black Luster Soldier (Normal)', 'https://s3.duellinksmeta.com/cards/693f7ea0ce40358adaf90139_w420.webp']
]);

const FRAMES = new Set(['normal', 'effect', 'fusion', 'synchro', 'xyz', 'link', 'ritual',
  'normal_pendulum', 'effect_pendulum', 'fusion_pendulum', 'synchro_pendulum', 'xyz_pendulum', 'ritual_pendulum', 'spell', 'trap']);
const isStat = value => value === null || Number.isInteger(value);
export function validateCards(cards) {
  if (!Array.isArray(cards) || !cards.length) throw new Error('카드 데이터가 비어 있습니다.');
  const ids = new Set();
  for (const card of cards) {
    if (!card || !Number.isInteger(card.id) || ids.has(card.id) || typeof card.name !== 'string' || !card.name || !FRAMES.has(card.frameType)) {
      throw new Error('잘못된 카드 데이터입니다. 기존 데이터를 유지합니다.');
    }
    ids.add(card.id);
    if (!['spell', 'trap'].includes(card.frameType) &&
      (!card.attribute || !card.race || !isStat(card.atk) || !isStat(card.def) || !isStat(card.level) || (card.level !== null && (card.level < 0 || card.level > 13)))) {
      throw new Error(`몬스터 스테이터스가 올바르지 않습니다: ${card.name}`);
    }
  }
  if (!cards.some(card => !['spell', 'trap'].includes(card.frameType))) throw new Error('몬스터 데이터가 없습니다.');
  return cards;
}

export function normalizeCards(english, korean = [], previous = []) {
  if (!Array.isArray(english) || !english.length) throw new Error('영어 카드 데이터를 받지 못했습니다.');
  const ko = new Map(korean.map(card => [card.id, card.name]));
  const old = new Map(previous.map(card => [card.id, card.name]));
  const names = new Set();
  const ids = new Set();
  const cards = [];
  for (const card of english) {
    if (['Token', 'Skill Card'].includes(card.type) || names.has(card.name) || ids.has(card.id)) continue;
    names.add(card.name); ids.add(card.id);
    const image = card.card_images?.[0]?.image_url_cropped;
    cards.push({ id: card.id, name: ko.get(card.id) || old.get(card.id) || card.name, nameEn: card.name,
      frameType: mapFrameType(card.type, card.frameType), attribute: card.attribute ?? null,
      level: card.level ?? card.rank ?? card.linkval ?? null, race: card.race, type: card.type,
      atk: card.atk ?? null, def: card.def ?? null,
      image_url: typeof image === 'string' && image.startsWith('https://') ? image : null });
  }
  validateCards(cards);
  if (previous.length && cards.length < previous.length * 0.9) throw new Error('응답 카드 수가 지나치게 적어 업데이트를 중단했습니다.');
  return cards;
}

export function normalizeCardName(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[\s·・\-—－_<>＜＞"'“”]/g, '').toLowerCase()
    .replace(/ω/g, 'omega').replace(/β/g, 'beta');
}

export function isCardDecoderEligible(source) {
  return !/collab campaign/i.test(source?.releases || '');
}

function sourceNumber(value, fallback = null) {
  if (value === '?' || value === '-1') return -1;
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function cardFromMasterDuelSource(source) {
  if (source.card_type === 'Spell' || source.card_type === 'Trap') {
    const frameType = source.card_type.toLowerCase();
    return {
      id: 1_500_000_000 + Number(source.yugipedia_page_id),
      name: source.ko_name || source.en_name,
      nameEn: source.en_name,
      frameType,
      attribute: null,
      level: null,
      race: source.property || 'Normal',
      type: `${source.card_type} Card`,
      atk: null,
      def: null,
      image_url: MASTER_DUEL_IMAGE_OVERRIDES.get(source.main) || null
    };
  }
  const parts = String(source.types || '').split('/').map(part => part.trim()).filter(Boolean);
  const race = parts[0] || null;
  const tags = new Set(parts.slice(1).map(part => part.toLowerCase()));
  const isPendulum = tags.has('pendulum');
  let frameType = tags.has('link') ? 'link'
    : tags.has('xyz') ? 'xyz'
      : tags.has('synchro') ? 'synchro'
        : tags.has('fusion') ? 'fusion'
          : tags.has('ritual') ? 'ritual'
            : tags.has('normal') ? 'normal' : 'effect';
  if (isPendulum && frameType !== 'link') frameType += '_pendulum';
  const typeName = frameType === 'link' ? 'Link Monster'
    : frameType.startsWith('xyz') ? 'XYZ Monster'
      : frameType.startsWith('synchro') ? 'Synchro Monster'
        : frameType.startsWith('fusion') ? 'Fusion Monster'
          : frameType.startsWith('ritual') ? 'Ritual Monster'
            : frameType.startsWith('normal') ? 'Normal Monster' : 'Effect Monster';
  const linkValue = source.link_arrows
    ? String(source.link_arrows).split(',').map(arrow => arrow.trim()).filter(Boolean).length
    : null;
  const printedLevel = source.level ?? source.rank;
  return {
    id: 1_500_000_000 + Number(source.yugipedia_page_id),
    name: source.ko_name || source.en_name,
    nameEn: source.en_name,
    frameType,
    attribute: source.attribute || null,
    level: sourceNumber(printedLevel, linkValue),
    race,
    type: typeName,
    atk: sourceNumber(source.atk),
    def: frameType === 'link' ? null : sourceNumber(source.def),
    image_url: MASTER_DUEL_IMAGE_OVERRIDES.get(source.main) || null
  };
}

export function mergeMasterDuelCards(masterDuelRecords, ygoproCards, previous = []) {
  if (!Array.isArray(masterDuelRecords) || !masterDuelRecords.length) throw new Error('Master Duel 기준 데이터를 받지 못했습니다.');
  if (!Array.isArray(ygoproCards) || !ygoproCards.length) throw new Error('카드 상세 데이터를 받지 못했습니다.');
  const byName = new Map();
  for (const card of ygoproCards) {
    const key = normalizeCardName(card.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(card);
  }
  const previousNames = new Map(previous.map(card => [card.id, card.name]));
  const previousByName = new Map();
  for (const card of previous) {
    const key = normalizeCardName(card.nameEn);
    if (!previousByName.has(key)) previousByName.set(key, []);
    previousByName.get(key).push(card);
  }
  const seenSources = new Set();
  const seenIds = new Set();
  const cards = [];
  const unmatched = [];
  for (const source of masterDuelRecords) {
    if (!source?.en_name || !isCardDecoderEligible(source)) continue;
    const sourceKey = source.title || `${source.en_name}:${source.main || ''}`;
    if (seenSources.has(sourceKey)) continue;
    seenSources.add(sourceKey);
    const lookupName = MASTER_DUEL_NAME_ALIASES.get(source.en_name) || source.en_name;
    const sourceCard = source.yugipedia_page_id ? cardFromMasterDuelSource(source) : null;
    const details = byName.get(normalizeCardName(lookupName)) || [];
    const card = details.find(item => sourceCard && mapFrameType(item.type, item.frameType) === sourceCard.frameType) || details[0];
    if (card && sourceCard && sourceCard.frameType !== mapFrameType(card.type, card.frameType)) {
      if (!seenIds.has(sourceCard.id)) {
        seenIds.add(sourceCard.id);
        cards.push(sourceCard);
      }
      continue;
    }
    const previousCards = previousByName.get(normalizeCardName(lookupName)) || [];
    const previousCard = previousCards.find(item => !sourceCard || item.frameType === sourceCard.frameType) || previousCards[0];
    const previousImage = previousCard && card?.card_images?.find(image => image.id === previousCard.id);
    const id = previousImage ? previousCard.id : card?.id;
    if (!card || seenIds.has(id)) {
      if (sourceCard) {
        if (!seenIds.has(sourceCard.id)) {
          seenIds.add(sourceCard.id);
          cards.push(sourceCard);
          continue;
        }
      }
      if (!card) unmatched.push(source.en_name);
      continue;
    }
    seenIds.add(id);
    const image = (previousImage || card.card_images?.[0])?.image_url_cropped;
    // The Card Decoder runs on Master Duel's card values. YGOPRODeck is used
    // only for stable passcodes and images because its generic card details can
    // temporarily disagree with the version available in Master Duel.
    const eventCard = sourceCard && !['spell', 'trap'].includes(sourceCard.frameType) ? sourceCard : {
      frameType: mapFrameType(card.type, card.frameType),
      attribute: card.attribute ?? null,
      level: card.level ?? card.rank ?? card.linkval ?? null,
      race: card.race,
      type: card.type,
      atk: card.atk ?? null,
      def: card.def ?? null
    };
    cards.push({
      ...eventCard,
      id,
      name: source.ko_name || previousNames.get(id) || card.name,
      nameEn: card.name,
      image_url: typeof image === 'string' && image.startsWith('https://') ? image : null
    });
  }
  if (unmatched.length) throw new Error(`카드 상세 정보와 결합하지 못한 카드가 있습니다: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? ` 외 ${unmatched.length - 5}장` : ''}`);
  validateCards(cards);
  if (previous.length && cards.length < previous.length * 0.9) throw new Error('응답 카드 수가 지나치게 적어 업데이트를 중단했습니다.');
  return cards;
}

export async function fetchJson(url, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`카드 서버 오류 (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCardData(url) {
  const json = await fetchJson(url);
  if (!Array.isArray(json.data) || !json.data.length) throw new Error('카드 서버가 빈 데이터를 반환했습니다.');
  return json.data;
}

export async function fetchCardManifest(url) {
  const manifest = await fetchJson(url, 30000);
  if (!manifest || !Array.isArray(manifest.cards)) throw new Error('배포된 카드 데이터 형식이 올바르지 않습니다.');
  validateCards(manifest.cards);
  return manifest;
}
