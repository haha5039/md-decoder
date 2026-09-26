import fs from 'node:fs/promises';
import { allCards } from './src/cards_data.js';
import { fetchCardData, normalizeCards } from './src/data.js';
const [english, korean] = await Promise.allSettled([
  fetchCardData('https://db.ygoprodeck.com/api/v7/cardinfo.php?format=Master%20Duel'),
  fetchCardData('https://db.ygoprodeck.com/api/v7/cardinfo.php?format=Master%20Duel&language=ko')
]);
if (english.status !== 'fulfilled') throw english.reason;
const cards = normalizeCards(english.value, korean.status === 'fulfilled' ? korean.value : [], allCards);
const target = new URL('./src/cards_data.js', import.meta.url);
const temporary = new URL('./src/cards_data.js.tmp', import.meta.url);
await fs.writeFile(temporary, `export const allCards = ${JSON.stringify(cards)};`);
await fs.rename(temporary, target);
console.log(`Saved ${cards.length} cards (${cards.filter(card => !['spell', 'trap'].includes(card.frameType)).length} monsters).`);
if (korean.status !== 'fulfilled') console.log('Korean request failed; existing translations were retained.');
