import { mapFrameType } from './utils.js';

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

export async function fetchCardData(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`카드 서버 오류 (${response.status})`);
  const json = await response.json();
  if (!Array.isArray(json.data) || !json.data.length) throw new Error('카드 서버가 빈 데이터를 반환했습니다.');
  return json.data;
}
