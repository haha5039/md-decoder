import './style.css'
import { allCards as rawCards } from './cards_data.js'
import { isFrameMatch, isLevelMatch, getValidLevels, renderCardStatsHTML, translateAttribute, translateFrame, translateRace, getTargetRulesLevel, filterCandidatesByHints, mapFrameType } from './utils.js'

import { getCachedCards, saveCachedCards } from './db.js'

let allCards = [];

// State
let candidates = [];
let hints = []; // Array of { type: 'guess'|'direct', stat, isCorrect, value, cardName }
let selectedCard = null;
let calculatedResults = null;
let activeCriteria = 'entropy';

// DOM Elements
const searchInput = document.getElementById('cardSearch');
const searchDropdown = document.getElementById('searchDropdown');
const selectedCardContainer = document.getElementById('selectedCardContainer');
const selectedCardImg = document.getElementById('selectedCardImg');
const infoName = document.getElementById('infoName');
const infoDetails = document.getElementById('infoDetails');
const statusToggles = document.querySelectorAll('.status-toggles .btn-toggle');
const applyGuessBtn = document.getElementById('applyGuessBtn');

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
const updateProgressContainer = document.getElementById('updateProgressContainer');
const updateProgressBar = document.getElementById('updateProgressBar');
const updateProgressText = document.getElementById('updateProgressText');

async function initGameData() {
  try {
    const cached = await getCachedCards();
    if (cached && cached.length > 0) {
      allCards = cached.filter(c => c.frameType !== 'spell' && c.frameType !== 'trap');
      if (dbStatusText) dbStatusText.textContent = '현재: 사용자 업데이트 데이터 사용 중';
      console.log(`Loaded ${allCards.length} cards from IndexedDB.`);
    } else {
      allCards = rawCards.filter(c => c.frameType !== 'spell' && c.frameType !== 'trap');
      if (dbStatusText) dbStatusText.textContent = '현재: 내장 데이터 사용 중';
      console.log(`Loaded ${allCards.length} cards from static cards_data.js.`);
    }
  } catch (err) {
    console.error("Failed to load IndexedDB cache, fallback to static:", err);
    allCards = rawCards.filter(c => c.frameType !== 'spell' && c.frameType !== 'trap');
    if (dbStatusText) dbStatusText.textContent = '현재: 내장 데이터 사용 중 (오류)';
  }

  // Pre-calculate valid levels for all cards for maximum performance
  allCards.forEach(card => {
    card.validLevels = getValidLevels(card);
  });

  candidates = [...allCards];
  updateUI();
}

const frameTypeMap = {
  normal: 0,
  effect: 1,
  fusion: 2,
  synchro: 3,
  xyz: 4,
  link: 5,
  ritual: 6,
  normal_pendulum: 7,
  effect_pendulum: 8,
  fusion_pendulum: 9,
  synchro_pendulum: 10,
  xyz_pendulum: 11
};

function getMatchProfile(guess, target) {
  const isFrame = isFrameMatch(target, guess.frameType);
  const frameEnum = isFrame ? (frameTypeMap[target.frameType.toLowerCase()] ?? 0) : 12;
  
  const isLvl = isLevelMatch(target, guess.validLevels);
  const lvlEnum = isLvl ? (getTargetRulesLevel(target) !== null ? getTargetRulesLevel(target) : 0) : 14;
  
  const attrBit = (guess.attribute === target.attribute) ? 1 : 0;
  const raceBit = (guess.race === target.race || (guess.race === null && target.race === null)) ? 1 : 0;
  const atkBit = (guess.atk === target.atk) ? 1 : 0;
  const defBit = (guess.def === target.def) ? 1 : 0;
  
  return frameEnum | (lvlEnum << 4) | (attrBit << 8) | (raceBit << 9) | (atkBit << 10) | (defBit << 11);
}

function updateUI() {
  candidatesCount.textContent = `${candidates.length}장 / ${allCards.length}장`;
  visibleCandidatesCount.textContent = Math.min(candidates.length, 50);
  renderCandidateList(candidates.slice(0, 50), candidateList);
  
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
    const imgUrl = card.image_url || 'https://images.ygoprodeck.com/images/cards/80181649.jpg';
    div.innerHTML = `
      <img src="${imgUrl}" alt="${card.name}" loading="lazy">
      <div class="card-item-title" title="${card.name}">${card.name}</div>
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

function deleteHintItem(index) {
  const targetHint = hints[index];
  if (!targetHint) return;
  
  if (targetHint.type === 'direct') {
    const directHints = hints.filter(h => h.type === 'direct');
    if (directHints.length > 1) {
      hintsLeft.value = (parseInt(hintsLeft.value, 10) || 0) + 1;
    }
    hints.splice(index, 1);
  } else {
    const batchId = targetHint.batchId;
    hints.splice(index, 1);
    const batchExists = hints.some(h => h.batchId === batchId);
    if (!batchExists) {
      totalAttemptsLeft.value = (parseInt(totalAttemptsLeft.value, 10) || 0) + 1;
    }
  }
  applyFilters();
}

function undoLastInput() {
  if (hints.length === 0) return;
  
  const lastHint = hints[hints.length - 1];
  const lastBatchId = lastHint.batchId;
  const batchHints = hints.filter(h => h.batchId === lastBatchId);
  const batchType = lastHint.type;
  
  if (batchType === 'direct') {
    const directCountBefore = hints.filter(h => h.type === 'direct').length;
    const newDirectCount = batchHints.length;
    const paidBefore = Math.max(0, directCountBefore - 1);
    const paidAfter = Math.max(0, directCountBefore - newDirectCount - 1);
    const refund = paidBefore - paidAfter;
    
    hintsLeft.value = (parseInt(hintsLeft.value, 10) || 0) + refund;
  } else {
    totalAttemptsLeft.value = (parseInt(totalAttemptsLeft.value, 10) || 0) + 1;
  }
  
  hints = hints.filter(h => h.batchId !== lastBatchId);
  applyFilters();
}

function renderHints() {
  appliedHintsList.innerHTML = '';
  hints.forEach((hint, index) => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    
    let hintContent = '';
    if (hint.type === 'direct') {
      hintContent = `
        <span>
          <span class="stat-name">[확실한 힌트]</span> 
          ${getStatNameKR(hint.stat)}: <span class="stat-val">${getTranslatedValue(hint.stat, hint.value)}</span>
        </span>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="stat-res res-correct">적용됨</span>
        </div>
      `;
    } else {
      const resClass = hint.isCorrect ? 'res-correct' : 'res-wrong';
      const resText = hint.isCorrect ? 'O' : 'X';
      hintContent = `
        <span>
          <span class="stat-name">[${hint.cardName}]</span> 
          ${getStatNameKR(hint.stat)}: <span class="stat-val">${getTranslatedValue(hint.stat, hint.value)}</span>
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
  const mapping = [
    { stat: 'frameType', el: directFrame },
    { stat: 'attribute', el: directAttribute },
    { stat: 'level', el: directLevel },
    { stat: 'race', el: directRace },
    { stat: 'atk', el: directAtk },
    { stat: 'def', el: directDef }
  ];
  
  let added = false;
  const isDefNone = directDefNone ? directDefNone.checked : false;
  
  const directCountBefore = hints.filter(h => h.type === 'direct').length;
  let newDirectCount = 0;
  const batchId = 'direct_' + Date.now();
  
  mapping.forEach(m => {
    if (m.stat === 'def' && isDefNone) {
      const exists = hints.some(h => h.type === 'direct' && h.stat === 'def');
      if (!exists) {
        hints.push({
          type: 'direct',
          stat: 'def',
          isCorrect: true,
          value: null,
          batchId: batchId
        });
        added = true;
        newDirectCount++;
      }
      m.el.value = "";
      directDefNone.checked = false;
      m.el.disabled = false;
      return;
    }
    
    const val = m.el.value.trim();
    if (val !== "") {
      const exists = hints.some(h => h.type === 'direct' && h.stat === m.stat);
      if (!exists) {
        hints.push({
          type: 'direct',
          stat: m.stat,
          isCorrect: true,
          value: m.stat === 'level' || m.stat === 'atk' || m.stat === 'def' ? parseInt(val, 10) : val,
          batchId: batchId
        });
        added = true;
        newDirectCount++;
      }
      m.el.value = "";
    }
  });
  
  if (added) {
    const paidInBatch = Math.max(0, newDirectCount - (directCountBefore === 0 ? 1 : 0));
    if (paidInBatch > 0) {
      hintsLeft.value = (parseInt(hintsLeft.value, 10) || 0) - paidInBatch;
    }
    
    applyFilters();
    
    const target = document.querySelector('.results-panel');
    if (target) {
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    }
  }
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
      
      const imgUrl = card.image_url ? card.image_url.replace('.jpg', '_small.jpg') : '';
      const statsHTML = renderCardStatsHTML(card);
      
      div.innerHTML = `
        <img src="${imgUrl}" alt="${card.name}" onerror="this.src='${card.image_url || ''}'">
        <div class="search-dropdown-info">
          <div class="search-dropdown-title">${card.name}</div>
          <div class="search-dropdown-subtitle">${card.nameEn || ''}</div>
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
  selectedCard = card;
  selectedCardContainer.classList.remove('hidden');
  selectedCardImg.src = card.image_url || '';
  infoName.textContent = card.name;
  
  const levelText = card.level !== null ? `Lv/Rk/Lk: ${card.level}` : '';
  const atkDefText = (card.atk !== null ? `ATK: ${card.atk}` : '') + (card.def !== null ? ` / DEF: ${card.def}` : '');
  
  const frameText = translateFrame(card.frameType) || '';
  const attrText = translateAttribute(card.attribute) || '';
  const raceText = translateRace(card.race) || '';
  
  infoDetails.innerHTML = `${frameText} | ${attrText} | ${raceText}<br>${levelText}<br>${atkDefText}`;
  
  statusToggles.forEach(btn => {
    btn.classList.remove('active');
    btn.dataset.selected = "false";
  });

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
  });
});

applyGuessBtn.addEventListener('click', () => {
  if (!selectedCard) return;
  
  const newHints = [];
  const rows = document.querySelectorAll('.status-row');
  const batchId = 'guess_' + Date.now();
  
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
        batchId: batchId
      });
    }
  });
  
  if (newHints.length === 0) {
    alert("최소 1개 이상의 판정 결과를 선택해주세요.");
    return;
  }
  
  totalAttemptsLeft.value = (parseInt(totalAttemptsLeft.value, 10) || 0) - 1;
  
  hints = [...hints, ...newHints];
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
  candidates = filterCandidatesByHints(allCards, hints);
  
  calculatedResults = null;
  updateUI();
  recContainer.classList.add('hidden');
  snipeList.innerHTML = '';
  scoutList.innerHTML = '';
  strategyMsg.innerHTML = `<span class="badge" style="background:var(--accent-blue)">최적의 카드를 계산해주세요</span>`;
}

resetBtn.addEventListener('click', () => {
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
  
  // Reset numeric settings (0. 남은 횟수 설정)
  if (hintsLeft) hintsLeft.value = "1";
  if (totalAttemptsLeft) totalAttemptsLeft.value = "3";
  if (problemsLeft) problemsLeft.value = "1";
  
  updateUI();
  strategyMsg.innerHTML = `<span class="badge" style="background:var(--accent-blue)">최적의 카드를 계산해주세요</span>`;
});

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
  entropy: `<strong>기대 정보량 (Entropy):</strong> 전체 후보군을 가장 고르게 여러 판정 그룹으로 나누는 표준 알고리즘입니다. 평균적인 탐색 속도가 가장 빠르며 무난하게 좋은 카드들을 골라줍니다.`,
  minimax: `<strong>최악 상황 최소화 (Minimax):</strong> 만약 운이 없더라도, 남는 후보의 최대 개수를 가장 작게 억제하는 극도의 안정적 정찰 기법입니다. 소거법으로 실패 확률을 원천 봉쇄할 때 적합합니다.`,
  oneShot: `<strong>단판 확정 확률 (One-shot):</strong> 다음 1회 도전 결과로 남는 후보를 정확히 1장 이하로 압축해 내거나 정답을 바로 찾을 확률을 극대화합니다. 기회가 얼마 없어 확률에 도박을 걸어야 할 때 최고의 픽입니다.`,
  expected: `<strong>평균 잔여 최소 (Average):</strong> 섀넌 엔트로피와 유사하지만, 다음 도전 결과 이후에 최종적으로 남게 될 카드 수의 '수학적 기댓값' 자체를 직접적으로 최소화하는 직관적인 탐색 방식입니다.`
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

function sortRecommendations(list, criteria) {
  if (criteria === 'entropy') {
    return [...list].sort((a, b) => b.entropy - a.entropy);
  } else if (criteria === 'minimax') {
    return [...list].sort((a, b) => {
      if (a.minimax !== b.minimax) return a.minimax - b.minimax;
      return b.entropy - a.entropy; // Tie break with entropy
    });
  } else if (criteria === 'oneShot') {
    return [...list].sort((a, b) => {
      if (b.oneShotProb !== a.oneShotProb) return b.oneShotProb - a.oneShotProb;
      return b.entropy - a.entropy; // Tie break with entropy
    });
  } else if (criteria === 'expected') {
    return [...list].sort((a, b) => {
      if (a.expectedRemaining !== b.expectedRemaining) return a.expectedRemaining - b.expectedRemaining;
      return b.entropy - a.entropy; // Tie break with entropy
    });
  }
  return list;
}

function renderRecommendationList(list, container) {
  container.innerHTML = '';
  list.forEach(item => {
    const card = item.card;
    const div = document.createElement('div');
    div.className = 'card-item animate-fade-in';
    const imgUrl = card.image_url || 'https://images.ygoprodeck.com/images/cards/80181649.jpg';
    
    const entropyText = `정보량: ${item.entropy.toFixed(2)} Bits`;
    const expectedText = `평균 잔여: ${item.expectedRemaining.toFixed(1)}장`;
    const minimaxText = `최악의 경우: ${item.minimax}장`;
    const oneShotText = `단판 종결: ${(item.oneShotProb * 100).toFixed(1)}%`;
    
    let detailHtml = '';
    if (activeCriteria === 'entropy') {
      detailHtml = `<div class="card-item-info" style="font-weight:bold; color:var(--accent-gold);">${entropyText}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">${expectedText} | ${minimaxText}</div>`;
    } else if (activeCriteria === 'minimax') {
      detailHtml = `<div class="card-item-info" style="font-weight:bold; color:#f87171;">${minimaxText}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">${entropyText} | ${oneShotText}</div>`;
    } else if (activeCriteria === 'oneShot') {
      detailHtml = `<div class="card-item-info" style="font-weight:bold; color:#4ade80;">${oneShotText}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">${entropyText} | ${expectedText}</div>`;
    } else if (activeCriteria === 'expected') {
      detailHtml = `<div class="card-item-info" style="font-weight:bold; color:#60a5fa;">${expectedText}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">${entropyText} | ${minimaxText}</div>`;
    }
    
    div.innerHTML = `
      <img src="${imgUrl}" alt="${card.name}" loading="lazy">
      <div class="card-item-title" title="${card.name}">${card.name}</div>
      ${detailHtml}
    `;
    div.onclick = () => selectCard(card);
    container.appendChild(div);
  });
}

function renderRecommendations() {
  if (!calculatedResults) return;
  
  const sortedSnipes = sortRecommendations(calculatedResults.snipes, activeCriteria).slice(0, 5);
  const sortedScouts = sortRecommendations(calculatedResults.scouts, activeCriteria).slice(0, 5);
  
  renderRecommendationList(sortedSnipes, snipeList);
  renderRecommendationList(sortedScouts, scoutList);
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
calcRecBtn.addEventListener('click', () => {
  if (candidates.length <= 1) {
    if (candidates.length === 1) {
      updateHintStrategy(false);
    } else {
      alert("조건에 맞는 카드가 없습니다.");
    }
    return;
  }
  
  calcRecBtn.textContent = "계산 중...";
  calcRecBtn.disabled = true;
  
  setTimeout(() => {
    calculatedResults = calculateBestGuesses();
    
    recContainer.classList.remove('hidden');
    renderRecommendations();
    
    calcRecBtn.textContent = "최적의 카드 계산";
    calcRecBtn.disabled = false;
    
    updateHintStrategy(true);
  }, 50);
});

function calculateBestGuesses() {
  const snipes = [];
  const scouts = [];
  const total = candidates.length;
  
  if (total === 0) return { snipes, scouts };

  const guessedCardNames = new Set(hints.map(h => h.cardName).filter(Boolean));

  // Optimization: If there are too many candidates, uniformly sample them 
  // to calculate entropy extremely fast while maintaining statistical accuracy.
  let targetPool = candidates;
  if (total > 800) {
    const step = Math.floor(total / 800) || 1;
    targetPool = candidates.filter((_, i) => i % step === 0).slice(0, 800);
  }
  const sampleSize = targetPool.length;
  const ratio = total / sampleSize;
  const ratioForSquares = total / (sampleSize * sampleSize);
  
  const buckets = new Int32Array(4096);
  
  // We scan ALL 13600+ cards to find the best scouts, regardless of candidate count
  for (let i = 0; i < allCards.length; i++) {
    const guess = allCards[i];
    if (guessedCardNames.has(guess.name)) continue;
    
    buckets.fill(0);
    
    // Evaluate against the sample pool
    for (let j = 0; j < sampleSize; j++) {
      const target = targetPool[j];
      const profile = getMatchProfile(guess, target);
      buckets[profile]++;
    }
    
    let sumOfSquares = 0;
    let entropy = 0;
    let maxBucket = 0;
    let sizeOneBuckets = 0;
    
    const winProfile = (frameTypeMap[guess.frameType.toLowerCase()] ?? 0) | ((getTargetRulesLevel(guess) !== null ? getTargetRulesLevel(guess) : 0) << 4) | (15 << 8);
    
    for (let k = 0; k < 4096; k++) {
      const count = buckets[k];
      if (count > 0) {
        if (k !== winProfile) {
          sumOfSquares += count * count;
          if (count > maxBucket) {
            maxBucket = count;
          }
        }
        
        const p = count / sampleSize;
        entropy -= p * Math.log2(p);
        
        if (k === winProfile) {
          sizeOneBuckets += count;
        } else if (count === 1) {
          sizeOneBuckets++;
        }
      }
    }
    
    // Extrapolate the expected values to the true population size
    const expectedRemaining = sumOfSquares * ratioForSquares;
    const minimax = Math.round(maxBucket * ratio);
    // oneShotProb is only accurate/useful when candidates are very few (no sampling).
    const oneShotProb = sampleSize === total ? (sizeOneBuckets / total) : 0;
    
    const scoreObj = { 
      card: guess, 
      entropy, 
      expectedRemaining, 
      minimax, 
      oneShotProb 
    };
    
    const isCandidate = candidates.includes(guess);
    if (isCandidate) {
      snipes.push(scoreObj);
    } else {
      scouts.push(scoreObj);
    }
  }
  
  return { snipes, scouts };
}

let isUpdatingStrategy = false;
function updateHintStrategy(shouldAutoSelect = false) {
  if (isUpdatingStrategy) return;
  isUpdatingStrategy = true;

  const attempts = parseInt(totalAttemptsLeft.value, 10) || 0;
  const problems = parseInt(problemsLeft.value, 10) || 1;
  const hLeft = parseInt(hintsLeft.value, 10) || 0;
  const attemptsPerProblem = attempts / problems;
  const total = candidates.length;
  
  if (total === 1) {
    strategyMsg.innerHTML = `
      <div style="background: rgba(34,197,94,0.15); border: 1px solid #22c55e; padding: 0.75rem; border-radius: 8px; margin-bottom: 0.5rem;">
        <span class="badge" style="background:#22c55e; margin-bottom: 0.5rem; display: inline-block;">🎯 정답 확정</span>
        <p style="font-size: 0.85rem; color: #4ade80;">후보가 1개만 남았습니다! 즉시 인게임에서 <strong>[${candidates[0].name}]</strong> 카드로 도전하세요.</p>
      </div>
    `;
    
    // Clear styles when single candidate
    const snipeHeader = document.getElementById('snipeHeader');
    const scoutHeader = document.getElementById('scoutHeader');
    if (snipeHeader && scoutHeader) {
      snipeHeader.style.textShadow = 'none';
      snipeHeader.style.transform = 'none';
      snipeHeader.innerHTML = `🎯 정답 스나이핑 (후보 중 최적)`;
      scoutHeader.style.textShadow = 'none';
      scoutHeader.style.transform = 'none';
      scoutHeader.innerHTML = `🕵️ 극한의 정찰 픽 (오답 확실)`;
    }
    
    isUpdatingStrategy = false;
    return;
  }
  
  let badgeHtml = '';
  let adviceHtml = '';
  let recommendedLogic = 'entropy';
  
  if (attemptsPerProblem < 1.1) {
    if (attempts <= 0) {
      badgeHtml = `<span class="badge" style="background:#ef4444; margin-bottom: 0.5rem; display: inline-block;">⚠️ 도전 기회 소진</span>`;
      adviceHtml = `남은 도전 기회가 없습니다. 하지만 정답 카드를 계속 찾기 위해, 남은 힌트(${hLeft}개)를 활용하거나 아래 추천을 통해 효율적인 카드 탐색을 해보실 수 있습니다.`;
      recommendedLogic = hLeft > 0 ? 'expected' : 'oneShot';
    } else if (hLeft > 0) {
      badgeHtml = `<span class="badge" style="background:#f59e0b; color:#000; margin-bottom: 0.5rem; display: inline-block;">⚠️ 힌트 사용 필수</span>`;
      adviceHtml = `문제당 평균 도전 기회가 1회 이하입니다. 빗나갈 시 즉시 실패하므로, 남은 힌트(${hLeft}개)를 우선적으로 사용하여 후보를 확실하게 좁히는 것이 안전합니다.`;
    } else {
      badgeHtml = `<span class="badge" style="background:#ef4444; margin-bottom: 0.5rem; display: inline-block;">🚨 극단적 저격 상황</span>`;
      adviceHtml = `남은 힌트가 없습니다! 이번에 무조건 맞춰야 합니다. 후보군 중에서 <strong>[단판 확정 확률]</strong>이 가장 높은 카드로 스나이핑을 시도해야 생존율이 가장 높습니다.`;
      recommendedLogic = 'oneShot';
    }
  } else if (attemptsPerProblem < 1.8) {
    if (hLeft > 0 && total > 5) {
      badgeHtml = `<span class="badge" style="background:#f59e0b; color:#000; margin-bottom: 0.5rem; display: inline-block;">⚠️ 힌트 사용 권장</span>`;
      adviceHtml = `도전 기회가 다소 촉박합니다. 후보가 ${total}장 남아 한 번에 맞추기 어렵다면 확실한 힌트를 하나 더 개방하는 것이 좋습니다.`;
    } else {
      badgeHtml = `<span class="badge" style="background:#3b82f6; margin-bottom: 0.5rem; display: inline-block;">🟢 정답 스나이핑 권장</span>`;
      adviceHtml = `후보가 많지 않습니다. 후보 내에서 최고의 분별력을 가진 카드로 정답 도전을 해보세요. <strong>[최악 상황 최소화(Minimax)]</strong> 또는 <strong>[평균 잔여 최소]</strong>를 사용하면 틀려도 다음 턴에 정답을 쉽게 좁힐 수 있습니다.`;
      recommendedLogic = 'minimax';
    }
  } else {
    badgeHtml = `<span class="badge" style="background:#3b82f6; margin-bottom: 0.5rem; display: inline-block;">🕵️ 정찰 및 탐색 기회 충분</span>`;
    if (total > 15) {
      adviceHtml = `남은 도전 기회가 넉넉합니다(${attempts}회). 전체 카드 데이터베이스에서 <strong>[기대 정보량(Entropy)]</strong>이 가장 큰 <strong>'극한의 정찰 픽'</strong>을 하나 제출하면, 남은 후보(${total}장)를 가장 빠르고 균등하게 폭파하듯 제거할 수 있습니다.`;
      recommendedLogic = 'entropy';
    } else {
      adviceHtml = `후보군이 ${total}장으로 좁혀졌으며 도전 기회가 충분합니다. <strong>[평균 잔여 최소]</strong> 기준으로 후보 중 가장 안전한 카드를 스나이핑하여 정답과 정찰을 동시에 노리는 하이브리드 플레이가 좋습니다.`;
      recommendedLogic = 'expected';
    }
  }
  
  const criteriaNames = {
    entropy: '기대 정보량 (Entropy)',
    minimax: '최악 상황 최소화 (Minimax)',
    oneShot: '단판 확정 확률 (One-shot)',
    expected: '평균 잔여 최소 (Average)'
  };
  
  strategyMsg.innerHTML = `
    <div style="background: rgba(255,255,255,0.05); border: 1px solid var(--panel-border); padding: 0.75rem; border-radius: 8px; font-size: 0.85rem; line-height: 1.4;">
      ${badgeHtml}
      <p style="margin-bottom: 0.5rem; color: var(--text-main);">${adviceHtml}</p>
      <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 0.8rem; color: var(--accent-gold);">
        💡 추천 검색 기준: <strong>${criteriaNames[recommendedLogic]}</strong> (클릭하여 기준 변경 가능)
      </div>
    </div>
  `;

  // Visual cues highlighting the recommended list
  const snipeHeader = document.getElementById('snipeHeader');
  const scoutHeader = document.getElementById('scoutHeader');
  if (snipeHeader && scoutHeader) {
    if (recommendedLogic === 'entropy') {
      scoutHeader.style.textShadow = '0 0 10px rgba(168, 85, 247, 0.8)';
      scoutHeader.style.transform = 'scale(1.02)';
      scoutHeader.style.transition = 'all 0.3s ease';
      scoutHeader.innerHTML = `🕵️ 극한의 정찰 픽 (오답 확실) <span class="badge" style="background:#a855f7; font-size:0.7rem; padding:0.15rem 0.4rem; vertical-align:middle; margin-left:0.5rem;">추천 행동</span>`;
      
      snipeHeader.style.textShadow = 'none';
      snipeHeader.style.transform = 'none';
      snipeHeader.innerHTML = `🎯 정답 스나이핑 (후보 중 최적)`;
    } else {
      snipeHeader.style.textShadow = '0 0 10px rgba(251, 191, 36, 0.8)';
      snipeHeader.style.transform = 'scale(1.02)';
      snipeHeader.style.transition = 'all 0.3s ease';
      snipeHeader.innerHTML = `🎯 정답 스나이핑 (후보 중 최적) <span class="badge" style="background:var(--accent-gold); color:#000; font-size:0.7rem; padding:0.15rem 0.4rem; vertical-align:middle; margin-left:0.5rem;">추천 행동</span>`;
      
      scoutHeader.style.textShadow = 'none';
      scoutHeader.style.transform = 'none';
      scoutHeader.innerHTML = `🕵️ 극한의 정찰 픽 (오답 확실)`;
    }
  }

  if (shouldAutoSelect === true && calculatedResults && activeCriteria !== recommendedLogic) {
    updateCriteriaUI(recommendedLogic);
  }

  isUpdatingStrategy = false;
}

// Add state input change listeners
totalAttemptsLeft.addEventListener('input', () => updateHintStrategy(false));
problemsLeft.addEventListener('input', () => updateHintStrategy(false));
hintsLeft.addEventListener('input', () => updateHintStrategy(false));

if (updateDbBtn) {
  updateDbBtn.addEventListener('click', async () => {
    updateDbBtn.disabled = true;
    updateProgressContainer.style.display = 'block';
    
    const setProgress = (percent, text) => {
      updateProgressBar.style.width = `${percent}%`;
      updateProgressText.textContent = `${percent}% - ${text}`;
    };
    
    try {
      setProgress(10, '영어 카드 데이터 요청 중...');
      const enRes = await fetch('https://db.ygoprodeck.com/api/v7/cardinfo.php?format=Master%20Duel').then(r => r.json());
      
      setProgress(40, '한국어 카드 데이터 요청 중...');
      const koRes = await fetch('https://db.ygoprodeck.com/api/v7/cardinfo.php?format=Master%20Duel&language=ko').then(r => r.json());
      
      setProgress(70, '데이터 병합 및 매핑 중...');
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
        
        // Map frame type correctly (handles pendulum compound types)
        let frameType = mapFrameType(en.type, en.frameType);
        
        finalCards.push({
          id: en.id,
          name: koName,
          nameEn: en.name,
          frameType: frameType,
          attribute: en.attribute || null,
          level: en.level || en.rank || en.linkval || null,
          race: en.race,
          type: en.type,
          atk: en.atk !== undefined ? en.atk : null,
          def: en.def !== undefined ? en.def : null,
          image_url: en.card_images && en.card_images[0] ? en.card_images[0].image_url_cropped : null
        });
      }
      
      setProgress(90, 'IndexedDB 캐시에 저장 중...');
      await saveCachedCards(finalCards);
      
      setProgress(100, '완료! 페이지를 새로고침합니다.');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
      
    } catch (err) {
      console.error(err);
      setProgress(0, '오류 발생: 데이터 로드 실패');
      updateDbBtn.disabled = false;
      setTimeout(() => {
        updateProgressContainer.style.display = 'none';
      }, 3000);
    }
  });
}

// Init
initGameData();
