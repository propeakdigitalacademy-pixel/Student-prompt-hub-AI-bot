// ============================================================
// bot.js — Student Prompt Hub AI | Master Blueprint v4.0
// Built for Glitch.com | Node.js + Telegraf + Groq + lowdb
// ============================================================

require('dotenv').config();
require('./server'); // Start Express uptime server

const { Telegraf, Markup, session } = require('telegraf');
const Groq = require('groq-sdk');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────
// DATABASE SETUP (lowdb)
// ─────────────────────────────────────────
const adapter = new FileSync('database.json');
const db = low(adapter);

db.defaults({
  users: {},
  admin: { pin: process.env.ADMIN_PIN || 'PECULIAR123', api_usage: 0 },
  conversations: {},
  banned: {}
}).write();

// ─────────────────────────────────────────
// GROQ AI CLIENT
// ─────────────────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const PRIMARY_MODEL   = process.env.GROQ_MODEL          || 'qwen/qwen3-32b';
const FALLBACK_MODEL  = process.env.GROQ_FALLBACK_MODEL || 'llama3-8b-8192';

// ─────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────
const WA_CHANNEL  = 'https://whatsapp.com/channel/0029VbBUkLQLCoWzVkAHBg2D';
const WA_SUPPORT  = 'https://wa.me/2347042999216';
const WA_FEEDBACK = 'https://wa.me/2347042999216?text=Feedback%3A%20';
const BOT_SHARE   = 'https://t.me/StudentPromptHubBot'; // update with real username

// ─────────────────────────────────────────
// BOT INIT
// ─────────────────────────────────────────
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

bot.use(session());

// Middleware: init session
bot.use((ctx, next) => {
  if (!ctx.session) ctx.session = {};
  return next();
});

// ─────────────────────────────────────────
// HELPER: Get display name
// ─────────────────────────────────────────
function getDisplayName(userId, telegramUsername) {
  const users = db.get('users').value();
  if (users[userId] && users[userId].custom_name) {
    return users[userId].custom_name;
  }
  if (telegramUsername) return `@${telegramUsername}`;
  return 'Student';
}

// ─────────────────────────────────────────
// HELPER: Ensure user record exists
// ─────────────────────────────────────────
function ensureUser(ctx) {
  const userId = String(ctx.from.id);
  const users = db.get('users').value();
  if (!users[userId]) {
    const today = new Date().toISOString().split('T')[0];
    db.get('users').set(userId, {
      username: ctx.from.username ? `@${ctx.from.username}` : null,
      custom_name: null,
      joined_date: today,
      query_count: 0,
      is_banned: false
    }).write();
  }
  return userId;
}

// ─────────────────────────────────────────
// HELPER: Check if user is banned
// ─────────────────────────────────────────
function isBanned(userId) {
  const users = db.get('users').value();
  return users[userId] && users[userId].is_banned === true;
}

// ─────────────────────────────────────────
// HELPER: Increment query count
// ─────────────────────────────────────────
function incrementQuery(userId) {
  const current = db.get(`users.${userId}.query_count`).value() || 0;
  db.set(`users.${userId}.query_count`, current + 1).write();
  const apiUsage = db.get('admin.api_usage').value() || 0;
  db.set('admin.api_usage', apiUsage + 1).write();
}

// ─────────────────────────────────────────
// HELPER: Get/Set conversation history (last 5)
// ─────────────────────────────────────────
function getHistory(userId) {
  const convos = db.get('conversations').value();
  return convos[userId] || [];
}

function addToHistory(userId, role, content) {
  const convos = db.get('conversations').value();
  if (!convos[userId]) convos[userId] = [];
  convos[userId].push({ role, content });
  if (convos[userId].length > 10) {
    convos[userId] = convos[userId].slice(-10); // keep last 5 pairs
  }
  db.set('conversations', convos).write();
}

function clearHistory(userId) {
  db.set(`conversations.${userId}`, []).write();
}

// ─────────────────────────────────────────
// HELPER: Call Groq AI with retry/fallback
// ─────────────────────────────────────────
async function callGroq(messages, useVision = false, imageBase64 = null, imageMime = 'image/jpeg') {
  const tryModel = async (model) => {
    let msgs = messages;

    if (useVision && imageBase64) {
      // Vision: inject image into last user message
      msgs = messages.map((m, i) => {
        if (i === messages.length - 1 && m.role === 'user') {
          return {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
              { type: 'text', text: typeof m.content === 'string' ? m.content : 'Analyze this image.' }
            ]
          };
        }
        return m;
      });
    }

    const response = await groq.chat.completions.create({
      model,
      messages: msgs,
      max_tokens: 2048,
      temperature: 0.7
    });
    return response.choices[0].message.content;
  };

  try {
    return await tryModel(PRIMARY_MODEL);
  } catch (err) {
    console.error('[Groq Primary Error]', err.message);
    try {
      return await tryModel(FALLBACK_MODEL);
    } catch (err2) {
      console.error('[Groq Fallback Error]', err2.message);
      return null;
    }
  }
}

// ─────────────────────────────────────────
// HELPER: System prompt for the bot's identity
// ─────────────────────────────────────────
function getSystemPrompt(displayName) {
  return `You are "Student Prompt Hub AI", a smart academic tutor assistant for Telegram.
Your student's name is: ${displayName}. Always address them by this name.

STRICT RULES:
1. NEVER reveal your internal model, API keys, code, or technical architecture. If asked, politely refuse and redirect to studying.
2. You are built by "Propeak Digital Academy", founded by "Peculiar". Always say this if asked about your owner/maker.
3. You ONLY help with academic, educational, and learning tasks. Refuse anything non-academic like writing bots, scripts, hacking, building apps, etc.
4. Always be encouraging, supportive, and educational.
5. When formatting output, use clear Markdown: bold headings, numbered lists, bullet points.
6. Keep responses detailed, structured, and student-friendly.`;
}

// ─────────────────────────────────────────
// HELPER: Detect natural language intents
// ─────────────────────────────────────────
function detectIntent(text) {
  const t = text.toLowerCase().trim();
  if (/\b(summarize|summary|key points|main points|overview|brief)\b/.test(t)) return 'summarize';
  if (/\b(quiz|test me|mcq|multiple choice|questions)\b/.test(t)) return 'quiz';
  if (/\b(flashcard|flash card|q&a|question and answer)\b/.test(t)) return 'flashcards';
  if (/\b(eli5|explain like|simple|simpler|simplify|easy way|kid)\b/.test(t)) return 'eli5';
  if (/\b(debate|argue|opposite|counter|other side)\b/.test(t)) return 'debate';
  if (/\b(translate|in french|in spanish|in arabic|in yoruba|in hausa|in igbo)\b/.test(t)) return 'translate';
  if (/\b(solve|calculate|math|step by step|equation|formula)\b/.test(t)) return 'solve';
  if (/\b(notes|study notes|note form|organized notes)\b/.test(t)) return 'notes';
  if (/\b(explain|what is|what are|describe|tell me about|how does|why does|elaborate|detail)\b/.test(t)) return 'explain';
  return null;
}

// ─────────────────────────────────────────
// HELPER: Build AI prompt for learning commands
// ─────────────────────────────────────────
function buildLearningPrompt(intent, content, extraArg) {
  switch (intent) {
    case 'summarize':
      return `Summarize the following content into clear bullet points of key concepts:\n\n${content}`;
    case 'quiz':
      return `Create 5 multiple-choice questions (A/B/C/D) based on this content. Include an Answer Key at the bottom:\n\n${content}`;
    case 'flashcards':
      return `Create 8–10 flashcard Q&A pairs from this content. Format as:\nQ: ...\nA: ...\n\nContent:\n${content}`;
    case 'eli5':
      return `Explain this content as if I'm 5 years old, using simple analogies and everyday language:\n\n${content}`;
    case 'debate':
      return `Take the opposite/counter view to the main argument in this content. Present a compelling counter-argument:\n\n${content}`;
    case 'translate':
      return `Translate this content into ${extraArg || 'French'}:\n\n${content}`;
    case 'solve':
      return `Solve the following problem step-by-step, showing all working:\n\n${content}`;
    case 'notes':
      return `Convert this raw content into structured, well-organized study notes with headings and bullet points:\n\n${content}`;
    case 'explain':
      return `Explain the following in detail, clearly and thoroughly, with examples:\n\n${content}`;
    default:
      return content;
  }
}

// ─────────────────────────────────────────
// INLINE KEYBOARDS
// ─────────────────────────────────────────
const startKeyboard = Markup.inlineKeyboard([
  [Markup.button.url('🔗 Join WhatsApp Channel', WA_CHANNEL)],
  [Markup.button.callback('📂 Open Main Menu', 'main_menu')]
]);

const mainMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('📸 Upload Image/Notes', 'mode_image'), Markup.button.callback('📄 Upload PDF/Doc', 'mode_pdf')],
  [Markup.button.callback('❓ Quick Question', 'mode_chat'), Markup.button.callback('📜 View All Commands', 'view_commands')],
  [Markup.button.callback('⚙️ My Profile', 'view_profile'), Markup.button.callback('🔙 Back', 'back_start')]
]);

const actionKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('📋 Summarize', 'action_summarize'), Markup.button.callback('📝 Quiz Me', 'action_quiz')],
  [Markup.button.callback('🗂 Flashcards', 'action_flashcards'), Markup.button.callback('💡 Explain', 'action_explain')],
  [Markup.button.callback('⚖️ Debate', 'action_debate'), Markup.button.callback('🔢 Solve', 'action_solve')]
]);

const adminDashboardKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('👥 Users', 'admin_users'), Markup.button.callback('📊 Stats', 'admin_stats')],
  [Markup.button.callback('🚫 Ban User', 'admin_ban'), Markup.button.callback('📢 Broadcast', 'admin_broadcast')]
]);

// ─────────────────────────────────────────
// STUDY QUOTES for /motivate
// ─────────────────────────────────────────
const studyQuotes = [
  '📖 *"The secret of getting ahead is getting started."* — Mark Twain',
  '🌟 *"Education is the most powerful weapon which you can use to change the world."* — Nelson Mandela',
  '🚀 *"The more that you read, the more things you will know."* — Dr. Seuss',
  '💡 *"An investment in knowledge pays the best interest."* — Benjamin Franklin',
  '🎯 *"Success is the sum of small efforts, repeated day in and day out."* — Robert Collier',
  '📚 *"Intelligence plus character—that is the goal of true education."* — Martin Luther King Jr.',
  '⭐ *"The beautiful thing about learning is that nobody can take it away from you."* — B.B. King',
  '🔥 *"Believe you can and you are halfway there."* — Theodore Roosevelt',
  '✨ *"Study hard, dream big, achieve the impossible."*',
  '🌍 *"Your education is a dress rehearsal for a life that is yours to lead."* — Nora Ephron'
];

// ─────────────────────────────────────────
// /START COMMAND
// ─────────────────────────────────────────
bot.start(async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;

  const displayName = getDisplayName(userId, ctx.from.username);
  ctx.session.mode = null;

  await ctx.replyWithMarkdown(
    `👋 Welcome *${displayName}*\\! 🎓\n` +
    `I'm your personal *Student Prompt Hub AI*, here to make learning easy, fast, and free\\!\n\n` +
    `💡 *Pro Tip:* Join our WhatsApp channel for daily study tips, updates, and secret resources\\!\n\n` +
    `👇 *Tap a button below to get started:*`,
    startKeyboard
  );
});

// ─────────────────────────────────────────
// CALLBACK: Main Menu
// ─────────────────────────────────────────
bot.action('main_menu', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;
  const displayName = getDisplayName(userId, ctx.from.username);

  await ctx.replyWithMarkdown(
    `🛠️ *Select a Tool, ${displayName}:*\nChoose what you want to do with your notes or questions\\!`,
    mainMenuKeyboard
  );
});

// ─────────────────────────────────────────
// CALLBACK: Back to Start
// ─────────────────────────────────────────
bot.action('back_start', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;
  const displayName = getDisplayName(userId, ctx.from.username);
  ctx.session.mode = null;

  await ctx.replyWithMarkdown(
    `👋 Welcome back *${displayName}*\\! 🎓\nWhat would you like to do next?\n\n💡 *Join our WhatsApp channel for daily study tips\\!*`,
    startKeyboard
  );
});

// ─────────────────────────────────────────
// CALLBACK: Image Mode
// ─────────────────────────────────────────
bot.action('mode_image', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;

  ctx.session.mode = 'image_count_pending';
  ctx.session.imageCount = 0;
  ctx.session.imagesReceived = [];

  await ctx.replyWithMarkdown(
    `📸 *Image Mode Activated\\!*\n\nHow many images are you sending? _(Reply with a number, e\\.g\\. 3)_\\.\n_I will wait until I receive all of them before analyzing\\._`
  );
});

// ─────────────────────────────────────────
// CALLBACK: PDF Mode
// ─────────────────────────────────────────
bot.action('mode_pdf', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;

  ctx.session.mode = 'pdf_count_pending';
  ctx.session.pdfCount = 0;
  ctx.session.pdfsReceived = [];

  await ctx.replyWithMarkdown(
    `📄 *PDF/Doc Mode Activated\\!*\n\nHow many PDF files are you sending? _(Reply with a number, e\\.g\\. 2)_\\.\n_I will wait until I receive all of them before analyzing\\._`
  );
});

// ─────────────────────────────────────────
// CALLBACK: Chat Mode
// ─────────────────────────────────────────
bot.action('mode_chat', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;
  const displayName = getDisplayName(userId, ctx.from.username);

  ctx.session.mode = 'chat';
  await ctx.replyWithMarkdown(
    `❓ *Quick Question Mode, ${displayName}\\!*\n\nJust type your question or topic below and I'll help you understand it\\. You can also upload an image or paste text\\!`
  );
});

// ─────────────────────────────────────────
// CALLBACK: View Commands
// ─────────────────────────────────────────
bot.action('view_commands', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;

  await ctx.replyWithMarkdown(
    `📜 *Full Command List*\n\n` +
    `*👤 Profile & Info*\n` +
    `/start — Welcome message & menu\n` +
    `/setname <name> — Set your custom nickname\n` +
    `/profile — View your stats\n` +
    `/help — Detailed usage guide\n` +
    `/features — List all capabilities\n` +
    `/about — About this bot\n` +
    `/support — Contact support\n` +
    `/feedback — Send feedback\n` +
    `/share — Share this bot\n` +
    `/terms — Terms of service\n` +
    `/privacy — Privacy policy\n\n` +
    `*🎓 Learning Tools*\n` +
    `/summarize — Bullet point summary\n` +
    `/quiz — 5 MCQs with answer key\n` +
    `/flashcards — 8–10 Q&A pairs\n` +
    `/eli5 — Explain Like I'm 5\n` +
    `/debate — Counter-argument mode\n` +
    `/translate <lang> — Translate content\n` +
    `/solve — Step-by-step solution\n` +
    `/notes — Structured study notes\n\n` +
    `*🛠 Control*\n` +
    `/new\\_topic — Clear memory & start fresh\n` +
    `/motivate — Get a study quote\n` +
    `/timer — Start a 25-min Pomodoro timer\n\n` +
    `_Tip: You can also type naturally, like "explain this" or "quiz me"\\!_`
  );
});

// ─────────────────────────────────────────
// CALLBACK: Profile
// ─────────────────────────────────────────
bot.action('view_profile', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;
  const users = db.get('users').value();
  const user = users[userId];
  const displayName = getDisplayName(userId, ctx.from.username);

  await ctx.replyWithMarkdown(
    `⚙️ *Your Profile, ${displayName}\\!*\n\n` +
    `👤 *Name:* ${displayName}\n` +
    `📅 *Member Since:* ${user.joined_date || 'Unknown'}\n` +
    `🔢 *Total Queries:* ${user.query_count || 0}\n` +
    `📛 *Telegram Username:* ${user.username || 'Not set'}\n\n` +
    `_Use /setname YourName to set a custom nickname\\._`
  );
});
   
// ─────────────────────────────────────────
// CALLBACK: Post-upload action buttons
// ─────────────────────────────────────────
async function handleActionCallback(ctx, intent) {
  await ctx.answerCbQuery();
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;
  const displayName = getDisplayName(userId, ctx.from.username);

  const history = getHistory(userId);
  const lastContent = history.length > 0
    ? history.filter(m => m.role === 'user').slice(-1)[0]?.content || ''
    : '';

  if (!lastContent && !ctx.session.lastAnalyzedContent) {
    return ctx.replyWithMarkdown(`⚠️ *No content found\\!*\nPlease upload an image, PDF, or type a question first\\.`);
  }

  const content = ctx.session.lastAnalyzedContent || lastContent;
  const prompt = buildLearningPrompt(intent, content);
  const systemPrompt = getSystemPrompt(displayName);

  await ctx.replyWithMarkdown(`⏳ *Processing your request\\.\\.\\.*`);

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt }
  ];

  const result = await callGroq(messages);
  if (!result) {
    return ctx.replyWithMarkdown(`⚠️ AI is busy\\. Try again in a minute\\!`);
  }

  incrementQuery(userId);
  addToHistory(userId, 'user', prompt);
  addToHistory(userId, 'assistant', result);

  await ctx.replyWithMarkdown(result);
}

bot.action('action_summarize',  (ctx) => handleActionCallback(ctx, 'summarize'));
bot.action('action_quiz',       (ctx) => handleActionCallback(ctx, 'quiz'));
bot.action('action_flashcards', (ctx) => handleActionCallback(ctx, 'flashcards'));
bot.action('action_explain',    (ctx) => handleActionCallback(ctx, 'explain'));
bot.action('action_debate',     (ctx) => handleActionCallback(ctx, 'debate'));
bot.action('action_solve',      (ctx) => handleActionCallback(ctx, 'solve'));

// ─────────────────────────────────────────
// ADMIN CALLBACKS
// ─────────────────────────────────────────
bot.action('admin_users', async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.session.isAdmin) return;

  const users = db.get('users').value();
  const total = Object.keys(users).length;
  const banned = Object.values(users).filter(u => u.is_banned).length;

  await ctx.replyWithMarkdown(
    `👥 *User Statistics*\n\n` +
    `📊 Total Users: *${total}*\n` +
    `🚫 Banned Users: *${banned}*\n` +
    `✅ Active Users: *${total - banned}*`
  );
});

bot.action('admin_stats', async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.session.isAdmin) return;

  const apiUsage = db.get('admin.api_usage').value() || 0;
  const users = db.get('users').value();
  const total = Object.keys(users).length;

  await ctx.replyWithMarkdown(
    `📊 *Admin Dashboard Stats*\n\n` +
    `🔢 API Calls Used: *${apiUsage}*\n` +
    `👥 Total Users: *${total}*\n\n` +
    `_Use /stats PECULIAR123 for full stats\\._`
  );
});

bot.action('admin_ban', async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.session.isAdmin) return;
  await ctx.replyWithMarkdown(`🚫 *Ban a User*\n\nSend: \`/ban <PIN> <USER\\_ID>\`\nExample: \`/ban PECULIAR123 123456789\``);
});

bot.action('admin_broadcast', async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.session.isAdmin) return;
  await ctx.replyWithMarkdown(`📢 *Broadcast a Message*\n\nSend: \`/broadcast <PIN> <Your Message>\`\nExample: \`/broadcast PECULIAR123 Hello everyone\\!\``);
});

// ─────────────────────────────────────────
// /SETNAME COMMAND
// ─────────────────────────────────────────
bot.command('setname', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;

  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) {
    return ctx.replyWithMarkdown(`❌ Please provide a name\\.\nUsage: \`/setname YourName\``);
  }

  const newName = args.join(' ').trim();
  db.set(`users.${userId}.custom_name`, newName).write();

  await ctx.replyWithMarkdown(
    `✅ *Username Set Successfully\\!*\n\nHi *${newName}*, welcome to your smart learning hub\\! I'll call you by this name from now on\\. 🚀`
  );
});

// ─────────────────────────────────────────
// /PROFILE COMMAND
// ─────────────────────────────────────────
bot.command('profile', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;
  const users = db.get('users').value();
  const user = users[userId];
  const displayName = getDisplayName(userId, ctx.from.username);

  await ctx.replyWithMarkdown(
    `⚙️ *Your Profile, ${displayName}\\!*\n\n` +
    `👤 *Name:* ${displayName}\n` +
    `📅 *Member Since:* ${user.joined_date || 'Unknown'}\n` +
    `🔢 *Total Queries:* ${user.query_count || 0}\n` +
    `📛 *Telegram Username:* ${user.username || 'Not set'}\n\n` +
    `_Use /setname YourName to set a custom nickname\\._`
  );
});

// ─────────────────────────────────────────
// /HELP COMMAND
// ─────────────────────────────────────────
bot.command('help', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;
  const displayName = getDisplayName(userId, ctx.from.username);

  await ctx.replyWithMarkdown(
    `📚 *Help Guide — ${displayName}\\!*\n\n` +
    `*How to use Student Prompt Hub AI:*\n\n` +
    `1\\. Click /start to open the welcome menu\n` +
    `2\\. Tap *📂 Open Main Menu* to see your tools\n` +
    `3\\. *Upload Notes:* Tap 📸 for images or 📄 for PDFs\n` +
    `4\\. Tell the bot how many files you're sending\n` +
    `5\\. Upload all files one by one\n` +
    `6\\. Choose an action: Summarize, Quiz, Flashcards, etc\\.\n` +
    `7\\. You can also just *type a question* in the chat\\!\n\n` +
    `*🧠 Smart Features:*\n` +
    `• *Swipe/Reply* to any bot message to ask a follow-up question about it\n` +
    `• Type naturally: "explain this", "quiz me", "simplify"\n` +
    `• Use /new\\_topic to clear memory and start fresh\n\n` +
    `*📋 View All Commands:* /start → Main Menu → 📜 View All Commands`
  );
});

// ─────────────────────────────────────────
// /FEATURES COMMAND
// ─────────────────────────────────────────
bot.command('features', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;

  await ctx.replyWithMarkdown(
    `🌟 *Features of Student Prompt Hub AI*\n\n` +
    `📸 *Image Analysis & OCR* — Upload handwritten or printed notes\n` +
    `📄 *PDF Document Analysis* — Read and analyze textbooks, papers\n` +
    `🧠 *AI Summarization* — Get key points from any content\n` +
    `📝 *Quiz Generation* — Auto-create MCQs with answer keys\n` +
    `🗂 *Flashcard Creation* — Make revision Q&A pairs instantly\n` +
    `💡 *ELI5 Mode* — "Explain Like I'm 5" using simple analogies\n` +
    `⚖️ *Debate Mode* — AI argues the opposite side for critical thinking\n` +
    `🌍 *50+ Languages* — Translate content to any language\n` +
    `🔢 *Math/Science Solver* — Step-by-step solutions\n` +
    `📖 *Smart Notes* — Convert raw data to structured study notes\n` +
    `💬 *Smart Context* — Reply to any message for follow-up questions\n` +
    `🧹 *Memory Control* — Clear context with /new\\_topic anytime\n` +
    `⏱ *Pomodoro Timer* — 25-minute study timer via /timer\n` +
    `🎯 *Motivation* — Daily study quotes via /motivate`
  );
});

// ─────────────────────────────────────────
// /ABOUT COMMAND
// ─────────────────────────────────────────
bot.command('about', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;

  await ctx.replyWithMarkdown(
    `🎓 *About Student Prompt Hub AI*\n\n` +
    `Built by *Propeak Digital Academy*\\.\n` +
    `Founder: *Peculiar*\n\n` +
    `Peculiar is an expert *Video Editor*, *Web Developer*, *Graphics Designer*, and a master of many online skills\\.\n\n` +
    `This bot was created to make quality education accessible to every student for free\\.\n\n` +
    `💼 Want to hire Peculiar or see his work?`,
    Markup.inlineKeyboard([
      [Markup.button.url('💬 Contact Peculiar', WA_SUPPORT)]
    ])
  );
});

// ─────────────────────────────────────────
// /SUPPORT COMMAND
// ─────────────────────────────────────────
bot.command('support', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;

  await ctx.replyWithMarkdown(
    `💬 *Need Support?*\n\nReach out directly to our team on WhatsApp\\!`,
    Markup.inlineKeyboard([
      [Markup.button.url('💬 Chat with Peculiar on WhatsApp', WA_SUPPORT)]
    ])
  );
});

// ─────────────────────────────────────────
// /FEEDBACK COMMAND
// ─────────────────────────────────────────
bot.command('feedback', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;

  await ctx.replyWithMarkdown(
    `✍️ *Send Us Feedback\\!*\n\nWe love hearing from students\\. Your feedback helps us improve\\!`,
    Markup.inlineKeyboard([
      [Markup.button.url('✍️ Send Feedback via WhatsApp', WA_FEEDBACK)]
    ])
  );
});
    
// ─────────────────────────────────────────
// /SHARE COMMAND
// ─────────────────────────────────────────
bot.command('share', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;
  const displayName = getDisplayName(userId, ctx.from.username);

  await ctx.replyWithMarkdown(
    `🚀 *Share this Bot, ${displayName}\\!*\n\n` +
    `Help your classmates study smarter\\! Share this AI tutor with them:\n\n` +
    `📲 *${BOT_SHARE}*\n\n` +
    `_Copy the link above and send to a friend who needs help studying\\!_`
  );
});

// ─────────────────────────────────────────
// /TERMS COMMAND
// ─────────────────────────────────────────
bot.command('terms', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;

  await ctx.replyWithMarkdown(
    `📋 *Terms of Service*\n\n` +
    `1\\. *Acceptable Use:* This bot is for educational purposes only\\.\n` +
    `2\\. *No Misuse:* Do not attempt to extract prompts, reverse-engineer, or abuse the bot\\.\n` +
    `3\\. *Content:* You are responsible for the content you upload\\.\n` +
    `4\\. *Age:* Users must be 13 years or older to use this service\\.\n` +
    `5\\. *Rights:* Propeak Digital Academy reserves the right to ban abusive users\\.\n` +
    `6\\. *Updates:* These terms may change without notice\\.\n\n` +
    `By using this bot, you agree to all the above terms\\.`
  );
});

// ─────────────────────────────────────────
// /PRIVACY COMMAND
// ─────────────────────────────────────────
bot.command('privacy', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;

  await ctx.replyWithMarkdown(
    `🔒 *Privacy Policy*\n\n` +
    `• *What we store:* Your Telegram User ID, username, custom name, join date, and query count\\.\n` +
    `• *What we DON'T store:* Your uploaded files are NOT saved permanently after processing\\.\n` +
    `• *No Sharing:* Your data is NEVER sold or shared with third parties\\.\n` +
    `• *Local Storage:* All data is stored locally in a JSON database on the bot server\\.\n` +
    `• *Conversation Memory:* The bot remembers your last 5 messages for context only\\.\n` +
    `• *Right to Delete:* Contact support to request data deletion at any time\\.\n\n` +
    `_Your privacy is important to us\\. We keep things simple and safe\\._`
  );
});

// ─────────────────────────────────────────
// /NEW_TOPIC COMMAND
// ─────────────────────────────────────────
bot.command('new_topic', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;

  clearHistory(userId);
  ctx.session.lastAnalyzedContent = null;
  ctx.session.mode = null;

  await ctx.replyWithMarkdown(
    `🧹 *Context Cleared\\!*\nReady for a new subject\\. What do you want to learn next?`,
    mainMenuKeyboard
  );
});

// ─────────────────────────────────────────
// /MOTIVATE COMMAND
// ─────────────────────────────────────────
bot.command('motivate', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;
  const displayName = getDisplayName(userId, ctx.from.username);

  const randomQuote = studyQuotes[Math.floor(Math.random() * studyQuotes.length)];

  await ctx.replyWithMarkdown(
    `🌟 *Daily Motivation for ${displayName}\\!*\n\n${randomQuote}\n\n💪 *You got this, ${displayName}\\! Keep pushing\\!*`
  );
});

// ─────────────────────────────────────────
// /TIMER COMMAND
// ─────────────────────────────────────────
bot.command('timer', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;
  const displayName = getDisplayName(userId, ctx.from.username);

  await ctx.replyWithMarkdown(
    `⏱ *Pomodoro Timer Started, ${displayName}\\!*\n\n` +
    `🔴 *25 minutes of focused study begins NOW\\!*\n\n` +
    `📌 *The Pomodoro Technique:*\n` +
    `• Study hard for 25 minutes ⏳\n` +
    `• Take a 5-minute break ☕\n` +
    `• After 4 rounds, take a 15–30 min break 🛌\n\n` +
    `_Put your phone down and focus\\. I'll be here when you're done\\! 💪_`
  );

  // Schedule a reminder after 25 minutes
  setTimeout(async () => {
    try {
      await ctx.replyWithMarkdown(
        `🔔 *Time's up, ${displayName}\\!*\n\n` +
        `✅ Your 25-minute Pomodoro session is complete\\!\n\n` +
        `☕ *Take a 5-minute break now\\.*\n` +
        `You've earned it\\! Great work\\! 🎉`
      );
    } catch (e) {
      console.error('[Timer Reminder Error]', e.message);
    }
  }, 25 * 60 * 1000);
});

// ─────────────────────────────────────────
// LEARNING COMMANDS
// ─────────────────────────────────────────
async function handleLearningCommand(ctx, intent, extraArg) {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;
  const displayName = getDisplayName(userId, ctx.from.username);

  const history = getHistory(userId);
  const lastUserMsg = history.filter(m => m.role === 'user').slice(-1)[0]?.content;
  const content = ctx.session.lastAnalyzedContent || lastUserMsg;

  if (!content) {
    return ctx.replyWithMarkdown(
      `⚠️ *No content to work with\\!*\nPlease upload an image, PDF, or type your notes/question first, then use this command\\.`
    );
  }

  const prompt = buildLearningPrompt(intent, content, extraArg);
  const systemPrompt = getSystemPrompt(displayName);

  const typingMsg = await ctx.replyWithMarkdown(`⏳ *Working on it, ${displayName}\\.\\.\\.*`);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8),
    { role: 'user', content: prompt }
  ];

  const result = await callGroq(messages);
  if (!result) {
    return ctx.replyWithMarkdown(`⚠️ AI is busy\\. Please try again in a moment\\!`);
  }

  incrementQuery(userId);
  addToHistory(userId, 'user', prompt);
  addToHistory(userId, 'assistant', result);

  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, typingMsg.message_id);
  } catch (e) {}

  await ctx.replyWithMarkdown(result);
}

bot.command('summarize',  (ctx) => handleLearningCommand(ctx, 'summarize'));
bot.command('quiz',       (ctx) => handleLearningCommand(ctx, 'quiz'));
bot.command('flashcards', (ctx) => handleLearningCommand(ctx, 'flashcards'));
bot.command('eli5',       (ctx) => handleLearningCommand(ctx, 'eli5'));
bot.command('debate',     (ctx) => handleLearningCommand(ctx, 'debate'));
bot.command('solve',      (ctx) => handleLearningCommand(ctx, 'solve'));
bot.command('notes',      (ctx) => handleLearningCommand(ctx, 'notes'));

bot.command('translate', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const lang = args[0] || 'French';
  await handleLearningCommand(ctx, 'translate', lang);
});

// ─────────────────────────────────────────
// ADMIN COMMANDS (Secure & Silent)
// ─────────────────────────────────────────
function checkAdminPin(pin) {
  const storedPin = db.get('admin.pin').value();
  return pin === storedPin;
}

bot.command('admin', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const pin = parts[1];
  if (!pin || !checkAdminPin(pin)) return; // SILENT FAIL

  ctx.session.isAdmin = true;
  await ctx.replyWithMarkdown(
    `🛡️ *Admin Dashboard*\n\nWelcome, Administrator\\. Choose an action:`,
    adminDashboardKeyboard
  );
});

bot.command('ban', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const pin = parts[1];
  const targetId = parts[2];
  if (!pin || !checkAdminPin(pin)) return; // SILENT FAIL
  if (!targetId) return ctx.replyWithMarkdown(`❌ Usage: \`/ban <PIN> <USER\\_ID>\``);

  db.set(`users.${targetId}.is_banned`, true).write();
  await ctx.replyWithMarkdown(`✅ User \`${targetId}\` has been *banned*\\.`);
});

bot.command('unban', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const pin = parts[1];
  const targetId = parts[2];
  if (!pin || !checkAdminPin(pin)) return; // SILENT FAIL
  if (!targetId) return ctx.replyWithMarkdown(`❌ Usage: \`/unban <PIN> <USER\\_ID>\``);

  db.set(`users.${targetId}.is_banned`, false).write();
  await ctx.replyWithMarkdown(`✅ User \`${targetId}\` has been *unbanned*\\.`);
});

bot.command('broadcast', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const pin = parts[1];
  const message = parts.slice(2).join(' ');
  if (!pin || !checkAdminPin(pin)) return; // SILENT FAIL
  if (!message) return ctx.replyWithMarkdown(`❌ Usage: \`/broadcast <PIN> <Message>\``);

  const users = db.get('users').value();
  const userIds = Object.keys(users).filter(id => !users[id].is_banned);
  let successCount = 0;
  let failCount = 0;

  await ctx.replyWithMarkdown(`📢 *Broadcasting to ${userIds.length} users\\.\\.\\.*`);

  for (const uid of userIds) {
    try {
      await ctx.telegram.sendMessage(uid, `📢 *Announcement from Student Prompt Hub AI:*\n\n${message}`, { parse_mode: 'Markdown' });
      successCount++;
      await new Promise(r => setTimeout(r, 50)); // Rate limit buffer
    } catch (e) {
      failCount++;
    }
  }

  await ctx.replyWithMarkdown(
    `✅ *Broadcast Complete\\!*\n\n📤 Sent: *${successCount}*\n❌ Failed: *${failCount}*`
  );
});

bot.command('stats', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const pin = parts[1];
  if (!pin || !checkAdminPin(pin)) return; // SILENT FAIL

  const apiUsage = db.get('admin.api_usage').value() || 0;
  const users = db.get('users').value();
  const total = Object.keys(users).length;
  const banned = Object.values(users).filter(u => u.is_banned).length;

  await ctx.replyWithMarkdown(
    `📊 *Bot Statistics*\n\n` +
    `👥 Total Users: *${total}*\n` +
    `🚫 Banned: *${banned}*\n` +
    `✅ Active: *${total - banned}*\n` +
    `🔢 Total API Calls: *${apiUsage}*`
  );
});

bot.command('reset_usage', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const pin = parts[1];
  if (!pin || !checkAdminPin(pin)) return; // SILENT FAIL

  db.set('admin.api_usage', 0).write();
  await ctx.replyWithMarkdown(`✅ *API usage counter has been reset to 0\\.*`);
});

// Change PIN: /admin <PIN> pc <NEW_PIN>
bot.hears(/^\/admin\s+(\S+)\s+pc\s+(\S+)$/, async (ctx) => {
  const match = ctx.match;
  const currentPin = match[1];
  const newPin = match[2];
  if (!checkAdminPin(currentPin)) return; // SILENT FAIL

  db.set('admin.pin', newPin).write();
  process.env.ADMIN_PIN = newPin;
  await ctx.replyWithMarkdown(`✅ *Admin PIN changed successfully\\!*\nNew PIN is saved securely\\.`);
});

// ─────────────────────────────────────────
// PHOTO HANDLER (Image Upload & Vision)
// ─────────────────────────────────────────
bot.on('photo', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;
  const displayName = getDisplayName(userId, ctx.from.username);

  // === BATCH IMAGE MODE ===
  if (ctx.session.mode === 'image_awaiting') {
    if (!ctx.session.imagesReceived) ctx.session.imagesReceived = [];

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    ctx.session.imagesReceived.push(photo.file_id);

    const received = ctx.session.imagesReceived.length;
    const expected = ctx.session.imageCount;

    if (received < expected) {
      await ctx.replyWithMarkdown(`✅ *Image ${received}/${expected} received\\. Send the next one\\.*`);
      return;
    }

    // All images received
    await ctx.replyWithMarkdown(
      `✅ *All ${expected} image${expected > 1 ? 's' : ''} received\\!* What should I do?\nChoose an action or type a command:`,
      actionKeyboard
    );

    // Process the LAST image with vision for context
    const lastFileId = ctx.session.imagesReceived[ctx.session.imagesReceived.length - 1];
    try {
      const fileInfo = await ctx.telegram.getFile(lastFileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
      const fetch = require('node-fetch');
      const response = await fetch(fileUrl);
      const buffer = await response.buffer();
      const base64 = buffer.toString('base64');

      const visionMessages = [
        { role: 'system', content: getSystemPrompt(displayName) },
        { role: 'user', content: 'Describe what is in this image in detail. Extract all text, formulas, and key information you can see. This is academic content.' }
      ];

      const visionResult = await callGroq(visionMessages, true, base64, 'image/jpeg');
      if (visionResult) {
        ctx.session.lastAnalyzedContent = visionResult;
        addToHistory(userId, 'user', '[User uploaded image(s)]');
        addToHistory(userId, 'assistant', visionResult);
        incrementQuery(userId);
      }
    } catch (e) {
      console.error('[Vision Error]', e.message);
    }

    ctx.session.mode = null;
    ctx.session.imageCount = 0;
    ctx.session.imagesReceived = [];
    return;
  }

  // === SINGLE IMAGE (direct send) ===
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  const caption = ctx.message.caption || 'Analyze this image and extract all academic content, text, formulas, and key information.';

  // Handle smart reply context
  let contextPrefix = '';
  if (ctx.message.reply_to_message && ctx.message.reply_to_message.text) {
    contextPrefix = `Context from previous message: "${ctx.message.reply_to_message.text}"\n\n`;
  }

  await ctx.replyWithMarkdown(`🔍 *Analyzing your image, ${displayName}\\.\\.\\.*`);

  try {
    const fileInfo = await ctx.telegram.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    const fetch = require('node-fetch');
    const response = await fetch(fileUrl);
    const buffer = await response.buffer();
    const base64 = buffer.toString('base64');

    const history = getHistory(userId);
    const visionMessages = [
      { role: 'system', content: getSystemPrompt(displayName) },
      ...history.slice(-6),
      { role: 'user', content: `${contextPrefix}${caption}` }
    ];

    const result = await callGroq(visionMessages, true, base64, 'image/jpeg');
    if (!result) {
      return ctx.replyWithMarkdown(`⚠️ Could not analyze image\\. Try again or rephrase your request\\.`);
    }

    ctx.session.lastAnalyzedContent = result;
    incrementQuery(userId);
    addToHistory(userId, 'user', caption);
    addToHistory(userId, 'assistant', result);

    await ctx.replyWithMarkdown(result, actionKeyboard);
  } catch (e) {
    console.error('[Photo Handler Error]', e.message);
    await ctx.replyWithMarkdown(`❌ Could not process this image\\. Please try again\\.`);
  }
});

// ─────────────────────────────────────────
// DOCUMENT HANDLER (PDF/Doc Upload)
// ─────────────────────────────────────────
bot.on('document', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;
  const displayName = getDisplayName(userId, ctx.from.username);

  const doc = ctx.message.document;
  const mimeType = doc.mime_type || '';

  // === BATCH PDF MODE ===
  if (ctx.session.mode === 'pdf_awaiting') {
    if (!ctx.session.pdfsReceived) ctx.session.pdfsReceived = [];
    ctx.session.pdfsReceived.push({ fileId: doc.file_id, name: doc.file_name });

    const received = ctx.session.pdfsReceived.length;
    const expected = ctx.session.pdfCount;

    if (received < expected) {
      await ctx.replyWithMarkdown(`✅ *PDF ${received}/${expected} received\\. Send the next one\\.*`);
      return;
    }

    // All PDFs received
    await ctx.replyWithMarkdown(
      `✅ *All ${expected} PDF${expected > 1 ? 's' : ''} received\\! Ready for analysis\\.*\n\nUse /summarize, /quiz, or ask a question\\!`,
      actionKeyboard
    );

    // Store placeholder content for the session
    ctx.session.lastAnalyzedContent = `[User uploaded ${expected} PDF document(s): ${ctx.session.pdfsReceived.map(p => p.name).join(', ')}]`;
    ctx.session.mode = null;
    ctx.session.pdfCount = 0;
    ctx.session.pdfsReceived = [];
    return;
  }

  // === SINGLE DOCUMENT ===
  if (!mimeType.includes('pdf') && !mimeType.includes('document') && !mimeType.includes('text') && !mimeType.includes('msword') && !mimeType.includes('officedocument')) {
    return ctx.replyWithMarkdown(`❌ *Unsupported file type\\.*\nPlease upload a PDF, Word document, or text file\\.`);
  }

  await ctx.replyWithMarkdown(`📄 *Processing your document, ${displayName}\\.\\.\\.*`);

  try {
    const fileInfo = await ctx.telegram.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    const fetch = require('node-fetch');
    const response = await fetch(fileUrl);
    const buffer = await response.buffer();

    let extractedText = '';

    if (mimeType.includes('pdf')) {
      // Use basic PDF text extraction
      try {
        // Try to extract readable text from buffer as UTF-8
        const rawText = buffer.toString('utf8');
        // Extract readable strings (heuristic for simple PDFs)
        const readable = rawText.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
        if (readable.length > 100) {
          extractedText = readable.substring(0, 6000);
        } else {
          extractedText = `[PDF Document: ${doc.file_name}. The document appears to be image-based or scanned. Please describe the content you'd like analyzed.]`;
        }
      } catch (e) {
        extractedText = `[PDF Document: ${doc.file_name}]`;
      }
    } else {
      extractedText = buffer.toString('utf8').substring(0, 6000);
    }

    const caption = ctx.message.caption || 'Analyze this document and extract all key academic content, main topics, and important information.';
    const history = getHistory(userId);

    const messages = [
      { role: 'system', content: getSystemPrompt(displayName) },
      ...history.slice(-6),
      { role: 'user', content: `Document content:\n${extractedText}\n\nUser instruction: ${caption}` }
    ];

    const result = await callGroq(messages);
    if (!result) {
      return ctx.replyWithMarkdown(`⚠️ Could not analyze document\\. Please try again\\.`);
    }

    ctx.session.lastAnalyzedContent = extractedText;
    incrementQuery(userId);
    addToHistory(userId, 'user', `[Uploaded document: ${doc.file_name}]`);
    addToHistory(userId, 'assistant', result);

    await ctx.replyWithMarkdown(result, actionKeyboard);
  } catch (e) {
    console.error('[Document Handler Error]', e.message);
    await ctx.replyWithMarkdown(`❌ Could not read this file\\. Try another or paste the text directly\\.`);
  }
});
  
// ─────────────────────────────────────────
// TEXT MESSAGE HANDLER (Chat, Natural Language)
// ─────────────────────────────────────────
bot.on('text', async (ctx) => {
  const userId = ensureUser(ctx);
  if (isBanned(userId)) return;
  const displayName = getDisplayName(userId, ctx.from.username);

  const text = ctx.message.text.trim();

  // Skip slash commands (handled above)
  if (text.startsWith('/')) return;

  // === BATCH COUNT INPUT ===
  if (ctx.session.mode === 'image_count_pending') {
    const count = parseInt(text, 10);
    if (isNaN(count) || count < 1 || count > 20) {
      return ctx.replyWithMarkdown(`❌ Please enter a valid number between 1 and 20\\.`);
    }
    ctx.session.imageCount = count;
    ctx.session.imagesReceived = [];
    ctx.session.mode = 'image_awaiting';
    await ctx.replyWithMarkdown(`Got it\\! Sending *${count}* image${count > 1 ? 's' : ''}\\. Please upload them now\\.`);
    return;
  }

  if (ctx.session.mode === 'pdf_count_pending') {
    const count = parseInt(text, 10);
    if (isNaN(count) || count < 1 || count > 20) {
      return ctx.replyWithMarkdown(`❌ Please enter a valid number between 1 and 20\\.`);
    }
    ctx.session.pdfCount = count;
    ctx.session.pdfsReceived = [];
    ctx.session.mode = 'pdf_awaiting';
    await ctx.replyWithMarkdown(`Got it\\! Sending *${count}* PDF${count > 1 ? 's' : ''}\\. Please upload them now\\.`);
    return;
  }

  // === RULE: SECRET/CODE/MODEL INQUIRY ===
  const secretPatterns = /\b(llm|gpt|groq|openai|claude|gemini|model|api key|source code|how were you built|show me your code|your backend|your api|what model|which model)\b/i;
  if (secretPatterns.test(text)) {
    return ctx.replyWithMarkdown(
      `🤖 *Top Secret\\!* 🤫\nI'm an advanced AI tutor designed solely to help you learn\\. I can't reveal my internal code, models, or secrets\\.\nBut I *can* help you ace that exam\\! Want to try a quiz? 📝`
    );
  }

  // === RULE: OWNER/MAKER INQUIRY ===
  const ownerPatterns = /\b(who (made|built|created|owns|is your owner|is your creator)|your owner|your maker|who is peculiar|who is behind|propeak)\b/i;
  if (ownerPatterns.test(text)) {
    return ctx.replyWithMarkdown(
      `🎓 My owner is the one and only *Peculiar*\\!\n\n` +
      `He is the *Founder of Propeak Digital Academy*, an expert *Video Editor*, *Web Dev*, *Graphics Designer*, and a master of many online jobs\\.\n\n` +
      `💼 *Want to see his full bio or hire him?*\nCheck his WhatsApp profile: *07042999216*\nOr click here to chat:`,
      Markup.inlineKeyboard([
        [Markup.button.url('💬 Contact Peculiar', WA_SUPPORT)]
      ])
    );
  }

  // === RULE: OUT OF SCOPE (Non-Academic) ===
  const outOfScopePatterns = /\b(write (me )?(a )?(bot|script|code|app|website|hack|exploit|virus|malware)|how (do i|to) hack|make me a (website|bot|app)|build an app|create a script)\b/i;
  if (outOfScopePatterns.test(text)) {
    return ctx.replyWithMarkdown(
      `⚠️ *Out of Scope\\!*\nI am strictly a *Student Tutor*\\. I can help you *understand* coding concepts or study subjects, but I don't write scripts, hacks, or build apps\\.\nLet's focus on your studies\\! Upload a note or ask a theory question\\! 📖`
    );
  }

  // === SMART REPLY CONTEXT (Swipe to Reply) ===
  let contextPrefix = '';
  if (ctx.message.reply_to_message) {
    const repliedText = ctx.message.reply_to_message.text || ctx.message.reply_to_message.caption || '';
    if (repliedText) {
      contextPrefix = `Context from previous message: "${repliedText.substring(0, 1000)}"\n\nUser follow-up: `;
    }
  }

  // === DETECT NATURAL LANGUAGE INTENT ===
  const intent = detectIntent(text);
  let userPrompt;

  if (intent && (ctx.session.lastAnalyzedContent || getHistory(userId).length > 0)) {
    const content = ctx.session.lastAnalyzedContent
      || getHistory(userId).filter(m => m.role === 'user').slice(-1)[0]?.content
      || text;
    userPrompt = buildLearningPrompt(intent, content);
  } else {
    userPrompt = `${contextPrefix}${text}`;
  }

  // === SEND TO AI ===
  const history = getHistory(userId);
  const systemPrompt = getSystemPrompt(displayName);

  const typingIndicator = await ctx.replyWithMarkdown(`💭 *Thinking, ${displayName}\\.\\.\\.*`);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8),
    { role: 'user', content: userPrompt }
  ];

  const result = await callGroq(messages);

  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, typingIndicator.message_id);
  } catch (e) {}

  if (!result) {
    return ctx.replyWithMarkdown(`⚠️ *AI is busy right now\\.*\nPlease try again in a minute\\! 🔄`);
  }

  incrementQuery(userId);
  addToHistory(userId, 'user', userPrompt);
  addToHistory(userId, 'assistant', result);

  // Send result (split if too long for Telegram's 4096 char limit)
  if (result.length <= 4000) {
    await ctx.replyWithMarkdown(result);
  } else {
    const chunks = [];
    let i = 0;
    while (i < result.length) {
      chunks.push(result.slice(i, i + 4000));
      i += 4000;
    }
    for (const chunk of chunks) {
      await ctx.replyWithMarkdown(chunk);
      await new Promise(r => setTimeout(r, 300));
    }
  }
});

// ─────────────────────────────────────────
// UNKNOWN COMMAND FALLBACK
// ─────────────────────────────────────────
bot.on('message', async (ctx) => {
  if (ctx.message && !ctx.message.text && !ctx.message.photo && !ctx.message.document) {
    const userId = ensureUser(ctx);
    if (isBanned(userId)) return;
    await ctx.replyWithMarkdown(
      `❓ *Unknown message type\\.*\nI can handle text, images, and PDF documents\\.\nType /help for a full guide\\.`
    );
  }
});

// ─────────────────────────────────────────
// GLOBAL ERROR HANDLER
// ─────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`[Bot Error] Type: ${ctx.updateType}`, err);
  try {
    ctx.replyWithMarkdown(`⚠️ *Something went wrong\\.*\nPlease try again or type /start to restart\\.`);
  } catch (e) {}
});

// ─────────────────────────────────────────
// LAUNCH BOT
// ─────────────────────────────────────────
bot.launch()
  .then(() => console.log('[Bot] 🎓 Student Prompt Hub AI is LIVE!'))
  .catch(err => console.error('[Bot Launch Error]', err));

// Graceful stop
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
