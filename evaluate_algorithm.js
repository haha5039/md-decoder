import { allCards } from './src/cards_data.js';
import { evaluateStrategies } from './src/simulation.js';
const cards = allCards.filter(card => !['spell', 'trap'].includes(card.frameType));
const count = Number(process.argv[2] || 12);
const limit = Number(process.argv[3] || 8);
if (!Number.isInteger(count) || count < 1) throw new Error('Game count must be a positive integer.');
if (!Number.isInteger(limit) || limit < 1) throw new Error('Attempt limit must be a positive integer.');
console.log(JSON.stringify(evaluateStrategies(cards, { count, limit }), null, 2));
