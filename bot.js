// Dreinn AI — Telegram-бот, Mini App и админ-панель в одном файле.
// Бот встречает баннером и открывает приложение. Чат с нейросетями, генерация изображений и видео,
// профиль и админка — внутри Mini App.
// Без npm-зависимостей: нужен Node.js ≥ 22.13 (встроенные node:sqlite, fetch, FormData, zlib).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import util from 'node:util';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/* ───────────────────────────── Конфиг ───────────────────────────── */

// .env рядом с файлом подхватывается сам; переменные окружения (панель хостинга, docker --env-file) важнее
try {
  const vars = util.parseEnv(fs.readFileSync(path.join(ROOT, '.env'), 'utf8'));
  for (const [k, v] of Object.entries(vars)) process.env[k] ??= v;
} catch {}

// node:sqlite всё ещё помечен experimental — глушим только это предупреждение
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w?.message ?? w).includes('SQLite') ? undefined : emitWarning.call(process, w, ...rest));
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.error(`✖ Нужен Node.js 22.13 или новее, сейчас ${process.version}. На bothost.ru включи «Использовать собственный Dockerfile».`);
  process.exit(1);
}

const env = (k, d = '') => String(process.env[k] ?? d).trim();
const domain = env('DOMAIN').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const CFG = {
  token: env('BOT_TOKEN') || env('TELEGRAM_BOT_TOKEN') || env('API_TOKEN'),
  botUsername: env('BOT_USERNAME').replace(/^@/, ''),
  publicUrl: (env('PUBLIC_URL') || (domain ? `https://${domain}` : '')).replace(/\/+$/, ''),
  host: env('HOST', '0.0.0.0'),
  port: Number(env('PORT', '3000')),
  aiBase: env('AI_BASE_URL', 'https://vibecode.moe').replace(/\/+$/, ''),
  aiKey: env('AI_API_KEY'),
  adminIds: env('ADMIN_IDS').split(/[\s,;]+/).filter(Boolean).map(Number),
  adminPassword: env('ADMIN_PASSWORD'),
  dataDir: path.resolve(ROOT, env('DATA_DIR', 'data')),
  webhook: env('WEBHOOK') === '1',
  polling: env('POLLING') !== '0',
  devAuth: env('DEV_AUTH') === '1',
  tz: env('TIMEZONE', 'Europe/Moscow'),
};
if (!CFG.token) {
  console.error('✖ BOT_TOKEN не задан — заполни .env или переменные окружения (пример в .env.example)');
  process.exit(1);
}
const HAS_APP = CFG.publicUrl.startsWith('https://');

// Прокси для запросов к Telegram и нейросетям (Node 24+): PROXY_URL, HTTP(S)_PROXY
// или системный прокси Windows (его ставят VPN-клиенты вроде v2rayN, а Node сам его не видит)
function windowsProxy() {
  if (process.platform !== 'win32') return '';
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { encoding: 'utf8', windowsHide: true });
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/.test(out)) return '';
    const server = /ProxyServer\s+REG_SZ\s+(\S+)/.exec(out)?.[1] || '';
    const hp = /(?:^|;)https?=([^;]+)/.exec(server)?.[1] || (server.includes('=') ? '' : server);
    return hp ? (hp.includes('://') ? hp : `http://${hp}`) : '';
  } catch { return ''; }
}
const PROXY = env('PROXY_URL') || env('HTTPS_PROXY') || env('https_proxy') || env('HTTP_PROXY') || env('http_proxy') || windowsProxy();
if (PROXY && http.setGlobalProxyFromEnv) {
  http.setGlobalProxyFromEnv({ HTTPS_PROXY: PROXY, HTTP_PROXY: PROXY, NO_PROXY: env('NO_PROXY', 'localhost,127.0.0.1,::1') });
}
for (const dir of ['emoji', 'avatars', 'uploads', 'media']) fs.mkdirSync(path.join(CFG.dataDir, dir), { recursive: true });

/* ───────────────────────────── Утилиты ───────────────────────────── */

const now = () => Date.now();
const sleep = (ms, signal) => new Promise((ok, no) => {
  const t = setTimeout(ok, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); no(new Error('aborted')); }, { once: true });
});
const log = (...a) => console.log(new Date().toLocaleTimeString('ru-RU', { timeZone: CFG.tz }), ...a);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const money = n => `${round2(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: CFG.tz });
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + '…' : String(s));
const parseJson = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const httpErr = (status, message, code) => Object.assign(new Error(message), { status, expose: true, code });
const userErr = message => httpErr(400, message);
const sign = s => crypto.createHmac('sha256', CFG.token).update(String(s)).digest('hex').slice(0, 16);
const tzOffset = () => {
  const d = new Date();
  return new Date(d.toLocaleString('en-US', { timeZone: CFG.tz })) - new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
};

/* ───────────────────────────── База данных ───────────────────────────── */

const db = new DatabaseSync(path.join(CFG.dataDir, 'dreinn.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT, lang TEXT,
  is_premium INTEGER DEFAULT 0, photo_url TEXT,
  balance REAL DEFAULT 0, spent REAL DEFAULT 0, requests INTEGER DEFAULT 0,
  model_id INTEGER, dialog INTEGER DEFAULT 1,
  ref_by INTEGER, ref_earned REAL DEFAULT 0,
  is_admin INTEGER DEFAULT 0, banned INTEGER DEFAULT 0, blocked INTEGER DEFAULT 0,
  free_day TEXT, free_used INTEGER DEFAULT 0,
  tg TEXT, tg_at INTEGER DEFAULT 0,
  created_at INTEGER, seen_at INTEGER
);
CREATE INDEX IF NOT EXISTS users_ref ON users(ref_by);
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, model TEXT NOT NULL,
  kind TEXT DEFAULT 'chat', api TEXT DEFAULT 'anthropic', base_url TEXT DEFAULT '', api_key TEXT DEFAULT '',
  description TEXT DEFAULT '', emoji_id TEXT DEFAULT '', emoji TEXT DEFAULT '🤖',
  price REAL DEFAULT 0, badge TEXT DEFAULT '', tag TEXT DEFAULT '', power INTEGER DEFAULT 50,
  system_prompt TEXT DEFAULT '', max_tokens INTEGER DEFAULT 4096, temperature REAL,
  context INTEGER DEFAULT 12, vision INTEGER DEFAULT 1, extra TEXT DEFAULT '',
  active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, model_id INTEGER, model_name TEXT, kind TEXT,
  price REAL DEFAULT 0, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
  status TEXT, error TEXT, prompt TEXT, ms INTEGER, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS requests_user ON requests(user_id, id);
CREATE INDEX IF NOT EXISTS requests_time ON requests(created_at);
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, model_id INTEGER, title TEXT, created_at INTEGER, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS chats_user ON chats(user_id, updated_at);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, user_id INTEGER, role TEXT, content TEXT DEFAULT '',
  media TEXT DEFAULT '[]', model_id INTEGER, model_name TEXT, kind TEXT, status TEXT DEFAULT 'ok',
  price REAL DEFAULT 0, error TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS chat_messages_chat ON chat_messages(chat_id, id);
DROP TABLE IF EXISTS messages;
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount REAL, stars INTEGER DEFAULT 0,
  method TEXT, note TEXT, ref TEXT UNIQUE, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS payments_user ON payments(user_id, id);
CREATE TABLE IF NOT EXISTS emojis (
  id TEXT PRIMARY KEY, set_name TEXT, emoji TEXT, format TEXT, repaint INTEGER DEFAULT 0,
  file_id TEXT, thumb_id TEXT, in_library INTEGER DEFAULT 0, added_at INTEGER
);
CREATE TABLE IF NOT EXISTS emoji_sets (name TEXT PRIMARY KEY, title TEXT, count INTEGER, added_at INTEGER);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created_at INTEGER);
`);

const stmts = new Map();
const prep = sql => stmts.get(sql) ?? stmts.set(sql, db.prepare(sql)).get(sql);
const norm = p => p.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const one = (sql, ...p) => prep(sql).get(...norm(p));
const all = (sql, ...p) => prep(sql).all(...norm(p));
const run = (sql, ...p) => prep(sql).run(...norm(p));
const tx = fn => {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};

/* ───────────────────────────── Настройки ───────────────────────────── */

const DEFAULTS = {
  brand: 'Dreinn AI',
  tagline: 'нейросети прямо в Telegram',
  bot_banner: '',
  bot_text: '{emoji} <b>{brand}</b> — нейросети в одном приложении\n\nОбщайся с топовыми моделями, создавай изображения и видео. Всё — по кнопке ниже.',
  bot_button: 'Открыть Dreinn AI',
  banner: '',
  info: 'Dreinn AI — доступ к топовым нейросетям прямо в Telegram: умный чат, генерация изображений и видео. Платишь только за запросы.',
  topup_info: 'Оплата через СБП и картой появится совсем скоро. А пока баланс пополняет администратор — напиши в поддержку и укажи свой ID.',
  system_prompt: 'Ты — Dreinn AI, умный ассистент. Сегодня {date}. Отвечай на языке пользователя: по делу, структурно и дружелюбно. Используй Markdown: заголовки, списки, **жирный**, `код` и блоки кода.',
  ref_percent: '10',
  start_bonus: '0',
  free_daily: '15',
  min_transfer: '10',
  support: '',
  default_model: '',
  bot_emoji: '1',
};

// Что админ может менять в разделе «Настройки»
const SETTINGS_META = [
  { group: 'Бот', key: 'bot_banner', label: 'Баннер после /start', type: 'image', hint: 'Картинка над приветствием в чате с ботом' },
  { group: 'Бот', key: 'bot_text', label: 'Текст после /start', type: 'textarea', hint: 'HTML Telegram, до 1024 символов. {emoji} — логотип, {brand} — название, {name} — имя' },
  { group: 'Бот', key: 'bot_button', label: 'Текст кнопки', type: 'text' },
  { group: 'Бот', key: 'bot_emoji', label: 'Премиум-эмодзи в боте', type: 'bool', hint: 'Нужен Telegram Premium у владельца бота' },
  { group: 'Приложение', key: 'brand', label: 'Название', type: 'text' },
  { group: 'Приложение', key: 'tagline', label: 'Подзаголовок', type: 'text' },
  { group: 'Приложение', key: 'banner', label: 'Баннер в приложении', type: 'image', hint: 'Фон карточки с балансом. Пусто — фирменный градиент' },
  { group: 'Приложение', key: 'info', label: 'Раздел «Инфо»', type: 'textarea' },
  { group: 'Приложение', key: 'support', label: 'Поддержка', type: 'text', hint: '@username' },
  { group: 'Нейросети', key: 'system_prompt', label: 'Общий системный промпт', type: 'textarea', hint: '{date} — дата, {name} — имя' },
  { group: 'Нейросети', key: 'default_model', label: 'Модель по умолчанию', type: 'model' },
  { group: 'Нейросети', key: 'free_daily', label: 'Бесплатных запросов в день', type: 'number', hint: 'Для моделей с ценой 0. 0 — без лимита' },
  { group: 'Баланс', key: 'topup_info', label: 'Текст «Пополнение»', type: 'textarea' },
  { group: 'Баланс', key: 'start_bonus', label: 'Бонус при регистрации, ₽', type: 'number' },
  { group: 'Баланс', key: 'ref_percent', label: 'Реферальный процент', type: 'number', hint: 'С пополнений приглашённых' },
  { group: 'Баланс', key: 'min_transfer', label: 'Минимальный перевод, ₽', type: 'number' },
];

// Иконки-слоты: админ заменяет их премиум-эмодзи. По умолчанию — пак t.me/addemoji/tgiosicons
const SLOTS = [
  ['brand', 'Логотип', 'both', '5890925363067886150', '✨'],
  ['app', 'Кнопка «Открыть»', 'bot', '5776233299424843260', '🌐'],
  ['nav_chat', 'Меню: чат', 'app', '', '💬'],
  ['nav_history', 'Меню: история', 'app', '', '🗂'],
  ['nav_info', 'Меню: инфо', 'app', '', 'ℹ️'],
  ['nav_profile', 'Меню: профиль', 'app', '', '👤'],
  ['kind_chat', 'Тип: чат', 'app', '6030784887093464891', '💬'],
  ['kind_image', 'Тип: изображения', 'app', '6030466823290360017', '🖼'],
  ['kind_video', 'Тип: видео', 'app', '5886579539064132088', '🎥'],
  ['topup', 'Пополнить', 'app', '5778421276024509124', '💰'],
  ['transfer', 'Передать', 'app', '6039573425268201570', '📤'],
  ['ref', 'Рефералы', 'app', '6032609071373226027', '👥'],
  ['wallet', 'Баланс', 'app', '5769126056262898415', '👛'],
  ['gift', 'Бонус', 'app', '6032644646587338669', '🎁'],
  ['admin', 'Админка', 'app', '5904258298764334001', '⚙️'],
  ['history_head', 'Шапка «История»', 'app', '5766994197705921104', '🗂'],
  ['info_head', 'Шапка «Инфо»', 'app', '6028435952299413210', 'ℹ️'],
  ['empty', 'Пустой список', 'app', '5904248647972820334', '💭'],
].map(([key, label, group, def, alt]) => ({ key, label, group, def, alt }));
const SLOT = Object.fromEntries(SLOTS.map(s => [s.key, s]));

const settings = new Map(all('SELECT key, value FROM settings').map(r => [r.key, r.value]));
const opt = k => (settings.has(k) ? settings.get(k) : DEFAULTS[k] ?? '');
const num = k => Number(String(opt(k)).replace(',', '.')) || 0;
function setOpt(k, v) {
  v = String(v ?? '');
  settings.set(k, v);
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);
}
function delOpt(k) {
  settings.delete(k);
  run('DELETE FROM settings WHERE key = ?', k);
}
const slotId = k => (settings.has('slot.' + k) ? settings.get('slot.' + k) : SLOT[k]?.def || '');

/* ───────────────────────────── Стартовые модели ───────────────────────────── */

if (!one('SELECT COUNT(*) c FROM models').c) {
  const seed = [
    { name: 'Claude Fable 5.1', model: 'claude-fable-5-1', emoji: '👑', emoji_id: '5805553606635559688', price: 25, power: 100, tag: 'ULTRA', badge: 'TOP', description: 'Флагман Anthropic: самая умная модель для сложных задач, кода и больших документов.' },
    { name: 'Claude Opus 5.5', model: 'claude-opus-5-5', emoji: '💎', emoji_id: '6037083366438737901', price: 15, power: 90, tag: 'PRO', description: 'Глубокие рассуждения, сложный код, аналитика и тексты высшего качества.' },
    { name: 'Claude Sonnet 5.5', model: 'claude-sonnet-5-5', emoji: '✨', emoji_id: '5940660740758184142', price: 6, power: 75, tag: 'PRO', badge: 'NEW', description: 'Лучший баланс скорости и интеллекта для повседневных задач.' },
    { name: 'Claude Haiku 5.5', model: 'claude-haiku-5-5', emoji: '⚡', emoji_id: '5936088245560419529', price: 2, power: 55, tag: 'FAST', description: 'Быстрая и недорогая модель для простых вопросов и переписки.' },
    { name: 'Claude Haiku 4.5', model: 'claude-haiku-4-5', emoji: '💡', emoji_id: '5891120964468480450', price: 0, power: 40, tag: 'FREE', badge: 'FREE', description: 'Бесплатная модель с дневным лимитом — чтобы попробовать.' },
    { name: 'GPT Image', model: 'gpt-image-1', kind: 'image', api: 'openai', emoji: '🖼', emoji_id: '6030466823290360017', price: 15, power: 80, tag: 'IMG', active: 0, vision: 0, description: 'Создаёт изображения по описанию. Прикрепи фото — отредактирует его.' },
    { name: 'Sora 2', model: 'sora-2', kind: 'video', api: 'openai', emoji: '🎥', emoji_id: '5886579539064132088', price: 60, power: 85, tag: 'VIDEO', active: 0, vision: 0, extra: '{"seconds":"4","size":"720x1280"}', description: 'Короткие видео по описанию. Прикрепи фото — оживит его.' },
  ];
  seed.forEach((m, i) => run(
    `INSERT INTO models(name, model, kind, api, emoji, emoji_id, price, power, tag, badge, description, active, vision, extra, sort, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    m.name, m.model, m.kind || 'chat', m.api || 'anthropic', m.emoji, m.emoji_id, m.price, m.power, m.tag, m.badge || '',
    m.description, m.active ?? 1, m.vision ?? 1, m.extra || '', i * 10, now(),
  ));
}

/* ───────────────────────────── Telegram API ───────────────────────────── */

const BOT = { username: CFG.botUsername, id: 0 };
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.webm': 'video/webm', '.mp4': 'video/mp4', '.json': 'application/json', '.ico': 'image/x-icon',
};

async function tg(method, params = {}, files) {
  for (let attempt = 0; ; attempt++) {
    let body, headers;
    if (files) {
      body = new FormData();
      for (const [k, v] of Object.entries(params)) if (v != null) body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      for (const [k, f] of Object.entries(files)) body.append(k, new Blob([f.data], { type: f.type }), f.name);
    } else {
      body = JSON.stringify(params);
      headers = { 'content-type': 'application/json' };
    }
    const res = await fetch(`https://api.telegram.org/bot${CFG.token}/${method}`, {
      method: 'POST', headers, body, signal: AbortSignal.timeout(method === 'getUpdates' ? 65e3 : 60e3),
    });
    const j = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
    if (j.ok) return j.result;
    const wait = j.parameters?.retry_after;
    if (wait && attempt < 2) { await sleep(wait * 1000 + 250); continue; }
    throw Object.assign(new Error(`${method}: ${j.description}`), { code: j.error_code ?? res.status });
  }
}

async function tgDownload(fileId) {
  const f = await tg('getFile', { file_id: fileId });
  const r = await fetch(`https://api.telegram.org/file/bot${CFG.token}/${f.file_path}`, { signal: AbortSignal.timeout(60e3) });
  if (!r.ok) throw new Error(`download ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const send = (chatId, text, extra = {}) =>
  tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

// Премиум-эмодзи в тексте и на кнопках
const premiumOn = () => opt('bot_emoji') !== '0';
const EM = (id, alt = '✨') => (id && premiumOn() ? `<tg-emoji emoji-id="${id}">${alt}</tg-emoji>` : alt);
const E = k => EM(slotId(k), SLOT[k]?.alt || '✨');
function B(text, { icon, style, ...rest } = {}) {
  const eid = icon ? slotId(icon) : '';
  const b = { text, ...rest };
  if (eid && premiumOn()) b.icon_custom_emoji_id = eid;
  if (style) b.style = style;
  return b;
}
const kb = rows => ({ inline_keyboard: rows.map(r => r.filter(Boolean)).filter(r => r.length) });
const appUrl = (tab = '') => `${CFG.publicUrl}/${tab ? `?tab=${tab}` : ''}`;
const appKb = (text = opt('bot_button') || 'Открыть', tab) => (HAS_APP ? kb([[B(text, { icon: 'app', style: 'primary', web_app: { url: appUrl(tab) } })]]) : undefined);
const notify = (uid, text, tab) => send(uid, text, { reply_markup: appKb('Открыть приложение', tab) }).catch(() => {});

/* ───────────────────────────── Пользователи ───────────────────────────── */

const getUser = id => one('SELECT * FROM users WHERE id = ?', id);
const isAdmin = u => !!u && (u.is_admin === 1 || CFG.adminIds.includes(u.id));
const fullName = u => [u.first_name, u.last_name].filter(Boolean).join(' ') || (u.username ? '@' + u.username : `ID ${u.id}`);
const avatarFile = id => path.join(CFG.dataDir, 'avatars', `${id}.jpg`);
const tgInfo = u => parseJson(u.tg, {});

function touchUser(from, { ref, photo } = {}) {
  const t = now();
  const u = getUser(from.id);
  if (!u) {
    const referrer = ref && ref !== from.id && getUser(ref) ? ref : null;
    run(`INSERT INTO users(id, username, first_name, last_name, lang, is_premium, photo_url, balance, ref_by, created_at, seen_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      from.id, from.username || '', from.first_name || '', from.last_name || '', from.language_code || '',
      from.is_premium ? 1 : 0, photo || '', 0, referrer, t, t);
    const bonus = num('start_bonus');
    if (bonus > 0) credit(from.id, bonus, 'bonus', 'Бонус за регистрацию');
    if (referrer) notify(referrer, `${E('brand')} По твоей ссылке пришёл <b>${esc(from.first_name || 'новый пользователь')}</b>! Ты будешь получать <b>${num('ref_percent')}%</b> с его пополнений.`, 'profile');
    return getUser(from.id);
  }
  if (from.first_name !== undefined) {
    run(`UPDATE users SET username = ?, first_name = ?, last_name = ?, lang = ?, is_premium = ?, photo_url = COALESCE(NULLIF(?, ''), photo_url), seen_at = ?, blocked = 0 WHERE id = ?`,
      from.username || '', from.first_name || '', from.last_name || '', from.language_code || u.lang, from.is_premium ? 1 : 0, photo || '', t, from.id);
  }
  return getUser(from.id);
}

function avatarUrl(u) {
  const v = tgInfo(u).photo || '';
  if (v && fs.existsSync(avatarFile(u.id))) return `/a/${u.id}?s=${sign('a' + u.id)}&v=${v.slice(-8)}`;
  return u.photo_url || '';
}

function publicMe(u) {
  return {
    id: u.id, first_name: u.first_name, last_name: u.last_name, username: u.username, is_premium: !!u.is_premium,
    balance: round2(u.balance), spent: round2(u.spent), requests: u.requests, model_id: userModel(u)?.id ?? null,
    free_left: freeLeft(u), avatar: avatarUrl(u), created_at: u.created_at,
  };
}

function userStats(u) {
  const r30 = one("SELECT COUNT(*) c FROM requests WHERE user_id = ? AND status != 'error' AND created_at > ?", u.id, now() - 30 * 864e5).c;
  const last = one(`SELECT r.id, r.model_name, r.price, r.kind, r.created_at, m.emoji_id, m.emoji FROM requests r
    LEFT JOIN models m ON m.id = r.model_id WHERE r.user_id = ? AND r.status != 'error' ORDER BY r.id DESC LIMIT 1`, u.id);
  const refs = one('SELECT COUNT(*) c FROM users WHERE ref_by = ?', u.id).c;
  return {
    requests: u.requests, requests30: r30, spent: round2(u.spent), avg: u.requests ? round2(u.spent / u.requests) : 0,
    days: Math.max(1, Math.ceil((now() - u.created_at) / 864e5)), since: u.created_at,
    last: last || null, refs, ref_earned: round2(u.ref_earned),
  };
}

const refLink = u => `https://t.me/${BOT.username}?start=r${u.id}`;
const refFrom = s => {
  const m = /^r(\d+)$/.exec(s || '');
  return m ? Number(m[1]) : null;
};

/* ───────────────────────────── Профиль из Telegram ───────────────────────────── */

// Цвет профиля, фон-узор, эмодзи-статус и аватарка — через getChat, кэш 10 минут
async function refreshProfile(u, force = false) {
  const old = tgInfo(u);
  if (!force && now() - (u.tg_at || 0) < 10 * 60e3) return old;
  let p = old;
  try {
    const c = await tg('getChat', { chat_id: u.id });
    p = {
      pcolor: c.profile_accent_color_id ?? null,
      accent: c.accent_color_id ?? null,
      bg: c.profile_background_custom_emoji_id || '',
      status: c.emoji_status_custom_emoji_id || '',
      status_until: c.emoji_status_expiration_date || 0,
      gift: c.unique_gift_colors || null,
      photo: c.photo?.big_file_unique_id || '',
    };
    const fp = avatarFile(u.id);
    if (p.photo && (p.photo !== old.photo || !fs.existsSync(fp))) fs.writeFileSync(fp, await tgDownload(c.photo.big_file_id));
    if (!p.photo && fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (e) {
    log('getChat', u.id, e.message);
  }
  run('UPDATE users SET tg = ?, tg_at = ? WHERE id = ?', JSON.stringify(p), now(), u.id);
  return p;
}

/* ───────────────────────────── Премиум-эмодзи ───────────────────────────── */

function saveEmoji(s, library) {
  run(`INSERT INTO emojis(id, set_name, emoji, format, repaint, file_id, thumb_id, in_library, added_at) VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET set_name = excluded.set_name, emoji = excluded.emoji, format = excluded.format,
         repaint = excluded.repaint, file_id = excluded.file_id, thumb_id = excluded.thumb_id,
         in_library = MAX(in_library, excluded.in_library)`,
    s.custom_emoji_id, s.set_name || '', s.emoji || '', s.is_animated ? 'tgs' : s.is_video ? 'webm' : 'webp',
    s.needs_repainting ? 1 : 0, s.file_id, s.thumbnail?.file_id || '', library ? 1 : 0, now());
}

async function fetchEmojiInfo(ids, library = false) {
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    const list = await tg('getCustomEmojiStickers', { custom_emoji_ids: ids.slice(i, i + 200) });
    tx(() => list.forEach(s => saveEmoji(s, library)));
    out.push(...list);
  }
  return out;
}

async function importPack(input) {
  const name = (/(?:addemoji|addstickers)\/([\w]+)/i.exec(input)?.[1] || String(input).trim()).replace(/[^\w]/g, '');
  if (!name) throw userErr('Укажи ссылку на пак или его имя');
  let set;
  try { set = await tg('getStickerSet', { name }); } catch (e) {
    throw userErr(/STICKERSET_INVALID|not found/i.test(e.message) ? `Пак «${name}» не найден` : e.message);
  }
  if (set.sticker_type !== 'custom_emoji') throw userErr('Это стикерпак, а нужен пак эмодзи (t.me/addemoji/…)');
  tx(() => {
    set.stickers.forEach(s => saveEmoji(s, true));
    run(`INSERT INTO emoji_sets(name, title, count, added_at) VALUES(?,?,?,?)
         ON CONFLICT(name) DO UPDATE SET title = excluded.title, count = excluded.count`, set.name, set.title, set.stickers.length, now());
  });
  return { name: set.name, title: set.title, count: set.stickers.length };
}

// Формат каждого эмодзи для клиента: { id: [tgs|webm|webp, repaint] }
async function emojiMeta(ids) {
  ids = [...new Set(ids.filter(id => /^\d{5,25}$/.test(id || '')))];
  if (!ids.length) return {};
  const marks = ids.map(() => '?').join(',');
  const known = new Set(all(`SELECT id FROM emojis WHERE id IN (${marks})`, ...ids).map(r => r.id));
  const missing = ids.filter(id => !known.has(id));
  if (missing.length) await fetchEmojiInfo(missing).catch(e => log('emoji meta:', e.message));
  return Object.fromEntries(all(`SELECT id, format, repaint FROM emojis WHERE id IN (${marks})`, ...ids).map(r => [r.id, [r.format, r.repaint]]));
}

const emojiJobs = new Map();
function emojiFile(id, thumb) {
  const key = id + (thumb ? 't' : '');
  if (!emojiJobs.has(key)) {
    emojiJobs.set(key, (async () => {
      // метаданные к этому моменту уже получены через emojiMeta — неизвестные ID не дёргают Telegram
      const e = one('SELECT * FROM emojis WHERE id = ?', id);
      if (!e) return null;
      const fileId = thumb ? e.thumb_id || (e.format === 'webp' ? e.file_id : '') : e.file_id;
      if (!fileId) return null;
      const ext = thumb ? 'img' : { tgs: 'json', webm: 'webm', webp: 'webp' }[e.format];
      const fp = path.join(CFG.dataDir, 'emoji', `${id}${thumb ? '.t' : ''}.${ext}`);
      if (!fs.existsSync(fp)) {
        let buf = await tgDownload(fileId);
        if (!thumb && e.format === 'tgs') buf = zlib.gunzipSync(buf);
        fs.writeFileSync(fp, buf);
      }
      return fp;
    })().catch(err => { log('emoji', id, err.message); return null; })
      .finally(() => setTimeout(() => emojiJobs.delete(key), 5000)));
  }
  return emojiJobs.get(key);
}

const customEmojiIds = msg => [...(msg.entities || []), ...(msg.caption_entities || [])]
  .filter(e => e.type === 'custom_emoji').map(e => e.custom_emoji_id)
  .concat(msg.sticker?.custom_emoji_id ? [msg.sticker.custom_emoji_id] : []);

/* ───────────────────────────── Модели и биллинг ───────────────────────────── */

const KINDS = { chat: 'чат', image: 'изображения', video: 'видео' };
const activeModels = () => all('SELECT * FROM models WHERE active = 1 ORDER BY sort, id');
function defaultModel() {
  const id = Number(opt('default_model'));
  return (id && one('SELECT * FROM models WHERE id = ? AND active = 1', id))
    || one("SELECT * FROM models WHERE active = 1 AND kind = 'chat' ORDER BY price, sort, id LIMIT 1")
    || one('SELECT * FROM models WHERE active = 1 ORDER BY sort, id LIMIT 1');
}
const userModel = u => (u.model_id && one('SELECT * FROM models WHERE id = ? AND active = 1', u.model_id)) || defaultModel();
const publicModel = m => ({
  id: m.id, name: m.name, kind: m.kind, description: m.description, emoji_id: m.emoji_id, emoji: m.emoji,
  price: round2(m.price), badge: m.badge, tag: m.tag, power: m.power, vision: !!m.vision,
});

function freeLeft(u) {
  const lim = num('free_daily');
  return lim ? Math.max(0, lim - (u.free_day === today() ? u.free_used : 0)) : null;
}

function charge(u, m) {
  if (m.price > 0) {
    const r = run('UPDATE users SET balance = round(balance - ?, 2) WHERE id = ? AND balance >= ?', m.price, u.id, m.price);
    return r.changes ? { price: round2(m.price) } : null;
  }
  const lim = num('free_daily'), d = today();
  const used = u.free_day === d ? u.free_used : 0;
  if (lim && used >= lim) return null;
  run('UPDATE users SET free_day = ?, free_used = ? WHERE id = ?', d, used + 1, u.id);
  return { price: 0 };
}

function refund(u, c) {
  if (c.price) run('UPDATE users SET balance = round(balance + ?, 2) WHERE id = ?', c.price, u.id);
  else run('UPDATE users SET free_used = MAX(0, free_used - 1) WHERE id = ?', u.id);
}

function credit(uid, amount, method, note = '', { ref = null } = {}) {
  return tx(() => {
    if (ref && one('SELECT 1 FROM payments WHERE ref = ?', ref)) return false;
    run('UPDATE users SET balance = round(balance + ?, 2) WHERE id = ?', amount, uid);
    run('INSERT INTO payments(user_id, amount, method, note, ref, created_at) VALUES(?,?,?,?,?,?)', uid, round2(amount), method, note, ref, now());
    return true;
  });
}

// Пополнение (сейчас — вручную из админки, позже СБП): начисляет и платит реферальный процент
function topup(u, amount, note = '') {
  amount = round2(amount);
  credit(u.id, amount, 'topup', note);
  notify(u.id, `${E('brand')} Баланс пополнен на <b>${money(amount)}</b>.\nСейчас на балансе: <b>${money(getUser(u.id).balance)}</b>`);
  if (u.ref_by && num('ref_percent') > 0) {
    const bonus = round2(amount * num('ref_percent') / 100);
    if (bonus > 0) {
      credit(u.ref_by, bonus, 'referral', String(u.id));
      run('UPDATE users SET ref_earned = round(ref_earned + ?, 2) WHERE id = ?', bonus, u.ref_by);
      notify(u.ref_by, `${E('brand')} Реферальный бонус: <b>+${money(bonus)}</b> — друг пополнил баланс.`, 'profile');
    }
  }
}

function transfer(from, toId, amount) {
  amount = round2(amount);
  const min = num('min_transfer') || 1;
  if (!(amount >= min)) throw userErr(`Минимальная сумма перевода — ${money(min)}`);
  if (toId === from.id) throw userErr('Нельзя перевести самому себе');
  const to = getUser(toId);
  if (!to) throw userErr('Пользователь не найден — он должен хотя бы раз открыть бота');
  tx(() => {
    const r = run('UPDATE users SET balance = round(balance - ?, 2) WHERE id = ? AND balance >= ?', amount, from.id, amount);
    if (!r.changes) throw userErr('Недостаточно средств');
    run('UPDATE users SET balance = round(balance + ?, 2) WHERE id = ?', amount, to.id);
    run('INSERT INTO payments(user_id, amount, method, note, created_at) VALUES(?,?,?,?,?)', from.id, -amount, 'transfer_out', String(to.id), now());
    run('INSERT INTO payments(user_id, amount, method, note, created_at) VALUES(?,?,?,?,?)', to.id, amount, 'transfer_in', String(from.id), now());
  });
  notify(to.id, `${E('brand')} Тебе перевели <b>${money(amount)}</b> от ${esc(fullName(from))}.`, 'profile');
  return getUser(from.id);
}

/* ───────────────────────────── Нейросети ───────────────────────────── */

async function* sse(res) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true }).replace(/\r/g, '');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, ''));
      if (data.length) yield data.join('\n');
    }
  }
}

async function failText(res) {
  const t = await res.text().catch(() => '');
  let msg = t;
  try { const j = JSON.parse(t); msg = j.error?.message || j.message || j.error || t; } catch {}
  return `HTTP ${res.status}: ${cut(String(msg), 300)}`;
}

async function aiPost(url, headers, body, signal) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  if (!res.ok) throw Object.assign(new Error(await failText(res)), { status: res.status });
  return res;
}
const isStream = res => (res.headers.get('content-type') || '').includes('event-stream');
const aiTarget = m => ({ base: (m.base_url || CFG.aiBase).replace(/\/+$/, ''), key: m.api_key || CFG.aiKey });

const toAnthropic = msgs => msgs.map(m => ({
  role: m.role,
  content: m.image ? [{ type: 'image', source: { type: 'base64', media_type: m.image.mime, data: m.image.b64 } }, { type: 'text', text: m.text }] : m.text,
}));
const toOpenAI = (msgs, system) => [
  ...(system ? [{ role: 'system', content: system }] : []),
  ...msgs.map(m => ({
    role: m.role,
    content: m.image ? [{ type: 'text', text: m.text }, { type: 'image_url', image_url: { url: `data:${m.image.mime};base64,${m.image.b64}` } }] : m.text,
  })),
];

// Потоковый чат: формат Anthropic (/v1/messages) или OpenAI (/v1/chat/completions)
async function aiChat(m, system, msgs, onDelta = () => {}, signal) {
  const { base, key } = aiTarget(m);
  const usage = { in: 0, out: 0 };
  let text = '';
  const push = t => { if (t) { text += t; onDelta(t); } };
  const temp = m.temperature != null ? { temperature: m.temperature } : {};

  if (m.api === 'openai') {
    const body = { model: m.model, messages: toOpenAI(msgs, system), stream: true, stream_options: { include_usage: true }, max_tokens: m.max_tokens || 4096, ...temp, ...parseJson(m.extra, {}) };
    const hdr = { authorization: `Bearer ${key}` };
    let res;
    try { res = await aiPost(`${base}/v1/chat/completions`, hdr, body, signal); } catch (e) {
      if (!/max_completion_tokens/.test(e.message)) throw e;
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
      res = await aiPost(`${base}/v1/chat/completions`, hdr, body, signal);
    }
    if (!isStream(res)) {
      const j = await res.json();
      push(j.choices?.[0]?.message?.content || '');
      return { text, usage: { in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0 } };
    }
    for await (const data of sse(res)) {
      if (data === '[DONE]') break;
      let j; try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new Error(j.error.message || 'stream error');
      push(j.choices?.[0]?.delta?.content || '');
      if (j.usage) { usage.in = j.usage.prompt_tokens || 0; usage.out = j.usage.completion_tokens || 0; }
    }
    return { text, usage };
  }

  const body = { model: m.model, max_tokens: m.max_tokens || 4096, messages: toAnthropic(msgs), stream: true, ...(system ? { system } : {}), ...temp, ...parseJson(m.extra, {}) };
  const res = await aiPost(`${base}/v1/messages`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body, signal);
  if (!isStream(res)) {
    const j = await res.json();
    push((j.content || []).filter(b => b.type === 'text').map(b => b.text).join(''));
    return { text, usage: { in: j.usage?.input_tokens || 0, out: j.usage?.output_tokens || 0 } };
  }
  for await (const data of sse(res)) {
    let j; try { j = JSON.parse(data); } catch { continue; }
    if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') push(j.delta.text);
    else if (j.type === 'message_start') usage.in = j.message?.usage?.input_tokens || 0;
    else if (j.type === 'message_delta') usage.out = j.usage?.output_tokens || usage.out;
    else if (j.type === 'error') throw new Error(j.error?.message || 'stream error');
  }
  return { text, usage };
}

async function fetchImage(url, signal) {
  const d = /^data:image\/(\w+);base64,(.+)$/s.exec(url);
  if (d) return { buf: Buffer.from(d[2], 'base64'), ext: d[1].replace('jpeg', 'jpg') };
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Не удалось скачать результат: ${r.status}`);
  const type = r.headers.get('content-type') || '';
  return { buf: Buffer.from(await r.arrayBuffer()), ext: /webp/.test(type) ? 'webp' : /jpe?g/.test(type) ? 'jpg' : 'png' };
}

// Изображения: OpenAI Images (/v1/images/generations и /edits) или чат-модель, которая отвечает картинкой
async function aiImage(m, prompt, image, signal) {
  const { base, key } = aiTarget(m);
  const extra = parseJson(m.extra, {}), auth = { authorization: `Bearer ${key}` };
  if (m.api === 'chat') {
    const content = image ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.b64}` } }] : prompt;
    const res = await aiPost(`${base}/v1/chat/completions`, auth, { model: m.model, messages: [{ role: 'user', content }], ...extra }, signal);
    const msg = (await res.json()).choices?.[0]?.message || {};
    const str = typeof msg.content === 'string' ? msg.content : '';
    const url = msg.images?.[0]?.image_url?.url
      || (Array.isArray(msg.content) ? msg.content.find(p => p.type === 'image_url')?.image_url?.url : '')
      || /(data:image\/\w+;base64,[A-Za-z0-9+/=]+)/.exec(str)?.[1]
      || /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.exec(str)?.[1];
    if (!url) throw new Error('Модель не вернула изображение');
    return fetchImage(url, signal);
  }
  let res;
  if (image) {
    const fd = new FormData();
    fd.append('model', m.model);
    fd.append('prompt', prompt);
    for (const [k, v] of Object.entries(extra)) fd.append(k, String(v));
    fd.append('image', new Blob([image.buf], { type: image.mime }), `image.${image.ext}`);
    res = await fetch(`${base}/v1/images/edits`, { method: 'POST', headers: auth, body: fd, signal });
    if (!res.ok) throw new Error(await failText(res));
  } else {
    res = await aiPost(`${base}/v1/images/generations`, auth, { model: m.model, prompt, n: 1, size: '1024x1024', ...extra }, signal);
  }
  const d = (await res.json()).data?.[0];
  if (d?.b64_json) return { buf: Buffer.from(d.b64_json, 'base64'), ext: 'png' };
  if (d?.url) return fetchImage(d.url, signal);
  throw new Error('Провайдер не вернул изображение');
}

// Видео: OpenAI Videos API (/v1/videos) — создаём задачу, ждём готовности, скачиваем mp4
async function aiVideo(m, prompt, image, signal, onProgress) {
  const { base, key } = aiTarget(m);
  const auth = { authorization: `Bearer ${key}` };
  const fd = new FormData();
  fd.append('model', m.model);
  fd.append('prompt', prompt);
  for (const [k, v] of Object.entries(parseJson(m.extra, {}))) fd.append(k, String(v));
  if (image) fd.append('input_reference', new Blob([image.buf], { type: image.mime }), `reference.${image.ext}`);
  let res = await fetch(`${base}/v1/videos`, { method: 'POST', headers: auth, body: fd, signal });
  if (!res.ok) throw new Error(await failText(res));
  let job = await res.json();
  while (!['completed', 'failed', 'cancelled', 'error'].includes(job.status)) {
    await sleep(5000, signal);
    res = await fetch(`${base}/v1/videos/${job.id}`, { headers: auth, signal });
    if (!res.ok) throw new Error(await failText(res));
    job = await res.json();
    if (job.progress != null) onProgress(Number(job.progress));
  }
  if (job.status !== 'completed') throw new Error(job.error?.message || `Видео не сгенерировалось (${job.status})`);
  res = await fetch(`${base}/v1/videos/${job.id}/content`, { headers: auth, signal });
  if (!res.ok) throw new Error(await failText(res));
  return Buffer.from(await res.arrayBuffer());
}

/* ───────────────────────────── Чаты и генерация ───────────────────────────── */

const live = new Map(); // id ответа ассистента → идущая генерация
const STREAM = Symbol('stream');
const msgRow = id => one('SELECT * FROM chat_messages WHERE id = ?', id);
const publicMsg = r => r && {
  id: r.id, chat_id: r.chat_id, role: r.role, content: live.get(r.id)?.text ?? r.content, media: parseJson(r.media, []),
  model_id: r.model_id, model_name: r.model_name, kind: r.kind, status: r.status, price: round2(r.price), error: r.error,
  progress: live.get(r.id)?.progress ?? null, created_at: r.created_at,
};

function saveMedia(buf, ext) {
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(CFG.dataDir, 'media', name), buf);
  return `/m/${name}`;
}

function dataUrlImage(s) {
  const m = /^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/s.exec(String(s));
  if (!m) throw userErr('Нужна картинка PNG, JPG, WEBP или GIF');
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 12e6) throw userErr('Картинка больше 12 МБ');
  return { buf, mime: m[1].replace('jpg', 'jpeg'), ext: m[2].replace('jpeg', 'jpg'), b64: m[3] };
}

function systemPrompt(m, u) {
  const date = new Date().toLocaleDateString('ru-RU', { timeZone: CFG.tz, day: 'numeric', month: 'long', year: 'numeric' });
  return [opt('system_prompt'), m.system_prompt].filter(Boolean).join('\n\n').replace(/\{date\}/g, date).replace(/\{name\}/g, u.first_name || '');
}

// Контекст для чат-модели: прошлые реплики этого чата (без картинок и неудачных ответов)
function chatHistory(chatId, beforeId, m) {
  const n = Math.max(0, Math.min(100, m.context ?? 12));
  if (!n) return [];
  const rows = all("SELECT role, content, status FROM chat_messages WHERE chat_id = ? AND id < ? AND kind = 'chat' ORDER BY id DESC LIMIT ?", chatId, beforeId, n * 2).reverse();
  let out = [];
  for (const r of rows) {
    if (r.role === 'assistant' && (!r.content || !['ok', 'stopped'].includes(r.status))) {
      if (out.at(-1)?.role === 'user') out.pop();
      continue;
    }
    if (!r.content) continue;
    if (out.at(-1)?.role === r.role) out.at(-1).text += '\n\n' + r.content;
    else out.push({ role: r.role, text: r.content });
  }
  out = out.slice(-n);
  while (out.length && out[0].role !== 'user') out.shift();
  while (out.length && out.at(-1).role !== 'assistant') out.pop();
  return out;
}

function startJob(u, m, chat, userMsgId, asstId, input, c) {
  const job = { id: asstId, uid: u.id, chatId: chat.id, text: '', progress: null, subs: new Set(), ac: new AbortController(), stopped: false, done: false };
  live.set(asstId, job);
  runJob(job, u, m, userMsgId, input, c).catch(e => log('job', e.stack || e.message));
  return job;
}

async function runJob(job, u, m, userMsgId, input, c) {
  const t0 = now();
  const timer = setTimeout(() => { job.timedOut = true; job.ac.abort(); }, (m.kind === 'video' ? 20 : 5) * 60e3);
  const emit = ev => job.subs.forEach(fn => fn(ev));
  let media = [], usage = { in: 0, out: 0 }, error = null;
  try {
    if (m.kind === 'chat') {
      const r = await aiChat(m, systemPrompt(m, u), [...chatHistory(job.chatId, userMsgId, m), input], d => { job.text += d; emit({ type: 'delta', id: job.id, t: d }); }, job.ac.signal);
      usage = r.usage;
      if (!job.text.trim()) throw new Error('Модель вернула пустой ответ');
    } else if (m.kind === 'image') {
      const img = await aiImage(m, input.text, input.image, job.ac.signal);
      media = [{ type: 'image', url: saveMedia(img.buf, img.ext) }];
    } else {
      const buf = await aiVideo(m, input.text, input.image, job.ac.signal, p => { job.progress = p; emit({ type: 'progress', id: job.id, p }); });
      media = [{ type: 'video', url: saveMedia(buf, 'mp4') }];
    }
  } catch (e) {
    error = e;
  }
  clearTimeout(timer);

  // Остановили посреди ответа — частичный текст остаётся и оплачивается; иначе ошибка или пустая остановка — возврат
  const partial = !!error && job.stopped && !!job.text.trim();
  let status = 'ok', price = c.price, errText = null;
  if (error && !partial) {
    refund(u, c);
    price = 0;
    status = job.stopped ? 'stopped' : 'error';
    if (status === 'error') {
      errText = job.timedOut ? 'Модель отвечала слишком долго.' : 'Не удалось получить ответ от модели.';
      errText += c.price ? ' Деньги вернулись на баланс.' : '';
      log('AI', m.model, error.message);
    }
  } else if (partial) status = 'stopped';
  if (status === 'ok' || partial) run('UPDATE users SET spent = round(spent + ?, 2), requests = requests + 1 WHERE id = ?', price, u.id);
  run('INSERT INTO requests(user_id, model_id, model_name, kind, price, tokens_in, tokens_out, status, error, prompt, ms, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    u.id, m.id, m.name, m.kind, price, usage.in, usage.out, status, error && !job.stopped ? cut(error.message, 500) : null, cut(input.text, 500), now() - t0, now());
  run('UPDATE chat_messages SET content = ?, media = ?, status = ?, price = ?, error = ? WHERE id = ?', job.text, JSON.stringify(media), status, price, errText, job.id);
  job.done = true;
  const fresh = getUser(u.id);
  const message = publicMsg(msgRow(job.id));
  if (status === 'error' && isAdmin(fresh)) message.error += `\n${cut(error.message, 300)}`;
  emit({ type: 'done', message, me: publicMe(fresh) });
  setTimeout(() => live.delete(job.id), 60e3);
}

// SSE: события генерации (start → delta/progress → done); можно переподключиться к идущей генерации
function streamJob(res, mid, first) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
  const out = ev => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  if (first) out(first);
  const job = live.get(mid);
  if (!job || job.done) {
    out({ type: 'done', message: publicMsg(msgRow(mid)) });
    return res.end();
  }
  if (job.text || job.progress != null) out({ type: 'sync', id: mid, text: job.text, progress: job.progress });
  const ping = setInterval(() => res.write(': ping\n\n'), 15e3);
  const detach = () => { job.subs.delete(fn); clearInterval(ping); };
  const fn = ev => {
    out(ev);
    if (ev.type === 'done') { detach(); res.end(); }
  };
  job.subs.add(fn);
  res.on('close', detach);
}

/* ───────────────────────────── Бот ───────────────────────────── */

// /start и любое сообщение: баннер из админки + короткий текст + кнопка «Открыть»
async function sendStart(u) {
  const caption = String(opt('bot_text'))
    .replace(/\{emoji\}/g, E('brand')).replace(/\{brand\}/g, esc(opt('brand'))).replace(/\{name\}/g, esc(u.first_name || 'друг'));
  const reply_markup = appKb();
  const banner = opt('bot_banner');
  if (banner) {
    const p = { chat_id: u.id, caption, parse_mode: 'HTML', reply_markup };
    const cached = parseJson(opt('bot_banner_fid'), {});
    if (cached.banner === banner && cached.fid) {
      try { return await tg('sendPhoto', { ...p, photo: cached.fid }); } catch {}
    }
    try {
      const local = /^\/u\/([\w-]+\.\w+)$/.exec(banner);
      const sent = local
        ? await tg('sendPhoto', p, { photo: { data: fs.readFileSync(path.join(CFG.dataDir, 'uploads', local[1])), type: MIME[path.extname(local[1])] || 'image/jpeg', name: local[1] } })
        : await tg('sendPhoto', { ...p, photo: banner });
      setOpt('bot_banner_fid', JSON.stringify({ banner, fid: sent.photo.at(-1).file_id }));
      return sent;
    } catch (e) {
      log('Баннер бота:', e.message);
    }
  }
  return send(u.id, caption, { reply_markup });
}

async function onMessage(msg) {
  if (msg.chat?.type !== 'private' || !msg.from || msg.from.is_bot) return;
  const u = touchUser(msg.from, { ref: refFrom(/^\/start\s+(\S+)/.exec(msg.text || '')?.[1]) });
  if (u.banned) return;
  // Админ может просто прислать премиум-эмодзи — они попадут в библиотеку приложения
  const ids = isAdmin(u) ? customEmojiIds(msg) : [];
  if (ids.length) {
    const got = await fetchEmojiInfo([...new Set(ids)], true);
    return send(u.id, `${E('brand')} В библиотеку добавлено эмодзи: <b>${got.length}</b> ${got.map(s => EM(s.custom_emoji_id, s.emoji || '✨')).join('')}\nНазначить их разделам можно в админке → «Эмодзи».`);
  }
  return sendStart(u);
}

async function handleUpdate(up) {
  if (up.message) return onMessage(up.message);
}

/* ───────────────────────────── Рассылка ───────────────────────────── */

let bcJob = null;
function startBroadcast({ text, button, photo, notifyId }) {
  if (bcJob?.running) throw httpErr(409, 'Рассылка уже идёт');
  const ids = all('SELECT id FROM users WHERE banned = 0 AND blocked = 0').map(r => r.id);
  const reply_markup = button ? appKb('Открыть приложение') : undefined;
  bcJob = { running: true, total: ids.length, sent: 0, failed: 0, started: now() };
  const job = bcJob;
  (async () => {
    let photoRef = photo && !photo.startsWith('/u/') ? photo : null;
    for (const id of ids) {
      try {
        if (photo && !photoRef) {
          const name = photo.slice(3);
          const sent = await tg('sendPhoto', { chat_id: id, caption: text, parse_mode: 'HTML', reply_markup },
            { photo: { data: fs.readFileSync(path.join(CFG.dataDir, 'uploads', name)), type: MIME[path.extname(name)] || 'image/jpeg', name } });
          photoRef = sent.photo.at(-1).file_id;
        } else if (photoRef) await tg('sendPhoto', { chat_id: id, photo: photoRef, caption: text, parse_mode: 'HTML', reply_markup });
        else await send(id, text, { reply_markup });
        job.sent++;
      } catch (e) {
        job.failed++;
        if (e.code === 403) run('UPDATE users SET blocked = 1 WHERE id = ?', id);
      }
      await sleep(45);
    }
    job.running = false;
    job.finished = now();
    log(`Рассылка: ${job.sent}/${job.total}, ошибок ${job.failed}`);
    if (notifyId) send(notifyId, `${E('brand')} Рассылка завершена: доставлено <b>${job.sent}</b> из ${job.total}, ошибок ${job.failed}.`).catch(() => {});
  })();
  return job;
}

/* ───────────────────────────── HTTP: авторизация ───────────────────────────── */

function checkInitData(raw) {
  const p = new URLSearchParams(raw);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(CFG.token).digest();
  const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (now() / 1000 - Number(p.get('auth_date')) > 7 * 86400) return null;
  try { return { user: JSON.parse(p.get('user')), start: p.get('start_param') }; } catch { return null; }
}

const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

async function auth(req) {
  const h = req.headers.authorization || '';
  const sp = h.indexOf(' ');
  const kind = h.slice(0, sp), val = h.slice(sp + 1);
  if (kind === 'tma') {
    const d = checkInitData(val);
    if (!d?.user?.id) throw httpErr(401, 'Сессия Telegram устарела — перезапусти приложение');
    const u = touchUser(d.user, { ref: refFrom(d.start), photo: d.user.photo_url });
    if (u.banned) throw httpErr(403, 'Доступ ограничен');
    return { u, admin: isAdmin(u) };
  }
  if (kind === 'Admin') {
    const s = one('SELECT * FROM sessions WHERE token = ?', val);
    if (s && now() - s.created_at < 30 * 864e5) return { u: null, admin: true };
    throw httpErr(401, 'Сессия админа истекла — войди снова');
  }
  if (kind === 'Dev' && CFG.devAuth && isLocal(req)) {
    const id = Number(val);
    const u = getUser(id) || touchUser({ id, first_name: 'Dev', username: 'dev' });
    return { u, admin: isAdmin(u) };
  }
  throw httpErr(401, 'Нужна авторизация');
}

// Проверка пароля админа с ограничением попыток
const loginTries = new Map();
function checkPassword(req, password) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const t = loginTries.get(ip) || { n: 0, at: now() };
  if (now() - t.at > 10 * 60e3) Object.assign(t, { n: 0, at: now() });
  if (t.n >= 10) throw httpErr(429, 'Слишком много попыток — подожди 10 минут');
  t.n++;
  loginTries.set(ip, t);
  if (!CFG.adminPassword) throw httpErr(403, 'ADMIN_PASSWORD не задан');
  const a = crypto.createHash('sha256').update(String(password || '')).digest(), b = crypto.createHash('sha256').update(CFG.adminPassword).digest();
  if (!crypto.timingSafeEqual(a, b)) throw httpErr(401, 'Неверный пароль');
  loginTries.delete(ip);
}

/* ───────────────────────────── HTTP: API ───────────────────────────── */

const routes = [];
function route(method, pattern, access, fn, limit = 1e6) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, access, fn, limit });
}

async function readJson(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw httpErr(413, 'Слишком большой запрос');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpErr(400, 'Неверный JSON'); }
}

const slotsMap = () => Object.fromEntries(SLOTS.map(s => [s.key, slotId(s.key)]));
const publicSettings = () => ({
  brand: opt('brand'), tagline: opt('tagline'), banner: opt('banner'), info: opt('info'), topup_info: opt('topup_info'),
  support: String(opt('support')).replace(/^@/, ''), ref_percent: num('ref_percent'), free_daily: num('free_daily'),
  min_transfer: num('min_transfer') || 1,
});

route('GET', '/api/bootstrap', 'any', async ({ u, admin }) => {
  const models = activeModels().map(publicModel);
  const slots = slotsMap();
  return {
    me: u ? publicMe(u) : null, admin, models, slots, settings: publicSettings(),
    bot: BOT.username, ref_link: u ? refLink(u) : '',
    emoji: await emojiMeta([...Object.values(slots), ...models.map(m => m.emoji_id)]),
  };
});

route('GET', '/api/me', 'user', async ({ u }) => ({ me: publicMe(u) }));

route('GET', '/api/profile', 'user', async ({ u, query }) => {
  const p = await refreshProfile(u, query.force === '1');
  u = getUser(u.id);
  const st = userStats(u);
  const status = p.status && (!p.status_until || p.status_until * 1000 > now()) ? p.status : '';
  return {
    me: publicMe(u), stats: st, ref: { link: refLink(u), percent: num('ref_percent'), count: st.refs, earned: st.ref_earned },
    tg: { pcolor: p.pcolor ?? null, bg: p.bg || '', status, gift: p.gift || null, premium: !!u.is_premium },
    emoji: await emojiMeta([p.bg, status, st.last?.emoji_id]),
  };
});

route('GET', '/api/history', 'user', async ({ u, query }) => {
  const before = Number(query.before) || 2 ** 52;
  if (query.type === 'payments') {
    const items = all('SELECT id, amount, stars, method, note, created_at FROM payments WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 60', u.id, before);
    const total = one("SELECT COUNT(*) n, COALESCE(SUM(amount), 0) sum FROM payments WHERE user_id = ? AND amount > 0", u.id);
    return { type: 'payments', items, total, more: items.length === 60 };
  }
  const items = all(`SELECT r.id, r.model_name name, r.kind, r.price, r.status, r.created_at, m.emoji_id, m.emoji FROM requests r
    LEFT JOIN models m ON m.id = r.model_id WHERE r.user_id = ? AND r.status != 'error' AND r.id < ? ORDER BY r.id DESC LIMIT 60`, u.id, before);
  const total = one("SELECT COUNT(*) n, COALESCE(SUM(price), 0) sum FROM requests WHERE user_id = ? AND status != 'error'", u.id);
  return { type: 'requests', items, total, more: items.length === 60, emoji: await emojiMeta(items.map(i => i.emoji_id)) };
});

route('POST', '/api/select', 'user', async ({ u, body }) => {
  const m = one('SELECT * FROM models WHERE id = ? AND active = 1', Number(body.id));
  if (!m) throw userErr('Модель недоступна');
  run('UPDATE users SET model_id = ? WHERE id = ?', m.id, u.id);
  return { me: publicMe(getUser(u.id)) };
});

route('POST', '/api/transfer', 'user', async ({ u, body }) => {
  const me = transfer(u, Number(body.to), Number(body.amount));
  return { me: publicMe(me) };
});

// ── Чаты ──

route('GET', '/api/chats', 'user', async ({ u }) => {
  const chats = all(`SELECT c.id, c.title, c.updated_at, c.model_id, m.emoji_id, m.emoji, m.kind FROM chats c
    LEFT JOIN models m ON m.id = c.model_id WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT 100`, u.id);
  return { chats, emoji: await emojiMeta(chats.map(c => c.emoji_id)) };
});

route('GET', '/api/chats/:id', 'user', async ({ u, params }) => {
  const chat = one('SELECT * FROM chats WHERE id = ? AND user_id = ?', Number(params.id), u.id);
  if (!chat) throw httpErr(404, 'Чат не найден');
  return {
    chat: { id: chat.id, title: chat.title, model_id: chat.model_id },
    messages: all('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY id', chat.id).map(publicMsg),
  };
});

route('DELETE', '/api/chats/:id', 'user', async ({ u, params }) => {
  const chat = one('SELECT * FROM chats WHERE id = ? AND user_id = ?', Number(params.id), u.id);
  if (!chat) throw httpErr(404, 'Чат не найден');
  for (const job of live.values()) if (job.chatId === chat.id && !job.done) { job.stopped = true; job.ac.abort(); }
  for (const r of all('SELECT media FROM chat_messages WHERE chat_id = ?', chat.id)) {
    for (const x of parseJson(r.media, [])) fs.rm(path.join(CFG.dataDir, 'media', path.basename(x.url)), () => {});
  }
  run('DELETE FROM chat_messages WHERE chat_id = ?', chat.id);
  run('DELETE FROM chats WHERE id = ?', chat.id);
});

route('POST', '/api/chat/send', 'user', async ({ u, body, res }) => {
  const m = one('SELECT * FROM models WHERE id = ? AND active = 1', Number(body.model_id));
  if (!m) throw userErr('Модель недоступна — выбери другую');
  const text = String(body.text || '').trim().slice(0, 16000);
  const image = body.image ? dataUrlImage(body.image) : null;
  if (!text && !image) throw userErr('Напиши сообщение');
  if (m.kind !== 'chat' && !text) throw userErr('Опиши, что нужно сгенерировать');
  if (image && m.kind === 'chat' && !m.vision) throw userErr(`${m.name} не понимает изображения — выбери другую модель`);
  if ([...live.values()].filter(j => j.uid === u.id && !j.done).length >= 2) throw httpErr(429, 'Дождись окончания текущей генерации');
  let chat = null;
  if (body.chat_id) {
    chat = one('SELECT * FROM chats WHERE id = ? AND user_id = ?', Number(body.chat_id), u.id);
    if (!chat) throw httpErr(404, 'Чат не найден');
  }
  const c = charge(u, m);
  if (!c) {
    throw m.price > 0
      ? httpErr(402, `Недостаточно средств: запрос стоит ${money(m.price)}, на балансе ${money(u.balance)}`, 'balance')
      : httpErr(429, `Бесплатные запросы на сегодня закончились (${num('free_daily')} в день)`, 'free');
  }
  const t = now();
  let userId, asstId;
  try {
    if (!chat) {
      const r = run('INSERT INTO chats(user_id, model_id, title, created_at, updated_at) VALUES(?,?,?,?,?)', u.id, m.id, cut(text || 'Изображение', 60), t, t);
      chat = one('SELECT * FROM chats WHERE id = ?', Number(r.lastInsertRowid));
    } else {
      run('UPDATE chats SET updated_at = ?, model_id = ? WHERE id = ?', t, m.id, chat.id);
    }
    const media = image ? [{ type: 'image', url: saveMedia(image.buf, image.ext) }] : [];
    const insert = (role, content, med, status, price, at) => Number(run(
      'INSERT INTO chat_messages(chat_id, user_id, role, content, media, model_id, model_name, kind, status, price, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      chat.id, u.id, role, content, JSON.stringify(med), m.id, m.name, m.kind, status, price, at).lastInsertRowid);
    userId = insert('user', text, media, 'ok', 0, t);
    asstId = insert('assistant', '', [], 'pending', c.price, t + 1);
    run('UPDATE users SET model_id = ? WHERE id = ?', m.id, u.id);
  } catch (e) {
    refund(u, c);
    throw e;
  }
  const input = { role: 'user', text: text || 'Что на этом изображении? Опиши подробно.', image };
  startJob(u, m, chat, userId, asstId, input, c);
  streamJob(res, asstId, {
    type: 'start', chat: { id: chat.id, title: chat.title, model_id: m.id },
    user: publicMsg(msgRow(userId)), assistant: publicMsg(msgRow(asstId)), me: publicMe(getUser(u.id)),
  });
  return STREAM;
}, 18e6);

route('GET', '/api/chat/stream/:id', 'user', async ({ u, params, res }) => {
  const r = msgRow(Number(params.id));
  if (!r || r.user_id !== u.id) throw httpErr(404, 'Сообщение не найдено');
  streamJob(res, r.id);
  return STREAM;
});

route('POST', '/api/chat/stop', 'user', async ({ u, body }) => {
  const job = live.get(Number(body.id));
  if (job && job.uid === u.id && !job.done) { job.stopped = true; job.ac.abort(); }
});

// ── Админка ──

route('POST', '/api/admin/login', 'public', async ({ req, body }) => {
  checkPassword(req, body.password);
  const token = crypto.randomBytes(24).toString('hex');
  run('INSERT INTO sessions(token, created_at) VALUES(?, ?)', token, now());
  return { token };
});

// Вход в админку прямо из Mini App: пароль делает текущего пользователя Telegram админом
route('POST', '/api/admin/claim', 'user', async ({ u, req, body }) => {
  checkPassword(req, body.password);
  run('UPDATE users SET is_admin = 1 WHERE id = ?', u.id);
  log('Новый админ:', u.id, u.username);
});

route('POST', '/api/admin/logout', 'admin', async ({ req }) => {
  run('DELETE FROM sessions WHERE token = ?', (req.headers.authorization || '').split(' ')[1] || '');
});

route('GET', '/api/admin/stats', 'admin', async () => {
  const d1 = now() - 864e5, d30 = now() - 30 * 864e5;
  const off = tzOffset(), todayIdx = Math.floor((now() + off) / 864e5);
  const from = (todayIdx - 13) * 864e5 - off;
  const reqDays = new Map(all("SELECT CAST((created_at + ?) / 86400000 AS INTEGER) d, COUNT(*) n, COALESCE(SUM(price), 0) s FROM requests WHERE created_at >= ? AND status != 'error' GROUP BY d", off, from).map(r => [r.d, r]));
  const revDays = new Map(all("SELECT CAST((created_at + ?) / 86400000 AS INTEGER) d, COALESCE(SUM(amount), 0) s FROM payments WHERE created_at >= ? AND method = 'topup' GROUP BY d", off, from).map(r => [r.d, r]));
  const chart = Array.from({ length: 14 }, (_, i) => {
    const d = todayIdx - 13 + i, date = new Date(d * 864e5);
    return { label: `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`, n: reqDays.get(d)?.n || 0, spent: round2(reqDays.get(d)?.s), rev: round2(revDays.get(d)?.s) };
  });
  return {
    users: one('SELECT COUNT(*) total, COALESCE(SUM(created_at > ?), 0) new24, COALESCE(SUM(seen_at > ?), 0) active24, COALESCE(SUM(balance), 0) balances FROM users', d1, d1),
    requests: one("SELECT COUNT(*) total, COALESCE(SUM(created_at > ?), 0) day, COALESCE(SUM(price), 0) spent, COALESCE(SUM(CASE WHEN created_at > ? THEN price END), 0) spent24 FROM requests WHERE status != 'error'", d1, d1),
    errors24: one("SELECT COUNT(*) n FROM requests WHERE status = 'error' AND created_at > ?", d1).n,
    revenue: one("SELECT COALESCE(SUM(amount), 0) total, COUNT(*) count, COALESCE(SUM(CASE WHEN created_at > ? THEN amount END), 0) day FROM payments WHERE method = 'topup'", d1),
    top: all("SELECT model_name name, COUNT(*) n, COALESCE(SUM(price), 0) sum FROM requests WHERE created_at > ? AND status != 'error' GROUP BY model_id ORDER BY n DESC LIMIT 8", d30),
    recent: all(`SELECT r.id, r.model_name, r.kind, r.price, r.status, r.error, r.created_at, r.ms, u.first_name, u.username, r.user_id FROM requests r
      LEFT JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 15`),
    chart,
    provider: { base: CFG.aiBase, key: !!CFG.aiKey },
    app: { url: CFG.publicUrl, https: HAS_APP },
  };
});

const API_BY_KIND = { chat: ['anthropic', 'openai'], image: ['openai', 'chat'], video: ['openai'] };
const MODEL_FIELDS = {
  name: 'str', model: 'str', kind: ['chat', 'image', 'video'], api: ['anthropic', 'openai', 'chat'], base_url: 'str', api_key: 'str',
  description: 'str', emoji_id: 'str', emoji: 'str', price: 'num', badge: 'str', tag: 'str', power: 'int',
  system_prompt: 'str', max_tokens: 'int', temperature: 'numnull', context: 'int', vision: 'bool', active: 'bool', sort: 'int', extra: 'json',
};
function cleanModel(b) {
  const out = {};
  for (const [k, t] of Object.entries(MODEL_FIELDS)) {
    if (!(k in b)) continue;
    let v = b[k];
    if (Array.isArray(t)) { if (!t.includes(v)) throw userErr(`Поле ${k}: ${t.join(' / ')}`); }
    else if (t === 'str') v = String(v ?? '').trim();
    else if (t === 'num') v = round2(Math.max(0, Number(v) || 0));
    else if (t === 'int') v = Math.round(Number(v) || 0);
    else if (t === 'numnull') v = v === '' || v == null ? null : Number(v);
    else if (t === 'bool') v = v ? 1 : 0;
    else if (t === 'json') { v = String(v ?? '').trim(); if (v) { try { JSON.parse(v); } catch { throw userErr('Доп. параметры — невалидный JSON'); } } }
    out[k] = v;
  }
  if (out.kind && out.api && !API_BY_KIND[out.kind].includes(out.api)) out.api = API_BY_KIND[out.kind][0];
  if (out.api_key?.startsWith('••••')) delete out.api_key;
  if ('emoji_id' in out && out.emoji_id && !/^\d{5,25}$/.test(out.emoji_id)) throw userErr('ID эмодзи — только цифры');
  if ('name' in out && !out.name) throw userErr('Укажи название');
  if ('model' in out && !out.model) throw userErr('Укажи ID модели у провайдера');
  return out;
}
const adminModel = m => ({ ...m, api_key: m.api_key ? '••••' + m.api_key.slice(-4) : '' });

route('GET', '/api/admin/models', 'admin', async () => {
  const ms = all('SELECT * FROM models ORDER BY sort, id');
  const usage = new Map(all("SELECT model_id, COUNT(*) n FROM requests WHERE created_at > ? AND status != 'error' GROUP BY model_id", now() - 30 * 864e5).map(r => [r.model_id, r.n]));
  return { models: ms.map(m => ({ ...adminModel(m), used30: usage.get(m.id) || 0 })), emoji: await emojiMeta(ms.map(m => m.emoji_id)) };
});

route('POST', '/api/admin/models', 'admin', async ({ body }) => {
  const m = cleanModel({ kind: 'chat', api: 'anthropic', ...body });
  if (!m.name || !m.model) throw userErr('Нужны название и ID модели');
  m.sort ??= (one('SELECT COALESCE(MAX(sort), 0) s FROM models').s || 0) + 10;
  m.created_at = now();
  const keys = Object.keys(m);
  const r = run(`INSERT INTO models(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map(k => m[k]));
  return { model: adminModel(one('SELECT * FROM models WHERE id = ?', Number(r.lastInsertRowid))) };
});

route('PUT', '/api/admin/models/:id', 'admin', async ({ params, body }) => {
  const m = cleanModel(body), keys = Object.keys(m);
  if (keys.length) run(`UPDATE models SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map(k => m[k]), Number(params.id));
  const row = one('SELECT * FROM models WHERE id = ?', Number(params.id));
  if (!row) throw httpErr(404, 'Модель не найдена');
  return { model: adminModel(row) };
});

route('DELETE', '/api/admin/models/:id', 'admin', async ({ params }) => {
  run('DELETE FROM models WHERE id = ?', Number(params.id));
  run('UPDATE users SET model_id = NULL WHERE model_id = ?', Number(params.id));
});

route('POST', '/api/admin/models/:id/test', 'admin', async ({ params, body }) => {
  const m = one('SELECT * FROM models WHERE id = ?', Number(params.id));
  if (!m) throw httpErr(404, 'Модель не найдена');
  if (m.kind === 'video') throw userErr('Видео генерируется несколько минут — проверь модель прямо в чате');
  const t0 = now();
  try {
    if (m.kind === 'image') {
      const img = await aiImage(m, String(body.prompt || 'A cute robot mascot, minimal 3D icon'), null, AbortSignal.timeout(180e3));
      return { ok: true, ms: now() - t0, image: `data:image/${img.ext};base64,${img.buf.toString('base64')}` };
    }
    const r = await aiChat({ ...m, max_tokens: Math.min(m.max_tokens || 512, 512) }, '', [{ role: 'user', text: String(body.prompt || 'Привет! Ответь одним предложением: кто ты?') }], undefined, AbortSignal.timeout(120e3));
    return { ok: true, ms: now() - t0, text: r.text, usage: r.usage };
  } catch (e) {
    return { ok: false, ms: now() - t0, error: e.message };
  }
});

route('GET', '/api/admin/provider-models', 'admin', async ({ query }) => {
  const base = (query.base || CFG.aiBase).replace(/\/+$/, '');
  const r = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${CFG.aiKey}`, 'x-api-key': CFG.aiKey, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(20e3) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpErr(502, `Провайдер: ${j.error?.message || j.message || r.status}`);
  return { models: (j.data || j.models || []).map(x => ({ id: x.id, name: x.display_name || x.name || x.id, owned_by: x.owned_by || '' })) };
});

route('GET', '/api/admin/settings', 'admin', async () => {
  const slots = SLOTS.map(s => ({ ...s, value: slotId(s.key), custom: settings.has('slot.' + s.key) }));
  return {
    meta: SETTINGS_META, values: Object.fromEntries(SETTINGS_META.map(m => [m.key, opt(m.key)])), slots,
    models: all('SELECT id, name FROM models ORDER BY sort, id'), emoji: await emojiMeta(slots.map(s => s.value)),
  };
});

route('POST', '/api/admin/settings', 'admin', async ({ body }) => {
  const values = body.values || {};
  if ('bot_text' in values && String(values.bot_text).length > 1024) throw userErr('Текст после /start — максимум 1024 символа (ограничение подписи к фото)');
  for (const [k, v] of Object.entries(values)) {
    const meta = SETTINGS_META.find(m => m.key === k);
    if (!meta) continue;
    if (meta.type === 'number' && !Number.isFinite(Number(String(v).replace(',', '.')))) throw userErr(`«${meta.label}» — нужно число`);
    setOpt(k, meta.type === 'bool' ? (v ? '1' : '0') : String(v ?? '').trim());
  }
  for (const [k, v] of Object.entries(body.slots || {})) {
    if (!SLOT[k]) continue;
    if (v === null) delOpt('slot.' + k);
    else if (v === '' || /^\d{5,25}$/.test(v)) setOpt('slot.' + k, v);
  }
  return { ok: true, slots: slotsMap(), settings: publicSettings(), emoji: await emojiMeta(Object.values(slotsMap())) };
});

route('GET', '/api/admin/users', 'admin', async ({ query }) => {
  const q = String(query.q || '').trim().replace(/^@/, ''), like = `%${q}%`;
  const users = all(`SELECT id, username, first_name, last_name, balance, spent, requests, is_admin, banned, blocked, is_premium, created_at, seen_at FROM users
    WHERE (? = '' OR CAST(id AS TEXT) LIKE ? OR username LIKE ? OR first_name LIKE ? OR last_name LIKE ?)
    ORDER BY seen_at DESC LIMIT 50 OFFSET ?`, q, like, like, like, like, Number(query.offset) || 0);
  return { users: users.map(u => ({ ...u, admin: isAdmin(u), avatar: avatarUrl(getUser(u.id)) })), total: one('SELECT COUNT(*) c FROM users').c };
});

route('GET', '/api/admin/users/:id', 'admin', async ({ params }) => {
  const u = getUser(Number(params.id));
  if (!u) throw httpErr(404, 'Пользователь не найден');
  return {
    user: { ...publicMe(u), is_admin: !!u.is_admin, admin: isAdmin(u), banned: !!u.banned, blocked: !!u.blocked, ref_by: u.ref_by, seen_at: u.seen_at, lang: u.lang },
    stats: userStats(u),
    requests: all('SELECT id, model_name, price, status, error, created_at, prompt FROM requests WHERE user_id = ? ORDER BY id DESC LIMIT 20', u.id),
    payments: all('SELECT id, amount, stars, method, note, created_at FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 20', u.id),
  };
});

// Начисление и списание баланса: «пополнение» платит рефереру процент, «бонус» — просто подарок
function grant(u, delta, kind, note) {
  delta = round2(delta);
  if (!delta) throw userErr('Укажи сумму');
  if (delta < 0) {
    if (u.balance + delta < 0) throw userErr(`Нельзя списать больше, чем на балансе (${money(u.balance)})`);
    credit(u.id, delta, 'admin', note || 'Списание');
    return;
  }
  if (kind === 'topup') return topup(u, delta, note);
  credit(u.id, delta, 'bonus', note);
  notify(u.id, `${E('brand')} Тебе начислен бонус <b>${money(delta)}</b>${note ? `: ${esc(note)}` : ''}.`);
}

route('POST', '/api/admin/users/:id', 'admin', async ({ params, body }) => {
  const u = getUser(Number(params.id));
  if (!u) throw httpErr(404, 'Пользователь не найден');
  if (Number(body.delta)) grant(u, Number(body.delta), body.kind, String(body.note || '').slice(0, 200));
  if ('is_admin' in body) run('UPDATE users SET is_admin = ? WHERE id = ?', body.is_admin ? 1 : 0, u.id);
  if ('banned' in body) run('UPDATE users SET banned = ? WHERE id = ?', body.banned ? 1 : 0, u.id);
  return { ok: true, balance: round2(getUser(u.id).balance) };
});

route('POST', '/api/admin/grant', 'admin', async ({ body }) => {
  const q = String(body.user || '').trim().replace(/^@/, '');
  const u = /^\d+$/.test(q) ? getUser(Number(q)) : one('SELECT * FROM users WHERE username = ? COLLATE NOCASE', q);
  if (!u) throw userErr('Пользователь не найден — он должен хотя бы раз открыть бота');
  const amount = Number(String(body.amount).replace(',', '.'));
  if (!(amount > 0)) throw userErr('Сумма должна быть больше нуля');
  grant(u, amount, body.kind, String(body.note || '').slice(0, 200));
  return { ok: true, user: { id: u.id, name: fullName(u), balance: round2(getUser(u.id).balance) } };
});

route('GET', '/api/admin/emojis', 'admin', async () => {
  const items = all('SELECT id, set_name, emoji, format, repaint FROM emojis WHERE in_library = 1 ORDER BY added_at DESC, rowid');
  return {
    sets: all('SELECT * FROM emoji_sets ORDER BY added_at DESC'),
    items: items.map(e => ({ id: e.id, set: e.set_name, alt: e.emoji })),
    emoji: Object.fromEntries(items.map(e => [e.id, [e.format, e.repaint]])),
  };
});

route('POST', '/api/admin/emojis/import', 'admin', async ({ body }) => {
  const src = String(body.source || '').trim();
  if (!src) throw userErr('Вставь ссылку на пак или ID эмодзи');
  const ids = src.match(/\b\d{15,25}\b/g);
  if (ids && !/addemoji|addstickers/i.test(src)) {
    const got = await fetchEmojiInfo([...new Set(ids)], true);
    if (!got.length) throw userErr('Эмодзи с такими ID не найдены');
    return { imported: got.length };
  }
  const r = await importPack(src);
  return { imported: r.count, set: r };
});

route('DELETE', '/api/admin/emojis/:id', 'admin', async ({ params }) => {
  run('UPDATE emojis SET in_library = 0 WHERE id = ?', params.id);
});

route('DELETE', '/api/admin/emoji-sets/:name', 'admin', async ({ params }) => {
  run('UPDATE emojis SET in_library = 0 WHERE set_name = ?', params.name);
  run('DELETE FROM emoji_sets WHERE name = ?', params.name);
});

route('GET', '/api/admin/broadcast', 'admin', async () => ({ job: bcJob, users: one('SELECT COUNT(*) c FROM users WHERE banned = 0 AND blocked = 0').c }));

route('POST', '/api/admin/broadcast', 'admin', async ({ u, body }) => {
  const text = String(body.text || '').trim();
  const photo = String(body.photo || '').trim();
  if (!text && !photo) throw userErr('Пустое сообщение');
  if (photo && text.length > 1024) throw userErr('С картинкой текст — максимум 1024 символа');
  if (body.test) {
    const to = u?.id || CFG.adminIds[0];
    if (!to) throw userErr('Тест-отправка доступна из Telegram или при заданном ADMIN_IDS');
    const reply_markup = body.button ? appKb('Открыть приложение') : undefined;
    try {
      if (photo.startsWith('/u/')) {
        const name = photo.slice(3);
        await tg('sendPhoto', { chat_id: to, caption: text, parse_mode: 'HTML', reply_markup }, { photo: { data: fs.readFileSync(path.join(CFG.dataDir, 'uploads', name)), type: MIME[path.extname(name)] || 'image/jpeg', name } });
      } else if (photo) await tg('sendPhoto', { chat_id: to, photo, caption: text, parse_mode: 'HTML', reply_markup });
      else await send(to, text, { reply_markup });
    } catch (e) { throw userErr(e.message.replace(/^\w+: /, '')); }
    return { ok: true, test: true };
  }
  return { job: startBroadcast({ text, photo, button: !!body.button, notifyId: u?.id }) };
});

route('POST', '/api/admin/upload', 'admin', async ({ body }) => {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/s.exec(String(body.data || ''));
  if (!m) throw userErr('Нужна картинка PNG, JPG, WEBP или GIF');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8e6) throw userErr('Файл больше 8 МБ');
  const name = `${crypto.randomBytes(8).toString('hex')}.${m[1].replace('jpeg', 'jpg')}`;
  fs.writeFileSync(path.join(CFG.dataDir, 'uploads', name), buf);
  return { url: `/u/${name}` };
}, 12e6);

/* ───────────────────────────── HTTP: сервер ───────────────────────────── */

const gzCache = new Map();

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sendFile(req, res, fp, { type, cache = 'no-cache' } = {}) {
  let st;
  try { st = fs.statSync(fp); } catch { return json(res, 404, { error: 'Не найдено' }); }
  if (!st.isFile()) return json(res, 404, { error: 'Не найдено' });
  if (!type) {
    type = MIME[path.extname(fp).toLowerCase()];
    if (!type) { // миниатюры эмодзи бывают webp или jpg
      const head = Buffer.alloc(4);
      const fd = fs.openSync(fp, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
      type = head.toString('latin1') === 'RIFF' ? 'image/webp' : 'image/jpeg';
    }
  }
  const etag = `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
  const headers = { 'content-type': type, 'cache-control': cache, etag, 'accept-ranges': 'bytes' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  if (/json|javascript|css|html|svg/.test(type)) {
    let body = fs.readFileSync(fp);
    if (body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      const k = fp + etag;
      if (!gzCache.has(k)) { if (gzCache.size > 600) gzCache.clear(); gzCache.set(k, zlib.gzipSync(body)); }
      body = gzCache.get(k);
      headers['content-encoding'] = 'gzip';
      headers.vary = 'accept-encoding';
    }
    res.writeHead(200, headers);
    return res.end(body);
  }
  // Картинки и видео отдаём потоком и с Range — иначе видео не перематывается (iOS)
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    return fs.createReadStream(fp, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  fs.createReadStream(fp).pipe(res);
}

const PUBLIC = path.join(ROOT, 'public');
const WEBHOOK_PATH = '/tg/' + crypto.createHash('sha256').update('wh' + CFG.token).digest('hex').slice(0, 24);
const WEBHOOK_SECRET = crypto.createHash('sha256').update('secret' + CFG.token).digest('hex').slice(0, 32);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  try {
    if (p.startsWith('/api/')) {
      const r = routes.find(r => r.method === req.method && r.re.test(p));
      if (!r) throw httpErr(404, 'Не найдено');
      const m = p.match(r.re);
      const ctx = {
        req, res, url, query: Object.fromEntries(url.searchParams),
        params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])),
        body: ['POST', 'PUT'].includes(req.method) ? await readJson(req, r.limit) : {},
      };
      if (r.access !== 'public') {
        Object.assign(ctx, await auth(req));
        if (r.access === 'user' && !ctx.u) throw httpErr(403, 'Доступно только из Telegram');
        if (r.access === 'admin' && !ctx.admin) throw httpErr(403, 'Нет доступа');
      }
      const out = await r.fn(ctx);
      if (out !== STREAM) json(res, 200, out ?? { ok: true });
      return;
    }
    if (p === WEBHOOK_PATH && req.method === 'POST') {
      if (req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) return json(res, 403, { error: 'forbidden' });
      const up = await readJson(req, 5e6);
      json(res, 200, { ok: true });
      return handleUpdate(up).catch(e => log('update', e.message));
    }
    if (p === '/health') return json(res, 200, { ok: true });
    let m;
    if ((m = /^\/e\/(\d{5,25})$/.exec(p))) {
      const thumb = url.searchParams.has('t');
      const fp = await emojiFile(m[1], thumb);
      if (!fp) return json(res, 404, { error: 'Эмодзи не найдено' });
      return sendFile(req, res, fp, { type: thumb ? undefined : MIME[path.extname(fp)], cache: 'public, max-age=31536000, immutable' });
    }
    if ((m = /^\/a\/(\d+)$/.exec(p))) {
      if (url.searchParams.get('s') !== sign('a' + m[1])) return json(res, 403, { error: 'forbidden' });
      return sendFile(req, res, avatarFile(m[1]), { type: 'image/jpeg', cache: 'private, max-age=86400' });
    }
    if ((m = /^\/u\/([\w-]+\.\w+)$/.exec(p))) return sendFile(req, res, path.join(CFG.dataDir, 'uploads', m[1]), { cache: 'public, max-age=31536000, immutable' });
    if ((m = /^\/m\/([a-f0-9]{32}\.\w+)$/.exec(p))) return sendFile(req, res, path.join(CFG.dataDir, 'media', m[1]), { cache: 'private, max-age=31536000, immutable' });
    // статика Mini App; всё остальное без расширения — index.html (SPA)
    const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
    if (file.startsWith(PUBLIC + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(req, res, file);
    if (!path.extname(p)) return sendFile(req, res, path.join(PUBLIC, 'index.html'));
    return json(res, 404, { error: 'Не найдено' });
  } catch (e) {
    if (!e.status || e.status >= 500) log('HTTP', req.method, p, e.stack || e.message);
    if (!res.headersSent) json(res, e.status || 500, { error: e.expose ? e.message : 'Ошибка сервера', code: e.code });
    else res.end();
  }
});

/* ───────────────────────────── Запуск ───────────────────────────── */

async function setupBot() {
  await tg('setMyCommands', { commands: [{ command: 'start', description: `Открыть ${opt('brand')}` }] });
  await tg('setChatMenuButton', {
    menu_button: HAS_APP ? { type: 'web_app', text: opt('brand'), web_app: { url: appUrl() } } : { type: 'commands' },
  });
}

async function poll() {
  await tg('deleteWebhook', {}).catch(() => {});
  let offset = 0;
  for (;;) {
    try {
      const ups = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
      for (const up of ups) {
        offset = up.update_id + 1;
        handleUpdate(up).catch(e => log('update', e.message));
      }
    } catch (e) {
      log('polling:', e.message);
      await sleep(e.code === 409 ? 10e3 : 3e3);
    }
  }
}

try {
  const me = await tg('getMe');
  BOT.username = me.username;
  BOT.id = me.id;
} catch (e) {
  if (CFG.polling) {
    console.error('✖ Telegram не принял BOT_TOKEN или недоступен:', e.message);
    process.exit(1);
  }
  log('getMe:', e.message);
}

server.listen(CFG.port, CFG.host, () => {
  log(`✔ ${BOT.username ? '@' + BOT.username : 'Dreinn AI'} запущен на ${CFG.host}:${CFG.port}`);
  log(HAS_APP ? `  Mini App: ${CFG.publicUrl}` : '  ⚠ PUBLIC_URL (https) не задан — кнопка «Открыть» в боте не появится');
  if (PROXY) log(`  Прокси: ${PROXY.replace(/\/\/[^@/]*@/, '//***@')}`);
  if (!CFG.aiKey) log('  ⚠ AI_API_KEY не задан — модели отвечать не будут');
  if (!CFG.adminPassword && !CFG.adminIds.length) log('  ⚠ Не заданы ADMIN_IDS / ADMIN_PASSWORD — админка недоступна');
});
if (!CFG.polling) {
  log('  POLLING=0 — только сайт, апдейты бота не принимаются');
} else if (CFG.webhook && HAS_APP) {
  setupBot().catch(e => log('setup:', e.message));
  await tg('setWebhook', { url: CFG.publicUrl + WEBHOOK_PATH, secret_token: WEBHOOK_SECRET, allowed_updates: ['message'] });
  log('  Режим: webhook');
} else {
  setupBot().catch(e => log('setup:', e.message));
  poll();
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('Останавливаюсь…');
    server.close();
    try { db.close(); } catch {}
    process.exit(0);
  });
}
