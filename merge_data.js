import fs from 'node:fs/promises';
import { allCards } from './src/cards_data.js';
import { MASTER_DUEL_DATA_URL, YGOPRO_ALL_DATA_URL, fetchCardData, fetchJson, mergeMasterDuelCards } from './src/data.js';

const [masterDuelRecords, ygoproCards] = await Promise.all([
  fetchJson(MASTER_DUEL_DATA_URL),
  fetchCardData(YGOPRO_ALL_DATA_URL)
]);
const cards = mergeMasterDuelCards(masterDuelRecords, ygoproCards, allCards);
const generatedAt = new Date().toISOString();
const monsters = cards.filter(card => !['spell', 'trap'].includes(card.frameType));
const source = `export const dataGeneratedAt = ${JSON.stringify(generatedAt)};\nexport const allCards = ${JSON.stringify(cards)};`;
const manifest = JSON.stringify({
  generatedAt,
  sources: { masterDuel: MASTER_DUEL_DATA_URL, cardDetails: YGOPRO_ALL_DATA_URL },
  counts: { cards: cards.length, monsters: monsters.length },
  cards
});
const sourceTarget = new URL('./src/cards_data.js', import.meta.url);
const sourceTemporary = new URL('./src/cards_data.js.tmp', import.meta.url);
const manifestTarget = new URL('./public/master_duel_manifest.json', import.meta.url);
const manifestTemporary = new URL('./public/master_duel_manifest.json.tmp', import.meta.url);

await Promise.all([
  fs.writeFile(sourceTemporary, source),
  fs.writeFile(manifestTemporary, manifest)
]);
await Promise.all([
  fs.rename(sourceTemporary, sourceTarget),
  fs.rename(manifestTemporary, manifestTarget)
]);
console.log(`Saved ${cards.length} cards (${monsters.length} monsters) from the Master Duel allowlist at ${generatedAt}.`);
