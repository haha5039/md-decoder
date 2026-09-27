import { mapFrameType } from './utils.js';

export const MASTER_DUEL_DATA_URL = 'https://dawnbrandbots.github.io/yaml-yugi/master-duel-raw.json';
export const YGOPRO_ALL_DATA_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes';

const MASTER_DUEL_NAME_ALIASES = new Map(Object.entries({
  'Fairy Tale Tails': 'Fairy Tail Tales',
  'Layer 19 "Sudden Incursion! Super Quantum Black!!"': 'Super Quantum Black Layer',
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

export function mergeMasterDuelCards(masterDuelRecords, ygoproCards, previous = []) {
  if (!Array.isArray(masterDuelRecords) || !masterDuelRecords.length) throw new Error('Master Duel 기준 데이터를 받지 못했습니다.');
  if (!Array.isArray(ygoproCards) || !ygoproCards.length) throw new Error('카드 상세 데이터를 받지 못했습니다.');
  const byName = new Map();
  for (const card of ygoproCards) {
    const key = normalizeCardName(card.name);
    if (key && !byName.has(key)) byName.set(key, card);
  }
  const previousNames = new Map(previous.map(card => [card.id, card.name]));
  const seenNames = new Set();
  const seenIds = new Set();
  const cards = [];
  const unmatched = [];
  for (const source of masterDuelRecords) {
    if (!source?.en_name || seenNames.has(source.en_name)) continue;
    seenNames.add(source.en_name);
    const lookupName = MASTER_DUEL_NAME_ALIASES.get(source.en_name) || source.en_name;
    const card = byName.get(normalizeCardName(lookupName));
    if (!card || seenIds.has(card.id)) {
      if (!card) unmatched.push(source.en_name);
      continue;
    }
    seenIds.add(card.id);
    const image = card.card_images?.[0]?.image_url_cropped;
    cards.push({
      id: card.id,
      name: source.ko_name || previousNames.get(card.id) || card.name,
      nameEn: card.name,
      frameType: mapFrameType(card.type, card.frameType),
      attribute: card.attribute ?? null,
      level: card.level ?? card.rank ?? card.linkval ?? null,
      race: card.race,
      type: card.type,
      atk: card.atk ?? null,
      def: card.def ?? null,
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
