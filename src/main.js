import './style.css'
import { allCards as rawCards, dataGeneratedAt } from './cards_data.js'
import { getValidLevels, renderCardStatsHTML, translateAttribute, translateFrame, translateRace, getTargetRulesLevel, filterCandidatesByHints, escapeHTML, formatStat } from './utils.js'
import { ATTRIBUTE_ORDER, FRAME_ORDER, RACE_ORDER, alternateCardName, getLocale, initializeI18n, localizeCardName, populateLocalizedSelect, t } from './i18n.js';
import { initializeTheme } from './theme.js';

import { allocateAttempts, sortScores, distinctScores, TWO_TURN_LIMIT, chooseCriteria, recommendHintUse } from './solver.js';
import { fetchCardManifest } from './data.js';
import { formatHintAdvice } from './hint-advice.js';
import { getFrameInput } from './frame-result.js';
import { applyAutomaticMatches, budget, consumeAttempt, createBatchId, recordDirectHints, nextChallenge, parseStatInput, removeInputBatch, saveSession, restoreSession, hasSolvedGuess } from './session.js';

import { getCachedCards, saveCachedCards, clearCachedCards } from './db.js'

let allCards = [];

const initialStrategyHTML = () => `
  <p class="strategy-summary">${t('dynamic.readyBody')}</p>
`;

// State
let candidates = [];
let hints = []; // Array of { type: 'guess'|'direct', stat, isCorrect, value, cardName }
let selectedCard = null;
let framePendulum = false;
let frameKindChoice = null;
let frameResult = null;
let calculatedResults = null;
let activeCriteria = 'entropy';
let manualCriteria = false;
let calculationBudget = 0;
let solverWorker = null;
let calculationId = 0;
const CANDIDATE_PAGE_SIZE = 60;
let candidateLimit = CANDIDATE_PAGE_SIZE;
const CURRENT_EVENT_CARD_TOTAL = 9058;

// DOM Elements
const searchInput = document.getElementById('cardSearch');
const searchDropdown = document.getElementById('searchDropdown');
const selectedCardContainer = document.getElementById('selectedCardContainer');
const selectedCardImg = document.getElementById('selectedCardImg');
const infoName = document.getElementById('infoName');
const infoDetails = document.getElementById('infoDetails');
const statusToggles = () => document.querySelectorAll('.status-toggles .btn-toggle');
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
  renderKnownStats();
  
  if (hints.length > 0) {
    appliedHintsContainer.classList.remove('hidden');
    renderHints();
  } else {
    appliedHintsContainer.classList.add('hidden');
  }
}

function makeCardInteractive(element, action) {
  element.setAttribute('role', 'button');
  element.tabIndex = 0;
  element.onclick = action;
  element.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
  });
}

function renderKnownStats() {
  document.getElementById('knownStats').innerHTML = ['frameType', 'attribute', 'level', 'race', 'atk', 'def'].map(stat => {
    let known = hints.find(hint => hint.type === 'direct' && hint.stat === stat && hint.isCorrect
      && (stat !== 'frameType' || hint.value !== 'pendulum'))
      || hints.find(hint => hint.type === 'direct' && hint.stat === stat && hint.isCorrect)
      || hints.find(hint => hint.stat === stat && hint.isCorrect);
    if (stat === 'frameType' && known?.type === 'guess') {
      const frames = [...new Set(candidates.map(card => card.frameType))];
      known = frames.length === 1 ? { value: frames[0] } : null;
    }
    return `<div class="known-stat${known ? ' is-known' : ''}"><span>${getStatNameKR(stat)}</span><strong>${known ? escapeHTML(getTranslatedValue(stat, known.value)) : '?'}</strong></div>`;
  }).join('');
}

function renderCardSummary(card) {
  const levelLabel = card.frameType === 'link' ? 'Lnk' : card.frameType.startsWith('xyz') ? 'Rk' : 'Lv';
  const level = getTargetRulesLevel(card);
  const badge = (stat, value, className) => `<span class="stat-badge ${className}" data-stat="${stat}" title="${escapeHTML(t(`stats.${stat}`))}">${escapeHTML(value)}</span>`;
  return `<div class="candidate-stats">
    <div class="candidate-stats-row">${badge('frameType', translateFrame(card.frameType), `frame-${card.frameType.toLowerCase().replace('_pendulum', '')}`)}</div>
    <div class="candidate-stats-row">${badge('attribute', translateAttribute(card.attribute) || '—', 'attr')}${badge('level', level == null ? '—' : `${levelLabel}.${level}`, 'level')}</div>
    <div class="candidate-stats-row">${badge('race', translateRace(card.race) || '—', 'race')}</div>
    <div class="candidate-stats-atkdef"><span data-stat="atk" title="${escapeHTML(t('stats.atk'))}">⚔️ ${escapeHTML(formatStat(card.atk))}</span> / <span data-stat="def" title="${escapeHTML(t('stats.def'))}">🛡️ ${escapeHTML(formatStat(card.def))}</span></div>
  </div>`;
}

function renderCandidateList(list, container) {
  container.innerHTML = '';
  list.forEach(card => {
    const div = document.createElement('div');
    div.className = 'card-item animate-fade-in';
    const imgUrl = escapeHTML(card.image_url || '');
    const displayName = localizeCardName(card);

    div.innerHTML = `
      <img src="${imgUrl}" alt="${escapeHTML(displayName)}" loading="lazy" onerror="this.onerror=null;this.style.visibility='hidden'">
      <div class="card-item-title" title="${escapeHTML(displayName)}">${escapeHTML(displayName)}</div>
      ${renderCardSummary(card)}
    `;
    makeCardInteractive(div, () => selectCard(card));
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
  const batches = new Map();
  hints.forEach((hint, index) => {
    if (hint.inferred || hint.supplemental) return;
    if (!batches.has(hint.batchId)) batches.set(hint.batchId, []);
    batches.get(hint.batchId).push({ hint, index });
  });
  for (const entries of batches.values()) {
    const { hint, index } = entries[0];
    const li = document.createElement('li');
    li.className = 'history-batch';
    const guessedCard = allCards.find(card => card.id === hint.cardId);
    const title = hint.type === 'guess' ? (guessedCard ? localizeCardName(guessedCard) : hint.cardName)
      : t(hint.hintKind === 'bonus' ? 'dynamic.bonusHint' : 'dynamic.confirmedHint');
    const cost = entries.reduce((sum, entry) => sum + (entry.hint.hintCost || 0), 0);
    li.innerHTML = `<div class="history-batch-heading"><strong>${escapeHTML(title)}</strong>${hint.type === 'direct' ? `<span class="history-cost">${t('dynamic.hintCost', { count: cost })}</span>` : ''}</div>
      <div class="history-stats">${entries.map(({ hint: entry }) => {
        const revealed = entry.stat === 'frameType' && entry.isCorrect
          ? hints.find(item => item.type === 'direct' && item.stat === 'frameType' && item.batchId === entry.batchId) : null;
        return `<span class="history-stat ${entry.isCorrect ? 'res-correct' : 'res-wrong'}"><span>${getStatNameKR(entry.stat)}</span><strong>${escapeHTML(getTranslatedValue(entry.stat, revealed?.value ?? entry.value))}</strong>${entry.type === 'guess' ? `<b>${entry.isCorrect ? 'O' : 'X'}</b>` : ''}</span>`;
      }).join('')}</div>`;
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete-hint';
    deleteBtn.textContent = t(hint.type === 'guess' ? 'dynamic.cancelGuess' : 'dynamic.cancelInput');
    deleteBtn.onclick = () => deleteHintItem(index);
    li.querySelector('.history-batch-heading').appendChild(deleteBtn);
    appliedHintsList.appendChild(li);
  }
}

// ------------------------------------------------------------------
// DIRECT HINT LOGIC
// ------------------------------------------------------------------
function applyDirectHints() {
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
      const revealedFrame = stat === 'frameType' ? hints.find(hint => hint.type === 'guess' && hint.stat === stat
        && hint.isCorrect) : null;
      if (revealedFrame) {
        additions.push({ type: 'direct', stat, value, isCorrect: true, isExact: true,
          batchId: revealedFrame.batchId, source: 'judgment', supplemental: true, hintCost: 0 });
        continue;
      }
      if (hints.some(hint => hint.type === 'guess' && hint.stat === stat && hint.isCorrect
        && hint.value === value)) continue;
      additions.push({ type: 'direct', stat, value, isCorrect: true, isExact: true, batchId });
    }
    if (!additions.length) {
      showInputMessage(t('dynamic.alreadyApplied'));
      return;
    }
    const recorded = recordDirectHints(hints, additions, hintsLeft.value);
    hints.push(...recorded.hints);
    hintsLeft.value = recorded.remaining;
    fields.forEach(([, input]) => { input.value = ''; });
    directDefNone.checked = false; directDef.disabled = false;
    applyFilters();
  } catch (error) { showInputMessage(error.message); }
}
applyDirectHintBtn.addEventListener('click', applyDirectHints);

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
let activeSearchIndex = -1;
function closeSearch() {
  searchDropdown.classList.add('hidden');
  searchInput.setAttribute('aria-expanded', 'false');
  searchInput.removeAttribute('aria-activedescendant');
  activeSearchIndex = -1;
}
searchInput.addEventListener('input', (e) => {
  activeSearchIndex = -1;
  searchInput.removeAttribute('aria-activedescendant');
  const q = e.target.value.toLowerCase().trim();
  if (q.length < 2) {
    closeSearch();
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
      div.id = `search-card-${card.id}`;
      div.setAttribute('role', 'option');
      div.setAttribute('aria-selected', 'false');
      
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
        closeSearch();
        searchInput.value = '';
      };
      searchDropdown.appendChild(div);
    });
    searchDropdown.classList.remove('hidden');
    searchInput.setAttribute('aria-expanded', 'true');
  } else {
    closeSearch();
  }
});
searchInput.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeSearch(); return; }
  if (searchDropdown.classList.contains('hidden')) return;
  const options = [...searchDropdown.querySelectorAll('[role="option"]')];
  if (event.key === 'Enter' && activeSearchIndex >= 0) {
    event.preventDefault(); options[activeSearchIndex]?.click(); return;
  }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !options.length) return;
  event.preventDefault();
  activeSearchIndex = event.key === 'ArrowDown' ? (activeSearchIndex + 1) % options.length
    : (activeSearchIndex < 0 ? options.length - 1 : (activeSearchIndex - 1 + options.length) % options.length);
  options.forEach((option, index) => option.setAttribute('aria-selected', String(index === activeSearchIndex)));
  searchInput.setAttribute('aria-activedescendant', options[activeSearchIndex].id);
  options[activeSearchIndex].scrollIntoView({ block: 'nearest' });
});

document.addEventListener('click', (e) => {
  if (!searchDropdown.contains(e.target) && e.target !== searchInput) {
    closeSearch();
  }
});

function selectCard(card) {
  showInputMessage('');

  selectedCard = card;
  framePendulum = false;
  frameKindChoice = null;
  frameResult = null;
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
  
  statusToggles().forEach(btn => {
    btn.classList.remove('active');
    btn.dataset.selected = "false";
    btn.setAttribute('aria-pressed', 'false');
  });
  refreshMatchedInputs();

  // Scroll to input section when selecting a card
  const target = document.getElementById('guessResultSection');
  if (target) {
    setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }
}

document.querySelector('.status-toggles').addEventListener('click', event => {
    const btn = event.target.closest('.btn-toggle');
    if (!btn || btn.disabled) return;
    const parent = btn.parentElement;
    parent.querySelectorAll('.btn-toggle').forEach(b => {
      b.classList.remove('active');
      b.dataset.selected = "false";
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.dataset.selected = "true";
    btn.setAttribute('aria-pressed', 'true');
    if (btn.dataset.pendulum !== undefined) {
      const next = btn.dataset.pendulum === 'true';
      if (next !== framePendulum) frameKindChoice = null;
      framePendulum = next;
    } else if (btn.closest('.status-row')?.dataset.stat === 'frameType' && btn.dataset.val === 'wrong') {
      framePendulum = false;
      frameKindChoice = null;
    }
    refreshMatchedInputs();
});

document.getElementById('frameKind').addEventListener('change', event => {
  frameKindChoice = event.target.value || null;
  refreshMatchedInputs();
});

function refreshFrameResults() {
  if (!selectedCard) return { ready: false };
  const other = [...document.querySelectorAll('.status-row')].flatMap(row => {
    const active = row.querySelector('.btn-toggle.active');
    const stat = row.dataset.stat;
    if (stat === 'frameType' || !active) return [];
    return [{ type: 'guess', stat, isCorrect: active.dataset.val === 'correct',
      value: stat === 'level' ? getValidLevels(selectedCard) : selectedCard[stat] }];
  });
  const judgment = document.querySelector('.status-row[data-stat="frameType"] .btn-toggle.active')?.dataset.val ?? null;
  const knownFrame = hints.find(hint => hint.type === 'direct' && hint.stat === 'frameType'
    && hint.isCorrect && hint.value !== 'pendulum')?.value;
  const result = getFrameInput(candidates, selectedCard, {
    judgment, pendulum: framePendulum, frame: frameKindChoice, knownFrame, otherJudgments: other
  });
  frameResult = result.result;
  document.getElementById('frameDetails').classList.toggle('hidden', !result.showPendulum);
  document.querySelectorAll('#framePendulumChoices .btn-toggle').forEach(button => {
    const active = (button.dataset.pendulum === 'true') === framePendulum;
    button.classList.toggle('active', active);
    button.dataset.selected = String(active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.getElementById('frameKindRow').classList.toggle('hidden', !result.showKinds);
  const select = document.getElementById('frameKind');
  select.innerHTML = `<option value="">${escapeHTML(t('main.selectFrame'))}</option>`
    + result.frames.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(translateFrame(value))}</option>`).join('');
  select.value = result.showKinds && result.frames.includes(result.result) ? result.result : '';
  const note = document.getElementById('frameResultNote');
  note.classList.toggle('hidden', !result.showPendulum && !result.conflict);
  note.textContent = t(result.conflict ? 'dynamic.frameConflict'
    : result.automaticKind ? 'dynamic.frameKindAutomatic'
      : result.showKinds ? 'main.selectFrame' : 'main.frameResultHelp');
  return result;
}

function refreshMatchedInputs() {
  const frame = refreshFrameResults();
  const selected = [...document.querySelectorAll('.status-row')].flatMap(row => {
    const active = row.querySelector('.btn-toggle.active');
    if (!active || !selectedCard || (row.dataset.stat === 'frameType' && !frame.ready)) return [];
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
  const frame = refreshFrameResults();
  if (!frame.ready) {
    showInputMessage(t(frame.conflict ? 'dynamic.frameConflict' : 'main.selectFrame'));
    return;
  }
  let completedHints;
  try {
    completedHints = applyAutomaticMatches(newHints, [selectedCard], {
      revealedFrames: frameResult !== 'wrong' ? { [batchId]: frameResult } : {}
    });
  } catch (error) { showInputMessage(error.message); return; }
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
  candidateLimit = CANDIDATE_PAGE_SIZE;
  cancelCalculation();
  calculatedResults = null;
  const twoTurnButton = recCriteriaGroup.querySelector('[data-criteria="twoShot"]');
  twoTurnButton.disabled = true;
  twoTurnButton.title = t('dynamic.criteriaPending');
  const horizonButton = recCriteriaGroup.querySelector('[data-criteria="horizon"]');
  horizonButton.disabled = true;
  horizonButton.textContent = t('criteria.horizon');
  horizonButton.title = t('dynamic.criteriaPending');
  updateUI();
  recContainer.classList.add('hidden');
  snipeList.innerHTML = '';
  scoutList.innerHTML = '';
  strategyMsg.innerHTML = initialStrategyHTML();
  strategyMsg.classList.remove('guaranteed-result');
  persistSession();
  updateHintStrategy(false);
  if (selectedCard) refreshMatchedInputs();
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
  framePendulum = false;
  frameKindChoice = null;
  frameResult = null;
  if (selectedCardContainer) selectedCardContainer.classList.add('hidden');
  
  // Reset toggles (Mode 2)
  statusToggles().forEach(btn => {
    btn.classList.remove('active');
    btn.dataset.selected = "false";
    btn.setAttribute('aria-pressed', 'false');
  });
  judgmentProgress.textContent = '0 / 6';
  applyGuessBtn.disabled = true;
  document.getElementById('frameDetails').classList.add('hidden');
  document.getElementById('frameKindRow').classList.add('hidden');
  document.getElementById('frameKind').innerHTML = '';
  document.getElementById('frameResultNote').classList.add('hidden');
  document.getElementById('frameResultNote').textContent = '';
  
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
  horizon: `<strong>${t('criteria.horizon')}:</strong> ${t('criteriaDesc.horizon')}`,
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
    btn.setAttribute('aria-pressed', String(btn.dataset.criteria === criteria));
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
  // Both lists use the same responsive grid. Keep its reserved columns even
  // when fewer recommendations exist, so individual cards retain their width.
  const columns = getComputedStyle(container).gridTemplateColumns;
  if (!columns || columns === 'none') return 1;
  return Math.max(1, Math.min(5, columns.split(/\s+/).filter(Boolean).length));
}

function renderRecommendationList(list, container) {
  container.innerHTML = '';
  const visibleCount = Math.min(getRecommendationLimit(container), list.length);
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
    const horizonText = item.horizonProb == null ? t('dynamic.notEvaluated')
      : `${t('dynamic.horizonWin', { count: calculatedResults.horizonDepth })}: ${(item.horizonProb * 100).toFixed(2)}%${calculatedResults.horizonExact ? '' : ` (${t('dynamic.estimate')})`}`;
    const primaryText = activeCriteria === 'entropy' ? entropyText
      : activeCriteria === 'minimax' ? minimaxText
        : activeCriteria === 'oneShot' ? oneShotText
          : activeCriteria === 'twoShot' ? twoShotText : activeCriteria === 'horizon' ? horizonText : expectedText;
    const secondaryText = activeCriteria === 'oneShot'
      ? expectedText
      : item.oneShotProb > 0 ? oneShotText : '';
    
    div.innerHTML = `
      <img src="${imgUrl}" alt="${escapeHTML(displayName)}" loading="lazy" onerror="this.onerror=null;this.style.visibility='hidden'">
      <div class="card-item-title" title="${escapeHTML(displayName)}">${escapeHTML(displayName)}</div>
      ${renderCardSummary(card)}
      ${item.equivalentChoices > 1 ? `<div class="card-item-stats">${t('dynamic.equivalent', { count: item.equivalentChoices })}</div>` : ''}
      <div class="recommendation-primary">${primaryText}</div>
      ${secondaryText && secondaryText !== primaryText ? `<div class="recommendation-secondary">${secondaryText}</div>` : ''}
    `;
    makeCardInteractive(div, () => selectCard(card));
    container.appendChild(div);
  });
}

function renderRecommendations() {
  if (!calculatedResults) return;

  const sortedSnipes = distinctScores(calculatedResults.snipes, activeCriteria);
  const sortedScouts = distinctScores(calculatedResults.scouts, activeCriteria);
  const guaranteed = calculatedResults.snipes.some(score => score.oneShotProb >= 1 - 1e-10);
  document.getElementById('scoutSection').hidden = guaranteed || budget(totalAttemptsLeft.value) <= 1 || !sortedScouts.length;
  
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
    if (btn.disabled) return;
    manualCriteria = true;
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

function calculateRecommendations() {
  if (!candidates.length || hasSolvedGuess(hints)) return;
  manualCriteria = false;
  updateHintStrategy(true);
  cancelCalculation();
  const id = calculationId;
  calculationBudget = Math.min(4, Math.max(1, allocateAttempts(budget(totalAttemptsLeft.value), budget(problemsLeft.value, 1))));
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
      const horizonButton = recCriteriaGroup.querySelector('[data-criteria="horizon"]');
      horizonButton.disabled = calculatedResults.horizonDepth < 3;
      horizonButton.textContent = calculatedResults.horizonDepth >= 3
        ? t('dynamic.horizonWin', { count: calculatedResults.horizonDepth }) : t('criteria.horizon');
      horizonButton.title = calculatedResults.horizonDepth < 3 ? t('dynamic.horizonLimit') : '';
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
      revealedStats: [...new Set(hints.filter(hint => hint.isCorrect).map(hint => hint.stat))],
      attempts: calculationBudget,
      resourceAttempts: budget(totalAttemptsLeft.value),
      remainingHints: budget(hintsLeft.value),
      problemsLeft: budget(problemsLeft.value, 1)
    } });
  } catch (error) { cancelCalculation(); strategyMsg.textContent = t('dynamic.calcFailed', { error: error.message }); }
}
calcRecBtn.addEventListener('click', calculateRecommendations);

function updateHintStrategy(autoSelect = false) {
  const attempts = budget(totalAttemptsLeft.value);
  const remainingHints = budget(hintsLeft.value);
  const problems = budget(problemsLeft.value, 1);
  const currentBudget = allocateAttempts(attempts, problems);
  const guaranteed = calculatedResults?.snipes.some(score => score.oneShotProb >= 1 - 1e-10);
  const recommended = guaranteed ? 'oneShot' : chooseCriteria({ attempts: currentBudget, twoTurnExact: calculatedResults?.twoTurnExact,
    horizonDepth: calculatedResults?.horizonDepth, candidateCount: candidates.length });
  const unavailable = (activeCriteria === 'twoShot' && !calculatedResults?.twoTurnExact)
    || (activeCriteria === 'horizon' && !(calculatedResults?.horizonDepth >= 3));
  if ((autoSelect && !manualCriteria) || unavailable) {
    activeCriteria = recommended;
    if (unavailable) manualCriteria = false;
    recCriteriaGroup.querySelectorAll('.btn-toggle').forEach(button => {
      button.classList.toggle('active', button.dataset.criteria === activeCriteria);
      button.setAttribute('aria-pressed', String(button.dataset.criteria === activeCriteria));
    });
    criteriaDesc.innerHTML = criteriaDescriptions[activeCriteria];
    criteriaDesc.style.borderLeftColor = activeCriteria === 'minimax' ? '#ef4444'
      : activeCriteria === 'oneShot' ? '#22c55e' : 'var(--accent-blue)';
  }
  document.getElementById('autoCriteriaReason').textContent = manualCriteria ? t('dynamic.manualCriteria')
    : t('dynamic.autoCriteriaReason', { attempts, problems, criterion: t(`criteria.${activeCriteria}`), count: Math.min(4, currentBudget) });
  const messages = [];
  let hintAdviceHTML = '';
  if (hasSolvedGuess(hints) && candidates.length) {
    calcRecBtn.disabled = true;
    strategyMsg.textContent = t('dynamic.solved');
    return;
  }
  if (!candidates.length) messages.push(t('dynamic.noCandidates'));
  else if (candidates.length === 1) messages.push(t('dynamic.oneCandidate', { card: escapeHTML(localizeCardName(candidates[0])) }));
  else if (!calculatedResults) messages.push(t('dynamic.calculatePrompt', { count: candidates.length }));
  else {
    const best = guaranteed ? sortScores(calculatedResults.snipes, 'oneShot')[0]
      : sortScores([...calculatedResults.snipes, ...calculatedResults.scouts], activeCriteria)[0];
    if (best?.oneShotProb >= 1 - 1e-10) messages.push(t('dynamic.guaranteed', { card: `<strong>${escapeHTML(localizeCardName(best.card))}</strong>` }));
    else if (best) messages.push(t(activeCriteria === 'horizon' ? 'dynamic.bestHorizonCompact' : best.twoShotProb === null ? 'dynamic.bestOneShotCompact' : 'dynamic.bestCompact', {
      card: `<strong>${escapeHTML(localizeCardName(best.card))}</strong>`,
      oneShot: `${(best.oneShotProb * 100).toFixed(2)}%`,
      twoShot: `${((best.twoShotProb ?? 0) * 100).toFixed(2)}%`,
      count: calculatedResults.horizonDepth,
      probability: `${((best.horizonProb ?? 0) * 100).toFixed(2)}%`,
      estimate: calculatedResults.horizonExact ? '' : ` (${t('dynamic.estimate')})`
    }));
    // Hint value is measured for the current candidate state. Future challenge
    // count raises the scarcity threshold; it never assigns one hint per problem.
    const hintAdvice = recommendHintUse({
      attempts,
      remainingHints,
      problemsLeft: problems,
      candidateCount: candidates.length,
      hint: calculatedResults.hint ? { ...calculatedResults.hint, timing: best?.hintTiming ?? null } : null,
      guessedCount: new Set(hints.filter(hint => hint.type === 'guess').map(hint => hint.cardId)).size,
      bestGuessExpectedRemaining: calculatedResults.bestGuessExpectedRemaining
    });
    if (calculatedResults.hint && remainingHints && !guaranteed) {
      const notice = formatHintAdvice(hintAdvice, calculatedResults.hint);
      hintAdviceHTML = `<aside class="hint-advice" aria-live="polite" data-decision="${hintAdvice.decision}">
        <strong>${escapeHTML(notice.title)}</strong>
        <p>${escapeHTML(notice.reason)}</p>
        ${notice.detail ? `<p class="hint-metrics">${escapeHTML(notice.detail)}</p>` : ''}
      </aside>`;
    }
  }
  strategyMsg.innerHTML = messages.map((message, index) => `<p class="${index === 0 ? 'strategy-result' : 'strategy-advice'}">${message}</p>`).join('') + hintAdviceHTML;
  strategyMsg.classList.toggle('guaranteed-result', calculatedResults?.snipes.some(score => score.oneShotProb >= 1 - 1e-10) ?? false);
}

for (const input of [totalAttemptsLeft, hintsLeft, problemsLeft]) {
  input.addEventListener('change', () => {
    input.value = budget(input.value, input === problemsLeft ? 1 : 0);
    persistSession(); updateHintStrategy(true);
    if (calculatedResults || solverWorker) calculateRecommendations();
  });
}
document.getElementById('candidateSearch').addEventListener('input', () => { candidateLimit = CANDIDATE_PAGE_SIZE; renderCandidatePage(); });
document.getElementById('showMoreCandidates').addEventListener('click', () => { candidateLimit += CANDIDATE_PAGE_SIZE; renderCandidatePage(); });

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
