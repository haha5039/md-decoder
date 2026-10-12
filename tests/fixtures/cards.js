// Small, pinned rule examples. Do not import the periodically refreshed card DB
// here: new releases, translations and source ordering must not change unit tests.
export function makeCard(id, extra = {}) {
  return { id, name: `Card ${id}`, nameEn: `Card ${id}`, type: 'Effect Monster',
    frameType: 'effect', level: 4, attribute: 'DARK', race: 'Dragon', atk: 1000, def: 1000, ...extra };
}

export const ruleCards = [
  makeCard(28115467, { nameEn: 'MiSolfachord Eliteia', frameType: 'effect_pendulum', level: 3, attribute: 'WATER', race: 'Fairy', atk: 1100, def: 400 }),
  makeCard(82044280, { nameEn: 'Clear Wing Synchro Dragon', type: 'Synchro Monster', frameType: 'synchro', level: 7, attribute: 'WIND', atk: 2500, def: 2000 }),
  makeCard(90036274, { nameEn: 'Clear Wing Fast Dragon', type: 'Synchro Monster', frameType: 'synchro_pendulum', level: 7, attribute: 'WIND', atk: 2500, def: 2000 }),
  makeCard(83257450, { nameEn: 'The Unstoppable Exodia Incarnate', type: 'Fusion Monster', frameType: 'fusion', level: 10, race: 'Spellcaster', atk: -1, def: 0 }),
  makeCard(13331639, { nameEn: 'Supreme King Z-ARC', type: 'Fusion Monster', frameType: 'fusion_pendulum', level: 12, atk: 4000, def: 4000 }),
  makeCard(4538826, { nameEn: 'Chaos Emperor, the Dragon of Armageddon', frameType: 'effect_pendulum', level: 8, atk: 3000, def: 2500 }),
  makeCard(61052897, { nameEn: 'R-Genex Turing', level: 2, race: 'Spellcaster', atk: 600, def: 600 }),
  makeCard(65301952, { nameEn: 'Alchemic Magician', type: 'XYZ Monster', frameType: 'xyz', race: 'Spellcaster', atk: 1500, def: 1500 }),
  ...[
    [65305468, 'Number F0: Utopic Future', 0, 0],
    [43490025, 'Number F0: Utopic Future Slash', 0, 0],
    [26973555, 'Number F0: Utopic Draco Future', 3000, 2000],
    [41522092, 'Number F0: Utopic Future Zexal', 0, 0],
    [52653092, 'Number S0: Utopic ZEXAL', -1, -1]
  ].map(([id, nameEn, atk, def]) => makeCard(id, { nameEn, type: 'XYZ Monster', frameType: 'xyz', level: 0, attribute: 'LIGHT', race: 'Warrior', atk, def })),
  makeCard(1686814, { nameEn: 'Ultimaya Tzolkin', type: 'Synchro Monster', frameType: 'synchro', level: 0, atk: 0, def: 0 }),
  makeCard(90884403, { nameEn: 'Phantasmal Lord Ultimitl Bishbaalkin', type: 'Synchro Monster', frameType: 'synchro', level: 0, atk: 0, def: 0 })
];
