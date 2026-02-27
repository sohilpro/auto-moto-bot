const fs = require('fs');
const path = require('path');

// مسیر فایل ذخیره توکن‌ها
const TOKENS_FILE = path.join(__dirname, '../tokens.json');

// خواندن توکن‌ها از فایل
function getTokens() {
  if (!fs.existsSync(TOKENS_FILE)) {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify([]));
    return [];
  }
  const data = fs.readFileSync(TOKENS_FILE, 'utf8');
  return JSON.parse(data);
}

// ذخیره توکن‌های جدید در فایل
function saveTokens(tokensArray) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokensArray, null, 2));
}

// انتخاب یک توکن رندوم
function getRandomToken() {
  const tokens = getTokens();
  if (tokens.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * tokens.length);
  return tokens[randomIndex];
}

// حذف یک توکن خراب از لیست
function removeBadToken(badToken) {
  let tokens = getTokens();
  tokens = tokens.filter(t => t !== badToken);
  saveTokens(tokens);
  return tokens.length; // تعداد توکن‌های باقیمانده
}

module.exports = { getTokens, saveTokens, getRandomToken, removeBadToken };