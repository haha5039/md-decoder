import fs from 'fs';

const file = 'src/main.js';
let code = fs.readFileSync(file, 'utf-8');

// Replace recList references with recContainer, snipeList, scoutList
code = code.replace(
  /const recList = document\.getElementById\('recList'\);/,
  `const recContainer = document.getElementById('recContainer');\nconst snipeList = document.getElementById('snipeList');\nconst scoutList = document.getElementById('scoutList');`
);

code = code.replace(
  /recList\.innerHTML = '';/g,
  `recContainer.classList.add('hidden');\nsnipeList.innerHTML = '';\nscoutList.innerHTML = '';`
);

// Replace calculation logic and UI update
code = code.replace(
  /calcRecBtn\.addEventListener\([\s\S]*?function updateHintStrategy/m,
  `calcRecBtn.addEventListener('click', () => {
  if (candidates.length <= 1) {
    if (candidates.length === 1) {
      updateHintStrategy(1.0);
    } else {
      alert("조건에 맞는 카드가 없습니다.");
    }
    return;
  }
  
  calcRecBtn.textContent = "계산 중...";
  calcRecBtn.disabled = true;
  
  // Use timeout to allow UI update
  setTimeout(() => {
    const { snipes, scouts, bestExpected } = calculateBestGuesses();
    
    recContainer.classList.remove('hidden');
    renderCandidateList(snipes.map(g => g.card), snipeList);
    Array.from(snipeList.children).forEach((child, i) => {
      const exp = snipes[i].expectedRemaining.toFixed(1);
      const info = document.createElement('div');
      info.className = 'card-item-info';
      info.innerHTML = \`정보량: \${snipes[i].entropy.toFixed(2)} Bits<br>평균 잔여: \${exp}장\`;
      child.appendChild(info);
    });

    renderCandidateList(scouts.map(g => g.card), scoutList);
    Array.from(scoutList.children).forEach((child, i) => {
      const exp = scouts[i].expectedRemaining.toFixed(1);
      const info = document.createElement('div');
      info.className = 'card-item-info';
      info.innerHTML = \`정보량: \${scouts[i].entropy.toFixed(2)} Bits<br>평균 잔여: \${exp}장\`;
      child.appendChild(info);
    });
    
    calcRecBtn.textContent = "최적의 카드 계산";
    calcRecBtn.disabled = false;
    
    if (snipes.length > 0) {
      updateHintStrategy(bestExpected);
    }
  }, 50);
});

function calculateBestGuesses() {
  const snipes = [];
  const scouts = [];
  
  const total = candidates.length;
  
  // To avoid freezing the browser for too long, if candidates is huge, we only scout a subset
  const scoutPool = total > 1000 ? candidates : allCards;
  
  for (let i = 0; i < scoutPool.length; i++) {
    const guess = scoutPool[i];
    const buckets = new Int32Array(64);
    
    for (let j = 0; j < total; j++) {
      const target = candidates[j];
      const profile = getMatchProfile(guess, target);
      buckets[profile]++;
    }
    
    let sumOfSquares = 0;
    let entropy = 0;
    
    for (let k = 0; k < 64; k++) {
      if (buckets[k] > 0) {
        sumOfSquares += buckets[k] * buckets[k];
        const p = buckets[k] / total;
        entropy -= p * Math.log2(p);
      }
    }
    
    const expectedRemaining = sumOfSquares / total;
    const scoreObj = { card: guess, entropy, expectedRemaining };
    
    // Check if it's a valid candidate
    const isCandidate = candidates.includes(guess);
    if (isCandidate) {
      snipes.push(scoreObj);
    } else {
      scouts.push(scoreObj);
    }
  }
  
  snipes.sort((a, b) => b.entropy - a.entropy); // Higher entropy is better
  scouts.sort((a, b) => b.entropy - a.entropy);
  
  return {
    snipes: snipes.slice(0, 5),
    scouts: scouts.slice(0, 5),
    bestExpected: snipes.length > 0 ? snipes[0].expectedRemaining : 0
  };
}

function updateHintStrategy`
);

fs.writeFileSync(file, code);
console.log('Patch success!');
