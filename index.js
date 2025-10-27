const { Telegraf, Markup, session } = require('telegraf');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');

// Login config
const logging = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  warning: (msg) => console.log(`[WARN] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.log(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`)
};

// userstored
const userState = {};
const userTemp = {};
const userSessions = {};
const userSettings = {};
const userPendingBets = {};
const userWaitingForResult = {};
const userStats = {};
const userGameInfo = {};
const userSkippedBets = {};
const userShouldSkipNext = {};
const userBalanceWarnings = {};
const userSkipResultWait = {};
const userLast10Results = {};
const userLyzoRoundCount = {};
const userAILast10Results = {};
const userAIRoundCount = {};
const userStopInitiated = {};
const userSLSkipWaitingForWin = {};
const userAllResults = {};
const userLastNumbers = []; // Store actual numbers for Leslay
let allowedsixuserid = new Set();
let patterns = {};
let dreamPatterns = {};

// Track users who /start the bot and logged in user
const activeUsers = new Set();

async function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ rejectUnauthorized: !IGNORE_SSL });
    
    const defaultOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
        'Connection': 'Keep-Alive'
      },
      timeout: 15000 // Increased timeout
    };
    
    const requestOptions = {
      ...defaultOptions,
      ...options,
      agent
    };
    
    const req = https.request(url, requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ data: jsonData });
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

// Security helpers
function loadAllowedUsers() {
  try {
    if (fs.existsSync('users_6lottery.json')) {
      const data = JSON.parse(fs.readFileSync('users_6lottery.json', 'utf8'));
      allowed777bigwinIds = new Set(data.allowed_ids || []);
      logging.info(`Loaded ${allowed777bigwinIds.size} users`);
    } else {
      logging.warning("users_6lottery.json not found. Starting new");
      allowed777bigwinIds = new Set();
    }
  } catch (error) {
    logging.error(`Error loading users_6lottery.json: ${error}`);
    allowed777bigwinIds = new Set();
  }
}

function saveAllowedUsers() {
  try {
    fs.writeFileSync('users_6lottery.json', JSON.stringify({ 
      allowed_ids: Array.from(allowed777bigwinIds) 
    }, null, 4));
    logging.info(`Saved ${allowed777bigwinIds.size} users`);
  } catch (error) {
    logging.error(`Error saving user list: ${error}`);
  }
}

// Helper functions
function normalizeText(text) {
  return text.normalize('NFKC').trim();
}

function signMd5(data) {
  const filtered = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== "signature" && key !== "timestamp") {
      filtered[key] = value;
    }
  }
  const sorted = Object.keys(filtered).sort().reduce((acc, key) => {
    acc[key] = filtered[key];
    return acc;
  }, {});
  const jsonStr = JSON.stringify(sorted).replace(/\s+/g, '');
  return crypto.createHash('md5').update(jsonStr).digest('hex').toUpperCase();
}

function signMd5Original(data) {
  const dataCopy = { ...data };
  delete dataCopy.signature;
  delete dataCopy.timestamp;
  const sorted = Object.keys(dataCopy).sort().reduce((acc, key) => {
    acc[key] = dataCopy[key];
    return acc;
  }, {});
  const jsonStr = JSON.stringify(sorted).replace(/\s+/g, '');
  return crypto.createHash('md5').update(jsonStr).digest('hex').toUpperCase();
}

function computeUnitAmount(amt) {
  if (amt <= 0) return 1;
  const amtStr = String(amt);
  const trailingZeros = amtStr.length - amtStr.replace(/0+$/, '').length;
  
  if (trailingZeros >= 4) return 10000;
  if (trailingZeros === 3) return 1000;
  if (trailingZeros === 2) return 100;
  if (trailingZeros === 1) return 10;
  return Math.pow(10, amtStr.length - 1);
}

function getSelectMap(gameType) {
  return { "B": 13, "S": 14 };
}

function numberToBS(num) {
  return num >= 5 ? 'B' : 'S';
}

// Load patterns for Lyzo strategy
function loadPatterns() {
  try {
    if (fs.existsSync('patterns.json')) {
      const data = JSON.parse(fs.readFileSync('patterns.json', 'utf8'));
      patterns = data;
      logging.info(`Loaded ${Object.keys(patterns).length} patterns for Lyzo strategy`);
    } else {
      logging.warning("patterns.json not found. Lyzo strategy will not work properly.");
      patterns = {};
    }
  } catch (error) {
    logging.error(`Error loading patterns.json: ${error}`);
    patterns = {};
  }
}

// Load patterns for DREAM strategy
function loadDreamPatterns() {
  try {
    if (fs.existsSync('dream.json')) {
      const data = JSON.parse(fs.readFileSync('dream.json', 'utf8'));
      dreamPatterns = data;
      logging.info(`Loaded ${Object.keys(dreamPatterns).length} patterns for DREAM strategy`);
    } else {
      logging.warning("dream.json not found. DREAM strategy will not work properly.");
      dreamPatterns = {
        "0": "SBBSBSSBBS",
        "1": "BBSBSBSBBS",
        "2": "SBSBBSBSBB",
        "3": "BSBSBSSBSB",
        "4": "SBBSBSBBSS",
        "5": "BSSBSBBSBS",
        "6": "BSBSSBSBSB",
        "7": "SBSBSBSSBB",
        "8": "BSBBSBSBSB",
        "9": "SBSBBSSBSB"
      };
    }
  } catch (error) {
    logging.error(`Error loading dream.json: ${error}`);
    dreamPatterns = {
      "0": "SBBSBSSBBS",
      "1": "BBSBSBSBBS",
      "2": "SBSBBSBSBB",
      "3": "BSBSBSSBSB",
      "4": "SBBSBSBBSS",
      "5": "BSSBSBBSBS",
      "6": "BSBSSBSBSB",
      "7": "SBSBSBSSBB",
      "8": "BSBBSBSBSB",
      "9": "SBSBBSSBSB"
    };
  }
}

// FIXED: Babio Strategy without random betting
async function getBabioPrediction(userId, gameType) {
  try {
    if (!userAILast10Results[userId]) {
      userAILast10Results[userId] = [];
    }
    if (!userAIRoundCount[userId]) {
      userAIRoundCount[userId] = 0;
    }
    
    userAIRoundCount[userId]++;
    
    // Always use available results, no random betting
    if (userAILast10Results[userId].length === 0) {
      // If no results, default to B
      logging.info(`Babio: No results available, defaulting to B`);
      return { result: 'B', percent: '50.0' };
    }
    
    // Use the most recent results available
    const availableResults = userAILast10Results[userId].slice(-10);
    logging.debug(`Babio: Available results: ${availableResults.join(', ')}`);
    
    const settings = userSettings[userId] || {};
    
    if (!settings.babio_state) {
      settings.babio_state = {
        current_position: 8,
        last_result: null
      };
    }
    
    const babioState = settings.babio_state;
    let prediction;
    
    // If we have at least 8 results, use the 8th position
    if (availableResults.length >= 8) {
      prediction = availableResults[7];
      logging.info(`Babio: Using 8th position result: ${prediction}`);
    } else if (availableResults.length >= 5) {
      // If we have at least 5 results, use the 5th position
      prediction = availableResults[4];
      logging.info(`Babio: Using 5th position result: ${prediction}`);
    } else {
      // Otherwise, use the last result
      prediction = availableResults[availableResults.length - 1];
      logging.info(`Babio: Using last result: ${prediction}`);
    }
    
    return { result: prediction, percent: 'N/A' };
  } catch (error) {
    logging.error(`Error getting Babio prediction: ${error}`);
    // Instead of random, default to B
    return { result: 'B', percent: '50.0' };
  }
}

// ALINKAR Strategy 
function getAlinkarPrediction(userId) {
  try {
    if (!userAllResults[userId]) {
      userAllResults[userId] = [];
    }
    
    // don't have enough results, bet randomly
    if (userAllResults[userId].length < 1) {
      const randomPrediction = Math.random() < 0.5 ? 'B' : 'S';
      logging.info(`ALINKAR: First bet is random (${randomPrediction})`);
      return randomPrediction;
    }
    
    // Get the last 5 
    const lastResults = userAllResults[userId].slice(-5);
    logging.debug(`ALINKAR: Last results: ${lastResults.join(', ')}`);
    
    let consecutiveCount = 1;
    let lastOutcome = lastResults[lastResults.length - 1];
    
    for (let i = lastResults.length - 2; i >= 0; i--) {
      if (lastResults[i] === lastOutcome) {
        consecutiveCount++;
      } else {
        break;
      }
    }
    
    logging.info(`ALINKAR: ${consecutiveCount} consecutive ${lastOutcome} outcomes`);
    
    let prediction;
    if (consecutiveCount === 1) {
      // တစ်ခါလွဲဘက်ကန်
      prediction = lastOutcome === 'B' ? 'S' : 'B';
      logging.info(`ALINKAR: Betting opposite (${prediction}) to single ${lastOutcome}`);
    } else if (consecutiveCount === 2) {
      // နှစ်ခါလာလိုက်လောင်း
      prediction = lastOutcome;
      logging.info(`ALINKAR: Betting follow (${prediction}) to double ${lastOutcome}`);
    } else if (consecutiveCount === 3) {
      // သုံးခါလာဘက်ကန်
      prediction = lastOutcome === 'B' ? 'S' : 'B';
      logging.info(`ALINKAR: Betting opposite (${prediction}) to triple ${lastOutcome}`);
    } else {
      // လေးခါနဲ့လေးခါအထက်လိုက်လောင်း
      prediction = lastOutcome;
      logging.info(`ALINKAR: Betting follow (${prediction}) to ${consecutiveCount}+ ${lastOutcome}`);
    }
    
    return prediction;
  } catch (error) {
    logging.error(`Error getting ALINKAR prediction: ${error}`);
    const randomPrediction = Math.random() < 0.5 ? 'B' : 'S';
    return randomPrediction;
  }
}

// FIXED: MAY BARANI Strategy without random betting
async function getMayBaraniPrediction(userId) {
  try {
    if (!userAllResults[userId]) {
      userAllResults[userId] = [];
    }
    
    // Always use available results, no random betting
    if (userAllResults[userId].length === 0) {
      // If no results, default to B
      logging.info(`MAY BARANI: No results available, defaulting to B`);
      return 'B';
    }
    
    // Need at least 5 results to calculate
    if (userAllResults[userId].length < 5) {
      // If we don't have 5 results yet, use the most recent result
      const lastResult = userAllResults[userId][userAllResults[userId].length - 1];
      logging.info(`MAY BARANI: Not enough results (${userAllResults[userId].length}), using last result: ${lastResult}`);
      return lastResult;
    }
    
    // Get the latest 5 results (from top to bottom as described)
    const latest5Results = userAllResults[userId].slice(-5);
    logging.debug(`MAY BARANI: Latest 5 results: ${latest5Results.join(', ')}`);
    
    // Convert B/S to numbers (B=5-9, S=0-4)
    // For calculation, we'll use middle values: B=7, S=2
    const numericResults = latest5Results.map(result => result === 'B' ? 7 : 2);
    
    // Sum the latest 5 results
    const sum = numericResults.reduce((acc, val) => acc + val, 0);
    logging.info(`MAY BARANI: Sum of latest 5 results: ${sum}`);
    
    // Subtract the remaining results (if any)
    let remainingSum = 0;
    if (userAllResults[userId].length > 5) {
      const remainingResults = userAllResults[userId].slice(0, -5);
      const numericRemaining = remainingResults.map(result => result === 'B' ? 7 : 2);
      remainingSum = numericRemaining.reduce((acc, val) => acc + val, 0);
      logging.info(`MAY BARANI: Sum of remaining results: ${remainingSum}`);
    }
    
    // Calculate final result
    let finalResult = sum - remainingSum;
    logging.info(`MAY BARANI: Final calculation: ${sum} - ${remainingSum} = ${finalResult}`);
    
    // Ignore negative sign
    finalResult = Math.abs(finalResult);
    logging.info(`MAY BARANI: Absolute value: ${finalResult}`);
    
    // If 2 digits, use only the last digit
    if (finalResult >= 10) {
      finalResult = finalResult % 10;
      logging.info(`MAY BARANI: Last digit of 2-digit number: ${finalResult}`);
    }
    
    // Determine bet based on the rules
    let prediction;
    const isTwoDigitCalculation = (sum - remainingSum) >= 10;
    
    if (isTwoDigitCalculation) {
      // Two-digit calculation result - bet opposite
      if (finalResult >= 5) {
        prediction = 'S'; // Opposite of Big
        logging.info(`MAY BARANI: Two-digit result ${finalResult} >= 5, betting Small (opposite)`);
      } else {
        prediction = 'B'; // Opposite of Small
        logging.info(`MAY BARANI: Two-digit result ${finalResult} < 5, betting Big (opposite)`);
      }
    } else {
      // Single-digit calculation result - bet same
      if (finalResult >= 5) {
        prediction = 'B'; // Same as Big
        logging.info(`MAY BARANI: Single-digit result ${finalResult} >= 5, betting Big (same)`);
      } else {
        prediction = 'S'; // Same as Small
        logging.info(`MAY BARANI: Single-digit result ${finalResult} < 5, betting Small (same)`);
      }
    }
    
    return prediction;
  } catch (error) {
    logging.error(`Error getting MAY BARANI prediction: ${error}`);
    // Instead of random, default to B
    return 'B';
  }
}

// FIXED: AI Prediction strategy without random betting
async function getAIPrediction(userId, gameType) {
  try {
    if (!userAILast10Results[userId]) {
      userAILast10Results[userId] = [];
    }
    if (!userAIRoundCount[userId]) {
      userAIRoundCount[userId] = 0;
    }
    
    userAIRoundCount[userId]++;
    
    // Always use available results, no random betting
    if (userAILast10Results[userId].length === 0) {
      // If no results, default to B
      logging.info(`AI Prediction: No results available, defaulting to B`);
      return { result: 'B', percent: '50.0' };
    }
    
    // Use the most recent results available
    const availableResults = userAILast10Results[userId].slice(-10);
    logging.debug(`AI Prediction: Available results: ${availableResults.join(', ')}`);
    
    // Check for patterns in the available results
    if (availableResults.length >= 3) {
      const lastThree = availableResults.slice(-3).join('');
      
      if (lastThree === 'BBB') {
        logging.info(`AI Prediction: S (based on BBB pattern)`);
        return { result: 'S', percent: '70.0' };
      } else if (lastThree === 'SSS') {
        logging.info(`AI Prediction: B (based on SSS pattern)`);
        return { result: 'B', percent: '70.0' };
      }
    }
    
    // Count the frequency of B and S in the available results
    const counts = { B: 0, S: 0 };
    for (const result of availableResults) {
      counts[result]++;
    }
    
    let prediction;
    if (counts.B > counts.S) {
      prediction = 'B';
      logging.info(`AI Prediction: B (B appeared ${counts.B} times, S appeared ${counts.S} times)`);
    } else if (counts.S > counts.B) {
      prediction = 'S';
      logging.info(`AI Prediction: S (S appeared ${counts.S} times, B appeared ${counts.B} times)`);
    } else {
      // If tied, use the last result
      prediction = availableResults[availableResults.length - 1];
      logging.info(`AI Prediction: Using last result (${prediction}) due to tie (B: ${counts.B}, S: ${counts.S})`);
    }
    
    const diff = Math.abs(counts.B - counts.S);
    const confidence = 50 + (diff * 5);
    const percent = Math.min(confidence, 95).toFixed(1);
    
    return { result: prediction, percent };
  } catch (error) {
    logging.error(`Error getting AI prediction: ${error}`);
    // Instead of random, default to B
    return { result: 'B', percent: '50.0' };
  }
}

// FIXED: Lyzo strategy without random betting
async function getLyzoPrediction(userId, gameType) {
  try {
    if (Object.keys(patterns).length === 0) {
      logging.warning("No patterns loaded for Lyzo strategy");
      // Instead of random, use a deterministic approach based on last result
      if (!userLast10Results[userId] || userLast10Results[userId].length === 0) {
        // If no results, default to B
        logging.info(`Lyzo: No results available, defaulting to B`);
        return { result: 'B', percent: '50.0' };
      }
      // Use the last result
      const lastResult = userLast10Results[userId][userLast10Results[userId].length - 1];
      logging.info(`Lyzo: Using last result as prediction: ${lastResult}`);
      return { result: lastResult, percent: '50.0' };
    }
  
    if (!userLast10Results[userId]) {
      userLast10Results[userId] = [];
    }
    if (!userLyzoRoundCount[userId]) {
      userLyzoRoundCount[userId] = 0;
    }
    
    userLyzoRoundCount[userId]++;
    
    // Always use pattern matching, no random betting
    if (userLast10Results[userId].length < 10) {
      // If we don't have 10 results yet, use the most recent result
      if (userLast10Results[userId].length > 0) {
        const lastResult = userLast10Results[userId][userLast10Results[userId].length - 1];
        logging.info(`Lyzo: Not enough results (${userLast10Results[userId].length}), using last result: ${lastResult}`);
        return { result: lastResult, percent: '50.0' };
      } else {
        // If no results at all, default to B
        logging.info(`Lyzo: No results available, defaulting to B`);
        return { result: 'B', percent: '50.0' };
      }
    }
    
    const lastTenResults = userLast10Results[userId].slice(-10);
    logging.debug(`Lyzo Prediction: Last 10 results: ${lastTenResults.join(', ')}`);
    
    const patternString = lastTenResults.join('');
    logging.debug(`Lyzo Prediction: Pattern string: ${patternString}`);
    
    const prediction = patterns[patternString];
    
    if (prediction) {
      logging.info(`Lyzo Prediction: ${prediction} (matched pattern: ${patternString})`);
      return { result: prediction, percent: 'N/A' };
    } else {
      // Instead of random, use a deterministic approach
      // Count the frequency of B and S in the last 10 results
      const counts = { B: 0, S: 0 };
      for (const result of lastTenResults) {
        counts[result]++;
      }
      
      // Use the more frequent result, or B if tied
      let deterministicPrediction;
      if (counts.B > counts.S) {
        deterministicPrediction = 'B';
      } else if (counts.S > counts.B) {
        deterministicPrediction = 'S';
      } else {
        // If tied, use the last result
        deterministicPrediction = lastTenResults[lastTenResults.length - 1];
      }
      
      logging.info(`Lyzo Prediction: ${deterministicPrediction} (no pattern matched, using deterministic approach)`);
      return { result: deterministicPrediction, percent: '50.0' };
    }
  } catch (error) {
    logging.error(`Error getting Lyzo prediction: ${error}`);
    // Instead of random, default to B
    return { result: 'B', percent: '50.0' };
  }
}

// BEATRIX Strategy
async function getBeatrixPrediction(userId, gameType) {
  try {
    if (!userSettings[userId]) {
      userSettings[userId] = {};
    }
    
    // Initialize BEATRIX state if not exists
    if (!userSettings[userId].beatrix_state) {
      userSettings[userId].beatrix_state = {
        waiting_for_seven: true,
        last_period_with_seven: null
      };
    }
    
    const beatrixState = userSettings[userId].beatrix_state;
    
    // If we're waiting for a 7, return null to indicate we should skip
    if (beatrixState.waiting_for_seven) {
      logging.info(`BEATRIX: Waiting for a result of 7`);
      return { result: null, skip: true };
    }
    
    // If we have a period with 7, check its last digit
    if (beatrixState.last_period_with_seven) {
      const lastDigit = parseInt(beatrixState.last_period_with_seven.slice(-1));
      
      // Determine prediction based on the mapping
      let prediction;
      if (lastDigit === 0 || lastDigit === 1 || lastDigit === 2 || lastDigit === 3 || lastDigit === 7) {
        prediction = 'S'; // SMALL
      } else {
        prediction = 'B'; // BIG
      }
      
      logging.info(`BEATRIX: Period ${beatrixState.last_period_with_seven} ends with ${lastDigit}, predicting ${prediction === 'B' ? 'BIG' : 'SMALL'}`);
      return { result: prediction, skip: false };
    }
    
    // Default case - wait for 7
    logging.info(`BEATRIX: No period with 7 found, waiting`);
    return { result: null, skip: true };
  } catch (error) {
    logging.error(`Error getting BEATRIX prediction: ${error}`);
    return { result: null, skip: true };
  }
}

function getValidDalembertBetAmount(unitSize, currentUnits, balance, minBet) {
  let amount = unitSize * currentUnits;
  
  while (amount > balance && currentUnits > 1) {
    currentUnits--;
    amount = unitSize * currentUnits;
  }
  
  if (amount > balance) {
    amount = balance;
  }
  
  if (amount < minBet) {
    amount = minBet;
  }
  
  return { amount, adjustedUnits: currentUnits };
}

function computeBetDetails(desiredAmount) {
  if (desiredAmount <= 0) {
    return { unitAmount: 0, betCount: 0, actualAmount: 0 };
  }
  
  const unitAmount = computeUnitAmount(desiredAmount);
  const betCount = Math.max(1, Math.floor(desiredAmount / unitAmount));
  const actualAmount = unitAmount * betCount;
  
  return { unitAmount, betCount, actualAmount };
}

function calculateBetAmount(settings, currentBalance) {
  const bettingStrategy = settings.betting_strategy || "Martingale";
  const betSizes = settings.bet_sizes || [100];
  const minBetSize = Math.min(...betSizes);
  
  logging.debug(`Calculating bet amount - Strategy: ${bettingStrategy}, Bet Sizes: [${betSizes.join(', ')}]`);
  
  if (bettingStrategy === "D'Alembert") {
    if (betSizes.length > 1) {
      throw new Error("D'Alembert strategy requires only ONE bet size");
    }
    
    const unitSize = betSizes[0];
    let units = settings.dalembert_units || 1;
    
    const { amount: validAmount, adjustedUnits } = getValidDalembertBetAmount(unitSize, units, currentBalance, minBetSize);
    
    if (adjustedUnits !== units) {
      settings.dalembert_units = adjustedUnits;
      units = adjustedUnits;
      logging.info(`D'Alembert: Adjusted units to ${units} due to balance constraints`);
    }
    
    logging.info(`D'Alembert: Betting ${validAmount} (${units} units of ${unitSize})`);
    return validAmount;
    
  } else if (bettingStrategy === "Custom") {
    const customIndex = settings.custom_index || 0;
    const adjustedIndex = Math.min(customIndex, betSizes.length - 1);
    const amount = betSizes[adjustedIndex];
    logging.info(`Custom: Betting ${amount} at index ${adjustedIndex}`);
    return amount;
    
  } else {
    // Martingale / Anti
    const martinIndex = settings.martin_index || 0;
    const adjustedIndex = Math.min(martinIndex, betSizes.length - 1);
    const amount = betSizes[adjustedIndex];
    logging.info(`${bettingStrategy}: Betting ${amount} at index ${adjustedIndex}`);
    return amount;
  }
}

// betting strategy after win/loss
function updateBettingStrategy(settings, isWin, betAmount) {
  const bettingStrategy = settings.betting_strategy || "Martingale";
  const betSizes = settings.bet_sizes || [100];
  
  logging.debug(`Updating betting strategy - Strategy: ${bettingStrategy}, Result: ${isWin ? 'WIN' : 'LOSS'}, Bet Amount: ${betAmount}`);
  
  if (bettingStrategy === "Martingale") {
    if (isWin) {
      settings.martin_index = 0;
      logging.info("Martingale: Win - Reset to index 0");
    } else {
      settings.martin_index = Math.min((settings.martin_index || 0) + 1, betSizes.length - 1);
      logging.info(`Martingale: Loss - Move to index ${settings.martin_index}`);
    }
    
  } else if (bettingStrategy === "Anti-Martingale") {
    if (isWin) {
      settings.martin_index = Math.min((settings.martin_index || 0) + 1, betSizes.length - 1);
      logging.info(`Anti-Martingale: Win - Move to index ${settings.martin_index}`);
    } else {
      settings.martin_index = 0;
      logging.info("Anti-Martingale: Loss - Reset to index 0");
    }
    
  } else if (bettingStrategy === "D'Alembert") {
    if (isWin) {
      settings.dalembert_units = Math.max(1, (settings.dalembert_units || 1) - 1);
      logging.info(`D'Alembert: Win - Decrease units to ${settings.dalembert_units}`);
    } else {
      settings.dalembert_units = (settings.dalembert_units || 1) + 1;
      logging.info(`D'Alembert: Loss - Increase units to ${settings.dalembert_units}`);
    }
    
  } else if (bettingStrategy === "Custom") {
    const currentIndex = settings.custom_index || 0;
    
    // Find the current bet amount index
    let actualIndex = 0;
    for (let i = 0; i < betSizes.length; i++) {
      if (betSizes[i] === betAmount) {
        actualIndex = i;
        break;
      }
    }
    
    if (isWin) {
      // After win, move
      if (actualIndex > 0) {
        settings.custom_index = actualIndex - 1;
      } else {
        settings.custom_index = 0;
      }
      logging.info(`Custom: Win - Move to index ${settings.custom_index}`);
    } else {
      // After loss, move 
      if (actualIndex < betSizes.length - 1) {
        settings.custom_index = actualIndex + 1;
      } else {
        settings.custom_index = betSizes.length - 1;
      }
      logging.info(`Custom: Loss - Move to index ${settings.custom_index}`);
    }
  }
}

// error handle 
async function loginRequest(phone, password) {
  const body = {
    "phonetype": 1,
    "language": 7,
    "logintype": "mobile",
    "random": "70e85c7beb864e36b598a95cf290d692",
    "username": "95" + phone,
    "pwd": password
  };
  body.signature = signMd5Original(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await makeRequest(BASE_URL + "Login", {
      method: 'POST',
      body: body
    });
    
    const res = response.data;
    if (res.code === 0 && res.data) {
      const tokenHeader = res.data.tokenHeader || "Bearer ";
      const token = res.data.token || "";
      const session = {
        post: async (endpoint, data) => {
          const url = BASE_URL + endpoint;
          const options = {
            method: 'POST',
            headers: {
              "Authorization": `${tokenHeader}${token}`,
              "Content-Type": "application/json; charset=UTF-8",
              "User-Agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"
            },
            body: data
          };
          return makeRequest(url, options);
        }
      };
      return { response: res, session };
    }
    return { response: res, session: null };
  } catch (error) {
    logging.error(`Login error: ${error.message}`);
    return { response: { error: error.message }, session: null };
  }
}

async function getUserInfo(session, userId) {
  const body = {
    "language": 7,
    "random": "4fc9f8f8d6764a5f934d4c6a468644e0"
  };
  body.signature = signMd5Original(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await session.post("GetUserInfo", body);
    const res = response.data;
    if (res.code === 0 && res.data) {
      const info = {
        "user_id": res.data.userId,
        "username": res.data.userName,
        "nickname": res.data.nickName,
        "balance": res.data.amount,
        "photo": res.data.userPhoto,
        "login_date": res.data.userLoginDate,
        "withdraw_count": res.data.withdrawCount,
        "is_allow_withdraw": res.data.isAllowWithdraw === 1
      };
      userGameInfo[userId] = info;
      return info;
    }
    return null;
  } catch (error) {
    logging.error(`Get user info error: ${error.message}`);
    return null;
  }
}

async function getBalance(session, userId) {
  const body = {
    "language": 7,
    "random": "71ebd56cff7d4679971c482807c33f6f"
  };
  body.signature = signMd5Original(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await session.post("GetBalance", body);
    const res = response.data;
    logging.info(`Balance check response for user ${userId}`);
    
    if (res.code === 0 && res.data) {
      const data = res.data;
      const amount = data.Amount || data.amount || data.balance;
      if (amount !== undefined && amount !== null) {
        const balance = parseFloat(amount);
        if (userGameInfo[userId]) {
          userGameInfo[userId].balance = balance;
        }
        if (!userStats[userId]) {
          userStats[userId] = { start_balance: balance, profit: 0.0 };
        }
        return balance;
      }
      logging.warning(`No balance amount found for user ${userId}`);
    } else {
      logging.error(`Get balance failed for user ${userId}: ${res.msg || 'Unknown error'}`);
    }
    return null;
  } catch (error) {
    logging.error(`Balance check error for user ${userId}: ${error.message}`);
    return null;
  }
}

async function getGameIssueRequest(session, gameType) {
  let typeId, endpoint;
  
  if (gameType === "TRX") {
    typeId = 13;
    endpoint = "GetTrxGameIssue";
  } else if (gameType === "WINGO_30S") {
    typeId = 30; // Wingo 30s 
    endpoint = "GetGameIssue"; // Use Wingo endpoint
  } else {
    typeId = 1; // WINGO 1min
    endpoint = "GetGameIssue";
  }
  
  const body = {
    "typeId": typeId,
    "language": 7,
    "random": "7d76f361dc5d4d8c98098ae3d48ef7af"
  };
  body.signature = signMd5(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);
  
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await session.post(endpoint, body);
      logging.info(`Game issue request for ${gameType}, attempt ${attempt + 1}`);
      
      if (response.data && response.data.code === 0) {
        return response.data;
      } else if (response.data && response.data.code !== 0) {
        logging.error(`Game issue error for ${gameType}: ${response.data.msg || 'Unknown error'}`);
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
        return response.data;
      }
      
      return response.data;
    } catch (error) {
      logging.error(`Game issue error for ${gameType}, attempt ${attempt + 1}: ${error.message}`);
      
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }
      return { error: error.message };
    }
  }
  
  return { error: "Failed after retries" };
}

async function placeBetRequest(session, issueNumber, selectType, unitAmount, betCount, gameType, userId) {
  let typeId, endpoint;
  
  if (gameType === "TRX") {
    typeId = 13;
    endpoint = "GameTrxBetting";
  } else if (gameType === "WINGO_30S") {
    typeId = 30; // Wingo 30s
    endpoint = "GameBetting"; // Use Wingo endpoint
  } else {
    typeId = 1; //  WINGO 1min
    endpoint = "GameBetting";
  }
  
  const betBody = {
    "typeId": typeId,
    "issuenumber": issueNumber,
    "language": 7,
    "gameType": 2,
    "amount": unitAmount,
    "betCount": betCount,
    "selectType": selectType,
    "random": "f9ec46840a374a65bb2abad44dfc4dc3"
  };
  betBody.signature = signMd5Original(betBody).toUpperCase();
  betBody.timestamp = Math.floor(Date.now() / 1000);
  
  for (let attempt = 0; attempt < MAX_BET_RETRIES; attempt++) {
    try {
      const response = await session.post(endpoint, betBody);
      const res = response.data;
      logging.info(`Bet request for user ${userId}, ${gameType}, issue ${issueNumber}, select_type ${selectType}, amount ${unitAmount * betCount}`);
      return res;
    } catch (error) {
      logging.error(`Bet error for user ${userId}, attempt ${attempt + 1}: ${error.message}`);
      
      if (attempt < MAX_BET_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, BET_RETRY_DELAY * 1000));
        continue;
      }
      return { error: error.message };
    }
  }
  return { error: "Failed after retries" };
}

// FIXED: Enhanced function to get Wingo game results with proper signature generation
async function getWingoGameResults(session, gameType = "WINGO") {
  let typeId;
  
  if (gameType === "WINGO_30S") {
    typeId = 30; // Wingo 30s
  } else {
    typeId = 1; //  WINGO 1min
  }
  
  const body = {
    "pageSize": 10,
    "pageNo": 1,
    "typeId": typeId,
    "language": 7,
    "random": "4ad5325e389745a882f4189ed6550e70"
  };
  
  // FIXED: Use the correct signature format for WINGO_30S
  if (gameType === "WINGO_30S") {
    body.signature = "5483D466A138F08B6704354BAA7E7FB3";
    body.timestamp = 1761247150;
  } else {
    // For regular WINGO, use the original signature generation
    body.signature = signMd5Original(body).toUpperCase();
    body.timestamp = Math.floor(Date.now() / 1000);
  }
  
  try {
    const response = await session.post("GetNoaverageEmerdList", body);
    const data = response.data;
    
    // Debug logging to verify we're getting 10 results
    if (data && data.code === 0 && data.data && data.data.list) {
      logging.info(`Successfully fetched ${data.data.list.length} results for ${gameType}`);
      return data;
    } else {
      logging.error(`Failed to get ${gameType} results: ${data?.msg || 'Unknown error'}`);
      return data;
    }
  } catch (error) {
    logging.error(`Error getting ${gameType} results: ${error.message}`);
    return { error: error.message };
  }
}

// Tg message
async function sendMessageWithRetry(ctx, text, replyMarkup = null) {
  for (let attempt = 0; attempt < MAX_TELEGRAM_RETRIES; attempt++) {
    try {
      if (replyMarkup) {
        await ctx.reply(text, replyMarkup);
      } else {
        await ctx.reply(text);
      }
      return true;
    } catch (error) {
      logging.error(`Telegram message error, attempt ${attempt + 1}: ${error.message}`);
      if (attempt < MAX_TELEGRAM_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, TELEGRAM_RETRY_DELAY));
        continue;
      }
      return false;
    }
  }
  return false;
}

// Safe message delete
async function safeDeleteMessage(ctx, messageId = null) {
  try {
    const msgId = messageId || ctx.callbackQuery?.message?.message_id;
    if (msgId) {
      await ctx.deleteMessage(msgId);
    }
  } catch (error) {
    // Ignore errors when message doesn't exist or already deleted
    if (error.response?.error_code !== 400) {
      logging.error(`Failed to delete message: ${error.message}`);
    }
  }
}

// Check profit target and stop bot if reached (leslay)
async function checkProfitAndStopLoss(userId, bot) {
  const settings = userSettings[userId] || {};
  
  // Skip profit target check
  if (settings.strategy === "SNIPER") {
    // Only check stop loss
    const stopLossLimit = settings.stop_loss;
    
    if (!stopLossLimit) {
      return false;
    }
    
    let currentProfit;
    let balanceText;
    
    if (settings.virtual_mode) {
      // Calculate profit
      currentProfit = (userStats[userId].virtual_balance || 0) - (userStats[userId].initial_balance || 0);
      balanceText = `Final Virtual Balance: ${userStats[userId].virtual_balance.toFixed(2)} Ks\n`;
    } else {
      currentProfit = userStats[userId].profit || 0;
      const session = userSessions[userId];
      const finalBalance = await getBalance(session, parseInt(userId));
      balanceText = `Final Balance: ${finalBalance?.toFixed(2) || '0.00'} Ks\n`;
    }
    
    // Check for stop loss limit reached
    if (stopLossLimit && currentProfit <= -stopLossLimit) {
      settings.running = false;
      delete userWaitingForResult[userId];
      delete userShouldSkipNext[userId];
      
      // Reset betting strategy
      settings.martin_index = 0;
      settings.dalembert_units = 1;
      settings.custom_index = 0;
      delete settings.dream_state;
      delete settings.leo_state;
      delete settings.trend_state;
      delete settings.sniper_state;
      
      // Don't send the message immediately, set a flag to send after the win/lose message
      settings.stop_loss_reached = true;
      settings.stop_loss_message = `🛑 STOP LOSS LIMIT HIT! 🛑\n` +
                               `Stop Loss Limit: ${stopLossLimit} Ks\n` +
                               `Current Loss: ${Math.abs(currentProfit).toFixed(2)} Ks\n` +
                               balanceText;
      
      return true;
    }
    
    return false;
  }
  
  // For other strategies, check both profit target and stop loss
  const targetProfit = settings.target_profit;
  const stopLossLimit = settings.stop_loss;
  
  if (!targetProfit && !stopLossLimit) {
    return false;
  }
  
  let currentProfit;
  let balanceText;
  
  if (settings.virtual_mode) {
    // Calculate profit based on user's initial virtual balance
    currentProfit = (userStats[userId].virtual_balance || 0) - (userStats[userId].initial_balance || 0);
    balanceText = `Final Virtual Balance: ${userStats[userId].virtual_balance.toFixed(2)} Ks\n`;
  } else {
    currentProfit = userStats[userId].profit || 0;
    const session = userSessions[userId];
    const finalBalance = await getBalance(session, parseInt(userId));
    balanceText = `Final Balance: ${finalBalance?.toFixed(2) || '0.00'} Ks\n`;
  }
  
  // Check for profit target reached
  if (targetProfit && currentProfit >= targetProfit) {
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    
    // Reset betting strategy
    settings.martin_index = 0;
    settings.dalembert_units = 1;
    settings.custom_index = 0;
    delete settings.dream_state;
    delete settings.leo_state;
    delete settings.trend_state;
    delete settings.sniper_state;
    
    // Don't send the message immediately, set a flag to send after the win/lose message
    settings.profit_target_reached = true;
    settings.profit_target_message = `🎯 PROFIT TARGET HIT! 🎯\n` +
                                    `Target: ${targetProfit} Ks\n` +
                                    `Achieved: ${currentProfit >= 0 ? '+' : ''}${currentProfit.toFixed(2)} Ks\n` +
                                    balanceText;
    
    return true;
  }
  
  // Check for stop loss limit reached
  if (stopLossLimit && currentProfit <= -stopLossLimit) {
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    
    // Reset betting strategy
    settings.martin_index = 0;
    settings.dalembert_units = 1;
    settings.custom_index = 0;
    delete settings.dream_state;
    delete settings.leo_state;
    delete settings.trend_state;
    delete settings.sniper_state;
    
    // Don't send the message immediately, set a flag to send after the win/lose message
    settings.stop_loss_reached = true;
    settings.stop_loss_message = `🛑 STOP LOSS LIMIT HIT! 🛑\n` +
                               `Stop Loss Limit: ${stopLossLimit} Ks\n` +
                               `Current Loss: ${Math.abs(currentProfit).toFixed(2)} Ks\n` +
                               balanceText;
    
    return true;
  }
  
  return false;
}

// FIXED: Enhanced win/lose checker with improved WINGO_30S handling
async function winLoseChecker(bot) {
  logging.info("Win/lose checker started");
  while (true) {
    try {
      for (const [userId, session] of Object.entries(userSessions)) {
        if (!session) continue;
        const settings = userSettings[userId] || {};
        const gameType = settings.game_type || "TRX"; // Get game type from settings
        const isLeslayStrategy = settings.strategy === "SNIPER";
        
        let data;
        
        if (gameType === "WINGO" || gameType === "WINGO_30S") {
          // Get Wingo results (for both 1min and 30s)
          const wingoRes = await getWingoGameResults(session, gameType);
          if (!wingoRes || wingoRes.code !== 0) {
            logging.error(`Failed to get ${gameType} results: ${wingoRes?.msg || 'Unknown error'}`);
            continue;
          }
          data = wingoRes.data?.list || [];
          
          // FIXED: Ensure we have 10 results for strategies
          if (data.length < 10) {
            logging.warning(`Only ${data.length} results available for ${gameType}, expected 10`);
          }
          
          // FIXED: Debug logging for WINGO_30S
          if (gameType === "WINGO_30S") {
            logging.debug(`WINGO_30S: Retrieved ${data.length} results`);
            if (data.length > 0) {
              logging.debug(`WINGO_30S: First result issueNumber: ${data[0].issueNumber}, number: ${data[0].number}`);
            }
          }
        } else {
          // Get TRX results
          let issueRes = await getGameIssueRequest(session, gameType);
          
          if (!issueRes || issueRes.code !== 0) {
            continue;
          }
          
          data = issueRes.data ? [issueRes.data.settled || {}] : [];
        }
        
        // Store all 10 results for strategies that need historical data
        if (gameType === "WINGO" || gameType === "WINGO_30S") {
          // Initialize result arrays if they don't exist
          if (!userAILast10Results[userId]) userAILast10Results[userId] = [];
          if (!userLast10Results[userId]) userLast10Results[userId] = [];
          if (!userAllResults[userId]) userAllResults[userId] = [];
          
          // Process each result to ensure we have 10 for every period
          for (let i = 0; i < Math.min(data.length, 10); i++) {
            const result = data[i];
            if (result && result.number) {
              const number = parseInt(result.number || "0") % 10;
              const bigSmall = number >= 5 ? "B" : "S";
              
              // Store for AI strategy
              if (settings.strategy === "AI_PREDICTION" || settings.strategy === "BABIO") {
                if (!userAILast10Results[userId].includes(bigSmall)) {
                  userAILast10Results[userId].push(bigSmall);
                  if (userAILast10Results[userId].length > 10) {
                    userAILast10Results[userId] = userAILast10Results[userId].slice(-10);
                  }
                }
              }
              
              // Store for Lyzo strategy
              if (settings.strategy === "LYZO") {
                if (!userLast10Results[userId].includes(bigSmall)) {
                  userLast10Results[userId].push(bigSmall);
                  if (userLast10Results[userId].length > 10) {
                    userLast10Results[userId] = userLast10Results[userId].slice(-10);
                  }
                }
              }
              
              // Store for all strategies
              if (!userAllResults[userId].includes(bigSmall)) {
                userAllResults[userId].push(bigSmall);
                if (userAllResults[userId].length > 20) {
                  userAllResults[userId] = userAllResults[userId].slice(-20);
                }
              }
            }
          }
        }
        
        // Process pending bets (ACTUAL BETS)
        if (userPendingBets[userId]) {
          for (const [period, betInfo] of Object.entries(userPendingBets[userId])) {
            const settled = data.find(item => item.issueNumber === period);
            if (settled && settled.number) {
              // FIXED: Debug logging for WINGO_30S
              if (gameType === "WINGO_30S") {
                logging.debug(`WINGO_30S: Found result for period ${period}: ${settled.number}`);
              }
              
              const [betType, amount, isVirtual] = betInfo;
              const number = parseInt(settled.number || "0") % 10;
              const bigSmall = number >= 5 ? "B" : "S";
              const isWin = (betType === "B" && bigSmall === "B") || (betType === "S" && bigSmall === "S");
              
              // Store the actual number for SNIPER strategy
              if (!userLastNumbers[userId]) {
                userLastNumbers[userId] = [];
              }
              userLastNumbers[userId].push(number.toString());
              if (userLastNumbers[userId].length > 10) {
                userLastNumbers[userId] = userLastNumbers[userId].slice(-10);
              }
              
              // Store result for AI strategy
              if (settings.strategy === "AI_PREDICTION") {
                if (!userAILast10Results[userId]) {
                  userAILast10Results[userId] = [];
                }
                userAILast10Results[userId].push(bigSmall);
                if (userAILast10Results[userId].length > 10) {
                  userAILast10Results[userId] = userAILast10Results[userId].slice(-10);
                }
                logging.debug(`Stored result for AI: ${bigSmall} (now have ${userAILast10Results[userId].length} results)`);
              }
              
              // Store result for Babio strategy
              if (settings.strategy === "BABIO") {
                if (!userAILast10Results[userId]) {
                  userAILast10Results[userId] = [];
                }
                userAILast10Results[userId].push(bigSmall);
                if (userAILast10Results[userId].length > 10) {
                  userAILast10Results[userId] = userAILast10Results[userId].slice(-10);
                }
                logging.debug(`Stored result for Babio: ${bigSmall} (now have ${userAILast10Results[userId].length} results)`);
              }
              
              // Store result for Lyzo strategy if using TRX
              if (settings.strategy === "LYZO") {
                if (!userLast10Results[userId]) {
                  userLast10Results[userId] = [];
                }
                userLast10Results[userId].push(bigSmall);
                if (userLast10Results[userId].length > 10) {
                  userLast10Results[userId] = userLast10Results[userId].slice(-10);
                }
                logging.debug(`Stored result for Lyzo: ${bigSmall} (now have ${userLast10Results[userId].length} results)`);
              }
              
              // Store result in userAllResults for all strategies
              if (!userAllResults[userId]) {
                userAllResults[userId] = [];
              }
              userAllResults[userId].push(bigSmall);
              if (userAllResults[userId].length > 20) {
                userAllResults[userId] = userAllResults[userId].slice(-20);
              }
              
              // BEATRIX strategy result processing
              if (settings.strategy === "BEATRIX") {
                if (!userSettings[userId].beatrix_state) {
                  userSettings[userId].beatrix_state = {
                    waiting_for_seven: true,
                    last_period_with_seven: null
                  };
                }
                
                const beatrixState = userSettings[userId].beatrix_state;
                
                // Check if the result number is 7
                if (number === 7) {
                  beatrixState.waiting_for_seven = false;
                  beatrixState.last_period_with_seven = period;
                  logging.info(`BEATRIX: Found result 7 in period ${period}, ready to bet on next period`);
                } else {
                  // If not 7, we're waiting
                  beatrixState.waiting_for_seven = true;
                  logging.info(`BEATRIX: Result is ${number}, not 7, continuing to wait`);
                }
              }
              
              // Update LEO strategy state
              if (settings.strategy === "LEO" && settings.leo_state) {
                settings.leo_state.last_result = bigSmall;
                settings.leo_state.pattern_index = (settings.leo_state.pattern_index + 1) % 
                  (bigSmall === 'B' ? LEO_BIG_PATTERN.length : LEO_SMALL_PATTERN.length);
                logging.info(`LEO strategy: Updated last_result to ${bigSmall}, pattern_index to ${settings.leo_state.pattern_index}`);
              }
              
              // Update TREND_FOLLOW strategy state
              if (settings.strategy === "TREND_FOLLOW" && settings.trend_state) {
                settings.trend_state.last_result = bigSmall;
                logging.info(`TREND_FOLLOW strategy: Updated last_result to ${bigSmall}`);
              }
              
              // Update ALTERNATE strategy state
              if (settings.strategy === "ALTERNATE" && settings.alternate_state) {
                settings.alternate_state.last_result = bigSmall;
                
                // Handle BB/SS wait logic
                if (settings.alternate_state.skip_mode) {
                  // We're in skip mode
                  if (isWin) {
                    // Win in skip mode - resume normal betting
                    settings.alternate_state.skip_mode = false;
                    logging.info(`ALTERNATE strategy: Win in skip mode. Resuming normal betting.`);
                  }
                  // If lose in skip mode, continue skipping
                  logging.info(`ALTERNATE strategy: Updated last_result to ${bigSmall} (still in skip mode)`);
                } else {
                  logging.info(`ALTERNATE strategy: Updated last_result to ${bigSmall} (normal mode)`);
                }
              }
              
              // Update SNIPER strategy state
              if (isLeslayStrategy && settings.sniper_state && settings.sniper_state.active) {
                if (isWin) {
                  // Increment the hit count
                  settings.sniper_state.hit_count = (settings.sniper_state.hit_count || 0) + 1;
                  
                  // Check if this is the second hit
                  if (settings.sniper_state.hit_count >= 2) {
                    // Set a flag to show the special message after the win/lose message
                    settings.sniper_hit_twice = true;
                    logging.info(`SNIPER: Second hit recorded, will show message after win/lose notification`);
                    
                    // STOP THE BOT IMMEDIATELY when sniper hits 2 times
                    settings.running = false;
                    delete userWaitingForResult[userId];
                    delete userShouldSkipNext[userId];
                    delete userSLSkipWaitingForWin[userId];
                  } else {
                    // First hit - set a flag to show 1/2 message after the win/lose message
                    settings.sniper_hit_once = true;
                    logging.info(`SNIPER: First hit recorded (${settings.sniper_state.hit_count}/2)`);
                  }
                  
                  // Reset the sniper state but keep the hit count
                  const hitCount = settings.sniper_state.hit_count;
                  settings.sniper_state.active = false;
                  settings.sniper_state.direction = null;
                  settings.sniper_state.current_index = 0;
                  settings.sniper_state.bet_sequence = [];
                  settings.sniper_state.got_same_result = false;
                  settings.sniper_state.hit_count = hitCount;
                } else {
                  // Loss: increment the current_index
                  settings.sniper_state.current_index++;
                  
                  // Check if we've reached the max bets (4)
                  if (settings.sniper_state.current_index >= 4) {
                    // Reached max bets, stop the bot
                    settings.running = false;
                    // Set a flag to show the special message
                    settings.sniper_max_reached = true;
                    logging.info(`SNIPER: Reached max bets without win, stopping bot`);
                  }
                  
                  // Check if we got the same number again
                  const lastNumber = userLastNumbers[userId] && userLastNumbers[userId].length > 1 
                    ? userLastNumbers[userId][userLastNumbers[userId].length - 2] 
                    : null;
                  
                  const currentNumber = userLastNumbers[userId] && userLastNumbers[userId].length > 0 
                    ? userLastNumbers[userId][userLastNumbers[userId].length - 1] 
                    : null;
                  
                  // If we got the same number again (0 after 0 or 9 after 9) on the first bet
                  if (lastNumber === currentNumber && settings.sniper_state.current_index === 1) {
                    settings.sniper_state.got_same_result = true;
                    
                    if (currentNumber === "0") {
                      // Got 0 again, update sequence: B -> S -> B -> B
                      settings.sniper_state.bet_sequence = ["B", "S", "B", "B"];
                      logging.info(`SNIPER: Got 0 again, sequence: B -> S -> B -> B`);
                    } else if (currentNumber === "9") {
                      // Got 9 again, update sequence: S -> B -> S -> S
                      settings.sniper_state.bet_sequence = ["S", "B", "S", "S"];
                      logging.info(`SNIPER: Got 9 again, sequence: S -> B -> S -> S`);
                    }
                  } else if (!settings.sniper_state.got_same_result) {
                    // If we didn't get the same result, continue with the original pattern
                    if (settings.sniper_state.direction === "B") {
                      // Original was Big (after 0)
                      if (settings.sniper_state.current_index === 2) {
                        settings.sniper_state.bet_sequence.push("B");
                      } else if (settings.sniper_state.current_index === 3) {
                        settings.sniper_state.bet_sequence.push("B");
                      }
                    } else {
                      // Original was Small (after 9)
                      if (settings.sniper_state.current_index === 2) {
                        settings.sniper_state.bet_sequence.push("S");
                      } else if (settings.sniper_state.current_index === 3) {
                        settings.sniper_state.bet_sequence.push("S");
                      }
                    }
                  }
                }
              }
              
              // Update Babio strategy state
              if (settings.strategy === "BABIO" && settings.babio_state) {
                if (!isWin) {
                  settings.babio_state.current_position = settings.babio_state.current_position === 8 ? 5 : 8;
                }
              }
              
              const entryLayer = settings.layer_limit || 1;
              
              // Entry Layer logic - skip for Leslay strategy
              if (!isLeslayStrategy) {
                if (entryLayer === 2) {
                  if (!settings.entry_layer_state) {
                    settings.entry_layer_state = { waiting_for_lose: true };
                  }
                  
                  if (isWin) {
                    // Win - reset to wait for 1 lose
                    settings.entry_layer_state.waiting_for_lose = true;
                  } else {
                    // Lose - if we were waiting for a lose, now we can bet
                    if (settings.entry_layer_state.waiting_for_lose) {
                      settings.entry_layer_state.waiting_for_lose = false;
                    }
                  }
                } else if (entryLayer === 3) {
                  if (!settings.entry_layer_state) {
                    settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
                  }
                  
                  if (isWin) {
                    // Win - reset to wait for 2 consecutive loses
                    settings.entry_layer_state.waiting_for_loses = true;
                    settings.entry_layer_state.consecutive_loses = 0;
                  } else {
                    // Lose - increment consecutive loses counter
                    settings.entry_layer_state.consecutive_loses++;
                    
                    // If we have 2 consecutive loses, we can now bet
                    if (settings.entry_layer_state.consecutive_loses >= 2) {
                      settings.entry_layer_state.waiting_for_loses = false;
                    }
                  }
                }
              }
              
              // SL layer logic - skip for Leslay strategy
              if (!isLeslayStrategy && settings.sl_layer && settings.sl_layer > 0) {
                if (isWin) {
                  settings.consecutive_losses = 0;
                  userShouldSkipNext[userId] = false;
                  
                  // If we were waiting for a skip win and got a win, reset SL skip state
                  if (userSLSkipWaitingForWin[userId]) {
                    delete userSLSkipWaitingForWin[userId];
                    logging.info(`SL Layer: Got win after skip, resetting SL state for user ${userId}`);
                  }
                  
                  // Update betting strategy after win
                  updateBettingStrategy(settings, true, amount);
                } else {
                  // ONLY increment consecutive_losses for ACTUAL losses
                  settings.consecutive_losses = (settings.consecutive_losses || 0) + 1;
                  logging.info(`SL Layer: Consecutive losses increased to ${settings.consecutive_losses}/${settings.sl_layer}`);
                  
                  // Update betting strategy after loss
                  updateBettingStrategy(settings, false, amount);
                  
                  if (settings.consecutive_losses >= settings.sl_layer) {
                    // Save current state before skipping
                    const bettingStrategy = settings.betting_strategy || "Martingale";
                    if (bettingStrategy === "Martingale" || bettingStrategy === "Anti-Martingale") {
                      settings.original_martin_index = settings.martin_index || 0;
                    } else if (bettingStrategy === "D'Alembert") {
                      settings.original_dalembert_units = settings.dalembert_units || 1;
                    } else if (bettingStrategy === "Custom") {
                      settings.original_custom_index = settings.custom_index || 0;
                    }
                    
                    settings.skip_betting = true;
                    userShouldSkipNext[userId] = true;
                    userSLSkipWaitingForWin[userId] = true;
                    logging.warning(`SL Layer triggered! Skipping next bet after ${settings.consecutive_losses} consecutive losses. Waiting for skip win.`);
                  }
                }
              } else {
                // No SL layer or Leslay strategy - update betting strategy normally
                updateBettingStrategy(settings, isWin, amount);
              }
              
              // Update profit based on mode
              if (isVirtual) {
                if (!userStats[userId].virtual_balance) {
                  userStats[userId].virtual_balance = settings.virtual_balance || 0;
                }
                
                if (isWin) {
                  userStats[userId].virtual_balance += amount * 0.96;
                } else {
                  userStats[userId].virtual_balance -= amount;
                }
              } else {
                if (userStats[userId] && amount > 0) {
                  if (isWin) {
                    const profitChange = amount * 0.96;
                    userStats[userId].profit += profitChange;
                  } else {
                    userStats[userId].profit -= amount;
                  }
                }
              }
              
              // Update DREAM strategy state if using DREAM strategy
              if (settings.strategy === "DREAM" && settings.dream_state) {
                const dreamState = settings.dream_state;
                
                const resultNumber = parseInt(settled.number || "0") % 10;
                logging.info(`DREAM strategy: Result number is ${resultNumber}`);
                
                if (dreamState.first_bet) {
                  dreamState.first_bet = false;
                  dreamState.current_pattern = dreamPatterns[resultNumber.toString()] || dreamPatterns["0"];
                  dreamState.current_index = 0;
                  logging.info(`DREAM strategy: First bet complete. Using pattern for result ${resultNumber}: ${dreamState.current_pattern}`);
                } else {
                  if (isWin) {
                    dreamState.current_pattern = dreamPatterns[resultNumber.toString()] || dreamPatterns["0"];
                    dreamState.current_index = 0;
                    logging.info(`DREAM strategy: Win! Changed to pattern for result ${resultNumber}: ${dreamState.current_pattern}`);
                  } else {
                    dreamState.current_index = (dreamState.current_index + 1) % dreamState.current_pattern.length;
                    logging.info(`DREAM strategy: Loss. Moving to index ${dreamState.current_index} in current pattern: ${dreamState.current_pattern}`);
                  }
                }
              }
              
              const currentBalance = isVirtual 
                ? userStats[userId].virtual_balance 
                : await getBalance(session, parseInt(userId));
              
              // Check for profit target or stop loss
              const botStopped = await checkProfitAndStopLoss(userId, bot);
              
              // Format result as requested: 🎯Result: 7 => Big
              const resultText = `🎯 Result: ${number} => ${bigSmall === 'B' ? 'Big' : 'Small'}`;
              
              // Format ID based on game type
              const gameId = `🆔 ${gameType} : ${period}`;
              
              let message;
              if (isWin) {
                const winAmount = amount * 0.96;
                const totalProfit = isVirtual 
                  ? (userStats[userId].virtual_balance - (userStats[userId].initial_balance || 0))
                  : (userStats[userId]?.profit || 0);
                message = `✅ WIN +${winAmount.toFixed(2)} Ks\n` +
                         `--------------------------\n`+
                         `${gameId}\n` +
                         `${resultText}\n` +
                         `💳 Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                         `📊 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks`;
              } else {
                const totalProfit = isVirtual 
                  ? (userStats[userId].virtual_balance - (userStats[userId].initial_balance || 0))
                  : (userStats[userId]?.profit || 0);
                const consecutiveLosses = settings.consecutive_losses || 0;
                
                // Only show consecutive losses if SL Layer is enabled and not Leslay strategy
                let slStatusLine = '';
                if (!isLeslayStrategy && settings.sl_layer) {
                  slStatusLine = `\🔴 Consecutive Losses: ${consecutiveLosses}/${settings.sl_layer}\n\n`;
                }
                
                message = `❌ LOSE -${amount} Ks\n` +
                         `--------------------------\n`+
                         `${gameId}\n` +
                         `${resultText}\n` +
                         `${slStatusLine}` +
                         `💳 Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                         `📊 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks`;
              }
              
              try {
                await bot.telegram.sendMessage(userId, message);
                
                // Check for sniper hit messages
                if (isLeslayStrategy) {
                  if (settings.sniper_hit_twice) {
                    try {
                      await bot.telegram.sendMessage(userId, "🎯 SNIPER HIT 2/2! Target acquired successfully! Bot stopped.");
                      settings.sniper_hit_twice = false;
                    } catch (error) {
                      logging.error(`Failed to send sniper hit message to ${userId}: ${error.message}`);
                    }
                  } else if (settings.sniper_hit_once) {
                    try {
                      await bot.telegram.sendMessage(userId, "🎯 SNIPER HIT 1/2! One more target to go!");
                      settings.sniper_hit_once = false;
                    } catch (error) {
                      logging.error(`Failed to send sniper hit message to ${userId}: ${error.message}`);
                    }
                  }
                }
                
                // Check if profit target was reached and send the message after the win/lose message
                if (settings.profit_target_reached && settings.profit_target_message) {
                  await bot.telegram.sendMessage(userId, settings.profit_target_message, makeMainKeyboard(true));
                  settings.profit_target_reached = false;
                  settings.profit_target_message = null;
                  userStopInitiated[userId] = true;
                }
                
                // Check if stop loss was reached and send the message after the win/lose message
                if (settings.stop_loss_reached && settings.stop_loss_message) {
                  await bot.telegram.sendMessage(userId, settings.stop_loss_message, makeMainKeyboard(true));
                  settings.stop_loss_reached = false;
                  settings.stop_loss_message = null;
                  userStopInitiated[userId] = true;
                }
              } catch (error) {
                logging.error(`Failed to send result to ${userId}: ${error.message}`);
              }
              
              delete userPendingBets[userId][period];
              if (Object.keys(userPendingBets[userId]).length === 0) {
                delete userPendingBets[userId];
              }
              userWaitingForResult[userId] = false;
            }
          }
        }
        
        // Process skipped bets (DO NOT count towards SL layer)
        if (userSkippedBets[userId]) {
          for (const [period, betInfo] of Object.entries(userSkippedBets[userId])) {
            const settled = data.find(item => item.issueNumber === period);
            if (settled && settled.number) {
              // FIXED: Debug logging for WINGO_30S
              if (gameType === "WINGO_30S") {
                logging.debug(`WINGO_30S: Found result for skipped period ${period}: ${settled.number}`);
              }
              
              const [betType, isVirtual] = betInfo;
              const number = parseInt(settled.number || "0") % 10;
              const bigSmall = number >= 5 ? "B" : "S";
              const isWin = (betType === "B" && bigSmall === "B") || (betType === "S" && bigSmall === "S");
              
              // Store the actual number for SNIPER strategy
              if (!userLastNumbers[userId]) {
                userLastNumbers[userId] = [];
              }
              userLastNumbers[userId].push(number.toString());
              if (userLastNumbers[userId].length > 10) {
                userLastNumbers[userId] = userLastNumbers[userId].slice(-10);
              }
              
              // Store result for AI strategy
              if (settings.strategy === "AI_PREDICTION") {
                if (!userAILast10Results[userId]) {
                  userAILast10Results[userId] = [];
                }
                userAILast10Results[userId].push(bigSmall);
                if (userAILast10Results[userId].length > 10) {
                  userAILast10Results[userId] = userAILast10Results[userId].slice(-10);
                }
                logging.debug(`Stored result for AI (skipped bet): ${bigSmall} (now have ${userAILast10Results[userId].length} results)`);
              }
              
              // Store result for Babio strategy
              if (settings.strategy === "BABIO") {
                if (!userAILast10Results[userId]) {
                  userAILast10Results[userId] = [];
                }
                userAILast10Results[userId].push(bigSmall);
                if (userAILast10Results[userId].length > 10) {
                  userAILast10Results[userId] = userAILast10Results[userId].slice(-10);
                }
                logging.debug(`Stored result for Babio (skipped bet): ${bigSmall} (now have ${userAILast10Results[userId].length} results)`);
              }
              
              // Store result for Lyzo strategy if using TRX
              if (settings.strategy === "LYZO") {
                if (!userLast10Results[userId]) {
                  userLast10Results[userId] = [];
                }
                userLast10Results[userId].push(bigSmall);
                if (userLast10Results[userId].length > 10) {
                  userLast10Results[userId] = userLast10Results[userId].slice(-10);
                }
                logging.debug(`Stored result for Lyzo (skipped bet): ${bigSmall} (now have ${userLast10Results[userId].length} results)`);
              }
              
              // Store result in userAllResults for all strategies
              if (!userAllResults[userId]) {
                userAllResults[userId] = [];
              }
              userAllResults[userId].push(bigSmall);
              if (userAllResults[userId].length > 20) {
                userAllResults[userId] = userAllResults[userId].slice(-20);
              }
              
              // BEATRIX strategy result processing for skipped bets
              if (settings.strategy === "BEATRIX") {
                if (!userSettings[userId].beatrix_state) {
                  userSettings[userId].beatrix_state = {
                    waiting_for_seven: true,
                    last_period_with_seven: null
                  };
                }
                
                const beatrixState = userSettings[userId].beatrix_state;
                
                // Check if the result number is 7
                if (number === 7) {
                  beatrixState.waiting_for_seven = false;
                  beatrixState.last_period_with_seven = period;
                  logging.info(`BEATRIX: Found result 7 in period ${period}, ready to bet on next period`);
                } else {
                  // If not 7, we're waiting
                  beatrixState.waiting_for_seven = true;
                  logging.info(`BEATRIX: Result is ${number}, not 7, continuing to wait`);
                }
              }
              
              // Update TREND_FOLLOW strategy state
              if (settings.strategy === "TREND_FOLLOW" && settings.trend_state) {
                settings.trend_state.last_result = bigSmall;
                
                // Handle BS/SB wait logic
                if (settings.trend_state.skip_mode) {
                  // We're in skip mode
                  if (isWin) {
                    // Win in skip mode - resume normal betting
                    settings.trend_state.skip_mode = false;
                    logging.info(`TREND_FOLLOW strategy: Win in skip mode. Resuming normal betting.`);
                  }
                  // If lose in skip mode, continue skipping
                  logging.info(`TREND_FOLLOW strategy: Updated last_result to ${bigSmall}`);
                }
              }
              
              // Update ALTERNATE strategy state
              if (settings.strategy === "ALTERNATE" && settings.alternate_state) {
                settings.alternate_state.last_result = bigSmall;
                
                // Handle BB/SS wait logic
                if (settings.alternate_state.skip_mode) {
                  // We're in skip mode
                  if (isWin) {
                    // Win in skip mode - resume normal betting
                    settings.alternate_state.skip_mode = false;
                    logging.info(`ALTERNATE strategy: Win in skip mode. Resuming normal betting.`);
                  }
                  // If lose in skip mode, continue skipping
                  logging.info(`ALTERNATE strategy: Updated last_result to ${bigSmall} (still in skip mode)`);
                } else {
                  logging.info(`ALTERNATE strategy: Updated last_result to ${bigSmall} (normal mode)`);
                }
              }
              
              // Update LEO strategy state
              if (settings.strategy === "LEO" && settings.leo_state) {
                settings.leo_state.last_result = bigSmall;
                settings.leo_state.pattern_index = (settings.leo_state.pattern_index + 1) % 
                  (bigSmall === 'B' ? LEO_BIG_PATTERN.length : LEO_SMALL_PATTERN.length);
                logging.info(`LEO strategy: Updated last_result to ${bigSmall}, pattern_index to ${settings.leo_state.pattern_index}`);
              }
              
              // Update SNIPER strategy state
              if (isLeslayStrategy && settings.sniper_state && settings.sniper_state.active) {
                if (isWin) {
                  // Increment the hit count
                  settings.sniper_state.hit_count = (settings.sniper_state.hit_count || 0) + 1;
                  
                  // Check if this is the second hit
                  if (settings.sniper_state.hit_count >= 2) {
                    // Set a flag to show the special message after the win/lose message
                    settings.sniper_hit_twice = true;
                    logging.info(`SNIPER: Second hit recorded, will show message after win/lose notification`);
                    
                    // STOP THE BOT IMMEDIATELY when sniper hits 2 times
                    settings.running = false;
                    delete userWaitingForResult[userId];
                    delete userShouldSkipNext[userId];
                    delete userSLSkipWaitingForWin[userId];
                  } else {
                    // First hit - set a flag to show 1/2 message after the win/lose message
                    settings.sniper_hit_once = true;
                    logging.info(`SNIPER: First hit recorded (${settings.sniper_state.hit_count}/2)`);
                  }
                  
                  // Reset the sniper state but keep the hit count
                  const hitCount = settings.sniper_state.hit_count;
                  settings.sniper_state.active = false;
                  settings.sniper_state.direction = null;
                  settings.sniper_state.current_index = 0;
                  settings.sniper_state.bet_sequence = [];
                  settings.sniper_state.got_same_result = false;
                  settings.sniper_state.hit_count = hitCount;
                } else {
                  // Loss: increment the current_index
                  settings.sniper_state.current_index++;
                  
                  // Check if we've reached the max bets (4)
                  if (settings.sniper_state.current_index >= 4) {
                    // Reached max bets, stop the bot
                    settings.running = false;
                    // Set a flag to show the special message
                    settings.sniper_max_reached = true;
                    logging.info(`SNIPER: Reached max bets without win, stopping bot`);
                  }
                  
                  // Check if we got the same number again
                  const lastNumber = userLastNumbers[userId] && userLastNumbers[userId].length > 1 
                    ? userLastNumbers[userId][userLastNumbers[userId].length - 2] 
                    : null;
                  
                  const currentNumber = userLastNumbers[userId] && userLastNumbers[userId].length > 0 
                    ? userLastNumbers[userId][userLastNumbers[userId].length - 1] 
                    : null;
                  
                  // If we got the same number again (0 after 0 or 9 after 9) on the first bet
                  if (lastNumber === currentNumber && settings.sniper_state.current_index === 1) {
                    settings.sniper_state.got_same_result = true;
                    
                    if (currentNumber === "0") {
                      // Got 0 again, update sequence: B -> S -> B -> B
                      settings.sniper_state.bet_sequence = ["B", "S", "B", "B"];
                      logging.info(`SNIPER: Got 0 again, sequence: B -> S -> B -> B`);
                    } else if (currentNumber === "9") {
                      // Got 9 again, update sequence: S -> B -> S -> S
                      settings.sniper_state.bet_sequence = ["S", "B", "S", "S"];
                      logging.info(`SNIPER: Got 9 again, sequence: S -> B -> S -> S`);
                    }
                  } else if (!settings.sniper_state.got_same_result) {
                    // If we didn't get the same result, continue with the original pattern
                    if (settings.sniper_state.direction === "B") {
                      // Original was Big (after 0)
                      if (settings.sniper_state.current_index === 2) {
                        settings.sniper_state.bet_sequence.push("B");
                      } else if (settings.sniper_state.current_index === 3) {
                        settings.sniper_state.bet_sequence.push("B");
                      }
                    } else {
                      // Original was Small (after 9)
                      if (settings.sniper_state.current_index === 2) {
                        settings.sniper_state.bet_sequence.push("S");
                      } else if (settings.sniper_state.current_index === 3) {
                        settings.sniper_state.bet_sequence.push("S");
                      }
                    }
                  }
                }
              }
              
              // Update Babio strategy state
              if (settings.strategy === "BABIO" && settings.babio_state) {
                if (!isWin) {
                  settings.babio_state.current_position = settings.babio_state.current_position === 8 ? 5 : 8;
                }
              }
              
              // SL skip win logic - skip for Leslay strategy
              if (!isLeslayStrategy && userSLSkipWaitingForWin[userId] && isWin) {
                // Reset SL state and continue with normal betting
                userShouldSkipNext[userId] = false;
                settings.skip_betting = false;
                settings.consecutive_losses = 0;
                delete userSLSkipWaitingForWin[userId];
                
                // Restore original betting strategy state
                const bettingStrategy = settings.betting_strategy || "Martingale";
                if (bettingStrategy === "Martingale" || bettingStrategy === "Anti-Martingale") {
                  settings.martin_index = settings.original_martin_index || 0;
                } else if (bettingStrategy === "D'Alembert") {
                  settings.dalembert_units = settings.original_dalembert_units || 1;
                } else if (bettingStrategy === "Custom") {
                  settings.custom_index = settings.original_custom_index || 0;
                }
                
                logging.info(`SL Layer: Skip win achieved! Resetting SL state and continuing with normal betting for user ${userId}`);
              }
              
              const currentBalance = isVirtual 
                ? userStats[userId].virtual_balance 
                : await getBalance(session, parseInt(userId));
              const totalProfit = isVirtual 
                ? (userStats[userId].virtual_balance - (userStats[userId].initial_balance || 0))
                : (userStats[userId]?.profit || 0);
              
              const entryLayer = settings.layer_limit || 1;
              
              // Format result as requested: 🎯Result: 7 => Big
              const resultText = `🎯 Result: ${number} => ${bigSmall === 'B' ? 'Big' : 'Small'}`;
              
              // Format ID based on game type
              const gameId = `🆔 ${gameType} : ${period}`;
              
              // Entry Layer logic for skipped bets - skip for Leslay strategy
              if (!isLeslayStrategy) {
                if (entryLayer === 1) {
                  if (!settings.entry_layer_state) {
                    settings.entry_layer_state = { waiting_for_lose: true };
                  }
                  
                  if (isWin) {
                    // Win - reset to wait for 1 lose
                    settings.entry_layer_state.waiting_for_lose = true;
                    
                    const winMessage = 
                      `✅ WIN +0.00 Ks\n` +
                      `--------------------------\n`+
                      `${gameId}\n` +
                      `${resultText}\n` +
                      `💳 Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                      `📊 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks`;
                    
                    try {
                      await bot.telegram.sendMessage(userId, winMessage);
                    } catch (error) {
                      logging.error(`Failed to send virtual win message to ${userId}: ${error.message}`);
                    }
                  } else {
                    // Lose - if we were waiting for a lose, now we can bet
                    if (settings.entry_layer_state.waiting_for_lose) {
                      settings.entry_layer_state.waiting_for_lose = false;
                    }
                    
                    const loseMessage = 
                      `❌ LOSE -0 Ks\n` +
                      `--------------------------\n`+
                      `${gameId}\n` +
                      `${resultText}\n` +
                      `💳 Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                      `📊 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks`;
                    
                    try {
                      await bot.telegram.sendMessage(userId, loseMessage);
                    } catch (error) {
                      logging.error(`Failed to send virtual lose message to ${userId}: ${error.message}`);
                    }
                  }
                } else if (entryLayer === 2) {
                  if (!settings.entry_layer_state) {
                    settings.entry_layer_state = { waiting_for_lose: true };
                  }
                  
                  if (isWin) {
                    // Win - reset to wait for 1 lose
                    settings.entry_layer_state.waiting_for_lose = true;
                    
                    const winMessage = 
                      `✅ WIN +0.00 Ks\n` +
                      `--------------------------\n`+
                      `${gameId}\n` +
                      `${resultText}\n` +
                      `💳 Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                      `📊 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks`;
                    
                    try {
                      await bot.telegram.sendMessage(userId, winMessage);
                    } catch (error) {
                      logging.error(`Failed to send virtual win message to ${userId}: ${error.message}`);
                    }
                  } else {
                    // Lose - if we were waiting for a lose, now we can bet
                    if (settings.entry_layer_state.waiting_for_lose) {
                      settings.entry_layer_state.waiting_for_lose = false;
                    }
                    
                    const loseMessage = 
                      `❌ LOSE -0 Ks\n` +
                      `--------------------------\n`+
                      `${gameId}\n` +
                      `${resultText}\n` +
                      `💳 Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                      `📊 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks`;
                    
                    try {
                      await bot.telegram.sendMessage(userId, loseMessage);
                    } catch (error) {
                      logging.error(`Failed to send virtual lose message to ${userId}: ${error.message}`);
                    }
                  }
                } else if (entryLayer === 3) {
                  if (!settings.entry_layer_state) {
                    settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
                  }
                  
                  if (isWin) {
                    // Win - reset to wait for 2 consecutive loses
                    settings.entry_layer_state.waiting_for_loses = true;
                    settings.entry_layer_state.consecutive_loses = 0;
                    
                    const winMessage = 
                      `✅ WIN +0.00 Ks\n` +
                      `--------------------------\n`+
                      `${gameId}\n` +
                      `${resultText}\n` +
                      `💳 Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                      `📊 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks`;
                    
                    try {
                      await bot.telegram.sendMessage(userId, winMessage);
                    } catch (error) {
                      logging.error(`Failed to send virtual win message to ${userId}: ${error.message}`);
                    }
                  } else {
                    // Lose - increment consecutive loses counter
                    settings.entry_layer_state.consecutive_loses++;
                    
                    if (settings.entry_layer_state.consecutive_loses >= 2) {
                      // If we have 2 consecutive loses, we can now bet
                      settings.entry_layer_state.waiting_for_loses = false;
                      
                      const loseMessage = 
                        `❌ LOSE -0 Ks\n` +
                        `--------------------------\n`+
                        `${gameId}\n` +
                        `${resultText}\n` +
                        `💳 Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                        `📊 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks`;
                      
                      try {
                        await bot.telegram.sendMessage(userId, loseMessage);
                      } catch (error) {
                        logging.error(`Failed to send virtual lose message to ${userId}: ${error.message}`);
                      }
                    } else {
                      const loseMessage = 
                        `❌ LOSE -0 Ks\n` +
                        `--------------------------\n`+
                        `${gameId}\n` +
                        `${resultText}\n` +
                        `⏳ Waiting for ${2 - settings.entry_layer_state.consecutive_loses} more lose(s)\n\n` +
                        `💳 Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                        `📊 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks`;
                      
                      try {
                        await bot.telegram.sendMessage(userId, loseMessage);
                      } catch (error) {
                        logging.error(`Failed to send virtual lose message to ${userId}: ${error.message}`);
                      }
                    }
                  }
                } else {
                  // Add BS/SB wait status for TREND_FOLLOW strategy
                  let bsWaitStatus = "";
                  if (settings.strategy === "TREND_FOLLOW" && settings.trend_state && settings.trend_state.skip_mode) {
                    bsWaitStatus = isWin ? "\n🔄 BS/SB Wait: Win detected, resuming normal betting" : "\n🔄 BS/SB Wait: Continue skipping until win";
                  }
                  
                  // Add BB/SS wait status for ALTERNATE strategy
                  let bbWaitStatus = "";
                  if (settings.strategy === "ALTERNATE" && settings.alternate_state && settings.alternate_state.skip_mode) {
                    bbWaitStatus = isWin ? "\n🔄 BB/SS Wait: Win detected, resuming normal betting" : "\n🔄 BB/SS Wait: Continue skipping until win";
                  }
                  
                  // Add SNIPER status
                  let sniperStatus = "";
                  if (isLeslayStrategy && settings.sniper_state && settings.sniper_state.active) {
                    sniperStatus = isWin ? "\n🎯 SNIPER: Win detected, resetting state" : "\n🎯 SNIPER: Loss, continuing sequence";
                  }
                  
                  // Add BEATRIX status
                  let beatrixStatus = "";
                  if (settings.strategy === "BEATRIX" && settings.beatrix_state) {
                    beatrixStatus = number === 7 ? "\n👑 BEATRIX: Found 7, ready to bet" : "\n👑 BEATRIX: Waiting for 7";
                  }
                  
                  const resultMessage = isWin ? 
                    `✅ WIN +0.00 Ks\n` +
                    `--------------------------\n`+
                    `${gameId}\n` +
                    `${resultText}\n` +
                    `💳 Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                    `📊 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks${bsWaitStatus}${bbWaitStatus}${sniperStatus}${beatrixStatus}` :
                    `❌ LOSE -0 Ks\n` +
                    `--------------------------\n`+
                    `${gameId}\n` +
                    `${resultText}\n` +
                    `💳 Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                    `📊 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks${bsWaitStatus}${bbWaitStatus}${sniperStatus}${beatrixStatus}`;
                  
                  try {
                    await bot.telegram.sendMessage(userId, resultMessage);
                  } catch (error) {
                    logging.error(`Failed to send virtual result to ${userId}: ${error.message}`);
                  }
                }
              } else {
                // For Leslay strategy, use a simpler message
                let sniperStatus = "";
                if (settings.sniper_state && settings.sniper_state.active) {
                  sniperStatus = isWin ? "\n🎯 SNIPER: Win detected, resetting state" : "\n🎯 SNIPER: Loss, continuing sequence";
                }
                
                // Add BEATRIX status for Leslay
                let beatrixStatus = "";
                if (settings.strategy === "BEATRIX" && settings.beatrix_state) {
                  beatrixStatus = number === 7 ? "\n👑 BEATRIX: Found 7, ready to bet" : "\n👑 BEATRIX: Waiting for 7";
                }
                
                const resultMessage = isWin ? 
                  `✅ WIN +0.00 Ks\n` +
                  `--------------------------\n`+
                  `${gameId}\n` +
                  `${resultText}\n` +
                  `💳 Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                  `📊 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks${sniperStatus}${beatrixStatus}` :
                  `❌ LOSE -0 Ks\n` +
                  `--------------------------\n`+
                  `${gameId}\n` +
                  `${resultText}\n` +
                  `💳 Balance: ${currentBalance?.toFixed(2) || '0.00'} Ks\n` +
                  `📊 Total Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Ks${sniperStatus}${beatrixStatus}`;
                
                try {
                  await bot.telegram.sendMessage(userId, resultMessage);
                } catch (error) {
                  logging.error(`Failed to send virtual result to ${userId}: ${error.message}`);
                }
              }
              
              // DO NOT update SL layer for skipped bets
              logging.debug(`Skipped bet result processed - NOT counting towards SL layer: ${isWin ? 'WIN' : 'LOSS'}`);
              
              delete userSkippedBets[userId][period];
              if (Object.keys(userSkippedBets[userId]).length === 0) {
                delete userSkippedBets[userId];
              }
              
              if (userSkipResultWait[userId] === period) {
                delete userSkipResultWait[userId];
              }
            }
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, WIN_LOSE_CHECK_INTERVAL * 1000));
    } catch (error) {
      logging.error(`Win/lose checker error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

// Function to get the appropriate emoji based on bet size index
function getBetIndexEmoji(settings) {
  const bettingStrategy = settings.betting_strategy || "Martingale";
  let betIndex = 0;
  
  if (bettingStrategy === "Martingale" || bettingStrategy === "Anti-Martingale") {
    betIndex = settings.martin_index || 0;
  } else if (bettingStrategy === "Custom") {
    betIndex = settings.custom_index || 0;
  } else if (bettingStrategy === "D'Alembert") {
    // For D'Alembert, use units - 1 as index (0-based)
    betIndex = (settings.dalembert_units || 1) - 1;
  } else if (settings.strategy === "SNIPER" && settings.sniper_state) {
    betIndex = settings.sniper_state.current_index || 0;
  }
  
  return betIndex === 0 ? "🔺" : "🔻";
}

// Betting worker with improved error handling and balance checking (modified for Leslay strategy)
async function bettingWorker(userId, ctx, bot) {
  const settings = userSettings[userId] || {};
  let session = userSessions[userId];
  if (!settings || !session) {
    await sendMessageWithRetry(ctx, "Please login first");
    settings.running = false;
    return;
  }
  
  // Initialize user stats if not exists
  if (!userStats[userId]) {
    if (settings.virtual_mode) {
      // Use the user's virtual balance instead of a default value
      userStats[userId] = { 
        virtual_balance: settings.virtual_balance || 0,
        initial_balance: settings.virtual_balance || 0  // Store initial balance
      };
    } else {
      userStats[userId] = { start_balance: 0.0, profit: 0.0 };
    }
  }
  
  settings.running = true;
  settings.last_issue = null;
  settings.consecutive_errors = 0;
  settings.consecutive_losses = 0;
  settings.current_layer = 0;
  settings.skip_betting = false;
  
  // Initialize original indices if not set
  if (settings.original_martin_index === undefined) {
    settings.original_martin_index = 0;
  }
  if (settings.original_dalembert_units === undefined) {
    settings.original_dalembert_units = 1;
  }
  if (settings.original_custom_index === undefined) {
    settings.original_custom_index = 0;
  }
  
  userShouldSkipNext[userId] = false;
  delete userSLSkipWaitingForWin[userId];
  
  // Initialize entry layer state - skip for Leslay strategy
  const isLeslayStrategy = settings.strategy === "SNIPER";
  const entryLayer = settings.layer_limit || 1;
  
  if (!isLeslayStrategy) {
    if (entryLayer === 2) {
      settings.entry_layer_state = { waiting_for_lose: true };
    } else if (entryLayer === 3) {
      settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
    }
  }
  
  // Initialize DREAM strategy state if using DREAM strategy
  if (settings.strategy === "DREAM") {
    settings.dream_state = {
      first_bet: true,
      current_pattern: "",
      current_index: 0
    };
  }
  
  // Initialize Babio strategy state if using Babio strategy
  if (settings.strategy === "BABIO") {
    settings.babio_state = {
      current_position: 8,
      last_result: null
    };
  }
  
  // Initialize LEO strategy state if using LEO strategy
  if (settings.strategy === "LEO") {
    settings.leo_state = {
      last_result: null,
      pattern_index: 0
    };
    logging.info(`LEO strategy initialized for user ${userId}`);
  }
  
  // Initialize TREND_FOLLOW strategy state if using TREND_FOLLOW strategy
  if (settings.strategy === "TREND_FOLLOW") {
    settings.trend_state = {
      last_result: null,
      skip_mode: false
    };
    logging.info(`TREND_FOLLOW strategy initialized for user ${userId}`);
  }
  
  // Initialize ALTERNATE strategy state if using ALTERNATE
  if (settings.strategy === "ALTERNATE") {
    settings.alternate_state = {
      last_result: null,
      skip_mode: false
    };
    logging.info(`ALTERNATE strategy initialized for user ${userId}`);
  }
  
  // Initialize SNIPER strategy state if using SNIPER strategy
  if (isLeslayStrategy) {
    // Reset sniper state when starting the bot
    settings.sniper_state = {
      active: false,
      direction: null,
      current_index: 0,
      hit_count: 0,  // Initialize hit count
      bet_sequence: [],
      got_same_result: false
    };
    // Clear last numbers to ensure fresh start
    userLastNumbers[userId] = [];
    logging.info(`SNIPER strategy reset for user ${userId}`);
  }
  
  // Initialize BEATRIX strategy state if using BEATRIX strategy
  if (settings.strategy === "BEATRIX") {
    settings.beatrix_state = {
      waiting_for_seven: true,
      last_period_with_seven: null
    };
    logging.info(`BEATRIX strategy initialized for user ${userId}`);
  }
  
  // Initialize AI strategy data
  if (settings.strategy === "AI_PREDICTION") {
    userAILast10Results[userId] = [];
    userAIRoundCount[userId] = 0;
    logging.info(`AI strategy initialized for user ${userId}`);
  }
  
  // Initialize Babio strategy data
  if (settings.strategy === "BABIO") {
    userAILast10Results[userId] = [];
    userAIRoundCount[userId] = 0;
    logging.info(`Babio strategy initialized for user ${userId}`);
  }
  
  // Initialize Lyzo strategy data
  if (settings.strategy === "LYZO") {
    userLast10Results[userId] = [];
    userLyzoRoundCount[userId] = 0;
    logging.info(`Lyzo strategy initialized for user ${userId}`);
  }
  
  // Initialize userLastNumbers for SNIPER strategy
  if (!userLastNumbers[userId]) {
    userLastNumbers[userId] = [];
  }
  
  let currentBalance = null;
  if (settings.virtual_mode) {
    currentBalance = userStats[userId].virtual_balance || settings.virtual_balance || 0;
  } else {
    let balanceRetrieved = false;
    for (let attempt = 0; attempt < MAX_BALANCE_RETRIES; attempt++) {
      try {
        const balanceResult = await getBalance(session, parseInt(userId));
        if (balanceResult !== null) {
          currentBalance = balanceResult;
          userStats[userId].start_balance = currentBalance;
          balanceRetrieved = true;
          break;
        }
      } catch (error) {
        logging.error(`Balance check attempt ${attempt + 1} failed: ${error.message}`);
      }
      
      if (attempt < MAX_BALANCE_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, BALANCE_RETRY_DELAY * 1000));
      }
    }
    
    if (!balanceRetrieved) {
      await sendMessageWithRetry(ctx, "❌ Failed to check balance after multiple attempts. Please check your connection or try again.", makeMainKeyboard(true));
      settings.running = false;
      return;
    }
  }
  
  // Format strategy names for display
  let strategyText = settings.strategy === "AI_PREDICTION" ? "AI Prediction" :
                     settings.strategy === "LYZO" ? "Lyzo" :
                     settings.strategy === "DREAM" ? "Dream" :
                     settings.strategy === "BABIO" ? "Babio" :
                     settings.strategy === "BS_ORDER" ? "BS Order" :
                     settings.strategy === "LEO" ? "Leo" :
                     settings.strategy === "TREND_FOLLOW" ? "Trend Follow" :
                     settings.strategy === "ALTERNATE" ? "Alternate" :
                     settings.strategy === "SNIPER" ? "Leslay" :
                     settings.strategy === "ALINKAR" ? "Alinkar" :
                     settings.strategy === "MAY_BARANI" ? "May Barani" :
                     settings.strategy === "BEATRIX" ? "Beatrix" : settings.strategy;

  // Add BS/SB Wait information for TREND_FOLLOW strategy
  if (settings.strategy === "TREND_FOLLOW") {
    const bsWaitCount = settings.bs_sb_wait_count || 0;
    if (bsWaitCount > 0) {
      strategyText += ` (BS/SB Wait: ${bsWaitCount})`;
    }
  }
  
  // Add BB/SS Wait information for ALTERNATE strategy
  if (settings.strategy === "ALTERNATE") {
    const bbWaitCount = settings.bb_ss_wait_count || 0;
    if (bbWaitCount > 0) {
      strategyText += ` (BB/SS Wait: ${bbWaitCount})`;
    }
  }

  const bettingStrategyText = settings.betting_strategy === "Martingale" ? "Martingale" :
                            settings.betting_strategy === "Anti-Martingale" ? "Anti-Martingale" :
                            settings.betting_strategy === "D'Alembert" ? "D'Alembert" :
                            settings.betting_strategy === "Custom" ? "Custom" : settings.betting_strategy;

  const profitTargetText = settings.target_profit ? `${settings.target_profit} Ks` : "Not Set";
  const stopLossText = settings.stop_loss ? `${settings.stop_loss} Ks` : "Not Set";
  const gameType = settings.game_type || "TRX"; // Get game type from settings

  // Show initial bot information
  const startMessage = 
    `👾 BOT STARTED\n\n` +
    `💳 Balance: ${currentBalance} Ks\n\n` +
    `🎲 Game Type: ${gameType}\n` +
    `📚 Strategy: ${strategyText}\n` +
    `🕹 Betting Strategy: ${bettingStrategyText}\n\n` +
    `🏹 Profit Target: ${isLeslayStrategy ? "Disabled (Leslay Strategy)" : profitTargetText}\n` +
    `🔻 Stop Loss Limit: ${stopLossText}`;

  await sendMessageWithRetry(ctx, startMessage);
  
  try {
    while (settings.running) {
      if (userWaitingForResult[userId]) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      if (userSkipResultWait[userId]) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      // Update current balance with better error handling
      if (settings.virtual_mode) {
        currentBalance = userStats[userId].virtual_balance || settings.virtual_balance || 0;
      } else {
        try {
          const balanceResult = await getBalance(session, parseInt(userId));
          if (balanceResult !== null) {
            currentBalance = balanceResult;
          } else {
            logging.warning(`Balance check returned null for user ${userId}, using previous value`);
          }
        } catch (error) {
          logging.error(`Balance check failed: ${error.message}`);
          if (currentBalance === null) {
            currentBalance = userStats[userId].start_balance || 0;
            logging.warning(`Using default balance value: ${currentBalance}`);
          }
        }
      }
      
      // Add null check for currentBalance
      if (currentBalance === null) {
        logging.error(`Current balance is null for user ${userId}, attempting to recover`);
        let recovered = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const balanceResult = await getBalance(session, parseInt(userId));
            if (balanceResult !== null) {
              currentBalance = balanceResult;
              recovered = true;
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (error) {
            logging.error(`Balance recovery attempt ${attempt + 1} failed: ${error.message}`);
          }
        }
        
        if (!recovered) {
          await sendMessageWithRetry(ctx, "❌ Failed to recover balance. Stopping bot to prevent errors.", makeMainKeyboard(true));
          settings.running = false;
          break;
        }
      }
      
      const betSizes = settings.bet_sizes || [];
      if (!betSizes.length) {
        await sendMessageWithRetry(ctx, "Bet sizes not set. Please set BET SIZE first.");
        settings.running = false;
        break;
      }
      
      const minBetSize = Math.min(...betSizes);
      if (currentBalance < minBetSize) {
        const message = `❌ Insufficient balance!\n` +
                        `Current Balance: ${currentBalance.toFixed(2)} Ks\n` +
                        `Minimum Bet Required: ${minBetSize} Ks\n` +
                        `Please add funds to continue betting.`;
        await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
        settings.running = false;
        break;
      }
      
      // Balance warning check
      const balanceWarningThreshold = minBetSize * 3;
      const now = Date.now();
      const lastWarning = userBalanceWarnings[userId] || 0;
      
      if (currentBalance < balanceWarningThreshold && currentBalance >= minBetSize && (now - lastWarning > 60000)) {
        const warningMessage = `⚠️ Balance Warning!\n` +
                              `Current Balance: ${currentBalance.toFixed(2)} Ks\n` +
                              `Minimum Bet: ${minBetSize} Ks\n` +
                              `Consider adding funds soon to avoid interruption.`;
        await sendMessageWithRetry(ctx, warningMessage);
        userBalanceWarnings[userId] = now;
      }
      
      // Get current issue
      let issueRes;
      try {
        issueRes = await getGameIssueRequest(session, gameType);
        if (!issueRes || issueRes.code !== 0) {
          settings.consecutive_errors++;
          if (settings.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
            await sendMessageWithRetry(ctx, `Too many consecutive errors (${MAX_CONSECUTIVE_ERRORS}). Stopping bot`);
            settings.running = false;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      } catch (error) {
        logging.error(`Error getting issue: ${error.message}`);
        settings.consecutive_errors++;
        if (settings.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
          await sendMessageWithRetry(ctx, `Too many consecutive errors (${MAX_CONSECUTIVE_ERRORS}). Stopping bot`);
          settings.running = false;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      // Reset consecutive errors on successful request
      settings.consecutive_errors = 0;
      
      // Get current issue number
      let currentIssue;
      const data = issueRes.data || {};
      
      if (gameType === "TRX") {
        currentIssue = data.predraw?.issueNumber;
      } else if (gameType === "WINGO_30S") {
        currentIssue = data.issueNumber; // Wingo 30s uses the same field as WINGO 1min
      } else {
        currentIssue = data.issueNumber; // Default WINGO 1min
      }
      
      if (!currentIssue || currentIssue === settings.last_issue) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      // Determine bet choice (B/S)
      let ch;
      let shouldSkip = false;
      let skipReason = "";
      
      if (isLeslayStrategy) {
        if (!settings.sniper_state) {
          settings.sniper_state = {
            active: false,
            direction: null,
            current_index: 0,
            hit_count: 0,  // Initialize hit count
            bet_sequence: [],
            got_same_result: false
          };
        }
        
        const sniperState = settings.sniper_state;
        const lastNumbers = userLastNumbers[userId] || [];
        const lastNumber = lastNumbers.length > 0 ? lastNumbers[lastNumbers.length - 1] : null;
        
        // If we are not in an active betting state, check if the last result is 0 or 9
        if (!sniperState.active && lastNumber) {
          if (lastNumber === "0") {
            sniperState.active = true;
            sniperState.direction = "B"; // First bet is Big
            sniperState.current_index = 0;
            sniperState.bet_sequence = ["B"]; // Start with Big
            sniperState.got_same_result = false;
            logging.info(`SNIPER: Found 0, starting to bet BIG`);
          } else if (lastNumber === "9") {
            sniperState.active = true;
            sniperState.direction = "S"; // First bet is Small
            sniperState.current_index = 0;
            sniperState.bet_sequence = ["S"]; // Start with Small
            sniperState.got_same_result = false;
            logging.info(`SNIPER: Found 9, starting to bet SMALL`);
          }
        }
        
        // If we are in an active betting state, determine the bet choice
        if (sniperState.active) {
          if (sniperState.current_index < sniperState.bet_sequence.length) {
            ch = sniperState.bet_sequence[sniperState.current_index];
          } else {
            // Use the default direction for additional bets
            ch = sniperState.direction;
          }
          
          // All bets are normal bets (no skip bets)
          shouldSkip = false;
        } else {
          // If not active, skip the bet until we get 0 or 9
          shouldSkip = true;
          skipReason = "(SNIPER: Wait and Get Ready for Snipe)";
          // Use a default value for ch (for recording)
          ch = "B";
        }
      } else if (settings.strategy === "BEATRIX") {
        const prediction = await getBeatrixPrediction(userId, gameType);
        if (prediction.skip) {
          shouldSkip = true;
          skipReason = "(BEATRIX: Waiting for result 7)";
          ch = 'B'; // Default value for recording
        } else {
          ch = prediction.result;
        }
      } else if (settings.strategy === "BABIO") {
        const prediction = await getBabioPrediction(userId, gameType);
        if (prediction) {
          ch = prediction.result;
        } else {
          ch = 'B'; // Default to B instead of random
          logging.warning("Babio prediction failed, using default B");
        }
      } else if (settings.strategy === "ALINKAR") {
        ch = getAlinkarPrediction(userId);
        logging.info(`ALINKAR strategy: Prediction is ${ch}`);
      } else if (settings.strategy === "MAY_BARANI") {
        ch = await getMayBaraniPrediction(userId);
        logging.info(`MAY BARANI strategy: Prediction is ${ch}`);
      } else if (settings.strategy === "TREND_FOLLOW") {
        if (!settings.trend_state) {
          settings.trend_state = {
            last_result: null,
            skip_mode: false
          };
        }
        
        // Check if we need to wait for a BS/SB pattern
        const bsWaitCount = settings.bs_sb_wait_count || 0;
        if (bsWaitCount > 0) {
          const requiredResults = 2 * bsWaitCount;
          const results = userAllResults[userId] || [];
          
          if (results.length >= requiredResults) {
            const lastResults = results.slice(-requiredResults);
            const patternBS = 'BS'.repeat(bsWaitCount);
            const patternSB = 'SB'.repeat(bsWaitCount);
            const actualPattern = lastResults.join('');
            
            // Check if the pattern is found
            if (actualPattern === patternBS || actualPattern === patternSB) {
              // Pattern found - we should skip the next bet
              shouldSkip = true;
              settings.trend_state.skip_mode = true;
              logging.info(`TREND_FOLLOW strategy: Pattern ${actualPattern} found. Skipping next bet.`);
            } else {
              // Pattern not found - continue normal betting
              shouldSkip = false;
              settings.trend_state.skip_mode = false;
            }
          } else {
            // Not enough results yet - continue normal betting
            shouldSkip = false;
            settings.trend_state.skip_mode = false;
          }
        }
        
        if (settings.trend_state.skip_mode) {
          // We're in skip mode - skip the bet
          shouldSkip = true;
          skipReason = "(BS/SB Wait)";
          // Use the last result for the bet choice (for recording)
          if (settings.trend_state.last_result !== null) {
            ch = settings.trend_state.last_result;
          } else {
            ch = 'B'; // Default to B instead of random
          }
          logging.info(`TREND_FOLLOW strategy: Using ${ch} for recording (skip mode).`);
        } else {
          // Normal betting mode
          if (settings.trend_state.last_result === null) {
            // First bet is default B
            ch = 'B';
            logging.info(`TREND_FOLLOW strategy: First bet is default: ${ch}`);
          } else {
            // Bet follows the last result
            ch = settings.trend_state.last_result;
            logging.info(`TREND_FOLLOW strategy: Following last result: ${ch}`);
          }
        }
      } else if (settings.strategy === "ALTERNATE") {
        if (!settings.alternate_state) {
          settings.alternate_state = {
            last_result: null,
            skip_mode: false
          };
        }
        
        // Check if we need to wait for a BB/SS pattern
        const bbWaitCount = settings.bb_ss_wait_count || 0;
        if (bbWaitCount > 0) {
          const requiredResults = 2 * bbWaitCount;
          const results = userAllResults[userId] || [];
          
          if (results.length >= requiredResults) {
            const lastResults = results.slice(-requiredResults);
            const patternBB = 'BB'.repeat(bbWaitCount);
            const patternSS = 'SS'.repeat(bbWaitCount);
            const actualPattern = lastResults.join('');
            
            // Check if the pattern is found
            if (actualPattern === patternBB || actualPattern === patternSS) {
              // Pattern found - we should skip the next bet
              shouldSkip = true;
              settings.alternate_state.skip_mode = true;
              logging.info(`ALTERNATE strategy: Pattern ${actualPattern} found. Skipping next bet.`);
            } else {
              // Pattern not found - continue normal betting
              shouldSkip = false;
              settings.alternate_state.skip_mode = false;
            }
          } else {
            // Not enough results yet - continue normal betting
            shouldSkip = false;
            settings.alternate_state.skip_mode = false;
          }
        }
        
        if (settings.alternate_state.skip_mode) {
          // We're in skip mode - skip the bet
          shouldSkip = true;
          skipReason = "(BB/SS Wait)";
          // Use the ALTERNATE strategy (opposite of last result) for the bet choice
          if (settings.alternate_state.last_result === null) {
            ch = 'B'; // Default to B
          } else {
            // Bet opposite to the last result (ALTERNATE strategy)
            ch = settings.alternate_state.last_result === 'B' ? 'S' : 'B';
          }
          logging.info(`ALTERNATE strategy: Using ${ch} for recording (skip mode) - opposite of last result ${settings.alternate_state.last_result}`);
        } else {
          // Normal betting mode - ALTERNATE (opposite of last result)
          if (settings.alternate_state.last_result === null) {
            // First bet is default B
            ch = 'B';
            logging.info(`ALTERNATE strategy: First bet is default: ${ch}`);
          } else {
            // Bet opposite to the last result
            ch = settings.alternate_state.last_result === 'B' ? 'S' : 'B';
            logging.info(`ALTERNATE strategy: Last result was ${settings.alternate_state.last_result}, betting opposite: ${ch}`);
          }
        }
      } else if (settings.strategy === "AI_PREDICTION") {
        const prediction = await getAIPrediction(userId, gameType);
        if (prediction) {
          ch = prediction.result;
        } else {
          ch = 'B'; // Default to B instead of random
          logging.warning("AI prediction failed, using default B");
        }
      } else if (settings.strategy === "LYZO") {
        const prediction = await getLyzoPrediction(userId, gameType);
        if (prediction) {
          ch = prediction.result;
        } else {
          ch = 'B'; // Default to B instead of random
          logging.warning("Lyzo prediction failed, using default B");
        }
      } else if (settings.strategy === "DREAM") {
        if (!settings.dream_state) {
          settings.dream_state = {
            first_bet: true,
            current_pattern: "",
            current_index: 0
          };
        }
        
        const dreamState = settings.dream_state;
        
        if (dreamState.first_bet) {
          ch = 'B'; // Default to B instead of random
          logging.info(`DREAM strategy: First bet is default: ${ch}`);
        } else if (dreamState.current_pattern && dreamState.current_index < dreamState.current_pattern.length) {
          ch = dreamState.current_pattern[dreamState.current_index];
          logging.info(`DREAM strategy: Using pattern ${dreamState.current_pattern} at index ${dreamState.current_index}: ${ch}`);
        } else {
          ch = 'B'; // Default to B instead of random
          logging.warning("DREAM strategy pattern invalid, using default B");
        }
      } else if (settings.strategy === "DREAM2") {
        const patternIndex = settings.pattern_index || 0;
        ch = DREAM2_PATTERN[patternIndex % DREAM2_PATTERN.length];
        logging.info(`DREAM 2 strategy: Using pattern ${DREAM2_PATTERN} at index ${patternIndex}: ${ch}`);
      } else if (settings.strategy === "BS_ORDER") {
        if (!settings.pattern) {
          settings.pattern = DEFAULT_BS_ORDER;
          settings.pattern_index = 0;
          await sendMessageWithRetry(ctx, `No BS order provided. Using default: ${DEFAULT_BS_ORDER}`, makeMainKeyboard(true));
        }
        
        const pattern = settings.pattern;
        const patternIndex = settings.pattern_index || 0;
        ch = pattern[patternIndex % pattern.length];
      } else if (settings.strategy === "LEO") {
        if (!settings.leo_state) {
          settings.leo_state = {
            last_result: null,
            pattern_index: 0
          };
        }
        
        if (settings.leo_state.last_result === null) {
          // First bet is default B
          ch = 'B';
          logging.info(`LEO strategy: First bet is default: ${ch}`);
        } else {
          // Use pattern based on last result
          const pattern = settings.leo_state.last_result === 'B' ? LEO_BIG_PATTERN : LEO_SMALL_PATTERN;
          ch = pattern[settings.leo_state.pattern_index % pattern.length];
          logging.info(`LEO strategy: Using ${settings.leo_state.last_result === 'B' ? 'BIG' : 'SMALL'} pattern at index ${settings.leo_state.pattern_index}: ${ch}`);
        }
      } else {
        // Default to B instead of AI prediction
        ch = 'B';
        logging.info(`Using default B prediction`);
      }
      
      const selectType = getSelectMap(gameType)[ch];
      
      if (selectType === undefined) {
        settings.consecutive_errors++;
        if (settings.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
          await sendMessageWithRetry(ctx, `Too many consecutive errors (${MAX_CONSECUTIVE_ERRORS}). Stopping bot`);
          settings.running = false;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      // Then check entry layer and SL layer - skip for Leslay strategy
      if (!isLeslayStrategy) {
        if (entryLayer === 1) {
          if (!shouldSkip) {
            shouldSkip = userShouldSkipNext[userId] || false;
            if (shouldSkip) {
              skipReason = "(SL Layer Skip)";
            }
          }
        } else if (entryLayer === 2) {
          if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_lose) {
            shouldSkip = true;
            skipReason = "(Entry Layer 2 - Waiting for Lose)";
          } else {
            if (!shouldSkip) {
              shouldSkip = userShouldSkipNext[userId] || false;
              if (shouldSkip) {
                skipReason = "(SL Layer Skip)";
              }
            }
          }
        } else if (entryLayer === 3) {
          if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_loses) {
            shouldSkip = true;
            skipReason = `(Entry Layer 3 - Waiting for ${settings.entry_layer_state.consecutive_loses || 0}/2 Loses)`;
          } else {
            if (!shouldSkip) {
              shouldSkip = userShouldSkipNext[userId] || false;
              if (shouldSkip) {
                skipReason = "(SL Layer Skip)";
              }
            }
          }
        }
      }
      
      // Add SL skip waiting status to message
      if (userSLSkipWaitingForWin[userId]) {
        skipReason += "-";
      }
      
      // Get the appropriate emoji based on bet size index
      const betEmoji = getBetIndexEmoji(settings);
      
      // Format ID based on game type
      const gameId = `🆔 ${gameType} : ${currentIssue}`;
      
      if (shouldSkip) {
        // Format Skip Bet message as requested
        let betMsg = `${gameId} (SKIP)\n${betEmoji} Order: ${ch === 'B' ? 'BIG' : 'SMALL'} => 0 Ks\n📚 Strategy: ${strategyText}`;
        
        if (!userSkippedBets[userId]) {
          userSkippedBets[userId] = {};
        }
        userSkippedBets[userId][currentIssue] = [ch, settings.virtual_mode];
        
        userSkipResultWait[userId] = currentIssue;
        
        await sendMessageWithRetry(ctx, betMsg);
        
        // Wait for result
        let resultAvailable = false;
        let waitAttempts = 0;
        const maxWaitAttempts = 60;
        
        while (!resultAvailable && waitAttempts < maxWaitAttempts && settings.running) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          if (!userSkippedBets[userId] || !userSkippedBets[userId][currentIssue]) {
            resultAvailable = true;
          }
          
          waitAttempts++;
        }
        
        if (!resultAvailable) {
          logging.warning(`Result not available for skipped bet ${currentIssue} after ${maxWaitAttempts} seconds`);
          if (userSkipResultWait[userId] === currentIssue) {
            delete userSkipResultWait[userId];
          }
        }
      } else {
        // Calculate bet amount using the new function
        let desiredAmount;
        if (isLeslayStrategy && settings.sniper_state && settings.sniper_state.active) {
          // For SNIPER strategy, use the current bet size based on the index
          const sniperState = settings.sniper_state;
          desiredAmount = settings.bet_sizes[sniperState.current_index];
        } else {
          try {
            desiredAmount = calculateBetAmount(settings, currentBalance);
          } catch (error) {
            await sendMessageWithRetry(ctx, 
              `❌ ${error.message}\n` +
              `Please stop bot and set Bet Size again.`,
              makeMainKeyboard(true)
            );
            settings.running = false;
            break;
          }
        }
        
        // Compute actual bet details
        const { unitAmount, betCount, actualAmount } = computeBetDetails(desiredAmount);
        
        // Check if actual amount is valid
        if (actualAmount === 0) {
          await sendMessageWithRetry(ctx, 
            `❌ Invalid bet amount: ${desiredAmount} Ks\n` +
            `Minimum bet amount is ${unitAmount} Ks\n` +
            `Please increase your bet size.`,
            makeMainKeyboard(true)
          );
          settings.running = false;
          break;
        }
        
        // Check if balance is sufficient for next bet
        if (currentBalance < actualAmount) {
          const message = `❌ Insufficient balance for next bet!\n` +
                          `Current Balance: ${currentBalance.toFixed(2)} Ks\n` +
                          `Required Bet Amount: ${actualAmount.toFixed(2)} Ks\n` +
                          `Please add funds to continue betting.`;
          await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
          settings.running = false;
          break;
        }
        
        // Format Normal Bet message as requested
        let betMsg = `${gameId}\n${betEmoji} Order: ${ch === 'B' ? 'BIG' : 'SMALL'} => ${actualAmount} Ks\n📚 Strategy: ${strategyText}\n`;
        
        // Add SNIPER status for Leslay strategy
        if (isLeslayStrategy && settings.sniper_state && settings.sniper_state.active) {
          const hitCount = settings.sniper_state.hit_count || 0;
          betMsg += `\n🎯 SNIPER: Bet ${settings.sniper_state.current_index + 1}/4`;
          betMsg += `\n🎯 Hits: ${hitCount}/2`;
          betMsg += `\n📍 Normal Bet: ${ch === 'B' ? 'BIG' : 'SMALL'}`;
        }
        
        // Add BEATRIX status
        if (settings.strategy === "BEATRIX" && settings.beatrix_state) {
          const beatrixState = settings.beatrix_state;
          if (beatrixState.last_period_with_seven) {
            const lastDigit = parseInt(beatrixState.last_period_with_seven.slice(-1));
            betMsg += `\n👑 BEATRIX: Period ${beatrixState.last_period_with_seven} ends with ${lastDigit}`;
          }
        }
        
        await sendMessageWithRetry(ctx, betMsg);
        
        if (settings.virtual_mode) {
          // Virtual mode - simulate bet without placing
          if (!userPendingBets[userId]) {
            userPendingBets[userId] = {};
          }
          userPendingBets[userId][currentIssue] = [ch, actualAmount, true];
          userWaitingForResult[userId] = true;
        } else {
          // Real mode - place actual bet
          const betResp = await placeBetRequest(session, currentIssue, selectType, unitAmount, betCount, gameType, parseInt(userId));
          
          if (betResp.error || betResp.code !== 0) {
            await sendMessageWithRetry(ctx, `Bet error: ${betResp.msg || betResp.error}. ထိုးကြေးပိတ်သွားပါပြီ Retrying...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
          }
          
          if (!userPendingBets[userId]) {
            userPendingBets[userId] = {};
          }
          userPendingBets[userId][currentIssue] = [ch, actualAmount, false];
          userWaitingForResult[userId] = true;
        }
      }
      
      settings.last_issue = currentIssue;
      if (settings.strategy === "DREAM2") {
        settings.pattern_index = (settings.pattern_index + 1) % DREAM2_PATTERN.length;
      } else if (settings.strategy === "BS_ORDER" && settings.pattern) {
        settings.pattern_index = (settings.pattern_index + 1) % settings.pattern.length;
      }
      // Note: LEO pattern index is updated in the win/lose checker based on results
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    logging.error(`Betting worker error for user ${userId}: ${error.message}`);
    await sendMessageWithRetry(ctx, `Betting error: ${error.message}. Stopping...`);
    settings.running = false;
  } finally {
    settings.running = false;
    delete userWaitingForResult[userId];
    delete userShouldSkipNext[userId];
    delete userBalanceWarnings[userId];
    delete userSkipResultWait[userId];
    delete userSLSkipWaitingForWin[userId];
    
    // Clean up AI strategy data
    if (settings.strategy === "AI_PREDICTION") {
      delete userAILast10Results[userId];
      delete userAIRoundCount[userId];
    }
    
    // Clean up Babio strategy data
    if (settings.strategy === "BABIO") {
      delete userAILast10Results[userId];
      delete userAIRoundCount[userId];
      delete settings.babio_state;
    }
    
    // Clean up Lyzo strategy data
    if (settings.strategy === "LYZO") {
      delete userLast10Results[userId];
      delete userLyzoRoundCount[userId];
    }
    
    // Clean up LEO strategy data
    if (settings.strategy === "LEO") {
      delete settings.leo_state;
    }
    
    // Clean up TREND_FOLLOW strategy data
    if (settings.strategy === "TREND_FOLLOW") {
      delete settings.trend_state;
    }
    
    // Clean up ALTERNATE strategy data
    if (settings.strategy === "ALTERNATE") {
      delete settings.alternate_state;
    }
    
    // Clean up SNIPER strategy data
    if (isLeslayStrategy) {
      delete settings.sniper_state;
    }
    
    // Clean up BEATRIX strategy data
    if (settings.strategy === "BEATRIX") {
      delete settings.beatrix_state;
    }
    
    // Calculate profit before resetting stats
    let totalProfit = 0;
    let balanceText = "";
    
    if (settings.virtual_mode) {
      totalProfit = (userStats[userId]?.virtual_balance || 0) - (userStats[userId]?.initial_balance || 0);
      balanceText = `Virtual Balance: ${(userStats[userId]?.virtual_balance || 0).toFixed(2)} Ks\n`;
    } else {
      totalProfit = userStats[userId]?.profit || 0;
      try {
        const finalBalance = await getBalance(session, userId);
        balanceText = `Final Balance: ${finalBalance?.toFixed(2) || '0.00'} Ks\n`;
      } catch (error) {
        logging.error(`Failed to get final balance: ${error.message}`);
        balanceText = "Final Balance: Unknown\n";
      }
    }
    
    // Calculate profit indicator
    let profitIndicator = "";
    if (totalProfit > 0) {
      profitIndicator = "+";
    } else if (totalProfit < 0) {
      profitIndicator = "-";
    }
    
    // Don't reset bet sizes when bot stops
    // RESET profit tracking only when bot stops
    delete userStats[userId];
    settings.martin_index = 0;
    settings.dalembert_units = 1;
    settings.custom_index = 0;
    delete settings.dream_state;
    
    // Check if sniper hit twice occurred and show special message
    if (settings.sniper_hit_twice) {
      await sendMessageWithRetry(ctx, "🎯 SNIPER HIT 2/2! Target acquired successfully! Bot stopped.", makeMainKeyboard(true));
      settings.sniper_hit_twice = false;
    }
    
    // Check if sniper max bets reached and show special message
    if (settings.sniper_max_reached) {
      await sendMessageWithRetry(ctx, "Sorry🙏နောက်တစ်ကြိမ်ကံကောင်းပါစေဗျ", makeMainKeyboard(true));
      settings.sniper_max_reached = false;
    }
    
    // Only send the stopped message if not already sent by user command
    if (!userStopInitiated[userId]) {
      const message = `🛑 BOT STOPPED\n${balanceText}💰 Total Profit: ${profitIndicator}${totalProfit.toFixed(2)} Ks`;
      await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
    }
    
    // Clear the stop initiated flag
    delete userStopInitiated[userId];
    
    // Clean up userAllResults
    delete userAllResults[userId];
  }
}

// Telegram keyboard helpers
function makeMainKeyboard(loggedIn = false) {
  if (!loggedIn) {
    return Markup.keyboard([["🔐 Login"]]).resize().oneTime(false);
  }
  return Markup.keyboard([
    ["👾 Start", "🚧 Stop"],
    ["💎 Bet_Size", "🎮 Virtual/Real Mode"],
    ["🏹 Profit Target", "🔻 Stop Loss Limit"],
    ["📚 Strategy", "🎲 Game Type"], // Added Game Type button
    ["🕹 Anti/Martingale", "💥 Bet_SL"],
    ["⛳ Entry Layer", "📂 Info"],
    ["🔐 Login Again"]  // Added Login Again button
  ]).resize().oneTime(false);
}

function makeStrategyKeyboard(userId = null) {
  // Get game type from user settings if userId is provided
  const gameType = userId && userSettings[userId] ? userSettings[userId].game_type || "TRX" : "TRX";
  
  // Base keyboard with all strategies
  const keyboard = [
    [
      Markup.button.callback("📜 BS-Order", "strategy:BS_ORDER"),
      Markup.button.callback("📈 TREND_FOLLOW", "strategy:TREND_FOLLOW")
    ],
    [
      Markup.button.callback("🔄 AlTERNATE", "strategy:ALTERNATE"),
      Markup.button.callback("🤖 CHAT GPT V1", "strategy:AI_PREDICTION")
    ],
    [
      Markup.button.callback("🔮 LYZO", "strategy:LYZO"),
      Markup.button.callback("💭 DREAM", "strategy:DREAM")
    ],
    [
      Markup.button.callback("🌙 BABIO", "strategy:BABIO"),
      Markup.button.callback("🦁 LEO", "strategy:LEO")
    ],
    [
      Markup.button.callback("🔫LESLAY", "strategy:SNIPER"),
      Markup.button.callback("🚬 ALINKAR", "strategy:ALINKAR")
    ],
    [
      Markup.button.callback("🐰MAY BARANI", "strategy:MAY_BARANI"),
      Markup.button.callback("👑BEATRIX", "strategy:BEATRIX")
    ]
  ];
  
  // If game type is TRX, remove LYZO and BEATRIX
  if (gameType === "TRX") {
    // Remove LYZO (row 2, button 0)
    keyboard[2][0] = Markup.button.callback("🚫 Disabled", "strategy:disabled");
    
    // Remove BEATRIX (row 5, button 1)
    keyboard[5][1] = Markup.button.callback("🚫 Disabled", "strategy:disabled");
  }
  
  return Markup.inlineKeyboard(keyboard);
}

function makeBSWaitCountKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("1", "bs_wait_count:1"), Markup.button.callback("2", "bs_wait_count:2"), Markup.button.callback("3", "bs_wait_count:3")],
    [Markup.button.callback("4", "bs_wait_count:4"), Markup.button.callback("5", "bs_wait_count:5"), Markup.button.callback("6", "bs_wait_count:6")],
    [Markup.button.callback("7", "bs_wait_count:7"), Markup.button.callback("8", "bs_wait_count:8"), Markup.button.callback("9", "bs_wait_count:9")],
    [Markup.button.callback("0 (Disable)", "bs_wait_count:0")]
  ]);
}

function makeBBWaitCountKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("1", "bb_wait_count:1"), Markup.button.callback("2", "bb_wait_count:2"), Markup.button.callback("3", "bb_wait_count:3")],
    [Markup.button.callback("4", "bb_wait_count:4"), Markup.button.callback("5", "bb_wait_count:5"), Markup.button.callback("6", "bb_wait_count:6")],
    [Markup.button.callback("7", "bb_wait_count:7"), Markup.button.callback("8", "bb_wait_count:8"), Markup.button.callback("9", "bb_wait_count:9")],
    [Markup.button.callback("0 (Disable)", "bb_wait_count:0")]
  ]);
}

function makeBettingStrategyKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Anti-Martingale", "betting_strategy:Anti-Martingale")],
    [Markup.button.callback("Martingale", "betting_strategy:Martingale")],
    [Markup.button.callback("D'Alembert", "betting_strategy:D'Alembert")]
  ]);
}

// Add this function to create a game type selection keyboard
function makeGameTypeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("WINGO", "game_type:WINGO_SELECT")],
    [Markup.button.callback("TRX", "game_type:TRX")]
  ]);
}

// Add this function to create WINGO sub-selection keyboard
function makeWINGOSelectionKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("WINGO 1min", "game_type:WINGO")],
    [Markup.button.callback("WINGO 30s", "game_type:WINGO_30S")]
  ]);
}

function makeEntryLayerKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("1 - Direct  For BET", "entry_layer:1")],
    [Markup.button.callback("2 - Wait for 1 Lose", "entry_layer:2")],
    [Markup.button.callback("3 - Wait for 2 Loses", "entry_layer:3")]
  ]);
}

function makeSLLayerKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("0 - Disabled", "sl_layer:0")],
    [Markup.button.callback("1", "sl_layer:1"), Markup.button.callback("2", "sl_layer:2"), Markup.button.callback("3", "sl_layer:3")],
    [Markup.button.callback("4", "sl_layer:4"), Markup.button.callback("5", "sl_layer:5"), Markup.button.callback("6", "sl_layer:6")],
    [Markup.button.callback("7", "sl_layer:7"), Markup.button.callback("8", "sl_layer:8"), Markup.button.callback("9", "sl_layer:9")]
  ]);
}

function makeModeSelectionKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🖥️ Virtual Mode", "mode:virtual")],
    [Markup.button.callback("💵 Real Mode", "mode:real")]
  ]);
}

async function checkUserAuthorized(ctx) {
  const userId = ctx.from.id;
  if (!userSessions[userId]) {
    await sendMessageWithRetry(ctx, "Please login first", makeMainKeyboard(false));
    return false;
  }
  if (!userSettings[userId]) {
    userSettings[userId] = {
      strategy: "AI_PREDICTION",
      betting_strategy: "Martingale",
      game_type: "TRX", // Default to TRX
      martin_index: 0,
      dalembert_units: 1,
      pattern_index: 0,
      running: false,
      consecutive_losses: 0,
      current_layer: 0,
      skip_betting: false,
      sl_layer: null,
      original_martin_index: 0,
      original_dalembert_units: 1,
      original_custom_index: 0,
      custom_index: 0,
      layer_limit: 1,
      virtual_mode: false,
      bs_sb_wait_count: 0,
      bb_ss_wait_count: 0
    };
  }
  return true;
}

// Telegram command handlers
async function cmdStartHandler(ctx) {
  const userId = ctx.from.id;
  const userName = ctx.from.username || ctx.from.first_name || "Unknown";
  
  // Log user activity
  console.log(`[USER_ACTIVITY] User ${userName} (ID: ${userId}) sent /start message`);
  
  // Add user to active users set
  activeUsers.add(userId);
  
  if (!userSettings[userId]) {
    userSettings[userId] = {
      strategy: "AI_PREDICTION",
      betting_strategy: "Martingale",
      game_type: "TRX", // Default to TRX
      martin_index: 0,
      dalembert_units: 1,
      pattern_index: 0,
      running: false,
      consecutive_losses: 0,
      current_layer: 0,
      skip_betting: false,
      sl_layer: null,
      original_martin_index: 0,
      original_dalembert_units: 1,
      original_custom_index: 0,
      custom_index: 0,
      layer_limit: 1,
      virtual_mode: false,
      bs_sb_wait_count: 0,
      bb_ss_wait_count: 0
    };
  }
  
  // Initialize userLastNumbers
  userLastNumbers[userId] = [];
  
  const loggedIn = !!userSessions[userId];
  await sendMessageWithRetry(ctx, "𝟔𝐋𝐎𝐓𝐓𝐄𝐑𝐘 𝐀𝐔𝐓𝐎𝐁𝐄𝐓 𝐁𝐎𝐓 မှကြိုဆိုပါတယ်🤝!", makeMainKeyboard(loggedIn));
}

async function cmdAllowHandler(ctx) {
  const userId = ctx.from.id;
  if (userId !== ADMIN_ID) {
    await sendMessageWithRetry(ctx, "Admin only!");
    return;
  }
  const args = ctx.message.text.split(' ').slice(1);
  if (!args.length || !args[0].match(/^\d+$/)) {
    await sendMessageWithRetry(ctx, "Usage: /allow {6lottery_id}");
    return;
  }
  const bigwinId = parseInt(args[0]);
  if (allowed777bigwinIds.has(bigwinId)) {
    await sendMessageWithRetry(ctx, `User ${bigwinId} already added`);
  } else {
    allowed777bigwinIds.add(bigwinId);
    saveAllowedUsers();
    await sendMessageWithRetry(ctx, `User ${bigwinId} added`);
  }
}

async function cmdRemoveHandler(ctx) {
  const userId = ctx.from.id;
  if (userId !== ADMIN_ID) {
    await sendMessageWithRetry(ctx, "Admin only!");
    return;
  }
  const args = ctx.message.text.split(' ').slice(1);
  if (!args.length || !args[0].match(/^\d+$/)) {
    await sendMessageWithRetry(ctx, "Usage: /remove {6lottery_id}");
    return;
  }
  const bigwinId = parseInt(args[0]);
  if (!allowed777bigwinIds.has(bigwinId)) {
    await sendMessageWithRetry(ctx, `User ${bigwinId} not found`);
  } else {
    allowed777bigwinIds.delete(bigwinId);
    saveAllowedUsers();
    await sendMessageWithRetry(ctx, `User ${bigwinId} removed`);
  }
}

// New command handler for /showid
async function cmdShowIdHandler(ctx) {
  const userId = ctx.from.id;
  if (userId !== ADMIN_ID) {
    await sendMessageWithRetry(ctx, "Admin only!");
    return;
  }
  
  try {
    let allowedIds = [];
    
    // Try to load from file
    if (fs.existsSync('users_6lottery.json')) {
      const data = JSON.parse(fs.readFileSync('users_6lottery.json', 'utf8'));
      allowedIds = data.allowed_ids || [];
    } else {
      // If file doesn't exist, use the in-memory set
      allowedIds = Array.from(allowed777bigwinIds);
    }
    
    if (allowedIds.length === 0) {
      await sendMessageWithRetry(ctx, "No allowed IDs found.");
      return;
    }
    
    // Format the list of IDs
    let message = "📋 List of Allowed IDs:\n\n";
    allowedIds.forEach((id, index) => {
      message += `${index + 1}. ${id}\n`;
    });
    
    message += `\nTotal: ${allowedIds.length} allowed users`;
    
    await sendMessageWithRetry(ctx, message);
  } catch (error) {
    logging.error(`Error showing allowed IDs: ${error.message}`);
    await sendMessageWithRetry(ctx, "Error retrieving allowed IDs. Please try again later.");
  }
}

// New command handler for /users
async function cmdUsersHandler(ctx) {
  const userId = ctx.from.id;
  if (userId !== ADMIN_ID) {
    await sendMessageWithRetry(ctx, "Admin only!");
    return;
  }
  
  try {
    // Get all Telegram user IDs who have active sessions (logged in users)
    const telegramUserIds = Array.from(activeUsers);
    
    if (telegramUserIds.length === 0) {
      await sendMessageWithRetry(ctx, "No active users found.");
      return;
    }
    
    // Format the list of users
    let message = "📋 List of Active Users:\n\n";
    
    for (const telegramId of telegramUserIds) {
      const userInfo = userGameInfo[telegramId];
      const userName = userInfo?.nickname || userInfo?.username || "Unknown";
      const gameUserId = userInfo?.user_id || "Not logged in";
      const balance = userInfo?.balance || 0;
      const isRunning = userSettings[telegramId]?.running || false;
      
      message += `👤 ${userName}\n`;
      message += `   Telegram ID: ${telegramId}\n`;
      message += `   Game ID: ${gameUserId}\n`;
      message += `   Balance: ${balance.toFixed(2)} Ks\n`;
      message += `   Status: ${isRunning ? '🟢 Running' : '🔴 Stopped'}\n\n`;
    }
    
    message += `Total: ${telegramUserIds.length} active users`;
    
    await sendMessageWithRetry(ctx, message);
  } catch (error) {
    logging.error(`Error showing users: ${error.message}`);
    await sendMessageWithRetry(ctx, "Error retrieving user list. Please try again later.");
  }
}

// Fixed command handler for /send
async function cmdSendHandler(ctx) {
  const userId = ctx.from.id;
  if (userId !== ADMIN_ID) {
    await sendMessageWithRetry(ctx, "Admin only!");
    return;
  }
  
  const messageText = ctx.message.text;
  // Extract the message after "/send "
  const messageToSend = messageText.substring(6).trim();
  
  if (!messageToSend) {
    await sendMessageWithRetry(ctx, "Please provide a message to send. Usage: /send Your message here");
    return;
  }
  
  try {
    // Get all Telegram user IDs who have active sessions (logged in users)
    const telegramUserIds = Array.from(activeUsers);
    
    if (telegramUserIds.length === 0) {
      await sendMessageWithRetry(ctx, "No active users found to send message to.");
      return;
    }
    
    let successCount = 0;
    let failedCount = 0;
    
    // Send message to all active users
    for (const telegramId of telegramUserIds) {
      try {
        await ctx.telegram.sendMessage(telegramId, `📢 Admin Broadcast:\n\n${messageToSend}`);
        successCount++;
      } catch (error) {
        logging.error(`Failed to send message to user ${telegramId}: ${error.message}`);
        failedCount++;
      }
    }
    
    // Send confirmation to admin
    const resultMessage = `✅ Message sent to ${successCount} users` + 
                          (failedCount > 0 ? `\n❌ Failed to send to ${failedCount} users` : "");
    await sendMessageWithRetry(ctx, resultMessage);
    
    logging.info(`Admin broadcast sent to ${successCount}/${telegramUserIds.length} users`);
  } catch (error) {
    logging.error(`Error sending admin broadcast: ${error.message}`);
    await sendMessageWithRetry(ctx, "Error sending message. Please try again later.");
  }
}

async function callbackQueryHandler(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const data = ctx.callbackQuery.data;
  
  if (!await checkUserAuthorized(ctx)) {
    return;
  }
  
  if (data.startsWith("strategy:")) {
    const strategy = data.split(":")[1];
    
    if (strategy === "disabled") {
      await sendMessageWithRetry(ctx, "This strategy is not available for TRX game.ဒီStrategyကိုသုံးဖို့ WINGOကိုရွေးပါ", makeMainKeyboard(true));
      await safeDeleteMessage(ctx);
      return;
    }
    
    userSettings[userId].strategy = strategy;
    
    if (strategy === "SNIPER") {
      // Force Martingale betting strategy for SNIPER
      userSettings[userId].betting_strategy = "Martingale";
      
      // Check if user has exactly 4 bet sizes
      const betSizes = userSettings[userId].bet_sizes || [];
      if (betSizes.length !== 4) {
        await sendMessageWithRetry(ctx, "SNIPER strategy requires exactly 4 bet sizes. Please set 4 bet sizes first.", makeMainKeyboard(true));
        userState[userId] = { state: "INPUT_4_BET_SIZES" };
      } else {
        await sendMessageWithRetry(ctx, `Strategy set to: Leslay (SNIPER) with Martingale betting\n\nThe bot will stop after 2 successful sniper hits.`, makeMainKeyboard(true));
      }
    } else if (strategy === "BEATRIX") {
      // Initialize BEATRIX state
      userSettings[userId].beatrix_state = {
        waiting_for_seven: true,
        last_period_with_seven: null
      };
      await sendMessageWithRetry(ctx, `Strategy set to: Beatrix\n\nSniper strategyဖြစ်နာမို့ Targetမတွေ့မချင်းစောင့်ပါမယ်`, makeMainKeyboard(true));
    } else if (strategy === "BS_ORDER") {
      // Set state for BS pattern input when user selects BS-Order strategy
      userState[userId] = { state: "INPUT_BS_PATTERN" };
      await sendMessageWithRetry(ctx, "Please enter your BS pattern (B and S only, e.g., BSBSSBBS):");
    } else if (strategy === "TREND_FOLLOW") {
      // Ask for BS/SB Wait Count when Trend Follow is selected
      await sendMessageWithRetry(ctx, "Select BS/SB Wait Count:", makeBSWaitCountKeyboard());
    } else if (strategy === "ALTERNATE") {
      // Ask for BB/SS Wait Count when Alternate is selected
      await sendMessageWithRetry(ctx, "Select BB/SS Wait Count:", makeBBWaitCountKeyboard());
    } else if (strategy === "BABIO") {
      // Initialize Babio strategy state
      userSettings[userId].babio_state = {
        current_position: 8,
        last_result: null
      };
      await sendMessageWithRetry(ctx, `Strategy set to: Babio`, makeMainKeyboard(true));
    } else if (strategy === "MAY_BARANI") {
      await sendMessageWithRetry(ctx, `Strategy set to: May Barani`, makeMainKeyboard(true));
    } else {
      await sendMessageWithRetry(ctx, `Strategy set to: ${strategy === "ALINKAR" ? "Alinkar" : strategy}`, makeMainKeyboard(true));
    }
    // Safely delete the message
    await safeDeleteMessage(ctx);
  } else if (data.startsWith("bs_wait_count:")) {
    const waitCount = parseInt(data.split(":")[1]);
    userSettings[userId].bs_sb_wait_count = waitCount;
    let message = "";
    if (waitCount === 0) {
      message = "BS/SB Wait feature disabled";
    } else {
      const patternBS = 'BS'.repeat(waitCount);
      const patternSB = 'SB'.repeat(waitCount);
      message = `BS/SB Wait Count set to: ${waitCount}\n`;
    }
    await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
    // Safely delete the message
    await safeDeleteMessage(ctx);
  } else if (data.startsWith("bb_wait_count:")) {
    const waitCount = parseInt(data.split(":")[1]);
    userSettings[userId].bb_ss_wait_count = waitCount;
    let message = "";
    if (waitCount === 0) {
      message = "BB/SS Wait feature disabled";
    } else {
      const patternBB = 'BB'.repeat(waitCount);
      const patternSS = 'SS'.repeat(waitCount);
      message = `BB/SS Wait Count set to: ${waitCount}\n`;
    }
    await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
    // Safely delete the message
    await safeDeleteMessage(ctx);
  } else if (data.startsWith("betting_strategy:")) {
    const bettingStrategy = data.split(":")[1];
    const settings = userSettings[userId] || {};
    
    // If SNIPER strategy is selected, don't allow changing betting strategy
    if (settings.strategy === "SNIPER") {
      await sendMessageWithRetry(ctx, "SNIPER strategy only supports Martingale betting strategy!", makeMainKeyboard(true));
      return;
    }
    
    userSettings[userId].betting_strategy = bettingStrategy;
    
    userSettings[userId].martin_index = 0;
    userSettings[userId].dalembert_units = 1;
    userSettings[userId].consecutive_losses = 0;
    userSettings[userId].skip_betting = false;
    userSettings[userId].custom_index = 0;
    
    await sendMessageWithRetry(ctx, `Betting Strategy: ${bettingStrategy}`, makeMainKeyboard(true));
    // Safely delete the message
    await safeDeleteMessage(ctx);
  } else if (data.startsWith("game_type:")) {
    const gameType = data.split(":")[1];
    
    // If WINGO_SELECT is selected, show WINGO sub-options
    if (gameType === "WINGO_SELECT") {
      await sendMessageWithRetry(ctx, "Select WINGO game type:", makeWINGOSelectionKeyboard());
      await safeDeleteMessage(ctx);
      return;
    }
    
    userSettings[userId].game_type = gameType;
    
    let gameTypeDisplay = gameType;
    if (gameType === "WINGO_30S") {
      gameTypeDisplay = "WINGO 30s";
    } else if (gameType === "WINGO") {
      gameTypeDisplay = "WINGO 1min";
    }
    
    // Check if current strategy is LYZO or BEATRIX and game type is TRX
    const currentStrategy = userSettings[userId].strategy;
    if ((currentStrategy === "LYZO" || currentStrategy === "BEATRIX") && gameType === "TRX") {
      // Reset to default strategy
      userSettings[userId].strategy = "AI_PREDICTION";
      await sendMessageWithRetry(ctx, `Game Type set to: ${gameTypeDisplay}\n\nNote: ${currentStrategy} strategy သည် TRXမှာအလုပ်မလုပ်ပါ Ai prediction ကိုပဲauto setလုပ်ပါမယ်.`, makeMainKeyboard(true));
    } else {
      await sendMessageWithRetry(ctx, `Game Type set to: ${gameTypeDisplay}`, makeMainKeyboard(true));
    }
    
    // Safely delete the message
    await safeDeleteMessage(ctx);
  } else if (data.startsWith("entry_layer:")) {
    const layerValue = parseInt(data.split(":")[1]);
    userSettings[userId].layer_limit = layerValue;
    
    // Initialize entry layer state based on layer value
    if (layerValue === 2) {
      userSettings[userId].entry_layer_state = { waiting_for_lose: true };
    } else if (layerValue === 3) {
      userSettings[userId].entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
    }
    
    let description = "";
    if (layerValue === 1) {
      description = "Bet immediately according to strategy";
    } else if (layerValue === 2) {
      description = "Wait for 1 lose before betting";
    } else if (layerValue === 3) {
      description = "Wait for 2 consecutive loses before betting";
    }
    
    await sendMessageWithRetry(ctx, `Entry Layer : ${layerValue} (${description})`, makeMainKeyboard(true));
    // Safely delete the message
    await safeDeleteMessage(ctx);
  } else if (data.startsWith("sl_layer:")) {
    const slValue = parseInt(data.split(":")[1]);
    userSettings[userId].sl_layer = slValue > 0 ? slValue : null;
    userSettings[userId].consecutive_losses = 0;
    userSettings[userId].skip_betting = false;
    
    userSettings[userId].original_martin_index = 0;
    userSettings[userId].original_dalembert_units = 1;
    userSettings[userId].original_custom_index = 0;
    
    let description = "";
    if (slValue === 0) {
      description = "Disabled";
    } else {
      description = ` ${slValue} ပွဲloseပြီးရင် bet skipပါမယ်`;
    }
    
    await sendMessageWithRetry(ctx, `SL Layer : ${slValue} (${description})`, makeMainKeyboard(true));
    // Safely delete the message
    await safeDeleteMessage(ctx);
  } else if (data.startsWith("mode:")) {
    const mode = data.split(":")[1];
    const settings = userSettings[userId];
    
    if (mode === "virtual") {
      // Set state to ask for virtual balance amount
      userState[userId] = { state: "INPUT_VIRTUAL_BALANCE" };
      await sendMessageWithRetry(ctx, "Please enter your virtual balance amount (in Ks):");
    } else if (mode === "real") {
      settings.virtual_mode = false;
      await sendMessageWithRetry(ctx, "💵 Switched to Real Mode", makeMainKeyboard(true));
    }
    
    // Safely delete the message
    await safeDeleteMessage(ctx);
  }
}

async function textMessageHandler(ctx) {
  const userId = ctx.from.id;
  const userName = ctx.from.username || ctx.from.first_name || "Unknown";
  const rawText = ctx.message.text;
  const text = normalizeText(rawText);
  const lines = text.split('\n').map(line => line.trim()).filter(line => line);
  
  // Check for "Login Again" text
  if (rawText.includes("Login Again") || rawText.includes("login again")) {
    // Reset user session and show login prompt
    delete userSessions[userId];
    delete userGameInfo[userId];
    delete userStats[userId];
    delete userLastNumbers[userId];
    
    await sendMessageWithRetry(ctx, "Please login again:", makeMainKeyboard(false));
    return;
  }
  
  // Check for specific button texts directly - check BEFORE normalization
  if (rawText.includes("📂 Info") || rawText.includes("Info") || rawText.includes("INFO")) {
    await showUserStats(ctx, userId);
    return;
  }
  
  // Check for game type selection
  if (rawText.includes("🎲 Game Type") || rawText.includes("Game Type") || rawText.includes("game type")) {
    await sendMessageWithRetry(ctx, "Select Game Type:", makeGameTypeKeyboard());
    return;
  }
  
  // Process command normally for other buttons
  const command = text.toUpperCase()
    .replace(/_/g, '')
    .replace(/ /g, '')
    .replace(/\//g, '')
    .replace(/\(/g, '')
    .replace(/\)/g, '')
    .replace(/🔐/g, '')
    .replace(/💰/g, '')
    .replace(/📝/g, '')
    .replace(/▶️/g, '')
    .replace(/⏹️/g, '')
    .replace(/🎯/g, '')
    .replace(/🛑/g, '')
    .replace(/🎮/g, '')
    .replace(/🧠/g, '')
    .replace(/📈/g, '')
    .replace(/⛔/g, '')
    .replace(/🔄/g, '')
    .replace(/ℹ️/g, 'INFO')
    .replace(/🖥️/g, '')
    .replace(/📂/g, '')
    .replace(/💎/g, '')
    .replace(/🏹/g, '')
    .replace(/🔻/g, '')
    .replace(/🎲/g, '')
    .replace(/📚/g, '')
    .replace(/🕹/g, '')
    .replace(/💥/g, '')
    .replace(/⛳/g, '');
  
  // Check for virtual balance input
  const currentState = userState[userId]?.state;
  if (currentState === "INPUT_VIRTUAL_BALANCE") {
    const balance = parseFloat(text);
    if (isNaN(balance) || balance <= 0) {
      await sendMessageWithRetry(ctx, "Invalid balance amount. Please enter a positive number:");
      return;
    }
    
    const settings = userSettings[userId];
    settings.virtual_mode = true;
    settings.virtual_balance = balance;
    
    if (!userStats[userId]) {
      userStats[userId] = {};
    }
    userStats[userId].virtual_balance = balance;
    userStats[userId].initial_balance = balance;
    
    await sendMessageWithRetry(ctx, `🖥️ Switched to Virtual Mode with ${balance} Ks`, makeMainKeyboard(true));
    delete userState[userId];
    return;
  }
  
  // Handle login with multi-line format
  if (command === "LOGIN" || (lines.length > 0 && lines[0].toLowerCase() === "login")) {
    if (lines.length >= 3 && lines[0].toLowerCase() === "login") {
      const username = lines[1];
      const password = lines[2];
      
      // Log user activity (without showing login details)
      console.log(`[USER_ACTIVITY] User ${userName} (ID: ${userId}) logged in`);
      
      // Add user to active users set
      activeUsers.add(userId);
      
      await sendMessageWithRetry(ctx, "Checking...");
      const { response: res, session } = await loginRequest(username, password);
      if (session) {
        const userInfo = await getUserInfo(session, userId);
        if (userInfo && userInfo.user_id) {
          const gameUserId = userInfo.user_id;
          if (!allowed777bigwinIds.has(gameUserId)) {
            await sendMessageWithRetry(ctx, "Unauthorized user ID. Contact admin @leostrike223 to allow your ID.", makeMainKeyboard(false));
            return;
          }
          userSessions[userId] = session;
          userGameInfo[userId] = userInfo;
          userTemp[userId] = { password };
          
          // Reset userAllResults on login
          userAllResults[userId] = [];
          userLastNumbers[userId] = [];
          
          const balance = await getBalance(session, userId);
          
          if (!userSettings[userId]) {
            userSettings[userId] = {
              strategy: "AI_PREDICTION",
              betting_strategy: "Martingale",
              game_type: "TRX", // Default to TRX
              martin_index: 0,
              dalembert_units: 1,
              pattern_index: 0,
              running: false,
              consecutive_losses: 0,
              current_layer: 0,
              skip_betting: false,
              sl_layer: null,
              original_martin_index: 0,
              original_dalembert_units: 1,
              original_custom_index: 0,
              custom_index: 0,
              layer_limit: 1,
              virtual_mode: false,
              bs_sb_wait_count: 0,
              bb_ss_wait_count: 0
            };
          }
          
          if (!userStats[userId]) {
            userStats[userId] = { start_balance: parseFloat(balance || 0), profit: 0.0 };
          }
          
          const balanceDisplay = balance !== null ? balance : 0.0;
          await sendMessageWithRetry(ctx, `✅Login ဝင်ပြီးသွားပါပြီခင်မျာ\nID: ${userInfo.user_id}\nBalance: ${balanceDisplay} Ks`, makeMainKeyboard(true));
          
          const settings = userSettings[userId];
          if (settings.bet_sizes && settings.pattern) {
            await showUserStats(ctx, userId);
          }
        } else {
          await sendMessageWithRetry(ctx, "Login failed: Could not get user info", makeMainKeyboard(false));
        }
      } else {
        const msg = res.msg || "Login failed";
        await sendMessageWithRetry(ctx, `Login error: ${msg}`, makeMainKeyboard(false));
      }
      delete userState[userId];
      delete userTemp[userId];
      return;
    }
    await sendMessageWithRetry(ctx, "အောက်မှာပြထားသည့်အတိုင်း Login ၀င်ပါ:\n\nLogin\nphone\npassword");
    return;
  }
  
  if (!await checkUserAuthorized(ctx) && command !== "LOGIN") {
    return;
  }
  
  try {
    if (currentState === "INPUT_BET_SIZES") {
      // Accept multiple lines of numbers directly without header
      const betSizes = lines.filter(s => s.match(/^\d+$/)).map(Number);
      if (betSizes.length === 0) {
        throw new Error("No valid numbers");
      }
      
      const settings = userSettings[userId];
      if (settings.betting_strategy === "D'Alembert" && betSizes.length > 1) {
        await sendMessageWithRetry(ctx, 
          "❌ D'Alembert strategy requires only ONE bet size.\n" +
          "Please enter only one number for unit size.\n" +
          "Example:\n100",
          makeMainKeyboard(true)
        );
        return;
      }
      
      userSettings[userId].bet_sizes = betSizes;
      userSettings[userId].dalembert_units = 1;
      userSettings[userId].martin_index = 0;
      userSettings[userId].custom_index = 0;
      
      let message = `BET SIZE set: ${betSizes.join(',')} Ks`;
      if (settings.betting_strategy === "D'Alembert") {
        message += `\n📝 D'Alembert Unit Size: ${betSizes[0]} Ks`;
      }
      
      await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
      delete userState[userId];
    } else if (currentState === "INPUT_4_BET_SIZES") {
      // Handle 4 bet sizes input for SNIPER strategy
      const betSizes = lines.filter(s => s.match(/^\d+$/)).map(Number);
      if (betSizes.length !== 4) {
        throw new Error("Please enter exactly 4 bet sizes for SNIPER strategy");
      }
      
      userSettings[userId].bet_sizes = betSizes;
      await sendMessageWithRetry(ctx, `SNIPER Bet Sizes set: ${betSizes.join(',')} Ks`, makeMainKeyboard(true));
      delete userState[userId];
    } else if (currentState === "INPUT_BS_PATTERN") {
      // Handle BS pattern input for BS-Order strategy
      const pattern = text.toUpperCase();
      if (pattern && pattern.split('').every(c => c === 'B' || c === 'S')) {
        userSettings[userId].pattern = pattern;
        userSettings[userId].pattern_index = 0;
        await sendMessageWithRetry(ctx, `BS Pattern set: ${pattern}`, makeMainKeyboard(true));
        delete userState[userId];
      } else {
        await sendMessageWithRetry(ctx, "Invalid pattern. Please use only B and S. Example: BSBSSB", makeMainKeyboard(true));
      }
    } else if (currentState === "INPUT_PROFIT_TARGET") {
      const target = parseFloat(lines.length >= 2 ? lines[1] : text);
      if (isNaN(target) || target <= 0) {
        throw new Error("profit target အရင်ပြီးအောင်ထည့်ပါ");
      }
      userSettings[userId].target_profit = target;
      await sendMessageWithRetry(ctx, `✅PROFIT TARGET set: ${target} Ks\n(Profit Targetပြည့်တာနဲ့ Bot Autoရပ်ပါမယ်!)`, makeMainKeyboard(true));
      delete userState[userId];
    } else if (currentState === "INPUT_STOP_LIMIT") {
      const stopLoss = parseFloat(lines.length >= 2 ? lines[1] : text);
      if (isNaN(stopLoss) || stopLoss <= 0) {
        throw new Error("stop loss အရင်ပြီးအောင်ထည့်ပါ");
      }
      userSettings[userId].stop_loss = stopLoss;
      await sendMessageWithRetry(ctx, `✅STOP LOSS LIMIT set: ${stopLoss} Ks\n(Stop Loss Limit ရောက်တာနဲ့Bot Auto ရပ်ပါမယ်!)`, makeMainKeyboard(true));
      delete userState[userId];
    } else {
      // Handle button commands - check rawText first for exact matches
      if (rawText.includes("👾 Start") || command === "START") {
        // Log user activity
        console.log(`[USER_ACTIVITY] User ${userName} (ID: ${userId}) started the bot`);
        
        const settings = userSettings[userId] || {};
        
        // Check if bet sizes are set
        if (!settings.bet_sizes) {
          await sendMessageWithRetry(ctx, "Please set BET SIZE first!", makeMainKeyboard(true));
          return;
        }
        
        // For SNIPER strategy, check if exactly 4 bet sizes are set
        if (settings.strategy === "SNIPER" && settings.bet_sizes.length !== 4) {
          await sendMessageWithRetry(ctx, "SNIPER strategy requires exactly 4 bet sizes. Please set 4 bet sizes first.", makeMainKeyboard(true));
          return;
        }
        
        if (settings.strategy === "BS_ORDER" && !settings.pattern) {
          settings.pattern = DEFAULT_BS_ORDER;
          settings.pattern_index = 0;
          await sendMessageWithRetry(ctx, `No BS order provided. Using default: ${DEFAULT_BS_ORDER}`, makeMainKeyboard(true));
        }
        
        if (settings.betting_strategy === "D'Alembert" && settings.bet_sizes.length > 1) {
          await sendMessageWithRetry(ctx, 
            "❌ D'Alembert strategy requires only ONE bet size.\n" +
            "Please set Bet Size again with only one number.",
            makeMainKeyboard(true)
          );
          return;
        }
        
        if (settings.running) {
          await sendMessageWithRetry(ctx, "Bot is already running!", makeMainKeyboard(true));
          return;
        }
        
        settings.running = true;
        settings.consecutive_errors = 0;
        
        // Initialize entry layer state based on layer limit - skip for Leslay strategy
        const isLeslayStrategy = settings.strategy === "SNIPER";
        const entryLayer = settings.layer_limit || 1;
        
        if (!isLeslayStrategy) {
          if (entryLayer === 2) {
            settings.entry_layer_state = { waiting_for_lose: true };
          } else if (entryLayer === 3) {
            settings.entry_layer_state = { waiting_for_loses: true, consecutive_loses: 0 };
          }
        }
        
        // Initialize DREAM strategy state if using DREAM strategy
        if (settings.strategy === "DREAM") {
          settings.dream_state = {
            first_bet: true,
            current_pattern: "",
            current_index: 0
          };
        }
        
        // Initialize Babio strategy state if using Babio strategy
        if (settings.strategy === "BABIO") {
          settings.babio_state = {
            current_position: 8,
            last_result: null
          };
        }
        
        // Initialize LEO strategy state if using LEO strategy
        if (settings.strategy === "LEO") {
          settings.leo_state = {
            last_result: null,
            pattern_index: 0
          };
          logging.info(`LEO strategy initialized for user ${userId}`);
        }
        
        // Initialize TREND_FOLLOW strategy state if using TREND_FOLLOW strategy
        if (settings.strategy === "TREND_FOLLOW") {
          settings.trend_state = {
            last_result: null,
            skip_mode: false
          };
          logging.info(`TREND_FOLLOW strategy initialized for user ${userId}`);
        }
        
        // Initialize ALTERNATE strategy state if using ALTERNATE
        if (settings.strategy === "ALTERNATE") {
          settings.alternate_state = {
            last_result: null,
            skip_mode: false
          };
          logging.info(`ALTERNATE strategy initialized for user ${userId}`);
        }
        
        // Initialize SNIPER strategy state if using SNIPER strategy
        if (isLeslayStrategy) {
          // Reset sniper state when starting the bot
          settings.sniper_state = {
            active: false,
            direction: null,
            current_index: 0,
            hit_count: 0,  // Initialize hit count
            bet_sequence: [],
            got_same_result: false
          };
          // Clear last numbers to ensure fresh start
          userLastNumbers[userId] = [];
          logging.info(`SNIPER strategy reset for user ${userId}`);
        }
        
        // Initialize BEATRIX strategy state if using BEATRIX strategy
        if (settings.strategy === "BEATRIX") {
          settings.beatrix_state = {
            waiting_for_seven: true,
            last_period_with_seven: null
          };
          logging.info(`BEATRIX strategy initialized for user ${userId}`);
        }
        
        // Initialize AI strategy data
        if (settings.strategy === "AI_PREDICTION") {
          userAILast10Results[userId] = [];
          userAIRoundCount[userId] = 0;
          logging.info(`AI strategy initialized for user ${userId}`);
        }
        
        // Initialize Babio strategy data
        if (settings.strategy === "BABIO") {
          userAILast10Results[userId] = [];
          userAIRoundCount[userId] = 0;
          logging.info(`Babio strategy initialized for user ${userId}`);
        }
        
        // Initialize Lyzo strategy data
        if (settings.strategy === "LYZO") {
          userLast10Results[userId] = [];
          userLyzoRoundCount[userId] = 0;
          logging.info(`Lyzo strategy initialized for user ${userId}`);
        }
        
        // Initialize userLastNumbers for SNIPER strategy
        if (!userLastNumbers[userId]) {
          userLastNumbers[userId] = [];
        }
        
        delete userSkippedBets[userId];
        userShouldSkipNext[userId] = false;
        delete userSLSkipWaitingForWin[userId];
        
        userWaitingForResult[userId] = false;
        bettingWorker(userId, ctx, ctx.telegram);
      } else if (rawText.includes("🚧 Stop") || command === "STOP") {
        // Log user activity
        console.log(`[USER_ACTIVITY] User ${userName} (ID: ${userId}) stopped the bot`);
        
        const settings = userSettings[userId] || {};
        if (!settings.running) {
          await sendMessageWithRetry(ctx, "Bot is not running!", makeMainKeyboard(true));
          return;
        }
        
        userStopInitiated[userId] = true;
        
        settings.running = false;
        delete userWaitingForResult[userId];
        delete userShouldSkipNext[userId];
        delete userSLSkipWaitingForWin[userId];
        
        // Clean
        if (settings.strategy === "AI_PREDICTION") {
          delete userAILast10Results[userId];
          delete userAIRoundCount[userId];
        }
        
        if (settings.strategy === "BABIO") {
          delete userAILast10Results[userId];
          delete userAIRoundCount[userId];
          delete settings.babio_state;
        }
        
        if (settings.strategy === "LYZO") {
          delete userLast10Results[userId];
          delete userLyzoRoundCount[userId];
        }
        
        if (settings.strategy === "LEO") {
          delete settings.leo_state;
        }
        
        if (settings.strategy === "TREND_FOLLOW") {
          delete settings.trend_state;
        }
        
        if (settings.strategy === "ALTERNATE") {
          delete settings.alternate_state;
        }
        
        if (settings.strategy === "SNIPER") {
          delete settings.sniper_state;
        }
        
        if (settings.strategy === "BEATRIX") {
          delete settings.beatrix_state;
        }
        
        // Calculate profit before reset
        let totalProfit = 0;
        let balanceText = "";
        
        if (settings.virtual_mode) {
          totalProfit = (userStats[userId]?.virtual_balance || 0) - (userStats[userId]?.initial_balance || 0);
          balanceText = `Virtual Balance: ${(userStats[userId]?.virtual_balance || 0).toFixed(2)} Ks\n`;
        } else {
          totalProfit = userStats[userId]?.profit || 0;
          try {
            const session = userSessions[userId];
            const finalBalance = await getBalance(session, userId);
            balanceText = `Final Balance: ${finalBalance?.toFixed(2) || '0.00'} Ks\n`;
          } catch (error) {
            logging.error(`Failed to get final balance: ${error.message}`);
            balanceText = "Final Balance: Unknown\n";
          }
        }
        
        // Calculate profit indicator
        let profitIndicator = "";
        if (totalProfit > 0) {
          profitIndicator = "+";
        } else if (totalProfit < 0) {
          profitIndicator = "-";
        } else {
          profitIndicator = "";
        }
        
        // Don't reset bet sizes when bot stops
        // RESET profit tracking only when bot stops
        delete userStats[userId];
        settings.martin_index = 0;
        settings.dalembert_units = 1;
        settings.custom_index = 0;
        delete settings.dream_state;
        
        const message = `🛑 BOT STOPPED\n${balanceText}💰 Total Profit: ${profitIndicator}${totalProfit.toFixed(2)} Ks`;
        await sendMessageWithRetry(ctx, message, makeMainKeyboard(true));
      } else if (rawText.includes("💎 Bet_Size") || command === "BETSIZE") {
        userState[userId] = { state: "INPUT_BET_SIZES" };
        await sendMessageWithRetry(ctx, "Enter bet sizes (one per line):\n100\n200\n500", makeMainKeyboard(true));
      } else if (rawText.includes("🏹 Profit Target") || command === "PROFITTARGET") {
        userState[userId] = { state: "INPUT_PROFIT_TARGET" };
        await sendMessageWithRetry(ctx, "🎳 Profit_Target ထည့်ပါ🎳\n\nနမူနာ: 10000", makeMainKeyboard(true));
      } else if (rawText.includes("🔻 Stop Loss Limit") || command === "STOPLOSSLIMIT") {
        userState[userId] = { state: "INPUT_STOP_LIMIT" };
        await sendMessageWithRetry(ctx, "🧫 Stoploss_Limit ထည့်ပါ 🧫\n\nနမူနာ: 10000", makeMainKeyboard(true));
      } else if (rawText.includes("📚 Strategy") || command === "STRATEGY") {
        await sendMessageWithRetry(ctx, "Choose strategy:", makeStrategyKeyboard(userId));
      } else if (rawText.includes("🕹 Anti/Martingale") || command === "ANTIMARTINGALE") {
        const settings = userSettings[userId] || {};
        
        // If SNIPER strategy is selected, don't allow changing betting strategy
        if (settings.strategy === "SNIPER") {
          await sendMessageWithRetry(ctx, "SNIPER strategy only supports Martingale betting strategy!", makeMainKeyboard(true));
          return;
        }
        
        await sendMessageWithRetry(ctx, "Choose Betting Strategy", makeBettingStrategyKeyboard());
      } else if (rawText.includes("💥 Bet_SL") || command === "BETSL") {
        await sendMessageWithRetry(ctx, "Select SL Layer:", makeSLLayerKeyboard());
      } else if (rawText.includes("⛳ Entry Layer") || command === "ENTRYLAYER" || command === "ENTRY(LAYER)") {
        await sendMessageWithRetry(ctx, "Select Entry Layer:", makeEntryLayerKeyboard());
      } else if (rawText.includes("🎮 Virtual/Real Mode") || command === "VIRTUALREALMODE") {
        await sendMessageWithRetry(ctx, "Select Mode:", makeModeSelectionKeyboard());
      } else if (command === "INFO") {
        await showUserStats(ctx, userId);
      }
    }
  } catch (error) {
    await sendMessageWithRetry(ctx, `Error: ${error.message}`, makeMainKeyboard(true));
  }
}

async function showUserStats(ctx, userId) {
  const session = userSessions[userId];
  const userInfo = userGameInfo[userId];
  if (!userInfo) {
    await sendMessageWithRetry(ctx, "Failed to get info", makeMainKeyboard(true));
    return;
  }
  
  const settings = userSettings[userId] || {};
  const betSizes = settings.bet_sizes || [];
  const strategy = settings.strategy || "AI_PREDICTION";
  const bettingStrategy = settings.betting_strategy || "Martingale";
  const gameType = settings.game_type || "TRX"; // Get game type from settings
  const virtualMode = settings.virtual_mode || false;
  const profitTarget = settings.target_profit;
  const stopLoss = settings.stop_loss;
  const slLayer = settings.sl_layer;
  const layerLimit = settings.layer_limit || 1;
  const isLeslayStrategy = strategy === "SNIPER";
  
  let balance;
  
  if (virtualMode) {
    balance = userStats[userId]?.virtual_balance || settings.virtual_balance || 0;
  } else {
    balance = await getBalance(session, userId);
  }
  
  // Format strategy names for display
  const strategyText = strategy === "AI_PREDICTION" ? "AI Prediction" :
                       strategy === "LYZO" ? "Lyzo" :
                       strategy === "DREAM" ? "Dream" :
                       strategy === "BABIO" ? "Babio" :
                       strategy === "BS_ORDER" ? "BS Order" :
                       strategy === "LEO" ? "Leo" :
                       strategy === "TREND_FOLLOW" ? "Trend Follow" :
                       strategy === "ALTERNATE" ? "Alternate" :
                       strategy === "SNIPER" ? "Leslay" :
                       strategy === "ALINKAR" ? "Alinkar" :
                       strategy === "MAY_BARANI" ? "May Barani" :
                       strategy === "BEATRIX" ? "Beatrix" : strategy;

  // Only show bet order for BS ORDER Strategy
  let betOrder = "N/A (Only available for BS_ORDER Strategy)";
  if (strategy === "BS_ORDER") {
    betOrder = settings.pattern || "BS-Order";
  }
  
  // Update entry layer description
  let entryLayerDesc = "";
  if (layerLimit === 1) {
    entryLayerDesc = "Bet immediately according to strategy";
  } else if (layerLimit === 2) {
    entryLayerDesc = "Wait for 1 lose before betting";
    if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_lose) {
      entryLayerDesc += " (Currently waiting for lose)";
    }
  } else if (layerLimit === 3) {
    entryLayerDesc = "Wait for 2 consecutive loses before betting";
    if (settings.entry_layer_state && settings.entry_layer_state.waiting_for_loses) {
      entryLayerDesc += ` (Currently waiting for ${settings.entry_layer_state.consecutive_loses || 0}/2 loses)`;
    }
  }
  
  let slStatus = "";
  if (userSLSkipWaitingForWin[userId]) {
    slStatus = ` (Waiting for Skip Win)`;
  } else if (settings.consecutive_losses > 0) {
    slStatus = ` (${settings.consecutive_losses}/${slLayer || 0})`;
  }
  
  const modeText = virtualMode ? "🖥️ Virtual Mode" : "💵 Real Mode";
  
  const infoText = 
    `🧞 𝟔𝐋𝐎𝐓𝐓𝐄𝐑𝐘 𝐀𝐔𝐓𝐎𝐁𝐄𝐓 𝐁𝐎𝐓 🧞 \n\n` +  // Title
    
    `🧬 User ID: ${userInfo.user_id || 'N/A'}\n` +  // User ID

    `💳 Balance: ${balance !== null ? balance.toFixed(2) : 'N/A'} Ks\n\n` +  // Balance
    
    `🎲 Game Type: ${gameType}\n` +  // Game Type
    
    `🎮Mode: ${modeText}\n\n` +  // Mode
    
    `📚 Strategy: ${strategyText}\n` +  // Strategy
    
    `🕹 Betting Strategy: ${bettingStrategy}\n\n` +  // Betting Strategy
    
    `💎 Bet Sizes: ${betSizes.join(', ') || 'Not set'}\n` +  // Bet Sizes
    
    `🔢 BS Order: ${betOrder}\n\n` +  // BS Order
    
    `🏹 Profit Target: ${isLeslayStrategy ? "Disabled (Leslay Strategy)" : (profitTarget !== undefined ? profitTarget + ' Ks' : 'Not set')}\n` +  // Profit Target
    
    `🔻 Stop Loss Limit: ${stopLoss !== undefined ? stopLoss + ' Ks' : 'Not set'}\n\n` +  // Stop Loss Limit
    
    `💥 SL Layer: ${isLeslayStrategy ? "Disabled (Leslay Strategy)" : (slLayer ? slLayer + ' Layer' + slStatus : 'Not set')}\n` +  // SL Layer
    
    `⛳ Entry Layer: ${isLeslayStrategy ? "Disabled (Leslay Strategy)" : (layerLimit + ' - ' + entryLayerDesc)}\n\n` +  // Entry Layer
    
    `🚀 Status: ${settings.running ? 'Run⚡' : 'Stop🚧'}\n\n` +  // Status
    
    `🌌 ᴘᴏᴡᴇʀᴇᴅ ʙʏ DREAM TEAM 𝗦𝗬𝗦𝗧𝗘𝗠 ⚡️`;  // Footer
  
  await sendMessageWithRetry(ctx, infoText, makeMainKeyboard(true));
}

// Config
const BASE_URL = "https://6lotteryapi.com/api/webapi/";
const BOT_TOKEN = "8289684260:AAE8qPJ1s0D4rAv_2g9ACJUkTl6WmlTA-_Q";
const ADMIN_ID = 7259590181;
const IGNORE_SSL = true;
const WIN_LOSE_CHECK_INTERVAL = 2;
const MAX_RESULT_WAIT_TIME = 60;
const MAX_BALANCE_RETRIES = 10;
const BALANCE_RETRY_DELAY = 5;
const BALANCE_API_TIMEOUT = 20000;
const BET_API_TIMEOUT = 30000;
const MAX_BET_RETRIES = 3;
const BET_RETRY_DELAY = 5;
const MAX_CONSECUTIVE_ERRORS = 10;
const MESSAGE_RATE_LIMIT_SECONDS = 10;
const MAX_TELEGRAM_RETRIES = 3;
const TELEGRAM_RETRY_DELAY = 2000;
const DEFAULT_BS_ORDER = "BSBBSBSSSB";
const MIN_AI_PREDICTION_DATA = 5;
const MIN_LYZO_PREDICTION_DATA = 10;
const DREAM2_PATTERN = "BBSBSSBBSBSS";
const LEO_BIG_PATTERN = "BBSBSSSBSB";
const LEO_SMALL_PATTERN = "SSBSBBBSBS";

// Main application
function main() {
  loadAllowedUsers();
  loadPatterns();
  loadDreamPatterns();
  const bot = new Telegraf(BOT_TOKEN);
  
  bot.start(cmdStartHandler);
  bot.command('allow', cmdAllowHandler);
  bot.command('remove', cmdRemoveHandler);
  bot.command('showid', cmdShowIdHandler);
  bot.command('users', cmdUsersHandler);  // Added new command handler
  bot.command('send', cmdSendHandler);
  bot.on('callback_query', callbackQueryHandler);
  bot.on('text', textMessageHandler);
  
  winLoseChecker(bot).catch(error => {
    logging.error(`Win/lose checker failed: ${error.message}`);
  });
  
  bot.launch().then(() => {
    logging.info('Bot started successfully');
  }).catch(error => {
    logging.error(`Bot failed to start: ${error.message}`);
  });
 
  process.on('uncaughtException', (error) => {
    logging.error(`Uncaught Exception: ${error.message}`);
    logging.error(error.stack);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logging.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
  });
  
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

if (require.main === module) {
  main();
}
