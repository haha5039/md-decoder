import './style.css';
import { allCards as rawCards } from './cards_data.js';
import { isFrameMatch, isLevelMatch, getValidLevels, renderCardStatsHTML, translateAttribute, translateFrame, translateRace, getTargetRulesLevel } from './utils.js';
import { getCachedCards } from './db.js';

let allCards = [];


// DOM Elements
const startGameBtn = document.getElementById('startGameBtn');
const getHintBtn = document.getElementById('getHintBtn');
const attemptCountEl = document.getElementById('attemptCount');
const hintUseCountEl = document.getElementById('hintUseCount');
const gameArea = document.getElementById('gameArea');
const guessInput = document.getElementById('guessInput');
const guessDropdown = document.getElementById('guessDropdown');
const historyTbody = document.getElementById('historyTbody');

const confirmModal = document.getElementById('confirmModal');
const confirmMsg = document.getElementById('confirmMsg');
const confirmImg = document.getElementById('confirmImg');
const cancelConfirmBtn = document.getElementById('cancelConfirmBtn');
const okConfirmBtn = document.getElementById('okConfirmBtn');

const victoryModal = document.getElementById('victoryModal');
const victoryMsg = document.getElementById('victoryMsg');
const closeVictoryBtn = document.getElementById('closeVictoryBtn');
const restartGameBtn = document.getElementById('restartGameBtn');
const undoGuessBtn = document.getElementById('undoGuessBtn');

const candidateGrid = document.getElementById('candidateGrid');
const candidateCount = document.getElementById('candidateCount');

const hintEls = {
  frameType: document.getElementById('hint-frameType'),
  level: document.getElementById('hint-level'),
  attribute: document.getElementById('hint-attribute'),
  race: document.getElementById('hint-race'),
  atk: document.getElementById('hint-atk'),
  def: document.getElementById('hint-def')
};

// State
let targetCard = null;
let attempts = 0;
let hintUseCount = 0;
let pendingGuessCard = null;
let history = [];
let revealedHints = {
  frameType: false,
  level: false,
  attribute: false,
  race: false,
  atk: false,
  def: false
};
let systemRevealedKeys = [];

let candidates = [];

const statKeys = ['frameType', 'level', 'attribute', 'race', 'atk', 'def'];

// Initialize game
function initGame() {
  // Randomly select a card
  const randomIndex = Math.floor(Math.random() * allCards.length);
  targetCard = allCards[randomIndex];
  
  // Reset state
  attempts = 0;
  hintUseCount = 0;
  pendingGuessCard = null;
  history = [];
  statKeys.forEach(k => revealedHints[k] = false);
  systemRevealedKeys = [];
  candidates = [...allCards];
  
  // UI Reset
  attemptCountEl.textContent = '0';
  hintUseCountEl.textContent = '0';
  historyTbody.innerHTML = '';
  guessInput.value = '';
  updateHintUI();
  
  // Reveal exactly 1 random hint at the start
  revealRandomHint(true);
  
  // Update Candidates
  updateCandidates();
  
  // Update UI Layout
  startGameBtn.textContent = '게임 재시작 (다른 카드 뽑기)';
  gameArea.style.display = 'grid';
  victoryModal.style.display = 'none';
  confirmModal.style.display = 'none';
  
  console.log('Target Card (Cheat):', targetCard.name);
}

function selectCardForGuess(card) {
  pendingGuessCard = card;
  confirmMsg.innerHTML = `<strong>[${card.name}]</strong> 카드로 판정(도전)하시겠습니까?`;
  confirmImg.src = card.image_url || '';
  confirmModal.style.display = 'flex';
}

cancelConfirmBtn.addEventListener('click', () => {
  confirmModal.style.display = 'none';
  pendingGuessCard = null;
});

okConfirmBtn.addEventListener('click', () => {
  confirmModal.style.display = 'none';
  if (pendingGuessCard) {
    submitGuess(pendingGuessCard);
  }
  pendingGuessCard = null;
});

function revealRandomHint(isInitial = false) {
  const unrevealed = statKeys.filter(k => !revealedHints[k]);
  if (unrevealed.length === 0) return;
  
  const randomKey = unrevealed[Math.floor(Math.random() * unrevealed.length)];
  revealedHints[randomKey] = true;
  systemRevealedKeys.push(randomKey);
  
  // Push virtual hint row to history
  const hintRow = {
    isHint: true,
    hintType: isInitial ? '최초 힌트' : '무작위 힌트',
    key: randomKey,
    card: {
      name: isInitial ? '💡 최초 힌트 제공' : '💡 무작위 힌트 개방'
    }
  };
  history.unshift(hintRow);
  
  updateHintUI();
  updateCandidates();
  renderHistory();
}

getHintBtn.addEventListener('click', () => {
  const unrevealed = statKeys.filter(k => !revealedHints[k]);
  if (unrevealed.length > 0) {
    hintUseCount++;
    hintUseCountEl.textContent = hintUseCount;
    revealRandomHint(false);
  }
});

function getStatDisplay(val) {
  return val === null || val === undefined ? '-' : val;
}

function updateHintUI() {
  statKeys.forEach(key => {
    if (revealedHints[key]) {
      let val = (key === 'level') ? getTargetRulesLevel(targetCard) : targetCard[key];
      if (key === 'frameType') val = translateFrame(val);
      else if (key === 'attribute') val = translateAttribute(val);
      else if (key === 'race') val = translateRace(val);
      
      hintEls[key].textContent = getStatDisplay(val);
      hintEls[key].style.color = '#2ecc71';
    } else {
      hintEls[key].textContent = '???';
      hintEls[key].style.color = 'var(--accent-gold)';
    }
  });
  
  const unrevealed = statKeys.filter(k => !revealedHints[k]);
  getHintBtn.disabled = unrevealed.length === 0;
  if (unrevealed.length === 0) {
    getHintBtn.textContent = '모든 힌트 공개됨';
    getHintBtn.style.opacity = '0.5';
  } else {
    getHintBtn.textContent = '💡 무작위 힌트 받기';
    getHintBtn.style.opacity = '1';
  }
}

// Autocomplete logic
guessInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  guessDropdown.innerHTML = '';
  
  if (query.length < 1) {
    guessDropdown.style.display = 'none';
    return;
  }

  const matches = allCards.filter(card => 
    card.name.toLowerCase().includes(query) || 
    (card.nameEn && card.nameEn.toLowerCase().includes(query))
  ).slice(0, 50);

  if (matches.length > 0) {
    guessDropdown.style.display = 'block';
    matches.forEach(card => {
      const li = document.createElement('li');
      li.className = 'search-dropdown-item';
      
      const imgUrl = card.image_url ? card.image_url.replace('.jpg', '_small.jpg') : '';
      const statsHTML = renderCardStatsHTML(card);
      
      li.innerHTML = `
        <img src="${imgUrl}" alt="${card.name}" onerror="this.src='${card.image_url || ''}'">
        <div class="search-dropdown-info">
          <div class="search-dropdown-title">${card.name}</div>
          <div class="search-dropdown-subtitle">${card.nameEn || ''}</div>
          ${statsHTML}
        </div>
      `;
      li.addEventListener('click', () => {
        guessInput.value = '';
        guessDropdown.style.display = 'none';
        selectCardForGuess(card);
      });
      guessDropdown.appendChild(li);
    });
  } else {
    guessDropdown.style.display = 'none';
  }
});

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  if (!guessInput.contains(e.target) && !guessDropdown.contains(e.target)) {
    guessDropdown.style.display = 'none';
  }
});

function submitGuess(guessCard) {
  if (!targetCard) return;
  
  attempts++;
  attemptCountEl.textContent = attempts;
  
  // Compare stats (The result is how the guess compares to the target)
  const result = {
    card: guessCard,
    frame: isFrameMatch(targetCard, guessCard.frameType),
    attribute: guessCard.attribute === targetCard.attribute,
    level: isLevelMatch(targetCard, guessCard.validLevels),
    race: guessCard.race === targetCard.race || (guessCard.race === null && targetCard.race === null),
    atk: guessCard.atk === targetCard.atk,
    def: guessCard.def === targetCard.def,
    systemHints: [...systemRevealedKeys] // Capture system revealed hints at this moment
  };
  
  // Auto-reveal matching stats
  if (result.frame) revealedHints.frameType = true;
  if (result.attribute) revealedHints.attribute = true;
  if (result.level) revealedHints.level = true;
  if (result.race) revealedHints.race = true;
  if (result.atk) revealedHints.atk = true;
  if (result.def) revealedHints.def = true;
  
  history.unshift(result); // Add to top of history
  updateHintUI(); // Refresh revealed information boxes on top
  renderHistory();
  updateCandidates();
  
  // Check win condition (all 6 stats match)
  const isWin = result.frame && result.attribute && result.level && result.race && result.atk && result.def;
  
  if (isWin) {
    showVictory(guessCard);
  }

  // Scroll to guess history in the background so it's visible when the modal closes
  const target = document.getElementById('historySection');
  if (target) {
    setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }
}

function updateCandidates() {
  candidates = allCards.filter(card => {
    // 1. Check against revealed hints (must match target exactly since properties are revealed)
    if (revealedHints.frameType && card.frameType !== targetCard.frameType) return false;
    if (revealedHints.level && getTargetRulesLevel(card) !== getTargetRulesLevel(targetCard)) return false;
    if (revealedHints.attribute && card.attribute !== targetCard.attribute) return false;
    if (revealedHints.race && card.race !== targetCard.race) return false;
    if (revealedHints.atk && card.atk !== targetCard.atk) return false;
    if (revealedHints.def && card.def !== targetCard.def) return false;
    
    // 2. Check against guess history (decoder logic)
    for (let i = 0; i < history.length; i++) {
      const g = history[i];
      if (g.isHint) continue;
      // A candidate must yield the EXACT same O/X result against the guessed card as the target card did
      if (isFrameMatch(card, g.card.frameType) !== g.frame) return false;
      if ((card.attribute === g.card.attribute) !== g.attribute) return false;
      if (isLevelMatch(card, g.card.validLevels) !== g.level) return false;
      
      const raceMatch = card.race === g.card.race || (card.race === null && g.card.race === null);
      if (raceMatch !== g.race) return false;
      
      if ((card.atk === g.card.atk) !== g.atk) return false;
      if ((card.def === g.card.def) !== g.def) return false;
    }
    
    return true;
  });
  
  renderCandidates();
}

function renderCandidates() {
  candidateCount.textContent = `${candidates.length}장`;
  candidateGrid.innerHTML = '';
  
  // Limit to 50 for performance
  const displayList = candidates.slice(0, 50);
  
  displayList.forEach(card => {
    const cardEl = document.createElement('div');
    cardEl.className = 'candidate-card';
    
    const imgUrl = card.image_url ? card.image_url.replace('.jpg', '_small.jpg') : '';
    
    cardEl.innerHTML = `
      <img src="${imgUrl}" alt="${card.name}" loading="lazy" onerror="this.src='${card.image_url}'">
      <div class="candidate-name">${card.name}</div>
      <div class="candidate-stats">
        <div><span>카드 프레임:</span> <span>${getStatDisplay(translateFrame(card.frameType))}</span></div>
        <div><span>속성:</span> <span>${getStatDisplay(translateAttribute(card.attribute))}</span></div>
        <div><span>레벨 / 랭크 / 링크:</span> <span>${getStatDisplay(card.level)}</span></div>
        <div><span>종족:</span> <span>${getStatDisplay(translateRace(card.race))}</span></div>
        <div><span>공격력:</span> <span>${getStatDisplay(card.atk)}</span></div>
        <div><span>수비력:</span> <span>${getStatDisplay(card.def)}</span></div>
      </div>
    `;
    
    cardEl.addEventListener('click', () => {
      selectCardForGuess(card);
    });
    
    candidateGrid.appendChild(cardEl);
  });
}

function getHintText(key, card) {
  let val = card[key];
  if (key === 'frameType') {
    return `카드 프레임: ${translateFrame(val)}`;
  } else if (key === 'attribute') {
    return `속성: ${translateAttribute(val)}`;
  } else if (key === 'level') {
    return `레벨/랭크/링크: ${val}`;
  } else if (key === 'race') {
    return `종족: ${translateRace(val)}`;
  } else if (key === 'atk') {
    return `공격력: ${val === null || val === undefined ? '-' : val}`;
  } else if (key === 'def') {
    return `수비력: ${val === null || val === undefined ? '-' : val}`;
  }
  return '';
}

function getEquivalentCards(target) {
  return allCards.filter(card => 
    card.id !== target.id && // exclude the target itself
    isFrameMatch(target, card.frameType) &&
    isLevelMatch(target, card.validLevels) &&
    card.attribute === target.attribute &&
    (card.race === target.race || (card.race === null && target.race === null)) &&
    card.atk === target.atk &&
    card.def === target.def
  );
}

function rebuildGameStateFromHistory() {
  attempts = 0;
  hintUseCount = 0;
  statKeys.forEach(k => revealedHints[k] = false);
  systemRevealedKeys = [];
  
  // Rebuild in chronological order: oldest to newest
  // history is [latest, ..., oldest]
  for (let i = history.length - 1; i >= 0; i--) {
    const row = history[i];
    if (row.isHint) {
      revealedHints[row.key] = true;
      systemRevealedKeys.push(row.key);
      if (row.hintType === '무작위 힌트') {
        hintUseCount++;
      }
    } else {
      attempts++;
      
      const frameMatch = isFrameMatch(targetCard, row.card.frameType);
      const attributeMatch = row.card.attribute === targetCard.attribute;
      const levelMatch = isLevelMatch(targetCard, row.card.validLevels);
      const raceMatch = row.card.race === targetCard.race || (row.card.race === null && targetCard.race === null);
      const atkMatch = row.card.atk === targetCard.atk;
      const defMatch = row.card.def === targetCard.def;
      
      if (frameMatch) revealedHints.frameType = true;
      if (attributeMatch) revealedHints.attribute = true;
      if (levelMatch) revealedHints.level = true;
      if (raceMatch) revealedHints.race = true;
      if (atkMatch) revealedHints.atk = true;
      if (defMatch) revealedHints.def = true;
    }
  }
  
  attemptCountEl.textContent = attempts;
  hintUseCountEl.textContent = hintUseCount;
  
  updateHintUI();
  updateCandidates();
  renderHistory();
}

function renderHistory() {
  historyTbody.innerHTML = '';
  
  history.forEach(row => {
    const tr = document.createElement('tr');
    
    // Image cell
    const imgTd = document.createElement('td');
    imgTd.style.padding = '0.5rem';
    imgTd.style.borderBottom = '1px solid var(--accent-blue)';
    imgTd.style.textAlign = 'center';
    
    if (row.isHint) {
      imgTd.innerHTML = `<span style="font-size: 1.2rem;">💡</span>`;
    } else {
      const imgUrl = row.card.image_url ? row.card.image_url.replace('.jpg', '_small.jpg') : '';
      imgTd.innerHTML = `<img src="${imgUrl}" alt="card" style="width: 40px; border-radius: 3px;" loading="lazy" onerror="this.src='${row.card.image_url}'">`;
    }
    tr.appendChild(imgTd);
    
    // Name cell
    const nameTd = document.createElement('td');
    nameTd.textContent = row.card.name;
    nameTd.style.padding = '0.75rem';
    nameTd.style.borderBottom = '1px solid var(--accent-blue)';
    if (row.isHint) {
      nameTd.style.fontWeight = 'bold';
      nameTd.style.color = 'var(--accent-gold)';
    }
    tr.appendChild(nameTd);
    
    // Cell helper for normal guess cells
    const makeCell = (value, isMatch) => {
      const td = document.createElement('td');
      td.textContent = getStatDisplay(value);
      td.style.padding = '0.75rem';
      td.style.borderBottom = '1px solid var(--accent-blue)';
      td.style.backgroundColor = isMatch ? 'rgba(46, 204, 113, 0.2)' : 'rgba(231, 76, 60, 0.2)';
      td.style.color = isMatch ? '#2ecc71' : '#e74c3c';
      td.style.fontWeight = 'bold';
      return td;
    };
    
    // Cell helper for hint cells
    const makeHintCell = (value, isRevealedStat) => {
      const td = document.createElement('td');
      td.textContent = isRevealedStat ? getStatDisplay(value) : '-';
      td.style.padding = '0.75rem';
      td.style.borderBottom = '1px solid var(--accent-blue)';
      if (isRevealedStat) {
        td.style.backgroundColor = 'rgba(46, 204, 113, 0.2)';
        td.style.color = '#2ecc71';
        td.style.fontWeight = 'bold';
      } else {
        td.style.color = 'var(--text-muted)';
        td.style.opacity = '0.5';
      }
      return td;
    };
    
    if (row.isHint) {
      tr.appendChild(makeHintCell(translateFrame(targetCard.frameType), row.key === 'frameType'));
      tr.appendChild(makeHintCell(translateAttribute(targetCard.attribute), row.key === 'attribute'));
      tr.appendChild(makeHintCell(targetCard.level, row.key === 'level'));
      tr.appendChild(makeHintCell(translateRace(targetCard.race), row.key === 'race'));
      tr.appendChild(makeHintCell(targetCard.atk, row.key === 'atk'));
      tr.appendChild(makeHintCell(targetCard.def, row.key === 'def'));
    } else {
      tr.appendChild(makeCell(translateFrame(row.card.frameType), row.frame));
      tr.appendChild(makeCell(translateAttribute(row.card.attribute), row.attribute));
      tr.appendChild(makeCell(row.card.level, row.level));
      tr.appendChild(makeCell(translateRace(row.card.race), row.race));
      tr.appendChild(makeCell(row.card.atk, row.atk));
      tr.appendChild(makeCell(row.card.def, row.def));
    }
    
    // Action cell (9th column)
    const actionTd = document.createElement('td');
    actionTd.style.padding = '0.75rem';
    actionTd.style.borderBottom = '1px solid var(--accent-blue)';
    actionTd.style.textAlign = 'center';
    
    if (row.isHint && row.hintType === '최초 힌트') {
      actionTd.textContent = '-';
      actionTd.style.color = 'var(--text-muted)';
      actionTd.style.opacity = '0.5';
    } else {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-delete-history';
      delBtn.innerHTML = '❌';
      delBtn.style = 'background: none; border: none; color: #ef4444; cursor: pointer; padding: 0 0.5rem; font-size: 1rem;';
      delBtn.onclick = () => {
        const index = history.indexOf(row);
        if (index > -1) {
          history.splice(index, 1);
          rebuildGameStateFromHistory();
        }
      };
      actionTd.appendChild(delBtn);
    }
    tr.appendChild(actionTd);
    
    historyTbody.appendChild(tr);
  });
}

function showVictory(guessCard) {
  const equivalentCards = getEquivalentCards(targetCard);
  
  victoryMsg.innerHTML = `
    총 시도 횟수: <strong style="color:var(--accent-gold); font-size:1.4rem;">${attempts}번</strong><br>
    무작위 힌트 사용 수: <strong style="color:var(--accent-gold); font-size:1.4rem;">${hintUseCount}번</strong>
  `;
  
  const container = document.getElementById('victoryCardsContainer');
  container.innerHTML = '';
  
  // 1. Target Card Section
  const targetDiv = document.createElement('div');
  targetDiv.style.marginBottom = '1rem';
  targetDiv.innerHTML = `
    <div style="font-weight: bold; color: var(--accent-gold); margin-bottom: 0.5rem; font-size: 1.1rem;">🎯 정답 카드</div>
    <img src="${targetCard.image_url}" alt="${targetCard.name}" style="max-width: 140px; border-radius: var(--radius); border: 2px solid var(--accent-gold);">
    <div style="font-weight: 600; margin-top: 0.25rem; font-size: 1rem;">${targetCard.name}</div>
  `;
  container.appendChild(targetDiv);
  
  // 2. Equivalent Cards (includes guessCard if different from targetCard)
  const others = equivalentCards;
  if (others.length > 0) {
    const othersDiv = document.createElement('div');
    othersDiv.innerHTML = `
      <div style="font-weight: bold; color: var(--text-muted); margin-bottom: 0.5rem; font-size: 1.1rem;">👥 함께 인정되는 복수 정답 카드 (${others.length}장)</div>
      <div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; max-height: 180px; overflow-y: auto; padding: 0.5rem; background: rgba(0,0,0,0.15); border-radius: 8px;">
        ${others.map(c => {
          const isMyGuess = guessCard && c.id === guessCard.id;
          const borderStyle = isMyGuess 
            ? 'border: 2px solid #2ecc71; box-shadow: 0 0 10px rgba(46, 204, 113, 0.6);' 
            : 'border: 1px solid var(--border);';
          const nameColor = isMyGuess ? '#2ecc71' : '#f8fafc';
          const nameWeight = isMyGuess ? 'bold' : 'normal';
          
          return `
            <div style="text-align: center; width: 75px;">
              <img src="${c.image_url ? c.image_url.replace('.jpg', '_small.jpg') : ''}" alt="${c.name}" onerror="this.src='${c.image_url}'" style="width: 55px; border-radius: 4px; ${borderStyle}">
              <div style="font-size: 0.65rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 0.15rem; color: ${nameColor}; font-weight: ${nameWeight};" title="${c.name}">${c.name}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    container.appendChild(othersDiv);
  }
  
  victoryModal.style.display = 'flex';
}

// Event Listeners
startGameBtn.addEventListener('click', initGame);
closeVictoryBtn.addEventListener('click', () => {
  victoryModal.style.display = 'none';
});
restartGameBtn.addEventListener('click', () => {
  victoryModal.style.display = 'none';
  initGame();
});
if (undoGuessBtn) {
  undoGuessBtn.addEventListener('click', () => {
    if (history.length === 0) return;
    const latest = history[0];
    if (latest.isHint && latest.hintType === '최초 힌트') {
      alert("최초 힌트는 되돌릴 수 없습니다.");
      return;
    }
    history.shift();
    rebuildGameStateFromHistory();
  });
}

async function loadGameDatabase() {
  startGameBtn.disabled = true;
  startGameBtn.textContent = '데이터 로딩 중...';
  try {
    const cached = await getCachedCards();
    if (cached && cached.length > 0) {
      allCards = cached.filter(c => c.frameType !== 'spell' && c.frameType !== 'trap');
      console.log(`Play mode loaded ${allCards.length} cards from IndexedDB.`);
    } else {
      allCards = rawCards.filter(c => c.frameType !== 'spell' && c.frameType !== 'trap');
      console.log(`Play mode loaded ${allCards.length} cards from static cards_data.js.`);
    }
  } catch (err) {
    console.error("Play mode failed to load IndexedDB, fallback to static:", err);
    allCards = rawCards.filter(c => c.frameType !== 'spell' && c.frameType !== 'trap');
  }

  // Pre-calculate valid levels
  allCards.forEach(card => {
    card.validLevels = getValidLevels(card);
  });

  startGameBtn.disabled = false;
  startGameBtn.textContent = '무작위 카드로 시작하기';
}

// Init database
loadGameDatabase();
