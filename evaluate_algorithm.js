import { allCards } from './src/cards_data.js';
import { evaluateStrategies } from './src/simulation.js';
const cards = allCards.filter(card => !['spell', 'trap'].includes(card.frameType));
const count = Number(process.argv[2] || 12);
if (!Number.isInteger(count) || count < 1) throw new Error('Game count must be a positive integer.');
console.log(JSON.stringify(evaluateStrategies(cards, { count }), null, 2));
