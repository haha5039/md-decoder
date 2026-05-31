import fs from 'fs';
import https from 'https';

const dictionary = {
  "Performage Water Dancer": "Em 워터 댄서",
  "Performage Wind Drainer": "Em 윈드 드레이너",
  "Performage Fire Dancer": "Em 파이어 댄서",
  // add others if requested, but we can't do all.
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log("Fetching English cards...");
  const enRes = await fetchJSON('https://db.ygoprodeck.com/api/v7/cardinfo.php?format=Master%20Duel');
  console.log("Fetching Korean cards...");
  const koRes = await fetchJSON('https://db.ygoprodeck.com/api/v7/cardinfo.php?format=Master%20Duel&language=ko');

  const enCards = enRes.data || [];
  const koCards = koRes.data || [];

  const koMap = new Map();
  koCards.forEach(c => koMap.set(c.id, c));

  const uniqueNames = new Set();
  const finalCards = [];

  for (const en of enCards) {
    if (en.type === 'Token' || en.type === 'Skill Card') continue;
    if (uniqueNames.has(en.name)) continue;
    
    uniqueNames.add(en.name);

    const ko = koMap.get(en.id);
    let koName = ko ? ko.name : en.name;
    
    // Apply local patch for missing translations
    if (dictionary[koName]) koName = dictionary[koName];
    
    finalCards.push({
      id: en.id,
      name: koName,
      nameEn: en.name,
      frameType: en.frameType,
      attribute: en.attribute || null,
      level: en.level || en.rank || en.linkval || null,
      race: en.race,
      type: en.type,
      atk: en.atk !== undefined ? en.atk : null,
      def: en.def !== undefined ? en.def : null,
      image_url: en.card_images && en.card_images[0] ? en.card_images[0].image_url_cropped : null
    });
  }
  
  const content = `export const allCards = ${JSON.stringify(finalCards)};`;
  fs.writeFileSync('src/cards_data.js', content);
  console.log('Saved to src/cards_data.js with translations patched.');
}

run();
