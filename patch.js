import fs from 'fs';

const file = 'src/main.js';
let code = fs.readFileSync(file, 'utf-8');

// Fix isLevelMatch to handle nulls
code = code.replace(
  /function isLevelMatch\(card, levelToMatch\) {[\s\S]*?return cLevel === targetLevel \|\| pLevel === targetLevel;\n}/,
  `function isLevelMatch(card, levelToMatch) {
  if (levelToMatch === null || levelToMatch === undefined || levelToMatch === "") {
    return card.level === null || card.level === undefined;
  }
  const targetLevel = parseInt(levelToMatch, 10);
  const cLevel = getCardLevel(card);
  const pLevel = card.level;
  return cLevel === targetLevel || pLevel === targetLevel;
}`
);

// Fix getMatchProfile to handle nulls for spells/traps properly
code = code.replace(
  /if \(guess\.race === target\.race\) profile \|= 8;/,
  `if (guess.race === target.race || (guess.race === null && target.race === null)) profile |= 8;`
);

// Fix applyFilters to handle exact match for direct hints and handle nulls
code = code.replace(
  /function applyFilters\(\) {[\s\S]*?updateUI\(\);/,
  `function applyFilters() {
  candidates = allCards.filter(card => {
    for (let hint of hints) {
      let isMatch = false;
      
      if (hint.stat === 'frameType') {
        if (hint.type === 'direct') {
          // Direct hints should match exactly the primary frame if it's a basic type
          // except pendulum, which we let match pendulum cards
          const t1 = (card.frameType || '').toLowerCase();
          const t2 = (hint.value || '').toLowerCase();
          if (t2 === 'pendulum') {
             isMatch = t1.includes('pendulum');
          } else {
             isMatch = t1 === t2;
          }
        } else {
          isMatch = isFrameMatch(card, hint.value);
        }
      } else if (hint.stat === 'level') {
        isMatch = isLevelMatch(card, hint.value);
      } else {
        isMatch = (card[hint.stat] === hint.value);
      }
      
      if (hint.isCorrect && !isMatch) return false;
      if (!hint.isCorrect && isMatch) return false;
    }
    return true;
  });
  
  updateUI();`
);

fs.writeFileSync(file, code);
console.log('Patched main.js');
