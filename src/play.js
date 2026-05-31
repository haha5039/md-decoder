import './style.css';
import { allCards as rawCards } from './cards_data.js';
import { isFrameMatch, isLevelMatch, getValidLevels, renderCardStatsHTML, translateAttribute, translateFrame, translateRace } from './utils.js';

const allCards = rawCards.filter(c => c.frameType !== 'spell' && c.frameType !== 'trap');

// Pre-calculate valid levels for all cards for maximum performance
allCards.forEach(card => {
  card.validLevels = getValidLevels(card);
});


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
const victoryImg = document.getElementById('victoryImg');
const closeVictoryBtn = document.getElementById('closeVictoryBtn');

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
  candidates = [...allCards];
  
  // UI Reset
  attemptCountEl.textContent = '0';
  hintUseCountEl.textContent = '0';
  historyTbody.innerHTML = '';
  guessInput.value = '';
  updateHintUI();
  
  // Reveal exactly 1 random hint at the start
  revealRandomHint();
  
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

function revealRandomHint() {
  const unrevealed = statKeys.filter(k => !revealedHints[k]);
  if (unrevealed.length === 0) return;
  
  const randomKey = unrevealed[Math.floor(Math.random() * unrevealed.length)];
  revealedHints[randomKey] = true;
  updateHintUI();
  updateCandidates();
}

getHintBtn.addEventListener('click', () => {
  const unrevealed = statKeys.filter(k => !revealedHints[k]);
  if (unrevealed.length > 0) {
    hintUseCount++;
    hintUseCountEl.textContent = hintUseCount;
    revealRandomHint();
  }
});

function getStatDisplay(val) {
  return val === null || val === undefined ? '-' : val;
}

function updateHintUI() {
  statKeys.forEach(key => {
    if (revealedHints[key]) {
      let val = targetCard[key];
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
    def: guessCard.def === targetCard.def
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
  
  // Check win condition
  const isWin = result.frame && result.attribute && result.level && result.race && result.atk && result.def && guessCard.id === targetCard.id;
  
  if (isWin) {
    showVictory();
  }
}

function updateCandidates() {
  candidates = allCards.filter(card => {
    // 1. Check against revealed hints
    if (revealedHints.frameType && !isFrameMatch(card, targetCard.frameType)) return false;
    if (revealedHints.level && !isLevelMatch(card, targetCard.validLevels)) return false;
    if (revealedHints.attribute && card.attribute !== targetCard.attribute) return false;
    if (revealedHints.race && card.race !== targetCard.race) return false;
    if (revealedHints.atk && card.atk !== targetCard.atk) return false;
    if (revealedHints.def && card.def !== targetCard.def) return false;
    
    // 2. Check against guess history (decoder logic)
    for (let i = 0; i < history.length; i++) {
      const g = history[i];
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
        <div><span>종류:</span> <span>${getStatDisplay(translateFrame(card.frameType))}</span></div>
        <div><span>Lv:</span> <span>${getStatDisplay(card.level)}</span></div>
        <div><span>속성:</span> <span>${getStatDisplay(translateAttribute(card.attribute))}</span></div>
        <div><span>종족:</span> <span>${getStatDisplay(translateRace(card.race))}</span></div>
        <div><span>ATK:</span> <span>${getStatDisplay(card.atk)}</span></div>
        <div><span>DEF:</span> <span>${getStatDisplay(card.def)}</span></div>
      </div>
    `;
    
    cardEl.addEventListener('click', () => {
      selectCardForGuess(card);
    });
    
    candidateGrid.appendChild(cardEl);
  });
}

function renderHistory() {
  historyTbody.innerHTML = '';
  
  history.forEach(row => {
    const tr = document.createElement('tr');
    
    // Image cell
    const imgTd = document.createElement('td');
    imgTd.style.padding = '0.5rem';
    imgTd.style.borderBottom = '1px solid var(--accent-blue)';
    const imgUrl = row.card.image_url ? row.card.image_url.replace('.jpg', '_small.jpg') : '';
    imgTd.innerHTML = `<img src="${imgUrl}" alt="card" style="width: 40px; border-radius: 3px;" loading="lazy" onerror="this.src='${row.card.image_url}'">`;
    tr.appendChild(imgTd);
    
    // Cell helper
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
    
    // Name cell
    const nameTd = document.createElement('td');
    nameTd.textContent = row.card.name;
    nameTd.style.padding = '0.75rem';
    nameTd.style.borderBottom = '1px solid var(--accent-blue)';
    tr.appendChild(nameTd);
    
    tr.appendChild(makeCell(translateFrame(row.card.frameType), row.frame));
    tr.appendChild(makeCell(translateAttribute(row.card.attribute), row.attribute));
    tr.appendChild(makeCell(row.card.level, row.level));
    tr.appendChild(makeCell(translateRace(row.card.race), row.race));
    tr.appendChild(makeCell(row.card.atk, row.atk));
    tr.appendChild(makeCell(row.card.def, row.def));
    
    historyTbody.appendChild(tr);
  });
}

function showVictory() {
  victoryMsg.innerHTML = `정답 카드: <strong>${targetCard.name}</strong><br>총 시도 횟수: <strong style="color:var(--accent-gold); font-size:1.5rem;">${attempts}번</strong>`;
  victoryImg.src = targetCard.image_url;
  victoryModal.style.display = 'flex';
}

// Event Listeners
startGameBtn.addEventListener('click', initGame);
closeVictoryBtn.addEventListener('click', () => {
  victoryModal.style.display = 'none';
  initGame();
});
