import './style.css'
import { allCards as rawCards, dataGeneratedAt } from './cards_data.js'
import { getValidLevels, renderCardStatsHTML, translateAttribute, translateFrame, translateRace, getTargetRulesLevel, filterCandidatesByHints, escapeHTML, formatStat } from './utils.js'
import { ATTRIBUTE_ORDER, FRAME_ORDER, RACE_ORDER, alternateCardName, getLocale, initializeI18n, localizeCardName, populateLocalizedSelect, t } from './i18n.js';
import { initializeTheme } from './theme.js';

import { allocateAttempts, sortScores, distinctScores, TWO_TURN_LIMIT, chooseCriteria, recommendHintUse } from './solver.js';
import { fetchCardManifest } from './data.js';
import { applyAutomaticMatches, budget, consumeAttempt, createBatchId, nextChallenge, parseStatInput, removeInputBatch, saveSession, restoreSession, hasSolvedGuess } from './session.js';

import { getCachedCards, saveCachedCards, clearCachedCards } from './db.js'

let allCards = [];

const initialStrategyHTML = () => `
  <p class="strategy-summary">${t('dynamic.readyBody')}</p>
`;

// State
let candidates = [];
let hints = []; // Array of { type: 'guess'|'direct', stat, isCorrect, value, cardName }
let selectedCard = null;
let calculatedResults = null;
let activeCriteria = 'entropy';
let solverWorker = null;
let calculationId = 0;
let candidateLimit = 48;
const CURRENT_EVENT_CARD_TOTAL = 9058;

// DOM Elements
const searchInput = document.getElementById('cardSearch');
const searchDropdown = document.getElementById('searchDropdown');
const selectedCardContainer = document.getElementById('selectedCardContainer');
const selectedCardImg = document.getElementById('selectedCardImg');
const infoName = document.getElementById('infoName');
const infoDetails = document.getElementById('infoDetails');
const statusToggles = document.querySelectorAll('.status-toggles .btn-toggle');
const applyGuessBtn = document.getElementById('applyGuessBtn');
const judgmentProgress = document.getElementById('judgmentProgress');

const candidatesCount = document.getElementById('candidatesCount');
const visibleCandidatesCount = document.getElementById('visibleCandidatesCount');
const candidateList = document.getElementById('candidateList');
const appliedHintsContainer = document.getElementById('appliedHintsContainer');
const appliedHintsList = document.getElementById('appliedHintsList');
const resetBtn = document.getElementById('resetBtn');
const undoHintBtn = document.getElementById('undoHintBtn');
const calcRecBtn = document.getElementById('calcRecBtn');
const recContainer = document.getElementById('recContainer');
const snipeList = document.getElementById('snipeList');
const scoutList = document.getElementById('scoutList');

const strategyMsg = document.getElementById('strategyMsg');
const totalAttemptsLeft = document.getElementById('totalAttemptsLeft');
const problemsLeft = document.getElementById('problemsLeft');
const hintsLeft = document.getElementById('hintsLeft');
const recCriteriaGroup = document.getElementById('recCriteriaGroup');
const criteriaDesc = document.getElementById('criteriaDesc');

// Direct Hint Elements
const directAttribute = document.getElementById('directAttribute');
const directFrame = document.getElementById('directFrame');
const directLevel = document.getElementById('directLevel');
const directRace = document.getElementById('directRace');
const directAtk = document.getElementById('directAtk');
const directDef = document.getElementById('directDef');
const directDefNone = document.getElementById('directDefNone');
const applyDirectHintBtn = document.getElementById('applyDirectHintBtn');

initializeI18n(() => window.location.reload());
initializeTheme();
populateLocalizedSelect(directFrame, FRAME_ORDER, 'frames');
populateLocalizedSelect(directAttribute, ATTRIBUTE_ORDER, 'attributes');
populateLocalizedSelect(directRace, RACE_ORDER, 'races');

// Database Sync Elements
const dbStatusText = document.getElementById('dbStatusText');
const updateDbBtn = document.getElementById('updateDbBtn');
const clearDbBtn = document.getElementById('clearDbBtn');
const updateProgressContainer = document.getElementById('updateProgressContainer');
const updateProgressBar = document.getElementById('updateProgressBar');
const updateProgressText = document.getElementById('updateProgressText');

// Database Sync Elements

async function initGameData() {
  try {
    const cached = await getCachedCards();
    if (cached && cached.length > 0) {
      allCards = cached.filter(c => c.frameType !== 'spell' && c.frameType !== 'trap');
      const cachedAt = (() => { try { return localStorage.getItem('md-decoder-db-updated-at'); } catch { return null; } })();
      if (dbStatusText) dbStatusText.textContent = t('dynamic.dbUser', { date: cachedAt ? ` (${new Date(cachedAt).toLocaleDateString(getLocale())})` : '' });
      if (dbStatusBadge) {
        dbStatusBadge.textContent = t('db.latest');
        dbStatusBadge.style.background = 'rgba(34, 197, 94, 0.15)';
        dbStatusBadge.style.color = '#4ade80';
      }
      console.log(`Loaded ${allCards.length} cards from IndexedDB.`);
    } else {
      allCards = rawCards.filter(c => c.frameType !== 'spell' && c.frameType !== 'trap');
      if (dbStatusText) dbStatusText.textContent = t('dynamic.dbBuiltIn', { date: new Date(dataGeneratedAt).toLocaleDateString(getLocale()) });
      if (dbStatusBadge) {
        dbStatusBadge.textContent = t('db.builtIn');
        dbStatusBadge.style.background = 'rgba(59, 130, 246, 0.15)';
        dbStatusBadge.style.color = '#60a5fa';
      }
      console.log(`Loaded ${allCards.length} cards from static cards_data.js.`);
    }
  } catch (err) {
    console.error("Failed to load IndexedDB cache, fallback to static:", err);
    allCards = rawCards.filter(c => c.frameType !== 'spell' && c.frameType !== 'trap');
    if (dbStatusText) dbStatusText.textContent = t('dynamic.dbCacheError', { date: new Date(dataGeneratedAt).toLocaleDateString(getLocale()) });
    if (dbStatusBadge) {
      dbStatusBadge.textContent = t('dynamic.dbErrorBadge');
      dbStatusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
      dbStatusBadge.style.color = '#f87171';
    }
  }

  // Pre-calculate valid levels for all cards for maximum performance
  allCards.forEach(card => {
    card.validLevels = getValidLevels(card);
  });

  let saved = null;
  let restoreMessage = '';
  try { saved = restoreSession(localStorage, allCards); } catch { /* Storage can be disabled by the browser. */ }
  if (saved) {
    hints = applyAutomaticMatches(saved.hints, allCards);
    totalAttemptsLeft.value = saved.attempts;
    hintsLeft.value = saved.remainingHints;
    problemsLeft.value = saved.problems;
    restoreMessage = t(saved.migrated ? 'dynamic.sessionMigrated' : 'dynamic.sessionRestored');
  }
  applyFilters();
  if (restoreMessage) document.getElementById('sessionStatus').textContent = restoreMessage;
  if (saved?.migrated) showInputMessage(t('dynamic.sessionMigrated'));
}

function updateUI() {
  candidatesCount.textContent = t('common.countOfTotal', { count: candidates.length, total: allCards.length });
  document.getElementById('databaseScopeText').textContent = allCards.length === CURRENT_EVENT_CARD_TOTAL
    ? t('dynamic.scopeMatch', { count: allCards.length })
    : t('dynamic.scopeMismatch', { count: allCards.length, event: CURRENT_EVENT_CARD_TOTAL, difference: Math.abs(allCards.length - CURRENT_EVENT_CARD_TOTAL) });
  renderCandidatePage();
  
  if (hints.length > 0) {
    appliedHintsContainer.classList.remove('hidden');
    renderHints();
  } else {
    appliedHintsContainer.classList.add('hidden');
  }
}

function renderCandidateList(list, container) {
  container.innerHTML = '';
  list.forEach(card => {
    const div = document.createElement('div');
    div.className = 'card-item animate-fade-in';
    const imgUrl = escapeHTML(card.image_url || '');
    const displayName = localizeCardName(card);

    const levelLabel = card.frameType === 'link' ? 'Lnk' : (card.frameType.startsWith('xyz') ? 'Rk' : 'Lv');
    const lvText = getTargetRulesLevel(card) != null ? `${levelLabel}.${getTargetRulesLevel(card)}` : '';
    const attrText = translateAttribute(card.attribute) || '';
    const atkText = formatStat(card.atk);
    const defText = formatStat(card.def);

    div.innerHTML = `
      <img src="${imgUrl}" alt="${escapeHTML(displayName)}" loading="lazy" onerror="this.onerror=null;this.style.visibility='hidden'">
      <div class="card-item-title" title="${escapeHTML(displayName)}">${escapeHTML(displayName)}</div>
      <div class="candidate-stats">
        <div class="candidate-stats-row">
          <span class="stat-badge frame-${card.frameType.toLowerCase().replace('_pendulum', '')}" style="font-size: 0.65rem; padding: 0.1rem 0.35rem;">${escapeHTML(translateFrame(card.frameType))}</span>
        </div>
        <div class="candidate-stats-row">
          ${attrText ? `<span class="stat-badge attr" style="font-size: 0.65rem; padding: 0.1rem 0.35rem;">${escapeHTML(attrText)}</span>` : ''}
          ${lvText ? `<span class="stat-badge level" style="font-size: 0.65rem; padding: 0.1rem 0.35rem;">${lvText}</span>` : ''}
        </div>
        <div class="candidate-stats-row">
          <span class="stat-badge race" style="font-size: 0.65rem; padding: 0.1rem 0.35rem;">${escapeHTML(translateRace(card.race) || '-')}</span>
        </div>
        <div class="candidate-stats-atkdef">⚔️ ${atkText} / 🛡️ ${defText}</div>
      </div>
    `;
    div.onclick = () => selectCard(card);
    container.appendChild(div);
  });
}

function getStatNameKR(stat) {
  return t(`stats.${stat}`);
}

function getTranslatedValue(stat, value) {
  if (stat === 'def' && value === null) return t('common.none');
  if (value === -1) return '?';
  if (value === null || value === undefined) return '?';
  if (Array.isArray(value)) {
    return value.map(val => {
      if (stat === 'frameType') return translateFrame(val);
      if (stat === 'attribute') return translateAttribute(val);
      if (stat === 'race') return translateRace(val);
      return val;
    }).join('/');
  }
  if (stat === 'frameType') return translateFrame(value);
  if (stat === 'attribute') return translateAttribute(value);
  if (stat === 'race') return translateRace(value);
  return value;
}

function showInputMessage(message) {
  const notice = document.getElementById('inputNotice');
  notice.textContent = message;
  notice.hidden = !message;
  if (message) notice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function persistSession() {
  try {
    const ok = saveSession(localStorage, { hints, attempts: budget(totalAttemptsLeft.value), remainingHints: budget(hintsLeft.value), problems: budget(problemsLeft.value, 1) });
    document.getElementById('sessionStatus').textContent = t(ok ? 'dynamic.sessionSaved' : 'dynamic.sessionSaveFailed');
  } catch { document.getElementById('sessionStatus').textContent = t('dynamic.sessionUnavailable'); }
}

function deleteHintItem(index) {
  const hint = hints[index];
  if (!hint) return;
  const removed = removeInputBatch(hints, hint.batchId);
  hints = removed.hints;
  totalAttemptsLeft.value = budget(totalAttemptsLeft.value) + removed.attemptsRefund;
  hintsLeft.value = budget(hintsLeft.value) + removed.hintsRefund;
  applyFilters();
}

function undoLastInput() { if (hints.length) deleteHintItem(hints.length - 1); }

function renderCandidatePage() {
  const query = document.getElementById('candidateSearch').value.trim().toLowerCase();
  const list = candidates.filter(card => !query || card.name.toLowerCase().includes(query) || card.nameEn?.toLowerCase().includes(query));
  visibleCandidatesCount.textContent = t('main.visibleCount', { count: Math.min(list.length, candidateLimit) });
  renderCandidateList(list.slice(0, candidateLimit), candidateList);
  document.getElementById('showMoreCandidates').hidden = list.length <= candidateLimit;
  const notice = document.getElementById('candidateNotice');
  notice.hidden = candidates.length > 0 && (!query || list.length > 0);
  notice.textContent = candidates.length === 0
    ? t('dynamic.noCandidates')
    : t('dynamic.nameNotFound');
}

function renderHints() {
  appliedHintsList.innerHTML = '';
  hints.forEach((hint, index) => {
    if (hint.inferred || hint.supplemental) return;
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    
    let hintContent = '';
    if (hint.type === 'direct') {
      hintContent = `
        <span>
          <span class="stat-name">[${t('dynamic.confirmedHint')}]</span>
          ${getStatNameKR(hint.stat)}: <span class="stat-val">${escapeHTML(getTranslatedValue(hint.stat, hint.value))}</span>
        </span>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="stat-res res-correct">${t('dynamic.applied')}</span>
        </div>
      `;
    } else {
      const resClass = hint.isCorrect ? 'res-correct' : 'res-wrong';
      const resText = hint.isCorrect ? 'O' : 'X';
      const revealed = hints.find(item => item.supplemental && !item.automatic && item.batchId === hint.batchId && item.stat === hint.stat);
      const revealedText = revealed ? ` → ${t('dynamic.revealed')}: <span class="stat-val">${escapeHTML(getTranslatedValue(revealed.stat, revealed.value))}</span>` : '';
      const guessedCard = allCards.find(card => card.id === hint.cardId);
      const guessedName = guessedCard ? localizeCardName(guessedCard) : hint.cardName;
      hintContent = `
        <span>
          <span class="stat-name">[${escapeHTML(guessedName)}]</span>
          ${getStatNameKR(hint.stat)}: <span class="stat-val">${escapeHTML(getTranslatedValue(hint.stat, hint.value))}</span>${revealedText}
        </span>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="stat-res ${resClass}">${resText}</span>
        </div>
      `;
    }
    li.innerHTML = hintContent;
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete-hint';
    deleteBtn.innerHTML = '❌';
    deleteBtn.style = 'background: none; border: none; color: #ef4444; cursor: pointer; padding: 0 0.5rem; font-size: 1rem;';
    deleteBtn.title = t('dynamic.cancelInput');
    deleteBtn.setAttribute('aria-label', t('dynamic.cancelInput'));
    deleteBtn.onclick = () => deleteHintItem(index);
    
    const actionDiv = li.querySelector('div');
    if (actionDiv) {
      actionDiv.appendChild(deleteBtn);
    }
    
    appliedHintsList.appendChild(li);
  });
}

// ------------------------------------------------------------------
// DIRECT HINT LOGIC
// ------------------------------------------------------------------
applyDirectHintBtn.addEventListener('click', () => {
  if (!allCards.length) return;
  const fields = [['frameType', directFrame], ['attribute', directAttribute], ['level', directLevel], ['race', directRace], ['atk', directAtk], ['def', directDef]];
  const batchId = createBatchId('direct');
  const additions = [];
  try {
    for (const [stat, input] of fields) {
      const value = stat === 'def' && directDefNone.checked ? null : parseStatInput(input.value, stat);
      if (value === undefined) continue;
      const existing = hints.find(hint => hint.type === 'direct' && hint.stat === stat);
      if (existing) {
        if (existing.value !== value) throw new Error(t('dynamic.statConflict', { stat: getStatNameKR(stat) }));
        continue;
      }
      additions.push({ type: 'direct', stat, value, isCorrect: true, isExact: true, batchId });
    }
    if (!additions.length) {
      showInputMessage(t('dynamic.alreadyApplied'));
      return;
    }
    hints.push(...additions);
    fields.forEach(([, input]) => { input.value = ''; });
    directDefNone.checked = false; directDef.disabled = false;
    applyFilters();
  } catch (error) { showInputMessage(error.message); }
});

if (directDefNone) {
  directDefNone.addEventListener('change', (e) => {
    if (e.target.checked) {
      directDef.value = "";
      directDef.disabled = true;
    } else {
      directDef.disabled = false;
    }
  });
}

// ------------------------------------------------------------------
// SEARCH & SELECT (GUESS INPUT)
// ------------------------------------------------------------------
searchInput.addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  if (q.length < 2) {
    searchDropdown.classList.add('hidden');
    return;
  }
  
  // Search in both Korean (name) and English (nameEn)
  const results = allCards.filter(c => 
    (c.name && c.name.toLowerCase().includes(q)) || 
    (c.nameEn && c.nameEn.toLowerCase().includes(q))
  ).slice(0, 20);
  
  if (results.length > 0) {
    searchDropdown.innerHTML = '';
    results.forEach(card => {
      const div = document.createElement('div');
      div.className = 'dropdown-item';
      
      const imgUrl = escapeHTML(card.image_url || '');
      const statsHTML = renderCardStatsHTML(card);
      const displayName = localizeCardName(card);
      const alternateName = alternateCardName(card);
      
      div.innerHTML = `
        <img src="${imgUrl}" alt="${escapeHTML(displayName)}" onerror="this.onerror=null;this.style.visibility='hidden'">
        <div class="search-dropdown-info">
          <div class="search-dropdown-title">${escapeHTML(displayName)}</div>
          <div class="search-dropdown-subtitle">${escapeHTML(alternateName)}</div>
          ${statsHTML}
        </div>
      `;
      div.onclick = () => {
        selectCard(card);
        searchDropdown.classList.add('hidden');
        searchInput.value = '';
      };
      searchDropdown.appendChild(div);
    });
    searchDropdown.classList.remove('hidden');
  } else {
    searchDropdown.classList.add('hidden');
  }
});

document.addEventListener('click', (e) => {
  if (!searchDropdown.contains(e.target) && e.target !== searchInput) {
    searchDropdown.classList.add('hidden');
  }
});

function selectCard(card) {
  showInputMessage('');

  selectedCard = card;
  selectedCardContainer.classList.remove('hidden');
  selectedCardImg.src = card.image_url || '';
  infoName.textContent = localizeCardName(card);
  
  const levelLabel = card.frameType === 'link' ? 'Lnk' : (card.frameType.startsWith('xyz') ? 'Rk' : 'Lv');
  const lvText = getTargetRulesLevel(card) != null ? `${levelLabel}.${getTargetRulesLevel(card)}` : '';
  const atkText = formatStat(card.atk);
  const defText = formatStat(card.def);
  
  const frameText = translateFrame(card.frameType) || '';
  const attrText = translateAttribute(card.attribute) || '';
  const raceText = translateRace(card.race) || '';
  
  infoDetails.innerHTML = `
    <div class="candidate-stats" style="margin-top: 0.35rem; text-align: left; align-items: flex-start; gap: 0.35rem;">
      <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
        <span class="stat-badge frame-${card.frameType.toLowerCase().replace('_pendulum', '')}" style="font-size: 0.72rem; padding: 0.15rem 0.45rem;">${escapeHTML(frameText)}</span>
        ${attrText ? `<span class="stat-badge attr" style="font-size: 0.72rem; padding: 0.15rem 0.45rem;">${escapeHTML(attrText)}</span>` : ''}
        ${lvText ? `<span class="stat-badge level" style="font-size: 0.72rem; padding: 0.15rem 0.45rem;">${lvText}</span>` : ''}
      </div>
      <div style="display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap; margin-top: 0.1rem;">
        ${raceText ? `<span class="stat-badge race" style="font-size: 0.72rem; padding: 0.15rem 0.45rem;">${escapeHTML(raceText)}</span>` : ''}
        <span class="candidate-stats-atkdef" style="font-size: 0.75rem; color: var(--accent-gold); font-weight: 600; text-align: left; margin-left: 0.1rem;">⚔️ ${atkText} / 🛡️ ${defText}</span>
      </div>
    </div>
  `;
  
  statusToggles.forEach(btn => {
    btn.classList.remove('active');
    btn.dataset.selected = "false";
  });
  judgmentProgress.textContent = '0 / 6';
  applyGuessBtn.disabled = true;

  // Scroll to input section when selecting a card
  const target = document.getElementById('guessResultSection');
  if (target) {
    setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }
}

statusToggles.forEach(btn => {
  btn.addEventListener('click', (e) => {
    const parent = btn.parentElement;
    parent.querySelectorAll('.btn-toggle').forEach(b => {
      b.classList.remove('active');
      b.dataset.selected = "false";
    });
    btn.classList.add('active');
    btn.dataset.selected = "true";
    refreshMatchedInputs();
  });
});

function refreshMatchedInputs() {
  const selected = [...document.querySelectorAll('.status-row')].flatMap(row => {
    const active = row.querySelector('.btn-toggle.active');
    if (!active || !selectedCard) return [];
    const stat = row.dataset.stat;
    return [{ type: 'guess', stat, isCorrect: active.dataset.val === 'correct', value: stat === 'level' ? getValidLevels(selectedCard) : selectedCard[stat] }];
  });
  judgmentProgress.textContent = `${selected.length} / 6`;
  applyGuessBtn.disabled = selected.length !== 6;
}

applyGuessBtn.addEventListener('click', () => {
  if (!selectedCard) return;
  if (hints.some(hint => hint.type === 'guess' && hint.cardId === selectedCard.id)) { showInputMessage(t('dynamic.duplicateGuess')); return; }
  
  const newHints = [];
  const rows = document.querySelectorAll('.status-row');
  const batchId = createBatchId('guess');
  
  rows.forEach(row => {
    const stat = row.dataset.stat;
    const activeBtn = row.querySelector('.btn-toggle.active');
    
    if (activeBtn) {
      const isCorrect = activeBtn.dataset.val === 'correct';
      let value = selectedCard[stat];
      if (stat === 'level') value = selectedCard.validLevels || getValidLevels(selectedCard);
      
      newHints.push({
        type: 'guess',
        stat,
        isCorrect,
        value,
        cardName: selectedCard.name,
        cardId: selectedCard.id,
        batchId: batchId
      });
    }
  });
  
  if (newHints.length !== 6) {
    showInputMessage(t('dynamic.needSix'));
    return;
  }
  const completedHints = applyAutomaticMatches(newHints, [selectedCard]);
  const provisionalCandidates = filterCandidatesByHints(candidates, completedHints);
  if (!provisionalCandidates.length) {
    showInputMessage(t('dynamic.impossibleFeedback'));
    return;
  }
  const attempt = consumeAttempt(totalAttemptsLeft.value);
  newHints[0].attemptCost = attempt.cost;
  totalAttemptsLeft.value = attempt.remaining;
  
  hints = [...hints, ...completedHints];
  applyFilters();
  
  selectedCardContainer.classList.add('hidden');
  selectedCard = null;

  // Scroll to recommendations section after submitting judgment
  const target = document.getElementById('recommendationsSection');
  if (target) {
    setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  }
});

// ------------------------------------------------------------------
// FILTERING
// ------------------------------------------------------------------
function applyFilters() {
  showInputMessage('');
  candidates = filterCandidatesByHints(allCards, hints);
  candidateLimit = 48;
  cancelCalculation();
  calculatedResults = null;
  const twoTurnButton = recCriteriaGroup.querySelector('[data-criteria="twoShot"]');
  twoTurnButton.disabled = true;
  twoTurnButton.title = t('dynamic.criteriaPending');
  updateUI();
  recContainer.classList.add('hidden');
  snipeList.innerHTML = '';
  scoutList.innerHTML = '';
  strategyMsg.innerHTML = initialStrategyHTML();
  persistSession();
  updateHintStrategy(false);
}

function resetChallenge(preserveResources = false) {
  const resources = preserveResources ? nextChallenge({ attempts: totalAttemptsLeft.value, remainingHints: hintsLeft.value, problems: problemsLeft.value }) : { attempts: 4, remainingHints: 1, problems: 1 };
  hints = [];
  candidates = [...allCards];
  calculatedResults = null;
  recContainer.classList.add('hidden');
  snipeList.innerHTML = '';
  scoutList.innerHTML = '';
  
  // Reset direct inputs (Mode 1)
  if (directAttribute) directAttribute.value = "";
  if (directFrame) directFrame.value = "";
  if (directLevel) directLevel.value = "";
  if (directRace) directRace.value = "";
  if (directAtk) directAtk.value = "";
  if (directDefNone) directDefNone.checked = false;
  if (directDef) {
    directDef.disabled = false;
    directDef.value = "";
  }
  
  // Reset search & selectedCard (Mode 2)
  if (searchInput) searchInput.value = "";
  selectedCard = null;
  if (selectedCardContainer) selectedCardContainer.classList.add('hidden');
  
  // Reset toggles (Mode 2)
  statusToggles.forEach(btn => {
    btn.classList.remove('active');
    btn.dataset.selected = "false";
  });
  judgmentProgress.textContent = '0 / 6';
  applyGuessBtn.disabled = true;
  
  // Reset numeric settings (0. 남은 횟수 설정)
  hintsLeft.value = resources.remainingHints;
  totalAttemptsLeft.value = resources.attempts;
  problemsLeft.value = resources.problems;
  
  document.getElementById('candidateSearch').value = '';
  applyFilters();
}
resetBtn.addEventListener('click', () => resetChallenge());
document.getElementById('nextChallengeBtn').addEventListener('click', () => resetChallenge(true));

if (undoHintBtn) {
  undoHintBtn.addEventListener('click', undoLastInput);
}

// ------------------------------------------------------------------
// RECOMMENDATION SOLVER
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// CRITERIA SELECTION LOGIC
// ------------------------------------------------------------------
const criteriaDescriptions = {
  entropy: `<strong>${t('criteria.entropy')}:</strong> ${t('criteriaDesc.entropy')}`,
  minimax: `<strong>${t('criteria.minimax')}:</strong> ${t('criteriaDesc.minimax')}`,
  oneShot: `<strong>${t('criteria.oneShot')}:</strong> ${t('criteriaDesc.oneShot')}`,
  twoShot: `<strong>${t('criteria.twoShot')}:</strong> ${t('criteriaDesc.twoShot')}`,
  expected: `<strong>${t('criteria.expected')}:</strong> ${t('criteriaDesc.expected')}`
};
criteriaDesc.innerHTML = criteriaDescriptions[activeCriteria];

function updateCriteriaUI(criteria) {
  activeCriteria = criteria;
  
  // Update button active state
  recCriteriaGroup.querySelectorAll('.btn-toggle').forEach(btn => {
    if (btn.dataset.criteria === criteria) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Update description
  if (criteriaDesc) {
    criteriaDesc.innerHTML = criteriaDescriptions[criteria];
    
    // Change border color to match the style
    const colors = {
      entropy: 'var(--accent-blue)',
      minimax: '#ef4444',
      oneShot: '#22c55e',
      expected: '#3b82f6'
    };
    criteriaDesc.style.borderLeftColor = colors[criteria] || 'var(--accent-blue)';
  }
  
  // Render recommendations with the new sorting
  if (calculatedResults) {
    renderRecommendations();
  }
  
  // Update strategy message to keep guidance in sync
  updateHintStrategy(false);
}

function sortRecommendations(list, criteria) { return sortScores(list, criteria); }

function getRecommendationLimit(container) {
  const width = container.clientWidth || container.parentElement?.clientWidth || 0;
  if (!width) return 1;
  const minimumCardWidth = 140;
  const gap = 12;
  return Math.max(1, Math.min(5, Math.floor((width + gap) / (minimumCardWidth + gap))));
}

function renderRecommendationList(list, container) {
  container.innerHTML = '';
  const visibleCount = Math.min(getRecommendationLimit(container), list.length);
  container.style.setProperty('--recommendation-columns', Math.max(1, visibleCount));
  list.slice(0, visibleCount).forEach(item => {
    const card = item.card;
    const div = document.createElement('div');
    div.className = 'card-item animate-fade-in';
    const imgUrl = escapeHTML(card.image_url || '');
    const displayName = localizeCardName(card);

    const entropyText = `${t('dynamic.info')}: ${item.entropy.toFixed(2)} Bits`;
    const expectedText = `${t('dynamic.average')}: ${t('common.cardCount', { count: item.expectedRemaining.toFixed(1) })}`;
    const minimaxText = `${t('dynamic.worst')}: ${t('common.cardCount', { count: item.minimax })}`;
    const oneShotText = `${t('dynamic.immediateWin')}: ${(item.oneShotProb * 100).toFixed(2)}%`;
    const twoShotText = item.twoShotProb === null ? '' : `${t('dynamic.twoWin')}: ${(item.twoShotProb * 100).toFixed(2)}%`;
    const primaryText = activeCriteria === 'entropy' ? entropyText
      : activeCriteria === 'minimax' ? minimaxText
        : activeCriteria === 'oneShot' ? oneShotText
          : activeCriteria === 'twoShot' ? twoShotText : expectedText;
    const secondaryText = activeCriteria === 'oneShot'
      ? expectedText
      : item.oneShotProb > 0 ? oneShotText : '';
    
    div.innerHTML = `
      <img src="${imgUrl}" alt="${escapeHTML(displayName)}" loading="lazy" onerror="this.onerror=null;this.style.visibility='hidden'">
      <div class="card-item-title" title="${escapeHTML(displayName)}">${escapeHTML(displayName)}</div>
      ${item.equivalentChoices > 1 ? `<div class="card-item-stats">${t('dynamic.equivalent', { count: item.equivalentChoices })}</div>` : ''}
      <div class="recommendation-primary">${primaryText}</div>
      ${secondaryText && secondaryText !== primaryText ? `<div class="recommendation-secondary">${secondaryText}</div>` : ''}
    `;
    div.onclick = () => selectCard(card);
    container.appendChild(div);
  });
}

function renderRecommendations() {
  if (!calculatedResults) return;

  const sortedSnipes = distinctScores(calculatedResults.snipes, activeCriteria);
  const sortedScouts = distinctScores(calculatedResults.scouts, activeCriteria);
  
  renderRecommendationList(sortedSnipes, snipeList);
  renderRecommendationList(sortedScouts, scoutList);
}

let recommendationResizeFrame = 0;
const recommendationWidths = new WeakMap();
const handleRecommendationResize = entries => {
  if (!calculatedResults || recContainer.classList.contains('hidden')) return;
  let changed = false;
  for (const { target, contentRect } of entries) {
    if (recommendationWidths.get(target) !== contentRect.width) {
      recommendationWidths.set(target, contentRect.width);
      changed = true;
    }
  }
  if (!changed) return;
  cancelAnimationFrame(recommendationResizeFrame);
  recommendationResizeFrame = requestAnimationFrame(renderRecommendations);
};
if ('ResizeObserver' in window) {
  const recommendationResizeObserver = new ResizeObserver(handleRecommendationResize);
  recommendationResizeObserver.observe(snipeList);
  recommendationResizeObserver.observe(scoutList);
} else {
  window.addEventListener('resize', () => handleRecommendationResize([
    { target: snipeList, contentRect: snipeList.getBoundingClientRect() },
    { target: scoutList, contentRect: scoutList.getBoundingClientRect() }
  ]));
}

recCriteriaGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-toggle');
  if (btn) {
    updateCriteriaUI(btn.dataset.criteria);
  }
});

// ------------------------------------------------------------------
// RECOMMENDATION SOLVER
// ------------------------------------------------------------------
function cancelCalculation() {
  calculationId++;
  solverWorker?.terminate(); solverWorker = null;
  calcRecBtn.disabled = false;
  calcRecBtn.textContent = t('main.calculate');
}

function hydrateSolverResult(result) {
  const cardsById = new Map(allCards.map(card => [card.id, card]));
  const hydrate = item => ({ ...item, card: cardsById.get(item.cardId) });
  return { ...result, snipes: result.snipes.map(hydrate), scouts: result.scouts.map(hydrate) };
}

calcRecBtn.addEventListener('click', () => {
  if (!candidates.length || hasSolvedGuess(hints)) return;
  cancelCalculation();
  const id = calculationId;
  calcRecBtn.disabled = true;
  calcRecBtn.textContent = t('main.calculating');
  try {
    solverWorker = new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' });
    solverWorker.onmessage = ({ data }) => {
      if (data.id !== calculationId) return;
      calcRecBtn.disabled = false; calcRecBtn.textContent = t('main.calculate');
      if (data.error) {
        const message = data.error === 'SOLVER_NOT_READY' ? t('dynamic.solverNotReady') : data.error;
        strategyMsg.textContent = t('dynamic.calcFailed', { error: message });
        return;
      }
      calculatedResults = hydrateSolverResult(data.result);
      recContainer.classList.remove('hidden');
      const twoTurnButton = recCriteriaGroup.querySelector('[data-criteria="twoShot"]');
      twoTurnButton.disabled = !calculatedResults.twoTurnExact;
      twoTurnButton.title = calculatedResults.twoTurnExact ? '' : t('dynamic.criteriaLimit', { count: TWO_TURN_LIMIT });
      updateHintStrategy(true);
      renderRecommendations();
    };
    solverWorker.onerror = () => {
      cancelCalculation();
      strategyMsg.textContent = t('dynamic.calcUnavailable');
    };
    solverWorker.postMessage({ type: 'init', cards: allCards });
    solverWorker.postMessage({ type: 'solve', id, request: {
      candidateIds: candidates.map(card => card.id),
      guessedIds: [...new Set(hints.filter(hint => hint.type === 'guess').map(hint => hint.cardId))],
      revealedStats: [...new Set(hints.filter(hint => hint.isCorrect).map(hint => hint.stat))]
    } });
  } catch (error) { cancelCalculation(); strategyMsg.textContent = t('dynamic.calcFailed', { error: error.message }); }
});

function updateHintStrategy(autoSelect = false) {
  const attempts = budget(totalAttemptsLeft.value);
  const remainingHints = budget(hintsLeft.value);
  const problems = budget(problemsLeft.value, 1);
  const currentBudget = allocateAttempts(attempts, problems);
  const recommended = chooseCriteria({ attempts: currentBudget, twoTurnExact: calculatedResults?.twoTurnExact, candidateCount: candidates.length });
  if (autoSelect || (activeCriteria === 'twoShot' && !calculatedResults?.twoTurnExact)) {
    activeCriteria = recommended;
    recCriteriaGroup.querySelectorAll('.btn-toggle').forEach(button => button.classList.toggle('active', button.dataset.criteria === activeCriteria));
    criteriaDesc.innerHTML = criteriaDescriptions[activeCriteria];
  }
  const messages = [];
  if (hasSolvedGuess(hints) && candidates.length) {
    calcRecBtn.disabled = true;
    strategyMsg.textContent = t('dynamic.solved');
    return;
  }
  if (!candidates.length) messages.push(t('dynamic.noCandidates'));
  else if (candidates.length === 1) messages.push(t('dynamic.oneCandidate', { card: escapeHTML(localizeCardName(candidates[0])) }));
  else if (!calculatedResults) messages.push(t('dynamic.calculatePrompt', { count: candidates.length }));
  else {
    const best = sortScores([...calculatedResults.snipes, ...calculatedResults.scouts], activeCriteria)[0];
    if (best) messages.push(t(best.twoShotProb === null ? 'dynamic.bestOneShotCompact' : 'dynamic.bestCompact', {
      card: `<strong>${escapeHTML(localizeCardName(best.card))}</strong>`,
      oneShot: `${(best.oneShotProb * 100).toFixed(2)}%`,
      twoShot: `${((best.twoShotProb ?? 0) * 100).toFixed(2)}%`
    }));
    // Hint value is measured for the current candidate state. Future challenge
    // count raises the scarcity threshold; it never assigns one hint per problem.
    const hintAdvice = recommendHintUse({
      attempts,
      remainingHints,
      problemsLeft: problems,
      candidateCount: candidates.length,
      hint: calculatedResults.hint,
      bestGuessExpectedRemaining: calculatedResults.bestGuessExpectedRemaining
    });
    if (calculatedResults.hint && remainingHints) {
      const values = {
        count: candidates.length,
        expected: calculatedResults.hint.expectedRemaining.toFixed(1),
        before: `${(hintAdvice.currentOneShotProb * 100).toFixed(2)}%`,
        after: `${(hintAdvice.expectedOneShotProb * 100).toFixed(2)}%`,
        gain: (hintAdvice.oneShotGain * 100).toFixed(2)
      };
      if (hintAdvice.decision === 'use') messages.push(`<strong>${t('dynamic.hintUseCompact', values)}</strong>`);
      else if (hintAdvice.reason === 'noAttempts') messages.push(t('dynamic.hintSaveNoAttempts'));
      else if (hintAdvice.reason === 'scarceResource') messages.push(t('dynamic.hintSaveScarce', values));
      else messages.push(t('dynamic.hintSaveCompact', values));
    }
  }
  strategyMsg.innerHTML = messages.map((message, index) => `<p class="${index === 0 ? 'strategy-result' : 'strategy-advice'}">${message}</p>`).join('');
}

for (const input of [totalAttemptsLeft, hintsLeft, problemsLeft]) {
  input.addEventListener('change', () => {
    input.value = budget(input.value, input === problemsLeft ? 1 : 0);
    persistSession(); updateHintStrategy(true);
    if (calculatedResults) renderRecommendations();
  });
}
document.getElementById('candidateSearch').addEventListener('input', () => { candidateLimit = 48; renderCandidatePage(); });
document.getElementById('showMoreCandidates').addEventListener('click', () => { candidateLimit += 48; renderCandidatePage(); });

if (updateDbBtn) {
  updateDbBtn.addEventListener('click', async () => {
    updateDbBtn.disabled = true;
    updateProgressContainer.style.display = 'block';
    
    const setProgress = (percent, text) => {
      updateProgressBar.style.width = `${percent}%`;
      updateProgressText.textContent = `${percent}% - ${text}`;
    };
    
    try {
      setProgress(20, t('dynamic.requestData'));
      const manifestUrl = new URL(`${import.meta.env.BASE_URL}master_duel_manifest.json`, window.location.origin);
      manifestUrl.searchParams.set('v', Date.now());
      const manifest = await fetchCardManifest(manifestUrl.href);
      const finalCards = manifest.cards;
      setProgress(70, t('dynamic.verifiedData', { count: manifest.counts?.monsters ?? finalCards.length }));
      persistSession();
      setProgress(90, t('dynamic.savingData'));
      await saveCachedCards(finalCards);
      try { localStorage.setItem('md-decoder-db-updated-at', manifest.generatedAt || new Date().toISOString()); } catch { /* Optional metadata. */ }
      
      setProgress(100, t('dynamic.updateDone'));
      setTimeout(() => {
        window.location.reload();
      }, 1000);
      
    } catch (err) {
      console.error(err);
      setProgress(0, t('dynamic.updateFailed', { error: err.message }));
      updateDbBtn.disabled = false;
      setTimeout(() => {
        updateProgressContainer.style.display = 'none';
      }, 3000);
    }
  });
}

if (clearDbBtn) {
  clearDbBtn.addEventListener('click', async () => {
    if (!confirm(t('dynamic.confirmDelete'))) return;
    try {
      await clearCachedCards();
      showInputMessage(t('dynamic.deleteSuccess'));
      window.location.reload();
    } catch (err) {
      console.error(err);
      showInputMessage(t('dynamic.deleteError'));
    }
  });
}

// Collapsible Settings Accordion Toggle
const toggleSettingsBtn = document.getElementById('toggleSettingsBtn');
const settingsContent = document.getElementById('settingsContent');
const settingsArrow = document.getElementById('settingsArrow');
const dbStatusBadge = document.getElementById('dbStatusBadge');

if (toggleSettingsBtn && settingsContent) {
  toggleSettingsBtn.addEventListener('click', () => {
    const isHidden = settingsContent.classList.contains('hidden');
    if (isHidden) {
      settingsContent.classList.remove('hidden');
      if (settingsArrow) settingsArrow.textContent = '▼';
    } else {
      settingsContent.classList.add('hidden');
      if (settingsArrow) settingsArrow.textContent = '▶';
    }
  });
}

// Init
initGameData();
