const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

// === CONFIG ===
const ADMINS = [
  { id: "123456789", channel: "-100111222333" }, // Replace with real admin & channel IDs
  { id: "987654321", channel: "-100444555666" },
];

const WORKERS = {
  "30s": "https://telegrambot.mylynbelardo330.workers.dev/30s",
  "1m": "https://telegrambot.mylynbelardo330.workers.dev/1m",
  "3m": "https://telegrambot.mylynbelardo330.workers.dev/3m",
  "5m": "https://telegrambot.mylynbelardo330.workers.dev/5m",
};

const WIN_OPTIONS = [3, 5, 10]; // winning limits
const ISSUE_DELAY = 3; // wait for 3 issues before first forecast
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes idle timeout

const PORT = process.env.PORT || 3000;
const HOST_URL = "https://yourdomain.com"; // Replace with your hosted URL
const bot = new TelegramBot(process.env.BOT_TOKEN);

// === STATE PER ADMIN ===
let sessions = {}; // key: adminId
let idleTimers = {}; // key: adminId

// === HELPERS ===
const getSize = (num) => (num >= 5 ? "BIG" : "SMALL");
const predictNextSize = (num) => (getSize(num) === "SMALL" ? "BIG" : "SMALL");
const calculateNextIssue = (issue) => {
  try {
    const issueNum = BigInt(issue);
    return (issueNum + 1n).toString();
  } catch {
    return issue;
  }
};

async function fetchResults(url) {
  try {
    const res = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.data || !res.data.sample) return [];
    const sample = res.data.sample;
    return [{ issue: sample.issueNumber, number: parseInt(sample.number, 10) }];
  } catch (err) {
    console.error("❌ Fetch error:", err.message);
    return [];
  }
}

// === FORECAST LOGIC ===
async function checkAndPredict(adminId) {
  const session = sessions[adminId];
  if (!session || !session.selectedInterval) return;

  const channelId = session.channel;
  const data = await fetchResults(WORKERS[session.selectedInterval]);
  if (!data.length) return;

  const latest = data[0];
  if (!latest.issue || latest.issue === session.lastIssue) return;
  session.lastIssue = latest.issue;

  if (!session.startIssue) session.startIssue = latest.issue;
  const diff = BigInt(latest.issue) - BigInt(session.startIssue);
  if (diff < ISSUE_DELAY) return;

  const nextIssue = calculateNextIssue(latest.issue);
  const nextSize = predictNextSize(latest.number);

  if (!session.lastPrediction) {
    session.lastPrediction = { size: nextSize, issue: nextIssue };
    const forecastMsg = `
🎯 NEXT PREDICTION ON WINGO ${session.selectedInterval.toUpperCase()}
ISSUE: ${nextIssue}
SIZE: ${nextSize}
AMOUNT: ${session.currentAmount}RS
🏆 Wins: ${session.winCount} / ${session.winLimit}
    `.trim();
    await bot.sendMessage(channelId, forecastMsg);

    const adminMsg = `
✅ Forecast session started!
🏆 Wins: ${session.winCount} / ${session.winLimit}
Next prediction ready: ISSUE ${nextIssue} SIZE ${nextSize} AMOUNT ${session.currentAmount}RS
    `.trim();
    const msg = await bot.sendMessage(adminId, adminMsg);
    session.adminMessageId = msg.message_id;
    return;
  }

  const actualSize = getSize(latest.number);
  const correct = actualSize === session.lastPrediction.size;
  if (correct) session.currentAmount = 1, session.winCount += 1;
  else session.currentAmount *= 3;

  let channelMsg = `${correct ? `✅ WIN! (${session.lastPrediction.size} for issue ${latest.issue})` : "AGAIN 3X!!!"}
🏆 Wins: ${session.winCount} / ${session.winLimit}`;
  if (session.winCount < session.winLimit) {
    channelMsg += `
🎯 NEXT PREDICTION ON WINGO ${session.selectedInterval.toUpperCase()}
ISSUE: ${nextIssue}
SIZE: ${nextSize}
AMOUNT: ${session.currentAmount}RS`;
  }
  await bot.sendMessage(channelId, channelMsg.trim());

  const adminMsg = `
${correct ? "✅ WIN!" : "AGAIN 3X!!!"} (${session.lastPrediction.size} for issue ${latest.issue})
🏆 Wins: ${session.winCount} / ${session.winLimit}
Winning Issue Numbers:
${session.winHistory.join("\n")}
Next prediction:
🎯 ISSUE: ${nextIssue}
SIZE: ${nextSize}
AMOUNT: ${session.currentAmount}RS
  `.trim();

  await bot.editMessageText(adminMsg, { chat_id: adminId, message_id: session.adminMessageId });
  if (correct) session.winHistory.push(latest.issue);
  session.lastPrediction = { size: nextSize, issue: nextIssue };

  if (session.winCount >= session.winLimit) stopSession(adminId);
}

// === KEYBOARDS ===
const mainKeyboard = {
  reply_markup: { keyboard: [["Start", "Stop"]], resize_keyboard: true, one_time_keyboard: false },
};
const intervalKeyboard = {
  reply_markup: { keyboard: [["30s", "1m"], ["3m", "5m"], ["⬅️ Back"]], resize_keyboard: true, one_time_keyboard: false },
};
const winLimitKeyboard = {
  reply_markup: { keyboard: [["3 Wins", "5 Wins", "10 Wins"], ["⬅️ Back"]], resize_keyboard: true, one_time_keyboard: false },
};

// === BOT SETUP ===
bot.setWebHook(`${HOST_URL}/bot${process.env.BOT_TOKEN}`);

// === EXPRESS SETUP ===
const app = express();
app.use(bodyParser.json());

app.post(`/bot${process.env.BOT_TOKEN}`, async (req, res) => {
  const update = req.body;
  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  if (!chatId || !text) return res.sendStatus(200);
  if (!ADMINS.find((a) => a.id.toString() === chatId)) return res.sendStatus(403);

  if (!sessions[chatId]) sessions[chatId] = {};
  const session = sessions[chatId];

  resetIdleTimer(chatId); // reset 5-min timer on any command

  // Start / Stop
  if (text === "Start" || text === "/start") {
    await bot.sendMessage(chatId, "Welcome! Choose an action:", mainKeyboard);
  } else if (text === "Stop" || text === "/stop") {
    stopSession(chatId);
  }

  // Interval selection
  if (["30s", "1m", "3m", "5m"].includes(text)) {
    session.selectedInterval = text;
    const adminObj = ADMINS.find(a => a.id.toString() === chatId);
    session.channel = adminObj.channel;
    await bot.sendMessage(chatId, `Interval selected: ${text}\nChoose winning limit:`, winLimitKeyboard);
  }

  // Win limit selection
  if (["3 Wins", "5 Wins", "10 Wins"].includes(text)) {
    const winLimit = parseInt(text);
    session.winLimit = winLimit;
    session.winCount = 0;
    session.currentAmount = 1;
    session.lastPrediction = null;
    session.lastIssue = null;
    session.startIssue = null;
    session.winHistory = [];

    await bot.sendMessage(
      session.channel,
      `🚨 Wingo Prediction Session Is Starting soon! 🎯\nGet ready for Wingo ${session.selectedInterval} predictions! 💥\n📲 Register here 👉 https://tinyurl.com/bhtclubs`
    );

    session.autoInterval = setInterval(() => checkAndPredict(chatId), 2000);
    const msg = await bot.sendMessage(chatId, `✅ Forecast session started!\nInterval: ${session.selectedInterval.toUpperCase()}\nWin Limit: ${session.winLimit}`, mainKeyboard);
    session.adminMessageId = msg.message_id;
  }

  res.sendStatus(200);
});

// === SESSION STOP FUNCTION ===
function stopSession(adminId) {
  const session = sessions[adminId];
  if (session && session.autoInterval) clearInterval(session.autoInterval);
  sessions[adminId] = {};
  bot.sendMessage(adminId, "⏹ Forecasting stopped.", mainKeyboard);

  resetIdleTimer(adminId); // start idle timer to show main keyboard again
}

// === IDLE TIMER ===
function resetIdleTimer(adminId) {
  if (idleTimers[adminId]) clearTimeout(idleTimers[adminId]);
  idleTimers[adminId] = setTimeout(() => {
    sessions[adminId] = {};
    bot.sendMessage(adminId, "⏹ Idle timeout. Showing main menu.", mainKeyboard);
  }, IDLE_TIMEOUT);
}

app.listen(PORT, () => console.log(`🤖 Telegram bot webhook running on port ${PORT}`));
