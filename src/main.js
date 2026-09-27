import './style.css'
import { allCards as rawCards, dataGeneratedAt } from './cards_data.js'
import { getValidLevels, renderCardStatsHTML, translateAttribute, translateFrame, translateRace, getTargetRulesLevel, filterCandidatesByHints, escapeHTML, formatStat } from './utils.js'

import { allocateAttempts, sortScores, distinctScores, TWO_TURN_LIMIT, chooseCriteria } from './solver.js';
import { fetchCardManifest } from './data.js';
import { applyAutomaticMatches, budget, createBatchId, nextChallenge, parseStatInput, removeInputBatch, saveSession, restoreSession, hasSolvedGuess } from './session.js';

import { getCachedCards, saveCachedCards, clearCachedCards } from './db.js'

let allCards = [];

const initialStrategyHTML = `
  <div style="background: rgba(59, 130, 246, 0.05); border: 1px dashed rgba(59, 130, 246, 0.3); padding: 1rem; border-radius: 8px; font-size: 0.85rem; line-height: 1.5; color: var(--text-muted); display: flex; align-items: center; gap: 0.75rem;">
    <span style="font-size: 1.5rem; flex-shrink: 0;">⚡</span>
    <div>
      <strong style="color: #60a5fa; display: block; margin-bottom: 0.2rem;">실시간 전략 추천 준비 완료</strong>
      현재 단서들을 기반으로 최적의 판단을 내릴 수 있습니다. 우측 상단의 <strong>[최적의 카드 계산]</strong> 버튼을 클릭하여 추천 정답 스나이핑 카드와 극한의 정찰 카드를 확인하세요.
    </div>
  </div>
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
      if (dbStatusText) dbStatusText.textContent = `현재: 사용자 업데이트 데이터${cachedAt ? ` (${new Date(cachedAt).toLocaleDateString()})` : ''}`;
      if (dbStatusBadge) {
        dbStatusBadge.textContent = '최신 DB';
        dbStatusBadge.style.background = 'rgba(34, 197, 94, 0.15)';
        dbStatusBadge.style.color = '#4ade80';
      }
      console.log(`Loaded ${allCards.length} cards from IndexedDB.`);
    } else {
      allCards = rawCards.filter(c => c.frameType !== 'spell' && c.frameType !== 'trap');
      if (dbStatusText) dbStatusText.textContent = `현재: 검증된 내장 데이터 (${new Date(dataGeneratedAt).toLocaleDateString()})`;
      if (dbStatusBadge) {
        dbStatusBadge.textContent = '내장 DB';
        dbStatusBadge.style.background = 'rgba(59, 130, 246, 0.15)';
        dbStatusBadge.style.color = '#60a5fa';
      }
      console.log(`Loaded ${allCards.length} cards from static cards_data.js.`);
    }
  } catch (err) {
    console.error("Failed to load IndexedDB cache, fallback to static:", err);
    allCards = rawCards.filter(c => c.frameType !== 'spell' && c.frameType !== 'trap');
    if (dbStatusText) dbStatusText.textContent = `현재: 검증된 내장 데이터 (${new Date(dataGeneratedAt).toLocaleDateString()}, 캐시 오류)`;
    if (dbStatusBadge) {
      dbStatusBadge.textContent = '내장 DB (오류)';
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
    restoreMessage = saved.migrated ? '이전 버전의 부정확한 자동 프레임·레벨 조건을 제거하고 추론을 복원했습니다.' : '이전 추론을 복원했습니다.';
  }
  applyFilters();
  if (restoreMessage) document.getElementById('sessionStatus').textContent = restoreMessage;
  if (saved?.migrated) showInputMessage('이전 버전에서 자동으로 단정했던 프레임·레벨 조건을 제거했습니다. O였던 항목의 인게임 공개값을 다시 확인해주세요.');
}

function updateUI() {
  candidatesCount.textContent = `${candidates.length}장 / ${allCards.length}장`;
  document.getElementById('databaseScopeText').textContent = allCards.length === CURRENT_EVENT_CARD_TOTAL
    ? `검증 DB ${allCards.length}장 · 현재 이벤트와 일치`
    : `검증 DB ${allCards.length}장 · 현재 이벤트 ${CURRENT_EVENT_CARD_TOTAL}장 (차이 ${Math.abs(allCards.length - CURRENT_EVENT_CARD_TOTAL)}장 미확인)`;
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

    const levelLabel = card.frameType === 'link' ? 'Lnk' : (card.frameType.startsWith('xyz') ? 'Rk' : 'Lv');
    const lvText = getTargetRulesLevel(card) != null ? `${levelLabel}.${getTargetRulesLevel(card)}` : '';
    const attrText = translateAttribute(card.attribute) || '';
    const atkText = formatStat(card.atk);
    const defText = formatStat(card.def);

    div.innerHTML = `
      <img src="${imgUrl}" alt="${escapeHTML(card.name)}" loading="lazy" onerror="this.onerror=null;this.style.visibility='hidden'">
      <div class="card-item-title" title="${escapeHTML(card.name)}">${escapeHTML(card.name)}</div>
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
  const map = {
    frameType: '카드 프레임', attribute: '속성', level: '레벨/랭크/링크',
    race: '종족', atk: '공격력', def: '수비력'
  };
  return map[stat] || stat;
}

function getTranslatedValue(stat, value) {
  if (stat === 'def' && value === null) return '없음';
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
    document.getElementById('sessionStatus').textContent = ok ? '추론 내용은 이 브라우저에 자동 저장됩니다.' : '저장 공간을 사용할 수 없어 새로고침하면 추론이 사라집니다.';
  } catch { document.getElementById('sessionStatus').textContent = '브라우저 저장소를 사용할 수 없습니다.'; }
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
  visibleCandidatesCount.textContent = Math.min(list.length, candidateLimit);
  renderCandidateList(list.slice(0, candidateLimit), candidateList);
  document.getElementById('showMoreCandidates').hidden = list.length <= candidateLimit;
  const notice = document.getElementById('candidateNotice');
  notice.hidden = candidates.length > 0 && (!query || list.length > 0);
  notice.textContent = candidates.length === 0
    ? '조건을 모두 만족하는 카드가 없습니다. 입력한 O/X와 공개 값을 확인하거나 최근 입력을 취소하세요. 데이터에 없는 카드일 수도 있습니다.'
    : '남은 후보에서 해당 이름을 찾지 못했습니다.';
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
          <span class="stat-name">[확실한 힌트]</span> 
          ${getStatNameKR(hint.stat)}: <span class="stat-val">${escapeHTML(getTranslatedValue(hint.stat, hint.value))}</span>
        </span>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="stat-res res-correct">적용됨</span>
        </div>
      `;
    } else {
      const resClass = hint.isCorrect ? 'res-correct' : 'res-wrong';
      const resText = hint.isCorrect ? 'O' : 'X';
      const revealed = hints.find(item => item.supplemental && !item.automatic && item.batchId === hint.batchId && item.stat === hint.stat);
      const revealedText = revealed ? ` → 공개: <span class="stat-val">${escapeHTML(getTranslatedValue(revealed.stat, revealed.value))}</span>` : '';
      hintContent = `
        <span>
          <span class="stat-name">[${escapeHTML(hint.cardName)}]</span>
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
    deleteBtn.title = '이 도전 또는 정보 입력 묶음 전체 취소';
    deleteBtn.setAttribute('aria-label', '이 입력 묶음 취소');
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
        if (existing.value !== value) throw new Error(`${getStatNameKR(stat)}에 이미 다른 공개 값이 있습니다. 기존 입력을 취소한 뒤 수정하세요.`);
        continue;
      }
      additions.push({ type: 'direct', stat, value, isCorrect: true, isExact: true, batchId });
    }
    if (!additions.length) {
      showInputMessage('선택한 정보는 이미 적용되어 있습니다.');
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
      
      div.innerHTML = `
        <img src="${imgUrl}" alt="${escapeHTML(card.name)}" onerror="this.onerror=null;this.style.visibility='hidden'">
        <div class="search-dropdown-info">
          <div class="search-dropdown-title">${escapeHTML(card.name)}</div>
          <div class="search-dropdown-subtitle">${escapeHTML(card.nameEn || '')}</div>
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
  infoName.textContent = card.name;
  
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
  if (hints.some(hint => hint.type === 'guess' && hint.cardId === selectedCard.id)) { showInputMessage('이미 기록한 카드입니다. 수정하려면 기존 도전 기록을 취소하세요. 도전 횟수는 차감하지 않습니다.'); return; }
  if (budget(totalAttemptsLeft.value) < 1) { showInputMessage('남은 도전 횟수를 확인하세요.'); return; }
  
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
    showInputMessage('6개 항목의 O/X를 모두 선택해주세요. 아직 도전 횟수는 차감하지 않았습니다.');
    return;
  }
  const completedHints = applyAutomaticMatches(newHints, [selectedCard]);
  const provisionalCandidates = filterCandidatesByHints(candidates, completedHints);
  if (!provisionalCandidates.length) {
    showInputMessage('이 O/X 조합을 만족하는 카드가 없습니다. 입력을 다시 확인해주세요. 아직 도전 횟수는 차감하지 않았습니다.');
    return;
  }
  newHints[0].attemptCost = 1;
  totalAttemptsLeft.value = budget(totalAttemptsLeft.value) - 1;
  
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
  twoTurnButton.title = '현재 후보로 추천을 계산하면 사용할 수 있습니다.';
  updateUI();
  recContainer.classList.add('hidden');
  snipeList.innerHTML = '';
  scoutList.innerHTML = '';
  strategyMsg.innerHTML = initialStrategyHTML;
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
  entropy: '<strong>기대 정보량:</strong> 6개 O/X 결과에 따른 정보량을 최대화합니다. 최단 해결 횟수를 보장하지는 않습니다.',
  minimax: '<strong>최악 잔여 최소:</strong> 실패했을 때 남을 수 있는 가장 큰 후보군을 줄입니다. 정답이면 잔여 수는 0입니다.',
  oneShot: '<strong>즉시 정답 확률:</strong> 이번 제출로 6개 항목이 모두 일치할 확률입니다. 후보 1장만 남기고 틀린 경우는 성공에 포함하지 않습니다.',
  twoShot: '<strong>2회 내 성공 확률:</strong> 첫 판정 후 최선의 다음 카드를 제출할 때의 성공 확률입니다. 서로 구분되는 후보 유형이 60개 이하이면 카드 수가 많아도 전수 계산합니다. 추가 힌트는 사용하지 않는 조건입니다.',
  expected: '<strong>평균 잔여 최소:</strong> 이번 제출 후 남는 후보 카드 수의 평균을 줄입니다. 정답이면 잔여 수는 0입니다.'
};

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
  const minimumCardWidth = 112;
  const gap = 12;
  return Math.max(1, Math.min(6, Math.floor((width + gap) / (minimumCardWidth + gap))));
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

    const levelLabel = card.frameType === 'link' ? 'Lnk' : (card.frameType.startsWith('xyz') ? 'Rk' : 'Lv');
    const lvText = getTargetRulesLevel(card) != null ? `${levelLabel}.${getTargetRulesLevel(card)}` : '';
    const attrText = translateAttribute(card.attribute) || '';
    const atkText = formatStat(card.atk);
    const defText = formatStat(card.def);
    
    const entropyText = `정보: ${item.entropy.toFixed(2)} Bits`;
    const expectedText = `평균: ${item.expectedRemaining.toFixed(1)}장`;
    const minimaxText = `최악: ${item.minimax}장`;
    const oneShotText = `즉시 정답: ${(item.oneShotProb * 100).toFixed(2)}%`;
    const riskText = item.eliminationProb > 0 ? `예외 오차 위험: ${(item.eliminationProb * 100).toFixed(2)}%` : '';
    
    let detailHtml = '';
    if (activeCriteria === 'entropy') {
      detailHtml = `
        <div class="card-item-info" style="font-weight:bold; color:var(--accent-gold); margin-bottom: 0.15rem; font-size: 0.72rem;">${entropyText}</div>
        <div class="card-item-stats" style="font-size: 0.68rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.05rem;">
          <span>${expectedText}</span>
          <span>${minimaxText}</span>
        </div>`;
    } else if (activeCriteria === 'minimax') {
      detailHtml = `
        <div class="card-item-info" style="font-weight:bold; color:#f87171; margin-bottom: 0.15rem; font-size: 0.72rem;">${minimaxText}</div>
        <div class="card-item-stats" style="font-size: 0.68rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.05rem;">
          <span>${entropyText}</span>
          <span>${oneShotText}</span>
        </div>`;
    } else if (activeCriteria === 'oneShot') {
      detailHtml = `
        <div class="card-item-info" style="font-weight:bold; color:#4ade80; margin-bottom: 0.15rem; font-size: 0.72rem;">${oneShotText}</div>
        <div class="card-item-stats" style="font-size: 0.68rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.05rem;">
          <span>${entropyText}</span>
          <span>${expectedText}</span>
        </div>`;
    } else if (activeCriteria === 'twoShot') {
      detailHtml = `
        <div class="card-item-info" style="font-weight:bold; color:#4ade80; margin-bottom: 0.15rem; font-size: 0.72rem;">2회 내 ${(item.twoShotProb * 100).toFixed(2)}%</div>
        <div class="card-item-stats" style="font-size: 0.68rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.05rem;">
          <span>${oneShotText}</span>
          <span>${expectedText}</span>
        </div>`;
    } else if (activeCriteria === 'expected') {
      detailHtml = `
        <div class="card-item-info" style="font-weight:bold; color:#60a5fa; margin-bottom: 0.15rem; font-size: 0.72rem;">${expectedText}</div>
        <div class="card-item-stats" style="font-size: 0.68rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.05rem;">
          <span>${entropyText}</span>
          <span>${minimaxText}</span>
        </div>`;
    }
    
    div.innerHTML = `
      <img src="${imgUrl}" alt="${escapeHTML(card.name)}" loading="lazy" onerror="this.onerror=null;this.style.visibility='hidden'">
      <div class="card-item-title" title="${escapeHTML(card.name)}">${escapeHTML(card.name)}</div>
      ${item.equivalentChoices > 1 ? `<div class="card-item-stats">동일 판정 ${item.equivalentChoices}장 중 대표</div>` : ''}
      ${detailHtml}
      ${riskText ? `<div class="card-item-info" style="color:#fbbf24;">${riskText}</div>` : ''}
      ${['oneShot', 'twoShot'].includes(activeCriteria) ? '' : `<div class="card-item-info">${oneShotText}${item.twoShotProb === null ? '' : ` · 2회 내 ${(item.twoShotProb * 100).toFixed(2)}%`}</div>`}
      <div class="candidate-stats" style="border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 0.25rem; margin-top: 0.25rem;">
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
  calcRecBtn.textContent = '최적의 카드 계산';
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
  calcRecBtn.textContent = '계산 중…';
  try {
    solverWorker = new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' });
    solverWorker.onmessage = ({ data }) => {
      if (data.id !== calculationId) return;
      calcRecBtn.disabled = false; calcRecBtn.textContent = '최적의 카드 계산';
      if (data.error) { strategyMsg.textContent = `계산 실패: ${data.error}. 다시 시도하세요.`; return; }
      calculatedResults = hydrateSolverResult(data.result);
      recContainer.classList.remove('hidden');
      const twoTurnButton = recCriteriaGroup.querySelector('[data-criteria="twoShot"]');
      twoTurnButton.disabled = !calculatedResults.twoTurnExact;
      twoTurnButton.title = calculatedResults.twoTurnExact ? '' : `서로 구분되는 후보 유형 ${TWO_TURN_LIMIT}개 이하에서 계산합니다.`;
      updateHintStrategy(true);
      renderRecommendations();
    };
    solverWorker.onerror = () => {
      cancelCalculation();
      strategyMsg.textContent = '계산을 완료하지 못했습니다. 페이지를 새로고침하거나 다시 시도하세요.';
    };
    solverWorker.postMessage({ type: 'init', cards: allCards });
    solverWorker.postMessage({ type: 'solve', id, request: {
      candidateIds: candidates.map(card => card.id),
      guessedIds: [...new Set(hints.filter(hint => hint.type === 'guess').map(hint => hint.cardId))],
      revealedStats: [...new Set(hints.filter(hint => hint.isCorrect).map(hint => hint.stat))]
    } });
  } catch (error) { cancelCalculation(); strategyMsg.textContent = `계산을 시작하지 못했습니다: ${error.message}`; }
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
    strategyMsg.textContent = '정답입니다. 다음 문제 버튼을 누르면 남은 도전·힌트 횟수를 유지한 채 새 문제를 시작합니다.';
    return;
  }
  if (!candidates.length) messages.push('일치하는 후보가 없습니다. 최근 입력을 취소하거나 공개 값을 확인하세요.');
  else if (!currentBudget) messages.push('다른 문제에 최소 1회씩 남기면 현재 문제에 쓸 도전이 없습니다. 힌트를 사용하거나 자원 배분을 조정하세요.');
  else if (candidates.length === 1) messages.push(`후보가 1장입니다. [${escapeHTML(candidates[0].name)}] 카드로 제출하세요.`);
  else if (currentBudget === 1 && remainingHints) messages.push(`현재 문제에 배정 가능한 도전이 1회입니다. 남은 힌트 ${remainingHints}회로 후보를 먼저 줄인 뒤 즉시 정답 확률을 비교하세요.`);
  else if (currentBudget === 1) messages.push('현재 문제의 마지막 도전은 <strong>즉시 정답 확률</strong>이 가장 높은 카드를 고르세요. 후보를 좁혀도 추가로 제출할 수 없습니다.');
  else if (currentBudget <= 4 && calculatedResults?.twoTurnExact) messages.push('<strong>2회 내 성공 확률</strong>은 첫 결과별 최선의 다음 제출까지 계산해 짧은 도전 구간의 해결 가능성을 높입니다.');
  else messages.push('기대 정보량과 평균 잔여 수로 후보를 좁히고, 도전이 적어지면 성공 확률을 비교하세요.');
  if (calculatedResults) {
    const best = sortScores([...calculatedResults.snipes, ...calculatedResults.scouts], activeCriteria)[0];
    if (best) messages.push(`현재 기준의 추천: <strong>${escapeHTML(best.card.name)}</strong> · 즉시 정답 ${(best.oneShotProb * 100).toFixed(2)}%${best.twoShotProb === null ? '' : ` · 2회 내 ${(best.twoShotProb * 100).toFixed(2)}%`}`);
    if (remainingHints && calculatedResults.hint) messages.push(`무작위 힌트 1회 후 예상 후보: ${calculatedResults.hint.expectedRemaining.toFixed(1)}장 (미공개 항목이 같은 확률로 선택된다고 가정).`);
    messages.push(`후보 카드가 같은 확률로 정답이라는 가정 · 계산 ${(calculatedResults.durationMs / 1000).toFixed(2)}초`);
  }
  if (problems > 1) messages.push(`남은 ${problems}문제가 도전 ${attempts}회를 공유해 현재 문제에는 ${currentBudget}회를 균등 배정했습니다.`);
  strategyMsg.innerHTML = messages.map(message => `<p>${message}</p>`).join('');
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
      setProgress(20, '검증된 Master Duel 데이터 요청 중...');
      const manifestUrl = new URL(`${import.meta.env.BASE_URL}master_duel_manifest.json`, window.location.origin);
      manifestUrl.searchParams.set('v', Date.now());
      const manifest = await fetchCardManifest(manifestUrl.href);
      const finalCards = manifest.cards;
      setProgress(70, `${manifest.counts?.monsters ?? finalCards.length}장 데이터 검증 완료`);
      persistSession();
      setProgress(90, 'IndexedDB 캐시에 저장 중...');
      await saveCachedCards(finalCards);
      try { localStorage.setItem('md-decoder-db-updated-at', manifest.generatedAt || new Date().toISOString()); } catch { /* Optional metadata. */ }
      
      setProgress(100, '완료! 페이지를 새로고침합니다.');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
      
    } catch (err) {
      console.error(err);
      setProgress(0, `업데이트 실패: ${err.message}`);
      updateDbBtn.disabled = false;
      setTimeout(() => {
        updateProgressContainer.style.display = 'none';
      }, 3000);
    }
  });
}

if (clearDbBtn) {
  clearDbBtn.addEventListener('click', async () => {
    if (!confirm('다운로드한 최신 카드 데이터를 삭제하고 내장 데이터로 되돌리시겠습니까?')) return;
    try {
      await clearCachedCards();
      showInputMessage('데이터가 성공적으로 삭제되었습니다. 내장 데이터를 적용하기 위해 페이지를 새로고침합니다.');
      window.location.reload();
    } catch (err) {
      console.error(err);
      showInputMessage('데이터 삭제 중 오류가 발생했습니다.');
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
