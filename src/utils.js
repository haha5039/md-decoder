// Special Rules Checkers for Master Duel

export function isFrameMatch(card, frameToMatch) {
  if (!card.frameType || !frameToMatch) return false;
  const t1 = card.frameType.toLowerCase();
  const t2 = frameToMatch.toLowerCase();
  
  if (t1 === t2) return true;
  
  const parts1 = t1.split('_');
  const parts2 = t2.split('_');
  
  return parts1.some(p => parts2.includes(p));
}

export function getValidLevels(card) {
  const levels = [];
  
  if (card.level !== null && card.level !== undefined) {
    levels.push(parseInt(card.level, 10));
  } else if (card.frameType !== 'link') {
    levels.push(0);
  }
  
  // Special rule for cards treated as level 12 or 1
  if (card.id === 1686814) levels.push(12); // Tzolkin
  if (card.id === 90884403) levels.push(12); // Bishbaalkin
  if (card.id === 65301952 || card.id === 65305468) levels.push(1); // FNo.0 (all artworks)
  if (card.id === 43490025) levels.push(1); // FNo.0 Slash
  if (card.id === 26505081) levels.push(1); // FNo.0 Draco
  if (card.id === 52653092) levels.push(1); // SNo.0 / Number F0 Zexal
  
  return [...new Set(levels)];
}

export function isLevelMatch(card, levelsToMatch) {
  const cardLevels = card.validLevels || getValidLevels(card);
  
  if (!Array.isArray(levelsToMatch)) {
    if (levelsToMatch === null || levelsToMatch === undefined || levelsToMatch === "") return false;
    const target = parseInt(levelsToMatch, 10);
    return cardLevels.includes(target);
  }
  
  for (let i = 0; i < cardLevels.length; i++) {
    if (levelsToMatch.includes(cardLevels[i])) return true;
  }
  
  return false;
}

export function translateAttribute(attr) {
  if (!attr) return attr;
  const map = {
    LIGHT: '빛',
    DARK: '어둠',
    WATER: '물',
    FIRE: '화염',
    EARTH: '땅',
    WIND: '바람',
    DIVINE: '신'
  };
  return map[attr.toUpperCase()] || attr;
}

export function translateFrame(frame) {
  if (!frame) return frame;
  const map = {
    normal: '일반 몬스터',
    effect: '효과 몬스터',
    fusion: '융합 몬스터',
    synchro: '싱크로 몬스터',
    xyz: '엑시즈 몬스터',
    link: '링크 몬스터',
    ritual: '의식 몬스터',
    normal_pendulum: '일반 펜듈럼',
    effect_pendulum: '효과 펜듈럼',
    fusion_pendulum: '융합 펜듈럼',
    synchro_pendulum: '싱크로 펜듈럼',
    xyz_pendulum: '엑시즈 펜듈럼',
    spell: '마법',
    trap: '함정'
  };
  return map[frame.toLowerCase()] || frame;
}

export function translateRace(race) {
  if (!race) return race;
  const map = {
    Dragon: '드래곤족',
    Spellcaster: '마법사족',
    Zombie: '언데드족',
    Warrior: '전사족',
    'Beast-Warrior': '야수전사족',
    Beast: '야수족',
    'Winged Beast': '비행야수족',
    Fiend: '악마족',
    Fairy: '천사족',
    Insect: '곤충족',
    Dinosaur: '공룡족',
    Reptile: '파충류족',
    Fish: '어류족',
    'Sea Serpent': '해룡족',
    Aqua: '물족',
    Pyro: '화염족',
    Thunder: '번개족',
    Rock: '암석족',
    Plant: '식물족',
    Machine: '기계족',
    Psychic: '사이킥족',
    Wyrm: '환룡족',
    Cyberse: '사이버스족',
    Illusion: '환상마족',
    'Divine-Beast': '환신야수족',
    'Creator-God': '창조신족'
  };
  return map[race] || race;
}

export function renderCardStatsHTML(card) {
  if (card.frameType === 'spell' || card.frameType === 'trap') {
    const typeKR = card.frameType === 'spell' ? '마법' : '함정';
    const subType = translateRace(card.race) || '일반';
    return `
      <div class="search-dropdown-stats">
        <span class="stat-badge frame-${card.frameType}">${typeKR}</span>
        <span class="stat-badge race">${subType}</span>
      </div>
    `;
  } else {
    const frameKR = translateFrame(card.frameType);
    const levelLabel = card.frameType === 'link' ? 'Lnk' : (card.frameType === 'xyz' ? 'Rk' : 'Lv');
    const lvText = card.level !== null && card.level !== undefined ? `${levelLabel}.${card.level}` : '';
    const attrText = translateAttribute(card.attribute) || '';
    const raceText = translateRace(card.race) || '';
    const atkText = card.atk !== null && card.atk !== undefined ? card.atk : '?';
    const defText = card.def !== null && card.def !== undefined ? card.def : '?';
    
    return `
      <div class="search-dropdown-stats">
        <span class="stat-badge frame-${card.frameType.toLowerCase().replace('_pendulum', '')}">${frameKR}</span>
        ${lvText ? `<span class="stat-badge level">${lvText}</span>` : ''}
        ${attrText ? `<span class="stat-badge attr">${attrText}</span>` : ''}
        ${raceText ? `<span class="stat-badge race">${raceText}</span>` : ''}
        <span class="stat-badge atk-def">⚔️ ${atkText} / 🛡️ ${defText}</span>
      </div>
    `;
  }
}

