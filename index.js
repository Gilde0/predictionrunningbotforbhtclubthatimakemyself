const express = require("express");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

// === CONFIG ===
const ADMINS = [
  { id: process.env.ADMIN1_ID, channel: process.env.CHANNEL1_ID },
  { id: process.env.ADMIN2_ID, channel: process.env.CHANNEL2_ID },
];

const WORKERS = {
  "30s": "https://telegrambot.mylynbelardo330.workers.dev/30s",
  "1m": "https://telegrambot.mylynbelardo330.workers.dev/1m",
  "3m": "https://telegrambot.mylynbelardo330.workers.dev/3m",
  "5m": "https://telegrambot.mylynbelardo330.workers.dev/5m",
};

const WIN_OPTIONS = [3, 5, 10]; // winning limits
const ISSUE_DELAY = 3; // wait for 3 issues before first forecast

// === STATE PER ADMIN ===
let sessions = {}; // key: adminId

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

// === BOT MENUS ===
const mainMenuKeyboard = () => ({
  reply_markup: {
    keyboard: [["Start"], ["Stop"]],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
});

const intervalMenuKeyboard = () => ({
  reply_markup: {
    keyboard: [["30s", "1m"], ["3m", "5m"], ["Back"]],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
});

const winLimitMenuKeyboard = () => ({
  reply_markup: {
    keyboard: [
      WIN_OPTIONS.map((n) => n + " Wins"),
      ["Back"],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
});

// === TELEGRAM BOT WITH WEBHOOK ===
const bot = new TelegramBot(process.env.BOT_TOKEN, { webHook: true });
bot.setWebHook(`${process.env.WEBHOOK_URL}/bot${process.env.BOT_TOKEN}`);

// === EXPRESS SERVER FOR WEBHOOK ===
const app = express();
app.use(express.json());
app.post(`/bot${process.env.BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// === FETCH RESULTS ===
async function fetchResults(url) {
  try {
    const res = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.data || !res.data.sample) return [];
    const sample = res.data.sample;
    return [
      {
        issue: sample.issueNumber,
        number: parseInt(sample.number, 10),
      },
    ];
  } catch (err) {
    console.error("❌ Fetch error:", err.message);
    return [];
  }
}

// === FORECAST LOGIC PER ADMIN ===
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

  if (correct) {
    session.currentAmount = 1;
    session.winCount += 1;
  } else {
    session.currentAmount *= 3;
  }

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

  await bot.editMessageText(adminMsg, {
    chat_id: adminId,
    message_id: session.adminMessageId,
  });

  if (correct) session.winHistory.push(latest.issue);
  session.lastPrediction = { size: nextSize, issue: nextIssue };

  if (session.winCount >= session.winLimit) {
    await bot.sendMessage(
      channelId,
      `
✅ Our prediction session has come to an end!
Thanks for joining, everyone. 🙌
Have great day and see you on the next session!

📲 Don’t forget to register here 👉 https://tinyurl.com/bhtclubs

and predict with us in real time! 🎯
    `.trim(),
    );

    clearInterval(session.autoInterval);
    sessions[adminId] = null;

    await bot.sendMessage(adminId, "Session ended!", mainMenuKeyboard());
  }
}

// === HANDLE MESSAGES FOR START/STOP AND MENU ===
bot.on("message", async (msg) => {
  const adminId = msg.chat.id.toString();
  if (!ADMINS.find((a) => a.id.toString() === adminId)) return;

  const text = msg.text.trim().toLowerCase();

  if (text === "/start" || text === "start") {
    await bot.sendMessage(adminId, "Welcome! Choose an action:", mainMenuKeyboard());
    return;
  }

  if (text === "/stop" || text === "stop") {
    const session = sessions[adminId];
    if (session && session.autoInterval) clearInterval(session.autoInterval);
    sessions[adminId] = null;
    await bot.sendMessage(adminId, "⏹ Forecasting stopped.", mainMenuKeyboard());
    return;
  }

  // Handle menu buttons
  if (text === "30s" || text === "1m" || text === "3m" || text === "5m") {
    if (!sessions[adminId]) sessions[adminId] = {};
    sessions[adminId].selectedInterval = text;
    const adminObj = ADMINS.find((a) => a.id.toString() === adminId);
    sessions[adminId].channel = adminObj.channel;
    await bot.sendMessage(adminId, `Interval selected: ${text.toUpperCase()}\nChoose winning limit:`, winLimitMenuKeyboard());
    return;
  }

  if (WIN_OPTIONS.map((n) => n + " wins").includes(text)) {
    const winLimit = parseInt(text.split(" ")[0]);
    const session = sessions[adminId];
    session.winLimit = winLimit;
    session.winCount = 0;
    session.currentAmount = 1;
    session.lastPrediction = null;
    session.lastIssue = null;
    session.startIssue = null;
    session.winHistory = [];

    await bot.sendMessage(
      session.channel,
      `
🚨 Wingo Prediction Session Is Starting soon! 🎯
Get ready, everyone — we’re kicking off our next round of Wingo ${session.selectedInterval} predictions! 💥
Join in and let’s aim for another winning streak together. 💪
📲 Don’t forget to register here 👉 https://tinyurl.com/bhtclubs
and predict with us live! 🔥
    `.trim(),
    );

    session.autoInterval = setInterval(() => checkAndPredict(adminId), 2000);

    const msg = await bot.sendMessage(
      adminId,
      `✅ Forecast session started!\nInterval: ${session.selectedInterval.toUpperCase()}\nWin Limit: ${session.winLimit}`,
      mainMenuKeyboard(),
    );
    session.adminMessageId = msg.message_id;
    return;
  }

  if (text === "back") {
    await bot.sendMessage(adminId, "Select interval:", intervalMenuKeyboard());
  }
});

// === EXPRESS SERVER LISTEN ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🤖 Telegram Forecast Bot running with webhook on port ${PORT}`);
});
