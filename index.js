const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
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

// === EXPRESS APP ===
const app = express();
app.use(express.json());

// === TELEGRAM BOT ===
const bot = new TelegramBot(process.env.BOT_TOKEN);
const WEBHOOK_URL = process.env.WEBHOOK_URL; // your Render webhook URL + /bot path
const PORT = process.env.PORT || 10000;

// Set webhook
bot.setWebHook(`${WEBHOOK_URL}/bot`);

console.log(`🤖 Telegram Forecast Bot running with webhook on port ${PORT}`);

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

// === FETCH RESULTS ===
async function fetchResults(url) {
  try {
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
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

  // First prediction
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
      `.trim()
    );
    clearInterval(session.autoInterval);
    sessions[adminId] = null;
    await bot.sendMessage(adminId, "Session ended! Choose interval to start new session:", intervalMenu);
  }
}

// === BOT MENUS ===
const mainMenu = {
  reply_markup: { inline_keyboard: [[{ text: "Start", callback_data: "start_menu" }]] },
};

const intervalMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "30s", callback_data: "interval_30s" },
        { text: "1m", callback_data: "interval_1m" },
        { text: "3m", callback_data: "interval_3m" },
        { text: "5m", callback_data: "interval_5m" },
      ],
      [{ text: "⬅️ Back", callback_data: "main" }],
    ],
  },
};

const winLimitMenu = {
  reply_markup: {
    inline_keyboard: [
      ...WIN_OPTIONS.map((n) => [{ text: n + " Wins", callback_data: "win_" + n }]),
      [{ text: "⬅️ Back", callback_data: "interval_back" }],
    ],
  },
};

const backStopMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "⏹ Stop", callback_data: "stop" },
        { text: "⬅️ Back", callback_data: "main" },
      ],
    ],
  },
};

// === WEBHOOK ENDPOINT ===
app.post("/bot", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// === HANDLE START COMMAND ===
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMINS.find(a => a.id.toString() === chatId)) return;
  bot.sendMessage(chatId, "Welcome! Choose an action:", mainMenu);
});

// === CALLBACK HANDLER ===
bot.on("callback_query", async (query) => {
  const adminId = query.message.chat.id.toString();
  if (!ADMINS.find(a => a.id.toString() === adminId)) return;
  const data = query.data;

  if (data === "interval_back") {
    await bot.editMessageText("Select interval:", {
      chat_id: adminId,
      message_id: query.message.message_id,
      reply_markup: intervalMenu.reply_markup,
    });
    return;
  }

  if (data === "main") {
    await bot.editMessageText("Welcome! Choose an action:", {
      chat_id: adminId,
      message_id: query.message.message_id,
      reply_markup: mainMenu.reply_markup,
    });
    return;
  }

  if (data === "start_menu" || data.startsWith("interval_")) {
    if (data.startsWith("interval_")) {
      const interval = data.split("_")[1];
      if (!sessions[adminId]) sessions[adminId] = {};
      sessions[adminId].selectedInterval = interval;
      const adminObj = ADMINS.find((a) => a.id.toString() === adminId);
      sessions[adminId].channel = adminObj.channel;
      await bot.editMessageText(`Interval selected: ${interval.toUpperCase()}\nChoose winning limit:`, {
        chat_id: adminId,
        message_id: query.message.message_id,
        reply_markup: winLimitMenu.reply_markup,
      });
    } else {
      await bot.editMessageText("Select interval:", {
        chat_id: adminId,
        message_id: query.message.message_id,
        reply_markup: intervalMenu.reply_markup,
      });
    }
    return;
  }

  if (data.startsWith("win_")) {
    const winLimit = parseInt(data.split("_")[1]);
    const session = sessions[adminId];
    session.winLimit = winLimit;
    session.winCount = 0;
    session.currentAmount = 1;
    session.lastPrediction = null;
    session.lastIssue = null;
    session.startIssue = null;
    session.winHistory = [];

    await bot.sendMessage(session.channel, `
🚨 Wingo Prediction Session Is Starting soon! 🎯
Get ready, everyone — we’re kicking off our next round of Wingo ${session.selectedInterval} predictions! 💥
Join in and let’s aim for another winning streak together. 💪
📲 Don’t forget to register here 👉 https://tinyurl.com/bhtclubs
and predict with us live! 🔥
    `.trim());

    session.autoInterval = setInterval(() => checkAndPredict(adminId), 2000);

    const msg = await bot.sendMessage(adminId, `✅ Forecast session started!\nInterval: ${session.selectedInterval.toUpperCase()}\nWin Limit: ${session.winLimit}`, backStopMenu);
    session.adminMessageId = msg.message_id;
    return;
  }

  if (data === "stop") {
    const session = sessions[adminId];
    if (session && session.autoInterval) clearInterval(session.autoInterval);
    sessions[adminId] = null;
    bot.sendMessage(adminId, "⏹ Forecasting stopped.", mainMenu);
    return;
  }
});

// === START EXPRESS SERVER ===
app.listen(PORT, () => console.log(`🚀 Express server running on port ${PORT}`));
