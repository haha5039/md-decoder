import { t } from './i18n.js';

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

// Printed zero and rules values both match; only the rules value is revealed.
const RULE_LEVELS = new Map([
  [1686814, 12], [90884403, 12],
  [65305468, 1], [43490025, 1], [26973555, 1], [41522092, 1], [52653092, 1]
]);

export function getValidLevels(card) {
  const printed = card.level ?? (RULE_LEVELS.has(card.id) ? 0 : null);
  return [...new Set([printed, RULE_LEVELS.get(card.id)].filter(Number.isInteger))];
}

export function getTargetRulesLevel(card) {
  return card ? (RULE_LEVELS.get(card.id) ?? card.level) : null;
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
  const key = attr.toUpperCase();
  const translated = t(`attributes.${key}`);
  return translated === `attributes.${key}` ? attr : translated;
}

export function translateFrame(frame) {
  if (!frame) return frame;
  const value = frame.toLowerCase();
  const translated = t(`frames.${value}`);
  return translated === `frames.${value}` ? frame : translated;
}

export function translateRace(race) {
  if (!race) return race;
  const translated = t(`races.${race}`);
  return translated === `races.${race}` ? race : translated;
}

export function renderCardStatsHTML(card) {
  if (card.frameType === 'spell' || card.frameType === 'trap') {
    const typeKR = translateFrame(card.frameType);
    const subType = translateRace(card.race) || t('frames.normal');
    return `
      <div class="search-dropdown-stats">
        <span class="stat-badge frame-${card.frameType}">${typeKR}</span>
        <span class="stat-badge race">${escapeHTML(subType)}</span>
      </div>
    `;
  } else {
    const frameKR = translateFrame(card.frameType);
    const levelLabel = card.frameType === 'link' ? 'Lnk' : (card.frameType.startsWith('xyz') ? 'Rk' : 'Lv');
    const lvText = getTargetRulesLevel(card) != null ? `${levelLabel}.${getTargetRulesLevel(card)}` : '';
    const attrText = translateAttribute(card.attribute) || '';
    const raceText = translateRace(card.race) || '';
    const atkText = formatStat(card.atk);
    const defText = formatStat(card.def);
    
    return `
      <div class="search-dropdown-stats">
        <span class="stat-badge frame-${card.frameType.toLowerCase().replace('_pendulum', '')}">${escapeHTML(frameKR)}</span>
        ${lvText ? `<span class="stat-badge level">${lvText}</span>` : ''}
        ${attrText ? `<span class="stat-badge attr">${escapeHTML(attrText)}</span>` : ''}
        ${raceText ? `<span class="stat-badge race">${escapeHTML(raceText)}</span>` : ''}
        <span class="stat-badge atk-def">⚔️ ${atkText} / 🛡️ ${defText}</span>
      </div>
    `;
  }
}

/**
 * Shared candidate filtering function used by both Deduction Helper (main.js) and Play Mode (play.js).
 * This ensures identical filtering logic across both modes.
 * 
 * Each hint is: { type: 'direct'|'guess', stat, isCorrect, value }
 *   - 'direct': System-revealed / confirmed exact info (uses exact match, getTargetRulesLevel for level)
 *   - 'guess': Deduced from a card guess (uses isFrameMatch for frame, isLevelMatch for level)
 */
export function filterCandidatesByHints(cards, hints) {
  return cards.filter(card => {
    for (const hint of hints) {
      let isMatch = false;
      
      if (hint.type === 'direct') {
        // Revealed values describe the target exactly; partial matches apply only to guesses.
        if (hint.stat === 'frameType') {
          isMatch = hint.value === 'pendulum' ? card.frameType.includes('_pendulum') : card.frameType === hint.value;
        } else if (hint.stat === 'level') {
          isMatch = (getTargetRulesLevel(card) === hint.value);
        } else {
          isMatch = (card[hint.stat] === hint.value);
        }
      } else {
        // Guess type: uses game-rule partial matching for frame and level
        if (hint.stat === 'frameType') {
          isMatch = isFrameMatch(card, hint.value);
        } else if (hint.stat === 'level') {
          isMatch = isLevelMatch(card, hint.value);
        } else {
          isMatch = (card[hint.stat] === hint.value);
        }
      }
      
      if (hint.isCorrect && !isMatch) return false;
      if (!hint.isCorrect && isMatch) return false;
    }
    return true;
  });
}

/**
 * Maps a Yu-Gi-Oh API card type string to the correct frameType value.
 * Handles pendulum compound types correctly (e.g., "Pendulum Effect Fusion Monster" → "fusion_pendulum").
 */
export function mapFrameType(apiType, fallbackFrameType) {
  // The API frame is authoritative: type labels can omit Pendulum or mislabel Normal Tuners.
  if (fallbackFrameType) return fallbackFrameType.toLowerCase();
  const t = (apiType || '').toLowerCase();
  const isPendulum = t.includes('pendulum');
  
  let base = fallbackFrameType;
  if (t.includes('fusion')) base = 'fusion';
  else if (t.includes('synchro')) base = 'synchro';
  else if (t.includes('xyz')) base = 'xyz';
  else if (t.includes('link')) base = 'link';
  else if (t.includes('ritual')) base = 'ritual';
  else if (t.includes('normal')) base = 'normal';
  else if (t.includes('effect') || t.includes('tuner') || t.includes('flip') || t.includes('spirit') || t.includes('toon') || t.includes('gemini') || t.includes('union')) base = 'effect';
  else if (t.includes('spell')) return 'spell';
  else if (t.includes('trap')) return 'trap';
  
  if (isPendulum && base !== 'link') {
    return base + '_pendulum';
  }
  return base;
}

export const STAT_KEYS = ['frameType', 'level', 'attribute', 'race', 'atk', 'def'];

export function getRevealedValue(card, stat) {
  return stat === 'level' ? getTargetRulesLevel(card) : card[stat];
}

export function getGuessFeedback(guess, target) {
  const matches = Object.fromEntries(STAT_KEYS.map(stat => [stat,
    stat === 'frameType' ? isFrameMatch(target, guess.frameType) :
    stat === 'level' ? isLevelMatch(target, getValidLevels(guess)) : guess[stat] === target[stat]
  ]));
  return {
    matches,
    won: STAT_KEYS.every(stat => matches[stat]),
    revealed: Object.fromEntries(STAT_KEYS.filter(stat => matches[stat]).map(stat => [stat, getRevealedValue(target, stat)]))
  };
}

export function hintsFromFeedback(guess, feedback, batchId) {
  const hints = STAT_KEYS.map(stat => ({
    type: 'guess', stat, value: stat === 'level' ? getValidLevels(guess) : guess[stat],
    isCorrect: feedback.matches[stat], cardId: guess.id, cardName: guess.name, batchId
  }));
  for (const [stat, value] of Object.entries(feedback.revealed)) {
    hints.push({ type: 'direct', stat, value, isCorrect: true, source: 'reveal', batchId, hintCost: 0 });
  }
  return hints;
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function formatStat(value) {
  return value === -1 ? '?' : value === null || value === undefined ? '—' : String(value);
}
