'use strict';
// Dreinn AI — Mini App: чат с нейросетями (текст, изображения, видео), история, профиль и админ-панель.
// Ванильный JS без сборки.

const tg = window.Telegram?.WebApp;
const inTG = !!tg?.initData;
const qs = new URLSearchParams(location.search);
const DESKTOP = inTG ? ['tdesktop', 'macos', 'web', 'weba', 'webk'].includes(tg.platform) : !('ontouchstart' in window);
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

const S = {
  me: null, admin: false, models: [], slots: {}, settings: {}, emoji: {}, bot: '', ref_link: '',
  view: 'app', tab: 'chat', profile: null, hist: { type: 'requests', items: null },
  chat: { id: null, title: '', messages: [] }, compose: { text: '', image: null }, genId: null,
  adminTab: 'stats', lib: null, userQ: '',
};

let auth = inTG ? `tma ${tg.initData}`
  : qs.get('dev') ? `Dev ${qs.get('dev')}`
  : store.get('admin_token') ? `Admin ${store.get('admin_token')}` : '';

/* ───────────── Утилиты ───────────── */

const $ = (sel, el = document) => el.querySelector(sel);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  chat: '<path d="M12 3.2c-5 0-9 3.5-9 7.9 0 2.3 1.1 4.4 2.9 5.8-.2 1.3-.8 2.6-1.7 3.6-.3.3 0 .8.4.8 2 0 3.6-.8 4.9-1.7.8.2 1.6.3 2.5.3 5 0 9-3.5 9-7.9S17 3.2 12 3.2Z"/>',
  archive: '<path fill-rule="evenodd" d="M3 4.5A1.5 1.5 0 0 1 4.5 3h15A1.5 1.5 0 0 1 21 4.5v2A1.5 1.5 0 0 1 19.5 8h-15A1.5 1.5 0 0 1 3 6.5v-2ZM4 9.5h16V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9.5Zm11.9 3.4-1.4-1.4-4 4-1.6-1.6-1.4 1.4 3 3 5.4-5.4Z"/>',
  info: '<path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.1 8.4h2.2V17h-2.2v-6.6ZM12 6.2a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z"/>',
  user: '<circle cx="12" cy="7.6" r="4.6"/><path d="M3.4 20.1C4.3 15.9 7.8 13.6 12 13.6s7.7 2.3 8.6 6.5a1.3 1.3 0 0 1-1.3 1.6H4.7a1.3 1.3 0 0 1-1.3-1.6Z"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  chevron: '<path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  back: '<path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  up: '<path d="M12 19V5m-6 6 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2.5"/>',
  list: '<path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  compose: '<path d="M12 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V12M18.3 3.7a2.1 2.1 0 0 1 3 3l-8.8 8.8-3.9.9.9-3.9 8.8-8.8Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  image: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 15.5-4.8-4.8L7 20"/></g>',
  close: '<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  copy: '<g fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></g>',
  download: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  expand: '<path d="M4 9V6a2 2 0 0 1 2-2h3m6 0h3a2 2 0 0 1 2 2v3m0 6v3a2 2 0 0 1-2 2h-3m-6 0H6a2 2 0 0 1-2-2v-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  collapse: '<path d="M9 4v3a2 2 0 0 1-2 2H4m16 0h-3a2 2 0 0 1-2-2V4m0 16v-3a2 2 0 0 1 2-2h3M4 15h3a2 2 0 0 1 2 2v3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  gear: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></g>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  send: '<path d="M4.4 11.2 19 4.6c.8-.4 1.6.4 1.3 1.2L13.8 20.4c-.4.8-1.5.7-1.7-.1l-1.5-6-6-1.5c-.9-.2-1-1.3-.2-1.6Z"/>',
  trash: '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  logo: '<path d="M12 2.5c.6 3.7 2.5 6.3 6.8 7.8v1.1c-4.3 1.5-6.2 4.1-6.8 7.8h-.9c-.6-3.7-2.5-6.3-6.8-7.8v-1.1c4.3-1.5 6.2-4.1 6.8-7.8h.9Z"/>',
  premium: '<defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b93ff"/><stop offset=".5" stop-color="#976fff"/><stop offset="1" stop-color="#e46ace"/></linearGradient></defs><path fill="url(#pg)" d="m12 2.6 2.8 5.8 6.3.8-4.6 4.4 1.2 6.3L12 16.8l-5.7 3.1 1.2-6.3-4.6-4.4 6.3-.8z"/>',
};
// Иконка-SVG; без size размер задаёт CSS родителя
const svg = (name, size) => {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"${size ? ` width="${size}" height="${size}"` : ''}>${ICONS[name]}</svg>`;
  return t.content.firstChild;
};

const fmt = n => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const rub = n => [fmt(n), h('span', { class: 'rub' }, '₽')];
const plural = (n, [one, few, many]) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many;
};
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const dShort = t => { const d = new Date(t); return `${d.getDate()} ${MON[d.getMonth()]}`; };
const dFull = t => new Date(t).toLocaleDateString('ru-RU');
const timeAgo = t => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'сейчас';
  if (s < 3600) return `${Math.floor(s / 60)} мин`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч`;
  return dShort(t);
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const userName = u => [u?.first_name, u?.last_name].filter(Boolean).join(' ') || (u?.username ? '@' + u.username : `ID ${u?.id ?? ''}`);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const haptic = fn => () => { if (inTG && tg.isVersionAtLeast?.('6.1')) try { fn(tg.HapticFeedback); } catch {} };
const hap = {
  tap: haptic(f => f.impactOccurred('light')),
  sel: haptic(f => f.selectionChanged()),
  ok: haptic(f => f.notificationOccurred('success')),
  err: haptic(f => f.notificationOccurred('error')),
};

const headers = json => ({ ...(auth && { authorization: auth }), ...(json && { 'content-type': 'application/json' }) });

async function api(path, body, method) {
  const r = await fetch(`/api/${path}`, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: headers(body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && auth.startsWith('Admin')) {
      store.set('admin_token', null);
      auth = '';
      setTimeout(renderLogin, 0);
    }
    throw Object.assign(new Error(j.error || `Ошибка ${r.status}`), { code: j.code, status: r.status });
  }
  if (j.emoji) Object.assign(S.emoji, j.emoji);
  return j;
}

// Чтение SSE-потока из fetch (EventSource не умеет POST)
async function apiStream(path, body, onEvent, signal) {
  const r = await fetch(`/api/${path}`, {
    method: body !== undefined ? 'POST' : 'GET', headers: headers(body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined, signal,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(j.error || `Ошибка ${r.status}`), { code: j.code, status: r.status });
  }
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const data = buf.slice(0, i).split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      buf = buf.slice(i + 2);
      if (data) onEvent(JSON.parse(data));
    }
  }
}

function toast(msg, type = '') {
  const t = h('div', { class: `toast ${type}` }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, type === 'err' ? 3600 : 2400);
}
const fail = e => { hap.err(); toast(e.message || String(e), 'err'); };

async function copy(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  hap.ok();
  toast('Скопировано');
}

function openLink(url) {
  if (inTG && url.startsWith('https://t.me/')) tg.openTelegramLink(url);
  else if (inTG) tg.openLink(url);
  else window.open(url, '_blank');
}

function download(x) {
  const url = new URL(x.url, location.origin).href;
  if (inTG && tg.isVersionAtLeast?.('8.0')) {
    try { return tg.downloadFile({ url, file_name: `dreinn-${x.url.split('/').pop()}` }); } catch {}
  }
  openLink(url);
}

const confirmBox = text => new Promise(ok => {
  if (inTG && tg.isVersionAtLeast?.('6.2')) tg.showConfirm(text, ok);
  else ok(window.confirm(text));
});

/* ───────────── Премиум-эмодзи (TGS / WEBM / WEBP) ───────────── */

let lottieP;
const loadLottie = () => lottieP ??= new Promise((ok, no) => {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie_light.min.js';
  s.onload = () => ok(window.lottie);
  s.onerror = () => { lottieP = null; no(new Error('lottie')); };
  document.head.append(s);
});
const tgsCache = new Map();
const tgsJson = id => {
  if (!tgsCache.has(id)) tgsCache.set(id, fetch(`/e/${id}`).then(r => (r.ok ? r.text() : Promise.reject(new Error('emoji')))));
  return tgsCache.get(id);
};

const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    const el = e.target;
    if (e.isIntersecting) { if (!el._loaded) loadEmo(el); else el._play?.(); } else el._pause?.();
  }
}, { rootMargin: '120px' });

// mode: loop — крутится всегда, once — один раз при появлении, static — картинка-миниатюра
function Emo(id, { size = 24, alt = '', mode = 'loop', cls = '' } = {}) {
  const el = h('span', { class: `emo ${cls}`, style: `--s:${size}px` });
  if (!id) {
    el.classList.add('emo-alt');
    el.textContent = alt;
    return el;
  }
  el._id = id;
  el._mode = mode;
  io.observe(el);
  return el;
}

const maskOrImg = (src, repaint) => (repaint
  ? h('i', { class: 'emo-mask', style: `-webkit-mask-image:url(${src});mask-image:url(${src})` })
  : h('img', { src, alt: '', draggable: 'false', decoding: 'async' }));

async function loadEmo(el) {
  el._loaded = true;
  const id = el._id, meta = S.emoji[id];
  const [kind, repaint] = meta || ['?', 0];
  if (repaint) el.classList.add('repaint');
  if (el._mode === 'static' || !meta) return el.replaceChildren(maskOrImg(`/e/${id}?t`, repaint));
  if (kind === 'webp') return el.replaceChildren(maskOrImg(`/e/${id}`, repaint));
  if (kind === 'webm') {
    const v = h('video', { src: `/e/${id}`, poster: `/e/${id}?t`, muted: true, playsinline: true, autoplay: true, loop: el._mode === 'loop' });
    v.muted = true;
    el.replaceChildren(v);
    el._play = () => el._mode === 'loop' && v.play().catch(() => {});
    el._pause = () => v.pause();
    return;
  }
  el.replaceChildren(maskOrImg(`/e/${id}?t`, repaint));
  try {
    const [lottie, txt] = await Promise.all([loadLottie(), tgsJson(id)]);
    if (!el.isConnected) return;
    el.replaceChildren();
    const anim = lottie.loadAnimation({
      container: el, renderer: 'svg', loop: el._mode === 'loop', autoplay: true, animationData: JSON.parse(txt),
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true },
    });
    el._anim = anim;
    el._play = () => el._mode === 'loop' && anim.play();
    el._pause = () => el._mode === 'loop' && anim.pause();
  } catch {}
}

function cleanup(node) {
  node?.querySelectorAll?.('.emo').forEach(el => {
    io.unobserve(el);
    el._anim?.destroy();
    el._anim = null;
  });
}

const slotEmo = (key, size, alt, mode) => Emo(S.slots[key], { size, alt, mode });

/* ───────────── Аватар и цвета профиля ───────────── */

const AVA_COLORS = [['#ff885e', '#ff516a'], ['#ffcd6a', '#ffa85c'], ['#82b1ff', '#665fff'], ['#a0de7e', '#54cb68'], ['#53edd6', '#28c9b7'], ['#72d5fd', '#2a9ef1'], ['#e0a2f3', '#d669ed']];
function Avatar(u, size) {
  const [a1, a2] = AVA_COLORS[Math.abs(Number(u?.id) || 0) % 7];
  const el = h('span', { class: 'ava', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * .4)}px;--a1:${a1};--a2:${a2}` });
  const initials = (u?.first_name?.[0] || u?.username?.[0] || '?').toUpperCase();
  if (u?.avatar) {
    const img = h('img', { src: u.avatar, alt: '' });
    img.onerror = () => { img.remove(); el.textContent = initials; };
    el.append(img);
  } else el.textContent = initials;
  return el;
}

// Палитра цветов профиля Telegram (тёмная тема): profile_accent_color_id → [центр, край]
const PROFILE_COLORS = [
  ['#b8524c', '#6e2b2a'], ['#c47a3e', '#7a4520'], ['#8a63c9', '#4c3180'], ['#4f9a55', '#285c2e'],
  ['#3f97a8', '#205a66'], ['#4f86c1', '#284f80'], ['#c1577f', '#7a2c4a'], ['#6f7780', '#373c42'],
  ['#d0605d', '#a65a35'], ['#cf7a3e', '#9c7a2a'], ['#9b62d6', '#91468a'], ['#3f9a5c', '#62782f'],
  ['#3a90b8', '#2e7a69'], ['#4c86c4', '#2f7488'], ['#b55076', '#9a4646'], ['#5d6d7c', '#56616b'],
];
const hex = n => '#' + (Number(n) >>> 0).toString(16).padStart(6, '0').slice(-6);
function profileColors(t) {
  if (t?.gift?.dark_theme_main_color != null) return [hex(t.gift.dark_theme_main_color), hex(t.gift.dark_theme_other_colors?.[0] ?? t.gift.dark_theme_main_color)];
  if (t?.pcolor != null && PROFILE_COLORS[t.pcolor]) return PROFILE_COLORS[t.pcolor];
  return ['#5a5a61', '#1c1c1f'];
}

// Узор из эмодзи фона профиля — кольцами вокруг аватарки, как в Telegram
function Pattern(id) {
  const wrap = h('div', { class: 'pf-pattern' });
  const rings = [{ r: 76, n: 6, s: 24, o: .3, a: 30 }, { r: 116, n: 9, s: 20, o: .2, a: 10 }, { r: 158, n: 12, s: 16, o: .11, a: 0 }];
  for (const g of rings) {
    for (let i = 0; i < g.n; i++) {
      const ang = (g.a + (i * 360) / g.n) * Math.PI / 180;
      const x = Math.cos(ang) * g.r * 1.35, y = Math.sin(ang) * g.r * .8;
      wrap.append(h('i', { style: `left:calc(50% + ${x - g.s / 2}px);top:${y - g.s / 2}px;width:${g.s}px;height:${g.s}px;opacity:${g.o};-webkit-mask-image:url(/e/${id}?t);mask-image:url(/e/${id}?t)` }));
    }
  }
  return wrap;
}

/* ───────────── Шторки и навигация ───────────── */

const sheets = [];
function sheet(content, { title, onClose } = {}) {
  const panel = h('div', { class: 'sheet' }, h('div', { class: 'sheet-grab' }), title && h('div', { class: 'sheet-title' }, title), content);
  const wrap = h('div', { class: 'sheet-wrap' }, h('div', { class: 'sheet-back', onclick: () => s.close() }), panel);
  const s = {
    wrap, panel,
    close() {
      if (s.closed) return;
      s.closed = true;
      wrap.classList.remove('open');
      sheets.splice(sheets.indexOf(s), 1);
      syncBack();
      setTimeout(() => { cleanup(wrap); wrap.remove(); }, 320);
      onClose?.();
    },
    set(node) { cleanup(panel); panel.replaceChildren(h('div', { class: 'sheet-grab' }), title && h('div', { class: 'sheet-title' }, title), node); },
  };
  document.body.append(wrap);
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  sheets.push(s);
  syncBack();
  hap.tap();
  return s;
}

function syncBack() {
  if (!inTG) return;
  const need = sheets.length || (S.view === 'admin' && S.me) || (S.view === 'app' && S.tab !== 'chat');
  need ? tg.BackButton.show() : tg.BackButton.hide();
}

const root = document.getElementById('app');
function mount(...nodes) {
  cleanup(root);
  root.replaceChildren(...nodes.filter(Boolean));
}

function render() {
  if (S.view === 'admin') return renderAdmin();
  const onChat = S.tab === 'chat';
  document.body.classList.toggle('on-chat', onChat);
  const views = { history: viewHistory, info: viewInfo, profile: viewProfile };
  mount(onChat ? viewChat() : h('main', { class: 'page' }, views[S.tab]()), !onChat && h('div', { class: 'nav-fade' }), Nav());
  if (onChat) requestAnimationFrame(() => scrollBottom(true));
  syncBack();
}

function go(tab) {
  if (S.tab !== tab) hap.sel();
  S.tab = tab;
  S.view = 'app';
  render();
  if (tab !== 'chat') window.scrollTo(0, 0);
  if (tab === 'profile') loadProfile();
  if (tab === 'history') loadHistory(true);
}

function Nav() {
  const btn = (tab, icon, slot, cls) => h('button', { class: `${cls}${S.tab === tab ? ' on' : ''}`, onclick: () => go(tab), 'aria-label': tab },
    S.slots[slot] ? Emo(S.slots[slot], { size: 26, mode: 'once' }) : svg(icon));
  return h('nav', { class: 'nav' },
    h('div', { class: 'nav-pill' }, btn('chat', 'chat', 'nav_chat', 'nav-btn'), btn('history', 'archive', 'nav_history', 'nav-btn'), btn('info', 'info', 'nav_info', 'nav-btn')),
    btn('profile', 'user', 'nav_profile', 'nav-round'));
}

const Field = (label, input, hint) => h('div', { class: 'field' }, label && h('label', null, label), input, hint && h('div', { class: 'hint' }, hint));
const Switch = on => h('input', { type: 'checkbox', class: 'switch', checked: !!on });
const ToggleRow = (label, sw, hint) => h('label', { class: 'toggle-row' }, h('div', { class: 'item-main' }, h('b', null, label), hint && h('div', { class: 'hint', style: 'margin:2px 0 0' }, hint)), sw);
const Tile = (label, value, sub, onclick, icon) => h(onclick ? 'button' : 'div', { class: 'tile', onclick },
  h('div', { class: 'tile-l' }, label), h('div', { class: 'tile-v' }, value), sub && h('div', { class: 'tile-s' }, sub), icon && h('span', { class: 'tile-c' }, svg(icon)));
const Skel = (height, mt = 10) => h('div', { class: 'skel', style: `height:${height}px;margin-top:${mt}px` });
const Empty = (title, sub) => h('div', { class: 'empty' }, slotEmo('empty', 72, '💭', 'once'), h('div', { class: 'empty-t' }, title), sub && h('div', { class: 'empty-s' }, sub));
const Section = (title, ...kids) => h('section', { class: 'section' }, title && h('h3', null, title), ...kids);

/* ───────────── Markdown → HTML (ответы моделей) ───────────── */

function mdInline(s) {
  const keep = [];
  const hold = x => `\u0001${keep.push(x) - 1}\u0002`;
  s = s.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => hold(`<a href="${esc(u)}">${esc(t)}</a>`));
  s = esc(s)
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '$1<a href="$2">$2</a>')
    .replace(/\*\*(?=\S)(.+?\S)\*\*/g, '<b>$1</b>')
    .replace(/__(?=\S)(.+?\S)__/g, '<b>$1</b>')
    .replace(/~~(?=\S)(.+?\S)~~/g, '<s>$1</s>')
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, '$1<i>$2</i>')
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<i>$2</i>');
  return s.replace(/\u0001(\d+)\u0002/g, (_, k) => keep[k]);
}

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

function md(src) {
  const lines = String(src).replace(/\r/g, '').split('\n'), out = [];
  const isBlock = l => /^```/.test(l) || /^#{1,6}\s/.test(l) || LIST_RE.test(l) || /^>/.test(l) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l);
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const lang = l.slice(3).trim(), code = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      out.push(`<pre><div class="code-head"><span>${esc(lang || 'код')}</span><button class="code-copy">Копировать</button></div><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (l.includes('|') && TABLE_SEP.test(lines[i + 1] || '')) {
      const head = cells(l), body = [];
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) body.push(cells(lines[i]));
      out.push(`<div class="table"><table><thead><tr>${head.map(c => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^#{1,6}\s/.test(l)) {
      out.push(`<h4>${mdInline(l.replace(/^#+\s*/, '').replace(/\s*#+\s*$/, ''))}</h4>`);
      i++;
    } else if (LIST_RE.test(l)) {
      const ordered = /\d/.test(LIST_RE.exec(l)[2]), items = [];
      while (i < lines.length && (LIST_RE.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const m = LIST_RE.exec(lines[i]);
        if (m) items.push(m[3]); else items[items.length - 1] += '\n' + lines[i].trim();
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map(x => `<li>${x.split('\n').map(mdInline).join('<br>')}</li>`).join('')}</${tag}>`);
    } else if (/^>/.test(l)) {
      const q = [];
      for (; i < lines.length && /^>/.test(lines[i]); i++) q.push(lines[i].replace(/^>\s?/, ''));
      out.push(`<blockquote>${md(q.join('\n'))}</blockquote>`);
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) {
      out.push('<hr>');
      i++;
    } else if (!l.trim()) {
      i++;
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !isBlock(lines[i]) && !(lines[i].includes('|') && TABLE_SEP.test(lines[i + 1] || ''))) para.push(lines[i++]);
      out.push(`<p>${para.map(mdInline).join('<br>')}</p>`);
    }
  }
  return out.join('');
}

/* ───────────── Чат ───────────── */

const KINDS = [['chat', 'Чат'], ['image', 'Изображения'], ['video', 'Видео']];
const KIND_ALT = { chat: '💬', image: '🖼', video: '🎥' };
const KIND_TITLE = { chat: 'Чем помочь?', image: 'Что нарисуем?', video: 'Какое видео снимем?' };
const SUGGEST = {
  chat: ['Объясни простыми словами, как работает ИИ', 'Напиши пост для Telegram-канала', 'Помоги разобраться с кодом', 'Составь план на неделю'],
  image: ['Кот-астронавт в стиле Pixar', 'Неоновый Токио под дождём, кинокадр', 'Минималистичный логотип кофейни', 'Уютная комната в стиле Ghibli'],
  video: ['Дрон пролетает над горами на закате', 'Капля падает в воду, замедленная съёмка', 'Кот играет на пианино, тёплый свет'],
};
const PLACEHOLDER = { chat: 'Сообщение', image: 'Опиши изображение…', video: 'Опиши видео…' };

const curModel = () => S.models.find(m => m.id === S.me?.model_id) || S.models[0] || null;
const priceText = m => (m.price > 0 ? `${fmt(m.price)} ₽ за запрос` : 'бесплатно');
const canAttach = m => !!m && (m.kind !== 'chat' || m.vision);

function viewChat() {
  const m = curModel();
  return h('main', { class: 'chat-page' },
    h('header', { class: 'chat-top' },
      h('button', { class: 'icon-btn soft', 'aria-label': 'Чаты', onclick: openChats }, svg('list')),
      h('button', { class: 'model-pill', onclick: openModels },
        Emo(m?.emoji_id, { size: 24, alt: m?.emoji || '🤖' }),
        h('span', { class: 'mp-text' }, h('b', null, m?.name || 'Нет моделей'), h('small', null, m ? priceText(m) : '')),
        svg('down')),
      h('button', { class: 'icon-btn soft', 'aria-label': 'Новый чат', onclick: newChat }, svg('compose'))),
    h('div', { class: 'msgs', id: 'msgs', onscroll: e => { S.stick = nearBottom(e.currentTarget); } },
      S.chat.messages.length ? S.chat.messages.map(Msg) : ChatEmpty(m)),
    Composer(m));
}

function Hero() {
  const banner = S.settings.banner;
  const canFs = inTG && tg.isVersionAtLeast?.('8.0') && !['tdesktop', 'macos', 'web', 'weba'].includes(tg.platform);
  return h('section', { class: `hero${banner ? ' has-banner' : ''}`, style: banner ? `--banner:url("${encodeURI(banner)}")` : null },
    h('div', { class: 'hero-bg' }),
    h('div', { class: 'hero-top' },
      h('div', { class: 'brand' }, S.settings.brand),
      h('div', { class: 'hero-actions' },
        canFs && h('button', { class: 'icon-btn glass', 'aria-label': 'Во весь экран', onclick: () => (tg.isFullscreen ? tg.exitFullscreen() : tg.requestFullscreen()) }, svg(tg.isFullscreen ? 'collapse' : 'expand')),
        S.admin && h('button', { class: 'icon-btn glass', 'aria-label': 'Админка', onclick: openAdmin }, svg('gear')),
        h('button', { class: 'hero-ava', 'aria-label': 'Профиль', onclick: () => go('profile') }, Avatar(S.me, 34)))),
    h('div', null,
      h('div', { class: 'hero-label' }, 'Баланс'),
      h('div', { class: 'balance' },
        h('span', { class: 'num' }, fmt(S.me.balance)), h('span', { class: 'rub' }, '₽'),
        h('button', { class: 'plus glass', 'aria-label': 'Пополнить', onclick: openTopup }, svg('plus')))));
}

function ChatEmpty(m) {
  return h('div', { class: 'chat-empty' },
    Hero(),
    m ? [
      h('div', { class: 'ce-model' },
        Emo(m.emoji_id, { size: 60, alt: m.emoji }),
        h('h2', null, KIND_TITLE[m.kind] || KIND_TITLE.chat),
        h('p', null, `${m.name} · ${priceText(m)}`),
        m.description && h('p', { class: 'ce-desc' }, m.description)),
      h('div', { class: 'suggest' }, (SUGGEST[m.kind] || SUGGEST.chat).map(t => h('button', { class: 'sug', onclick: () => setCompose(t) }, t))),
      !(m.price > 0) && S.me.free_left != null && h('div', { class: 'strip' }, slotEmo('gift', 20, '🎁'),
        h('span', null, 'Бесплатно сегодня: ', h('b', null, S.me.free_left), ` ${plural(S.me.free_left, ['запрос', 'запроса', 'запросов'])}`)),
    ] : Empty('Моделей пока нет', 'Загляни чуть позже'));
}

function Msg(msg) {
  if (msg.role === 'user') {
    return h('div', { class: 'msg user', 'data-id': msg.id },
      msg.media.map(MediaEl), msg.content && h('div', { class: 'bubble' }, msg.content));
  }
  const m = S.models.find(x => x.id === msg.model_id);
  const el = h('div', { class: `msg bot ${msg.status}`, 'data-id': msg.id },
    h('div', { class: 'msg-head' }, Emo(m?.emoji_id, { size: 18, alt: m?.emoji || KIND_ALT[msg.kind], mode: 'static' }), h('span', null, msg.model_name)),
    h('div', { class: 'msg-body md' }),
    h('div', { class: 'msg-foot' }));
  fillMsg(el, msg);
  return el;
}

function fillMsg(el, msg) {
  const body = $('.msg-body', el), foot = $('.msg-foot', el);
  el.className = `msg bot ${msg.status}`;
  if (msg.status === 'pending') {
    if (msg.kind === 'chat') body.innerHTML = msg.content ? md(msg.content) + '<span class="caret"></span>' : '<div class="dots"><i></i><i></i><i></i></div>';
    else {
      const label = msg.kind === 'video' ? `Снимаю видео${msg.progress != null ? ` · ${Math.round(msg.progress)}%` : '…'}` : 'Рисую изображение…';
      body.replaceChildren(h('div', { class: `gen-box ${msg.kind}` }, h('div', { class: 'gen-shine' }), h('span', null, label)));
    }
    foot.replaceChildren();
    return;
  }
  body.innerHTML = msg.content ? md(msg.content) : '';
  msg.media.forEach(x => body.append(MediaEl(x)));
  if (msg.status === 'error') body.append(h('div', { class: 'msg-err' }, msg.error || 'Ошибка генерации'));
  if (msg.status === 'stopped') body.append(h('div', { class: 'msg-note' }, 'Генерация остановлена'));
  foot.replaceChildren(
    msg.content && h('button', { class: 'mini', onclick: () => copy(msg.content) }, svg('copy'), 'Копировать'),
    msg.media[0] && h('button', { class: 'mini', onclick: () => download(msg.media[0]) }, svg('download'), 'Скачать'),
    msg.status !== 'error' && h('span', { class: 'msg-price' }, msg.price > 0 ? `${fmt(msg.price)} ₽` : 'бесплатно'));
}

function MediaEl(x) {
  if (x.type === 'video') return h('video', { class: 'media', src: x.url, controls: true, playsinline: true, preload: 'metadata' });
  const img = h('img', { class: 'media', src: x.url, alt: '', loading: 'lazy', onclick: () => viewImage(x) });
  img.onload = () => { if (S.stick) scrollBottom(); };
  return img;
}

function viewImage(x) {
  sheet(h('div', null,
    h('img', { class: 'viewer', src: x.url, alt: '' }),
    h('div', { class: 'row2' },
      h('button', { class: 'btn', onclick: () => openLink(new URL(x.url, location.origin).href) }, 'Открыть'),
      h('button', { class: 'btn primary', onclick: () => download(x) }, svg('download'), 'Скачать'))));
}

const msgsBox = () => $('#msgs');
const nearBottom = el => el.scrollHeight - el.scrollTop - el.clientHeight < 140;
function scrollBottom(force) {
  const el = msgsBox();
  if (el && (force || S.stick)) el.scrollTop = el.scrollHeight;
}

// Перерисовка сообщений во время стриминга — пачками раз в ~40 мс (setTimeout работает и в свёрнутом приложении)
const dirty = new Set();
let flushTimer = 0;
function touchMsg(msg) {
  dirty.add(msg);
  flushTimer ||= setTimeout(() => {
    flushTimer = 0;
    const box = msgsBox();
    S.stick = box ? nearBottom(box) : false;
    for (const m of dirty) {
      const node = document.querySelector(`.msg[data-id="${m.id}"]`);
      if (node) fillMsg(node, m);
    }
    dirty.clear();
    scrollBottom();
  }, 40);
}

function Composer(m) {
  const ta = h('textarea', {
    class: 'c-input', id: 'cinput', rows: 1, placeholder: m ? `${PLACEHOLDER[m.kind] || PLACEHOLDER.chat}` : 'Нет доступных моделей',
    enterkeyhint: DESKTOP ? 'send' : 'enter',
  });
  ta.value = S.compose.text;
  ta.oninput = () => { S.compose.text = ta.value; autosize(ta); syncSend(); };
  ta.onfocus = () => document.body.classList.add('typing');
  ta.onblur = () => setTimeout(() => { if (document.activeElement !== ta) document.body.classList.remove('typing'); }, 150);
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && DESKTOP) { e.preventDefault(); sendMessage(); } };
  const file = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  file.onchange = async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    try { S.compose.image = await prepImage(f); renderComposer(); } catch { fail(new Error('Не удалось прочитать картинку')); }
  };
  const keep = e => e.preventDefault(); // не убирать клавиатуру при нажатии на кнопки
  return h('div', { class: 'composer-wrap', id: 'composer' },
    S.compose.image && h('div', { class: 'attach-prev' }, h('img', { src: S.compose.image, alt: '' }),
      h('button', { 'aria-label': 'Убрать', onmousedown: keep, onclick: () => { S.compose.image = null; renderComposer(); } }, svg('close'))),
    h('div', { class: 'composer' },
      canAttach(m) && h('button', { class: 'c-btn', 'aria-label': 'Прикрепить изображение', onclick: () => file.click() }, svg('image')),
      file, ta,
      h('div', { class: 'c-act', onmousedown: keep }, SendBtn())));
}

function SendBtn() {
  if (S.genId) return h('button', { class: 'c-send stop', 'aria-label': 'Остановить', onclick: stopGen }, svg('stop'));
  return h('button', { class: 'c-send', id: 'csend', 'aria-label': 'Отправить', disabled: !(S.compose.text.trim() || S.compose.image) || !curModel(), onclick: sendMessage }, svg('up'));
}
const syncSend = () => { const a = $('.c-act'); if (a) a.replaceChildren(SendBtn()); };
function renderComposer() {
  const old = $('#composer');
  if (!old) return;
  const nu = Composer(curModel());
  old.replaceWith(nu);
  autosize($('#cinput'));
}
function autosize(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
}
function setCompose(text) {
  S.compose.text = text;
  const ta = $('#cinput');
  if (ta) { ta.value = text; autosize(ta); ta.focus(); }
  syncSend();
}

// Уменьшаем фото перед отправкой — до 1600 px по длинной стороне
async function prepImage(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = h('canvas', { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', .88);
}

async function sendMessage() {
  const m = curModel();
  if (!m) return;
  const text = S.compose.text.trim(), image = S.compose.image;
  if ((!text && !image) || S.genId || S.sending) return;
  if (m.kind !== 'chat' && !text) return fail(new Error('Опиши, что нужно сгенерировать'));
  S.sending = true;
  clearComposer();
  let started = null;
  try {
    await apiStream('chat/send', { chat_id: S.chat.id, model_id: m.id, text, image }, ev => {
      if (ev.type === 'start') started = ev.assistant.id;
      onChatEvent(ev);
    });
  } catch (e) {
    if (started) {
      // связь оборвалась посреди ответа — генерация идёт на сервере, подключаемся заново
      apiStream(`chat/stream/${started}`, undefined, onChatEvent).catch(() => {});
    } else {
      S.compose = { text, image };
      renderComposer();
      if (e.code === 'balance') { fail(e); openTopup(); } else fail(e);
    }
  } finally {
    S.sending = false;
  }
}

// Очищаем поле, не пересоздавая его, — чтобы на телефоне не пряталась клавиатура
function clearComposer() {
  const hadImage = !!S.compose.image;
  S.compose = { text: '', image: null };
  const ta = $('#cinput');
  if (!ta || hadImage) return renderComposer();
  ta.value = '';
  autosize(ta);
  syncSend();
}

function onChatEvent(ev) {
  if (ev.me) S.me = ev.me;
  if (ev.type === 'start') {
    const fresh = !S.chat.messages.length;
    Object.assign(S.chat, { id: ev.chat.id, title: ev.chat.title });
    S.chat.messages.push(ev.user, ev.assistant);
    S.genId = ev.assistant.id;
    S.chats = null;
    hap.tap();
    const box = msgsBox();
    if (box) {
      if (fresh) { cleanup(box); box.replaceChildren(Msg(ev.user), Msg(ev.assistant)); } else box.append(Msg(ev.user), Msg(ev.assistant));
      scrollBottom(true);
    }
    syncSend();
    return;
  }
  const id = ev.message?.id ?? ev.id ?? S.genId;
  const msg = S.chat.messages.find(x => x.id === id);
  if (ev.type === 'delta' && msg) { msg.content += ev.t; touchMsg(msg); }
  if (ev.type === 'sync' && msg) { msg.content = ev.text; msg.progress = ev.progress; touchMsg(msg); }
  if (ev.type === 'progress' && msg) { msg.progress = ev.p; touchMsg(msg); }
  if (ev.type === 'done') {
    if (msg) { Object.assign(msg, ev.message); touchMsg(msg); }
    if (S.genId === ev.message.id) S.genId = null;
    if (ev.message.status === 'ok') hap.ok(); else if (ev.message.status === 'error') hap.err();
    syncSend();
  }
}

async function stopGen() {
  if (!S.genId) return;
  hap.tap();
  try { await api('chat/stop', { id: S.genId }); } catch (e) { fail(e); }
}

function newChat() {
  if (S.chat.id === null && !S.chat.messages.length) return;
  S.chat = { id: null, title: '', messages: [] };
  S.genId = null;
  hap.sel();
  render();
}

async function openChat(id) {
  try {
    const r = await api(`chats/${id}`);
    S.chat = { id: r.chat.id, title: r.chat.title, messages: r.messages };
    S.genId = null;
    if (S.models.some(m => m.id === r.chat.model_id) && S.me.model_id !== r.chat.model_id) {
      S.me.model_id = r.chat.model_id;
      api('select', { id: r.chat.model_id }).catch(() => {});
    }
    S.tab = 'chat';
    render();
    // генерация ещё идёт — подключаемся к потоку
    for (const msg of r.messages.filter(x => x.status === 'pending')) {
      S.genId = msg.id;
      syncSend();
      apiStream(`chat/stream/${msg.id}`, undefined, onChatEvent).catch(() => {});
    }
  } catch (e) { fail(e); }
}

async function openChats() {
  const list = h('div', null, Skel(64, 0), Skel(64, 8), Skel(64, 8));
  const s = sheet(h('div', null,
    h('button', { class: 'btn primary', onclick: () => { s.close(); newChat(); } }, svg('compose'), 'Новый чат'),
    h('div', { style: 'height:12px' }), list), { title: 'Чаты' });
  try {
    const r = await api('chats');
    cleanup(list);
    list.replaceChildren(...(r.chats.length ? r.chats.map(c => {
      const row = h('div', { class: `list-row${c.id === S.chat.id ? ' cur' : ''}` },
        h('button', { class: 'lr-main', onclick: () => { s.close(); openChat(c.id); } },
          Emo(c.emoji_id, { size: 30, alt: c.emoji || KIND_ALT[c.kind] || '💬', mode: 'static' }),
          h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, c.title || 'Без названия'), h('div', { class: 'mono' }, timeAgo(c.updated_at)))),
        h('button', { class: 'icon-btn soft', 'aria-label': 'Удалить', onclick: async () => {
          if (!(await confirmBox('Удалить этот чат?'))) return;
          try {
            await api(`chats/${c.id}`, undefined, 'DELETE');
            row.remove();
            if (S.chat.id === c.id) { S.chat = { id: null, title: '', messages: [] }; S.genId = null; render(); }
          } catch (e) { fail(e); }
        } }, svg('trash')));
      return row;
    }) : [Empty('Чатов пока нет', 'Начни новый — он появится здесь')]));
  } catch (e) { list.replaceChildren(h('div', { class: 'out err' }, e.message)); }
}

function ModelCard(m, i, onclick) {
  const sel = S.me?.model_id === m.id;
  return h('button', { class: `card${sel ? ' sel' : ''}`, style: `animation-delay:${Math.min(i, 10) * 30}ms`, onclick },
    h('div', { class: 'card-icon' }, Emo(m.emoji_id, { size: 44, alt: m.emoji })),
    m.badge && h('span', { class: 'badge' }, m.badge),
    h('div', { class: 'card-name' }, m.name),
    h('div', { class: 'card-foot' },
      h('div', { class: 'price' }, m.price > 0 ? rub(m.price) : 'Free'),
      h('div', { class: 'tag' }, sel ? '✓ выбрана' : m.tag || KINDS.find(k => k[0] === m.kind)?.[1])),
    h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(4, Math.min(100, m.power))}%` })));
}

function openModels() {
  if (!S.models.length) return;
  const kinds = KINDS.filter(([k]) => S.models.some(m => m.kind === k));
  let filter = kinds.length > 1 ? curModel()?.kind || 'chat' : 'all';
  const chips = h('div', { class: 'chips', style: 'padding:0 0 12px' }), grid = h('div', { class: 'grid', style: 'margin:0' });
  const draw = () => {
    cleanup(chips);
    chips.replaceChildren(...(kinds.length > 1 ? kinds : []).map(([k, l]) => h('button', { class: `chip${filter === k ? ' on' : ''}`, onclick: () => { filter = k; hap.sel(); draw(); } },
      slotEmo(`kind_${k}`, 16, KIND_ALT[k], 'static'), l)));
    cleanup(grid);
    grid.replaceChildren(...S.models.filter(m => filter === 'all' || m.kind === filter).map((m, i) => ModelCard(m, i, () => pick(m))));
  };
  const pick = async m => {
    s.close();
    if (m.id === S.me.model_id) return;
    try {
      S.me = (await api('select', { id: m.id })).me;
      hap.ok();
      render();
    } catch (e) { fail(e); }
  };
  const s = sheet(h('div', null, chips, grid), { title: 'Модели' });
  draw();
}

/* ───────────── Пополнение, перевод, рефералка ───────────── */

async function refreshMe() {
  try { S.me = (await api('me')).me; if (S.profile) S.profile.me = S.me; render(); } catch {}
}

function openTopup() {
  const st = S.settings;
  sheet(h('div', null,
    h('div', { class: 'sheet-hero' }, slotEmo('topup', 64, '💰'),
      h('h3', null, `Баланс: ${fmt(S.me.balance)} ₽`),
      h('p', { class: 'sheet-sub' }, st.topup_info)),
    h('div', { class: 'link-box', onclick: () => copy(String(S.me.id)) }, h('span', null, `Твой ID: ${S.me.id}`), svg('copy')),
    h('div', { class: 'soon' }, h('span', null, 'СБП'), h('span', null, 'Карты'), h('span', null, 'Скоро')),
    st.support && h('button', { class: 'btn primary', style: 'margin-top:12px', onclick: () => openLink(`https://t.me/${st.support}`) }, svg('send'), 'Написать в поддержку')),
    { title: 'Пополнение', onClose: refreshMe });
}

function openTransfer() {
  let to, amt;
  const s = sheet(h('div', null,
    h('div', { class: 'sheet-hero' }, slotEmo('transfer', 56, '📤'), h('p', { class: 'sheet-sub' }, `Доступно ${fmt(S.me.balance)} ₽ · мгновенно и без комиссии`)),
    Field('ID получателя', to = h('input', { class: 'input', inputmode: 'numeric', placeholder: '123456789' }), 'Получатель найдёт свой ID в профиле'),
    Field('Сумма, ₽', amt = h('input', { class: 'input', type: 'number', inputmode: 'decimal', placeholder: `от ${S.settings.min_transfer} ₽` })),
    h('button', { class: 'btn primary', onclick: async e => {
      const btn = e.currentTarget, id = Number(to.value.trim()), sum = Number(amt.value.replace(',', '.'));
      if (!id || !(sum > 0)) return fail(new Error('Укажи ID и сумму'));
      if (!(await confirmBox(`Перевести ${fmt(sum)} ₽ пользователю ${id}?`))) return;
      btn.disabled = true;
      try {
        S.me = (await api('transfer', { to: id, amount: sum })).me;
        hap.ok();
        toast('Перевод выполнен');
        s.close();
        loadProfile();
      } catch (er) { fail(er); } finally { btn.disabled = false; }
    } }, 'Перевести')), { title: 'Перевод баланса' });
}

function shareLink(link) {
  const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`Нейросети прямо в Telegram — ${S.settings.brand}`)}`;
  if (inTG) tg.openTelegramLink(url);
  else if (navigator.share) navigator.share({ url: link }).catch(() => {});
  else copy(link);
}

function openRef() {
  const r = S.profile?.ref || { link: S.ref_link, percent: S.settings.ref_percent, count: 0, earned: 0 };
  sheet(h('div', null,
    h('div', { class: 'sheet-hero' }, slotEmo('ref', 64, '👥'), h('h3', null, `${fmt(r.percent)}% с пополнений друзей`),
      h('p', { class: 'sheet-sub' }, 'Делись ссылкой — бонус падает на баланс автоматически, с каждого пополнения и навсегда.')),
    h('div', { class: 'link-box', onclick: () => copy(r.link) }, h('span', null, r.link.replace('https://', '')), svg('copy')),
    h('div', { class: 'row2' }, Tile('Друзей', r.count), Tile('Заработано', rub(r.earned))),
    h('button', { class: 'btn primary', style: 'margin-top:12px', onclick: () => shareLink(r.link) }, svg('send'), 'Поделиться')), { title: 'Рефералка' });
}

/* ───────────── История ───────────── */

async function loadHistory(reset) {
  const H = S.hist;
  if (reset) Object.assign(H, { items: null, total: null, more: false });
  try {
    const before = !reset && H.items?.length ? `&before=${H.items.at(-1).id}` : '';
    const r = await api(`history?type=${H.type}${before}`);
    if (r.type !== H.type) return;
    H.items = reset || !H.items ? r.items : [...H.items, ...r.items];
    H.total = r.total;
    H.more = r.more;
    if (S.tab === 'history' && S.view === 'app') render();
  } catch (e) { fail(e); }
}

const PAY_KIND = {
  topup: ['topup', '💰', () => 'Пополнение'],
  bonus: ['gift', '🎁', p => p.note || 'Бонус'],
  admin: ['wallet', '👛', p => p.note || (p.amount > 0 ? 'Начисление' : 'Списание')],
  referral: ['ref', '👥', () => 'Реферальный бонус'],
  transfer_in: ['transfer', '📥', p => `Перевод от ${p.note}`],
  transfer_out: ['transfer', '📤', p => `Перевод → ${p.note}`],
  stars: ['topup', '⭐', p => `Пополнение · ${p.stars} ⭐`],
};

function viewHistory() {
  const H = S.hist, isReq = H.type === 'requests';
  const head = h('div', { class: 'head' },
    h('div', null,
      h('h1', null, 'История'),
      h('div', { class: 'sub' }, !H.total ? '…' : isReq
        ? [h('b', null, `${fmt(H.total.sum)} ₽`), ` за ${H.total.n} ${plural(H.total.n, ['запрос', 'запроса', 'запросов'])}`]
        : [h('b', null, `${fmt(H.total.sum)} ₽`), ' пополнено'])),
    h('div', { class: 'head-emo' }, slotEmo('history_head', 64, '🗂', 'once')));
  const seg = h('div', { class: 'seg' }, [['requests', 'Запросы'], ['payments', 'Баланс']].map(([k, l]) =>
    h('button', { class: H.type === k ? 'on' : '', onclick: () => { if (H.type === k) return; H.type = k; hap.sel(); H.items = null; H.total = null; render(); loadHistory(true); } }, l)));
  if (!H.items) return [head, seg, Skel(18, 22), Skel(72, 10), Skel(72, 8), Skel(72, 8)];
  if (!H.items.length) return [head, seg, isReq ? Empty('Запросов пока нет', 'Открой чат и задай вопрос любой модели') : Empty('Операций пока нет', 'Здесь появятся пополнения и переводы')];

  const groups = [];
  for (const it of H.items) {
    const d = new Date(it.created_at), key = d.getFullYear() * 12 + d.getMonth();
    let g = groups.at(-1);
    if (!g || g.key !== key) groups.push(g = { key, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, items: [], sum: 0 });
    g.items.push(it);
    g.sum += isReq ? it.price : it.amount;
  }
  return [head, seg, groups.map(g => [
    h('div', { class: 'group-h' }, h('span', null, g.label), h('span', null, `${g.items.length} шт · ${fmt(g.sum)} ₽`)),
    g.items.map(it => (isReq ? ReqItem(it) : PayItem(it))),
  ]), H.more && h('button', { class: 'more', onclick: () => loadHistory(false) }, 'Показать ещё')];
}

const ReqItem = r => h('div', { class: 'item' },
  h('div', { class: 'item-icon' }, Emo(r.emoji_id, { size: 40, alt: r.emoji || KIND_ALT[r.kind] || '🤖' })),
  h('div', { class: 'item-main' },
    h('div', { class: 'item-title' }, r.name),
    h('div', { class: 'item-meta' }, h('span', { class: 'pill' }, dShort(r.created_at)), KINDS.find(k => k[0] === r.kind)?.[1] || '', r.status === 'stopped' && '· стоп')),
  h('div', { class: 'item-amount' }, r.price > 0 ? rub(r.price) : 'free'));

function PayItem(p) {
  const [slot, alt, title] = PAY_KIND[p.method] || ['wallet', '👛', () => p.method];
  return h('div', { class: 'item' },
    h('div', { class: 'item-icon' }, slotEmo(slot, 34, alt)),
    h('div', { class: 'item-main' },
      h('div', { class: 'item-title' }, title(p)),
      h('div', { class: 'item-meta' }, h('span', { class: 'pill' }, dShort(p.created_at)), `№${p.id}`)),
    h('div', { class: `item-amount${p.amount > 0 ? ' pos' : ''}` }, p.amount > 0 ? '+' : '', rub(p.amount)));
}

/* ───────────── Инфо ───────────── */

function viewInfo() {
  const st = S.settings;
  const step = (n, t, d) => h('div', { class: 'step' }, h('span', { class: 'step-n' }, n), h('div', null, h('b', null, t), h('span', null, d)));
  return [
    h('div', { class: 'head' },
      h('div', null, h('h1', null, 'Инфо'), h('div', { class: 'sub' }, `${st.brand} — ${st.tagline}`)),
      h('div', { class: 'head-emo' }, slotEmo('info_head', 64, 'ℹ️', 'once'))),
    st.info && h('div', { class: 'info-card' }, h('p', null, st.info)),
    h('div', { class: 'info-card' }, h('h3', null, 'Как это работает'),
      step(1, 'Выбери модель', 'Сверху в чате: текстовые модели, генерация изображений и видео.'),
      step(2, 'Напиши запрос', 'Можно прикрепить фото — модель разберёт его или использует как основу.'),
      step(3, 'Плати только за запросы', 'Цена указана у каждой модели. Если генерация не удалась — деньги вернутся.')),
    S.models.length > 0 && h('div', { class: 'info-card' }, h('h3', null, 'Цены'),
      S.models.map(m => h('div', { class: 'price-row' }, Emo(m.emoji_id, { size: 24, alt: m.emoji, mode: 'static' }),
        h('span', { class: 'pr-name' }, m.name, h('small', null, KINDS.find(k => k[0] === m.kind)?.[1])),
        h('b', null, m.price > 0 ? `${fmt(m.price)} ₽` : 'бесплатно')))),
    st.free_daily > 0 && S.models.some(m => !(m.price > 0)) && h('div', { class: 'info-card' }, h('h3', null, 'Бесплатно'),
      h('p', null, `${st.free_daily} ${plural(st.free_daily, ['запрос', 'запроса', 'запросов'])} в день к бесплатным моделям. Сегодня осталось: ${S.me.free_left ?? '∞'}.`)),
    h('div', { class: 'row2' },
      h('button', { class: 'act', onclick: openRef }, slotEmo('ref', 24, '👥'), 'Рефералка'),
      st.support ? h('button', { class: 'act', onclick: () => openLink(`https://t.me/${st.support}`) }, slotEmo('topup', 24, '💬'), 'Поддержка')
        : h('button', { class: 'act', onclick: openTopup }, slotEmo('topup', 24, '💰'), 'Пополнить')),
    !S.admin && h('button', { class: 'link-btn', onclick: openAdminLogin }, 'Вход для администратора'),
  ];
}

function openAdminLogin() {
  let pass;
  const s = sheet(h('form', { onsubmit: async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api('admin/claim', { password: pass.value });
      S.admin = true;
      hap.ok();
      toast('Готово — ты администратор');
      s.close();
      openAdmin();
    } catch (er) { fail(er); btn.disabled = false; }
  } },
    Field('Пароль администратора', pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'ADMIN_PASSWORD' })),
    h('button', { class: 'btn primary', type: 'submit' }, 'Войти')), { title: 'Админ-панель' });
}

/* ───────────── Профиль ───────────── */

async function loadProfile(force) {
  try {
    const p = await api(`profile${force ? '?force=1' : ''}`);
    S.profile = p;
    S.me = p.me;
    if (S.tab === 'profile' && S.view === 'app') render();
  } catch (e) { fail(e); }
}

function viewProfile() {
  const P = S.profile, me = S.me, t = P?.tg;
  const [c1, c2] = profileColors(t);
  const head = h('section', { class: 'pf', style: `--c1:${c1};--c2:${c2}` },
    h('div', { class: 'pf-bg' }),
    t?.bg && Pattern(t.bg),
    Avatar(me, 100),
    h('div', { class: 'pf-name' },
      h('span', null, userName(me)),
      t?.status ? Emo(t.status, { size: 24 }) : me.is_premium && svg('premium', 22)),
    me.username && h('div', { class: 'pf-user' }, '@' + me.username),
    h('button', { class: 'pf-bal', onclick: openTopup }, 'Баланс:', h('b', null, `${fmt(me.balance)} ₽`), svg('chevron')));
  const actions = h('div', { class: 'row2' },
    h('button', { class: 'act', onclick: openTopup }, slotEmo('topup', 28, '💸'), 'Пополнить'),
    h('button', { class: 'act', onclick: openTransfer }, slotEmo('transfer', 28, '📤'), 'Передать'));
  if (!P) return [head, actions, h('div', { class: 'tiles' }, Skel(96, 0), Skel(96, 0), Skel(96, 0), Skel(96, 0)), Skel(76)];

  const st = P.stats;
  return [
    head, actions,
    h('div', { class: 'tiles' },
      Tile('Запросов', st.requests, `${st.requests30} за 30 дней`),
      Tile('Потрачено', `${fmt(st.spent)} ₽`, `≈ ${fmt(st.avg)} ₽ за запрос`),
      Tile('С нами', `${st.days} ${plural(st.days, ['день', 'дня', 'дней'])}`, `с ${dFull(st.since)}`),
      Tile('ID', me.id, 'нужен для поддержки', () => copy(String(me.id)), 'copy')),
    st.last && h('div', { class: 'wide' },
      h('div', { class: 'item-icon' }, Emo(st.last.emoji_id, { size: 40, alt: st.last.emoji || KIND_ALT[st.last.kind] || '🤖' })),
      h('div', { class: 'item-main' },
        h('div', { class: 'item-title' }, st.last.model_name),
        h('div', { class: 'item-meta' }, h('span', { class: 'pill' }, dShort(st.last.created_at)), 'Последний запрос')),
      h('div', { class: 'item-amount' }, st.last.price > 0 ? rub(st.last.price) : 'free')),
    h('button', { class: 'wide', onclick: openRef },
      h('div', { class: 'item-icon' }, slotEmo('ref', 36, '👥')),
      h('div', { class: 'item-main' },
        h('div', { class: 'item-title' }, `Рефка · ${fmt(P.ref.percent)}%`),
        h('div', { class: 'item-sub' }, `${P.ref.count} ${plural(P.ref.count, ['друг', 'друга', 'друзей'])} · доход ${fmt(P.ref.earned)} ₽`)),
      h('span', { class: 'arrow-btn' }, svg('arrow'))),
    S.admin && h('button', { class: 'wide', onclick: openAdmin },
      h('div', { class: 'item-icon' }, slotEmo('admin', 34, '⚙️')),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, 'Админ-панель'), h('div', { class: 'item-sub' }, 'Модели, баланс, эмодзи, настройки')),
      h('span', { class: 'arrow-btn' }, svg('arrow'))),
  ];
}

/* ───────────── Админ-панель ───────────── */

const ADMIN_TABS = [['stats', 'Обзор'], ['models', 'Модели'], ['users', 'Люди'], ['emoji', 'Эмодзи'], ['settings', 'Настройки'], ['broadcast', 'Рассылка']];
const API_OPTS = {
  chat: [['anthropic', 'Anthropic · /v1/messages'], ['openai', 'OpenAI · /v1/chat/completions']],
  image: [['openai', 'OpenAI Images · /v1/images'], ['chat', 'Картинка в ответе чата · /v1/chat/completions']],
  video: [['openai', 'OpenAI Videos · /v1/videos']],
};
let bcTimer;

function openAdmin() {
  S.view = 'admin';
  hap.tap();
  renderAdmin();
  window.scrollTo(0, 0);
}

function closeAdmin() {
  if (!S.me) return;
  S.view = 'app';
  render();
}

async function refreshBoot() {
  try { Object.assign(S, await api('bootstrap')); } catch {}
}

async function renderAdmin() {
  clearInterval(bcTimer);
  document.body.classList.remove('on-chat');
  const body = h('div', { class: 'adm-body' }, Skel(110, 0), Skel(160), Skel(220));
  mount(h('main', { class: 'page adm' },
    h('header', { class: 'adm-top' },
      h('div', { class: 'adm-title' },
        S.me && h('button', { class: 'icon-btn', onclick: closeAdmin, 'aria-label': 'Назад' }, svg('back')),
        'Админ-панель',
        !S.me && h('button', { class: 'btn sm', style: 'margin-left:auto', onclick: logout }, 'Выйти')),
      h('div', { class: 'chips', style: 'padding:0' }, ADMIN_TABS.map(([k, l]) =>
        h('button', { class: `chip${S.adminTab === k ? ' on' : ''}`, onclick: () => { if (S.adminTab === k) return; S.adminTab = k; hap.sel(); renderAdmin(); } }, l)))),
    body));
  syncBack();
  const tab = S.adminTab;
  try {
    const nodes = await ADMIN[tab]();
    if (S.adminTab !== tab || !body.isConnected) return;
    cleanup(body);
    body.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
  } catch (e) {
    if (body.isConnected) body.replaceChildren(h('div', { class: 'out err' }, e.message));
  }
}

async function logout() {
  await api('admin/logout', {}).catch(() => {});
  store.set('admin_token', null);
  auth = '';
  renderLogin();
}

function Chart(data) {
  const max = Math.max(1, ...data.map(d => d.n));
  return h('div', { class: 'chart' }, data.map(d => h('div', { class: `col${d.n ? '' : ' zero'}`, title: `${d.label}: ${d.n} запр. · ${fmt(d.spent)} ₽ · пополнено ${fmt(d.rev)} ₽` },
    d.n > 0 && h('span', { class: 'n' }, d.n),
    h('div', { class: 'b', style: `height:${Math.max(3, (d.n / max) * 92)}px` }),
    h('span', { class: 'lbl' }, d.label.slice(0, 2)))));
}

const STATUS = { ok: 'ок', error: 'ошибка', stopped: 'стоп', pending: '…' };

// Поле картинки: URL + загрузка файла + превью
function ImageField(label, value, hint) {
  const input = h('input', { class: 'input', value: value || '', placeholder: 'URL или загрузи файл' });
  const prev = h('div', { class: 'img-prev' });
  const show = () => prev.replaceChildren(...(input.value ? [h('img', { src: input.value, alt: '' })] : []));
  input.oninput = show;
  const file = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  file.onchange = () => {
    const fl = file.files[0];
    file.value = '';
    if (!fl) return;
    const rd = new FileReader();
    rd.onload = async () => {
      try { input.value = (await api('admin/upload', { data: rd.result })).url; show(); toast('Загружено — не забудь сохранить'); } catch (e) { fail(e); }
    };
    rd.readAsDataURL(fl);
  };
  show();
  return { input, node: Field(label, h('div', null, h('div', { style: 'display:flex;gap:8px' }, input, file,
    h('button', { class: 'btn sm', style: 'height:auto', type: 'button', onclick: () => file.click() }, svg('upload'))), prev), hint) };
}

const ADMIN = {
  async stats() {
    const d = await api('admin/stats');
    return [
      !d.app.https && h('div', { class: 'notice' }, 'PUBLIC_URL с https не задан — кнопка «Открыть» в боте не появится. Укажи домен и перезапусти.'),
      !d.provider.key && h('div', { class: 'notice' }, 'AI_API_KEY не задан — модели не будут отвечать.'),
      h('div', { class: 'tiles' },
        Tile('Пользователи', d.users.total, `+${d.users.new24} новых · ${d.users.active24} активных`),
        Tile('Запросы за 24 ч', d.requests.day, `всего ${d.requests.total}${d.errors24 ? ` · ошибок ${d.errors24}` : ''}`),
        Tile('Пополнения', `${fmt(d.revenue.total)} ₽`, `${d.revenue.count} шт · 24 ч: ${fmt(d.revenue.day)} ₽`),
        Tile('Списано', `${fmt(d.requests.spent)} ₽`, `на балансах ${fmt(d.users.balances)} ₽`)),
      Section('Запросы за 14 дней', Chart(d.chart)),
      d.top.length > 0 && Section('Топ моделей · 30 дней', d.top.map(t => h('div', { class: 'kv' }, h('span', null, t.name), h('b', null, `${t.n} · ${fmt(t.sum)} ₽`)))),
      Section('Последние запросы', d.recent.length ? d.recent.map(r => h('div', { class: 'feed' },
        h('div', { class: 'feed-main' }, h('b', null, r.model_name), h('div', { class: 'mono' }, `${r.first_name || ''} ${r.username ? '@' + r.username : r.user_id}`), r.error && h('div', { class: 'err-text' }, r.error)),
        h('div', { class: 'feed-side' }, h('span', { class: `st st-${r.status}` }, STATUS[r.status] || r.status), h('span', { class: 'mono' }, `${timeAgo(r.created_at)}${r.price ? ` · ${fmt(r.price)} ₽` : ''}`)))) : h('p', { class: 'muted small' }, 'Пока пусто')),
      h('p', { class: 'hint' }, `Провайдер: ${d.provider.base}`),
    ];
  },

  async models() {
    const d = await api('admin/models');
    const byKind = KINDS.map(([k, l]) => [l, d.models.filter(m => m.kind === k)]).filter(([, list]) => list.length);
    return [
      h('div', { class: 'row2', style: 'margin:0 0 10px' },
        h('button', { class: 'btn primary', onclick: () => editModel(null) }, svg('plus'), 'Добавить'),
        h('button', { class: 'btn', onclick: providerModels }, 'Модели провайдера')),
      byKind.map(([label, list]) => [h('div', { class: 'sub-h', style: 'margin:14px 4px 8px' }, label), list.map(m => {
        const sw = Switch(m.active);
        sw.onchange = async () => {
          try {
            await api(`admin/models/${m.id}`, { active: sw.checked }, 'PUT');
            toast(sw.checked ? 'Модель включена' : 'Модель скрыта');
            sw.closest('.list-row').classList.toggle('off', !sw.checked);
            refreshBoot();
          } catch (e) { fail(e); sw.checked = !sw.checked; }
        };
        return h('div', { class: `list-row${m.active ? '' : ' off'}` },
          h('button', { class: 'lr-main', onclick: () => editModel(m) },
            Emo(m.emoji_id, { size: 34, alt: m.emoji }),
            h('div', { class: 'item-main' },
              h('div', { class: 'item-title' }, m.name, m.badge && h('span', { class: 'pill' }, m.badge)),
              h('div', { class: 'mono' }, `${m.model} · ${m.api} · ${m.used30} за 30 дн`))),
          h('div', { class: 'lr-side' }, h('b', null, m.price > 0 ? `${fmt(m.price)} ₽` : 'free'), sw));
      })]),
      h('p', { class: 'hint' }, 'Цена списывается за каждый запрос. Модель с ценой 0 — бесплатная с дневным лимитом из настроек.'),
    ];
  },

  async users() {
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск: ID, @username или имя', value: S.userQ });
    const list = h('div', null, Skel(64, 10), Skel(64, 8));
    const load = async () => {
      try {
        const d = await api(`admin/users?q=${encodeURIComponent(search.value)}`);
        cleanup(list);
        list.replaceChildren(
          h('div', { class: 'hint', style: 'margin:10px 4px' }, `Всего пользователей: ${d.total}${search.value ? ` · найдено: ${d.users.length}` : ''}`),
          ...d.users.map(u => h('button', { class: 'list-row', onclick: () => openUser(u.id, load) },
            Avatar(u, 40),
            h('div', { class: 'item-main' },
              h('div', { class: 'item-title' }, userName(u), u.admin && h('span', { class: 'pill' }, 'админ'), u.banned ? h('span', { class: 'pill', style: 'color:#ff6961' }, 'бан') : null, u.blocked ? h('span', { class: 'pill' }, 'заблокировал') : null),
              h('div', { class: 'mono' }, `${u.id}${u.username ? ' · @' + u.username : ''} · ${timeAgo(u.seen_at)}`)),
            h('div', { class: 'lr-side' }, h('b', null, `${fmt(u.balance)} ₽`), h('span', { class: 'mono' }, `${u.requests} запр.`)))),
          !d.users.length && Empty('Никого не нашли'));
      } catch (e) { fail(e); }
    };
    search.oninput = debounce(() => { S.userQ = search.value; load(); }, 300);
    load();
    return [h('button', { class: 'btn primary', style: 'margin-bottom:10px', onclick: () => openGrant(null, load) }, svg('plus'), 'Выдать баланс'), search, list];
  },

  async emoji() {
    const [lib, st] = await Promise.all([api('admin/emojis'), api('admin/settings')]);
    S.lib = lib;
    let src;
    const importBtn = h('button', { class: 'btn primary', onclick: async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await api('admin/emojis/import', { source: src.value });
        hap.ok();
        toast(`Импортировано: ${r.imported}`);
        renderAdmin();
      } catch (er) { fail(er); } finally { btn.disabled = false; }
    } }, svg('upload'), 'Импортировать');
    const groups = [['app', 'Приложение'], ['both', 'Бот и приложение'], ['bot', 'Бот']];
    return [
      Section('Импорт премиум-эмодзи',
        src = h('input', { class: 'input', placeholder: 't.me/addemoji/… или ID эмодзи' }),
        h('div', { style: 'height:10px' }), importBtn,
        h('p', { class: 'hint' }, 'Ссылка на пак эмодзи, его имя или ID через пробел. Ещё проще — пришли боту сообщение с премиум-эмодзи: от админа они сразу попадают в библиотеку. Анимированные (TGS и WEBM) работают.')),
      Section('Иконки разделов', groups.map(([g, title]) => {
        const list = st.slots.filter(s => s.group === g);
        return list.length && [
          h('div', { class: 'sub-h' }, title),
          list.map(s => h('div', { class: 'slot-row' },
            h('span', { class: 'slot-emo' }, s.value ? Emo(s.value, { size: 28, alt: s.alt }) : h('span', { style: 'font-size:18px' }, s.alt)),
            h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, s.label), h('div', { class: 'mono' }, s.value ? (s.custom ? 'своё' : 'по умолчанию') : 'стандартная иконка')),
            h('button', { class: 'btn sm', onclick: () => pickEmoji(id => saveSlot(s.key, id), { none: true }) }, 'Заменить'),
            s.custom && h('button', { class: 'btn sm', onclick: () => saveSlot(s.key, null) }, 'Сброс'))),
        ];
      })),
      Section(`Библиотека · ${lib.items.length}`, lib.items.length ? Library(lib, id => openLibEmoji(id, lib)) : h('p', { class: 'muted small' }, 'Пока пусто — импортируй пак выше.')),
    ];
  },

  async settings() {
    const d = await api('admin/settings');
    const f = {};
    const nodes = [];
    let group = '';
    for (const m of d.meta) {
      if (m.group !== group) {
        group = m.group;
        nodes.push(h('div', { class: 'sub-h', style: nodes.length ? 'margin-top:22px' : '' }, group));
      }
      const v = d.values[m.key] ?? '';
      let el;
      if (m.type === 'image') {
        const fld = ImageField(m.label, v, m.hint);
        f[m.key] = fld.input;
        nodes.push(fld.node);
        continue;
      }
      if (m.type === 'textarea') el = h('textarea', { class: 'input', rows: 4 }, v);
      else if (m.type === 'bool') el = Switch(v !== '0');
      else if (m.type === 'model') el = h('select', { class: 'input' }, h('option', { value: '' }, 'Авто — самая дешёвая'), d.models.map(x => h('option', { value: x.id, selected: String(x.id) === String(v) }, x.name)));
      else el = h('input', { class: 'input', type: m.type === 'number' ? 'number' : 'text', step: 'any', value: v });
      f[m.key] = el;
      nodes.push(m.type === 'bool' ? ToggleRow(m.label, el, m.hint) : Field(m.label, el, m.hint));
    }
    const save = h('button', { class: 'btn primary', onclick: async e => {
      const btn = e.currentTarget, values = {};
      for (const [k, el] of Object.entries(f)) values[k] = el.type === 'checkbox' ? el.checked : el.value;
      btn.disabled = true;
      try {
        const r = await api('admin/settings', { values });
        Object.assign(S, { settings: r.settings, slots: r.slots });
        hap.ok();
        toast('Сохранено');
      } catch (er) { fail(er); } finally { btn.disabled = false; }
    } }, svg('check'), 'Сохранить');
    return [h('div', { class: 'section' }, nodes), h('div', { class: 'sticky-save' }, save)];
  },

  async broadcast() {
    const d = await api('admin/broadcast');
    const ta = h('textarea', { class: 'input', rows: 7, placeholder: 'Текст рассылки. HTML Telegram: <b>, <i>, <a href="…">, <tg-emoji emoji-id="…">✨</tg-emoji>' });
    const photo = ImageField('Картинка', '', 'Необязательно. С картинкой текст — до 1024 символов');
    const withBtn = Switch(true);
    const prog = h('div');
    const showJob = j => {
      if (!j) return prog.replaceChildren();
      prog.replaceChildren(Section(j.running ? 'Идёт рассылка…' : 'Последняя рассылка',
        h('div', { class: 'bar', style: 'height:6px;margin:0 0 10px' }, h('i', { style: `width:${j.total ? Math.round(((j.sent + j.failed) / j.total) * 100) : 100}%;background:#fff` })),
        h('div', { class: 'kv' }, h('span', null, 'Доставлено'), h('b', null, `${j.sent} из ${j.total}`)),
        h('div', { class: 'kv' }, h('span', null, 'Ошибок'), h('b', null, j.failed))));
    };
    const poll = () => {
      clearInterval(bcTimer);
      bcTimer = setInterval(async () => {
        if (S.adminTab !== 'broadcast' || S.view !== 'admin') return clearInterval(bcTimer);
        const r = await api('admin/broadcast').catch(() => null);
        showJob(r?.job);
        if (!r?.job?.running) clearInterval(bcTimer);
      }, 1500);
    };
    const run = test => async e => {
      const btn = e.currentTarget;
      if (!ta.value.trim() && !photo.input.value) return fail(new Error('Напиши текст или добавь картинку'));
      if (!test && !(await confirmBox(`Отправить рассылку ${d.users} пользователям?`))) return;
      btn.disabled = true;
      try {
        const r = await api('admin/broadcast', { text: ta.value, photo: photo.input.value, button: withBtn.checked, test });
        hap.ok();
        if (test) toast('Тест отправлен тебе в бота');
        else { toast('Рассылка запущена'); showJob(r.job); poll(); }
      } catch (er) { fail(er); } finally { btn.disabled = false; }
    };
    showJob(d.job);
    if (d.job?.running) poll();
    return [
      Section(`Новая рассылка · ${d.users} получателей`,
        Field(null, ta),
        photo.node,
        ToggleRow('Кнопка «Открыть приложение»', withBtn, 'Работает, если задан PUBLIC_URL'),
        h('div', { class: 'row2', style: 'margin:0' },
          h('button', { class: 'btn', onclick: run(true) }, 'Тест себе'),
          h('button', { class: 'btn primary', onclick: run(false) }, svg('send'), 'Отправить'))),
      prog,
    ];
  },
};

async function saveSlot(key, val) {
  try {
    const r = await api('admin/settings', { slots: { [key]: val } });
    S.slots = r.slots;
    hap.ok();
    toast(val === null ? 'Иконка сброшена' : 'Иконка обновлена');
    renderAdmin();
  } catch (e) { fail(e); }
}

function Library(lib, onPick, filter = '') {
  const titles = Object.fromEntries(lib.sets.map(s => [s.name, s.title]));
  const groups = new Map();
  for (const it of lib.items) {
    if (filter && !(it.alt || '').includes(filter)) continue;
    const k = titles[it.set] ? it.set : '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  if (!groups.size) return h('p', { class: 'muted small' }, 'Ничего не найдено');
  return [...groups].map(([set, items], i) => h('details', { class: 'set', open: i === 0 || !!filter },
    h('summary', null, titles[set] || 'Разные', h('span', { class: 'mono' }, items.length)),
    h('div', { class: 'emo-grid' }, items.map(it => h('button', { class: 'emo-cell', title: it.alt, onclick: () => onPick(it.id) }, Emo(it.id, { size: 32, alt: it.alt, mode: 'static' }))))));
}

async function pickEmoji(cb, { none } = {}) {
  let lib = S.lib;
  if (!lib) {
    try { lib = S.lib = await api('admin/emojis'); } catch (e) { return fail(e); }
  }
  const out = h('div');
  const search = h('input', { class: 'input', placeholder: 'Поиск по эмодзи: 🤖, ⭐, 💬…' });
  const draw = () => { cleanup(out); out.replaceChildren(...[Library(lib, id => { s.close(); cb(id); }, search.value.trim())].flat()); };
  search.oninput = debounce(draw, 200);
  const s = sheet(h('div', null,
    h('div', { class: 'picker-search' }, search),
    none && h('button', { class: 'btn', style: 'margin-bottom:10px', onclick: () => { s.close(); cb(''); } }, 'Без эмодзи — стандартная иконка'),
    lib.items.length ? out : h('p', { class: 'sheet-sub' }, 'Библиотека пуста — импортируй пак во вкладке «Эмодзи».')), { title: 'Выбор эмодзи' });
  draw();
}

function openLibEmoji(id, lib) {
  const it = lib.items.find(x => x.id === id);
  const s = sheet(h('div', null,
    h('div', { class: 'sheet-hero' }, Emo(id, { size: 96, alt: it?.alt })),
    h('div', { class: 'box' },
      h('div', { class: 'kv' }, h('span', null, 'ID'), h('b', { class: 'mono', style: 'color:#fff;cursor:pointer', onclick: () => copy(id) }, id)),
      h('div', { class: 'kv' }, h('span', null, 'Эмодзи'), h('b', null, it?.alt || '—')),
      h('div', { class: 'kv' }, h('span', null, 'Формат'), h('b', null, { tgs: 'анимированный (TGS)', webm: 'видео (WEBM)', webp: 'статичный (WEBP)' }[S.emoji[id]?.[0]] || '—'))),
    h('div', { class: 'row2' },
      h('button', { class: 'btn', onclick: () => copy(`<tg-emoji emoji-id="${id}">${it?.alt || '✨'}</tg-emoji>`) }, svg('copy'), 'HTML для бота'),
      h('button', { class: 'btn danger', onclick: async () => {
        try { await api(`admin/emojis/${id}`, undefined, 'DELETE'); toast('Удалено из библиотеки'); s.close(); renderAdmin(); } catch (e) { fail(e); }
      } }, svg('trash'), 'Удалить'))), { title: 'Эмодзи' });
}

async function providerModels() {
  const s = sheet(h('div', null, Skel(56, 0), Skel(56, 8), Skel(56, 8)), { title: 'Модели провайдера' });
  try {
    const r = await api('admin/provider-models');
    s.set(h('div', null,
      h('p', { class: 'sheet-sub', style: 'margin:0 0 12px' }, `Найдено: ${r.models.length}. Нажми, чтобы добавить.`),
      r.models.map(x => {
        const kind = /video|sora|veo|kling/i.test(x.id) ? 'video' : /image|dall|imagen/i.test(x.id) ? 'image' : 'chat';
        const api = kind === 'chat' && !/^claude/i.test(x.id) ? 'openai' : kind === 'chat' ? 'anthropic' : 'openai';
        return h('button', { class: 'list-row', onclick: () => { s.close(); editModel(null, { name: x.name, model: x.id, kind, api, vision: kind === 'chat' ? 1 : 0 }); } },
          h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, x.name), h('div', { class: 'mono' }, `${x.id} · ${KINDS.find(k => k[0] === kind)[1]}`)), svg('plus', 18));
      })));
  } catch (e) {
    s.set(h('div', { class: 'out err' }, e.message));
  }
}

function editModel(m, preset) {
  const isNew = !m;
  m = m || { name: '', model: '', kind: 'chat', api: 'anthropic', price: 5, power: 60, context: 12, max_tokens: 4096, vision: 1, active: 1, emoji: '🤖', emoji_id: '', description: '', badge: '', tag: '', system_prompt: '', temperature: null, base_url: '', api_key: '', extra: '', sort: '', ...preset };
  const f = {};
  const inp = (k, a = {}) => (f[k] = h('input', { class: 'input', value: m[k] ?? '', ...a }));
  const area = (k, a = {}) => (f[k] = h('textarea', { class: 'input', ...a }, m[k] ?? ''));
  const sel = (k, opts) => (f[k] = h('select', { class: 'input' }, opts.map(([v, l]) => h('option', { value: v, selected: m[k] === v }, l))));
  const tog = (k, label, hint) => ToggleRow(label, f[k] = Switch(m[k]), hint);
  let emojiId = m.emoji_id || '';
  const prev = h('span', { class: 'emo-prev' });
  const clearBtn = h('button', { class: 'btn sm', onclick: () => setEmo('') }, 'Убрать');
  const setEmo = id => {
    emojiId = id;
    cleanup(prev);
    prev.replaceChildren(Emo(id, { size: 40, alt: f.emoji?.value || m.emoji }));
    clearBtn.style.display = id ? '' : 'none';
  };
  const kindSel = sel('kind', KINDS);
  const apiSel = h('select', { class: 'input' });
  f.api = apiSel;
  const visionRow = tog('vision', 'Понимает фото', 'Можно прикреплять изображения к сообщению');
  const ctxRow = h('div', { class: 'row2', style: 'margin:0' }, Field('Max tokens', inp('max_tokens', { type: 'number' })), Field('Контекст, сообщений', inp('context', { type: 'number' })));
  const apiHint = h('div', { class: 'hint' });
  const HINTS = {
    chat: 'Ответ стримится в чат. Контекст — сколько прошлых сообщений видит модель.',
    image: 'Прикреплённое фото отправляется на /v1/images/edits. Размер и качество — в доп. параметрах: {"size":"1024x1536"}.',
    video: 'Задача создаётся на /v1/videos, приложение ждёт готовности (до 20 минут). Параметры: {"seconds":"8","size":"1280x720"}.',
  };
  const syncKind = () => {
    const k = kindSel.value, cur = apiSel.value || m.api;
    apiSel.replaceChildren(...API_OPTS[k].map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
    visionRow.style.display = ctxRow.style.display = k === 'chat' ? '' : 'none';
    apiHint.textContent = HINTS[k];
    if (testBtn) testBtn.style.display = k === 'video' ? 'none' : '';
  };
  kindSel.onchange = syncKind;
  const testOut = h('div');
  const collect = () => {
    const b = { emoji_id: emojiId };
    for (const [k, el] of Object.entries(f)) b[k] = el.type === 'checkbox' ? el.checked : el.value;
    if (b.sort === '') delete b.sort;
    return b;
  };
  const save = async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      if (isNew) await api('admin/models', collect());
      else await api(`admin/models/${m.id}`, collect(), 'PUT');
      hap.ok();
      toast(isNew ? 'Модель добавлена' : 'Сохранено');
      s.close();
      renderAdmin();
      refreshBoot();
    } catch (er) { fail(er); } finally { btn.disabled = false; }
  };
  const test = async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    testOut.replaceChildren(h('div', { class: 'out' }, 'Отправляю тестовый запрос…'));
    try {
      const r = await api(`admin/models/${m.id}/test`, {});
      testOut.replaceChildren(r.ok
        ? h('div', { class: 'out' }, h('b', null, `✓ ${(r.ms / 1000).toFixed(1)} с${r.usage ? ` · ${r.usage.in}→${r.usage.out} токенов` : ''}`), '\n\n', r.image ? h('img', { src: r.image }) : r.text)
        : h('div', { class: 'out err' }, `✕ ${r.error}`));
    } catch (er) { testOut.replaceChildren(h('div', { class: 'out err' }, er.message)); } finally { btn.disabled = false; }
  };
  const del = async () => {
    if (!(await confirmBox(`Удалить модель «${m.name}»?`))) return;
    try { await api(`admin/models/${m.id}`, undefined, 'DELETE'); toast('Удалено'); s.close(); renderAdmin(); refreshBoot(); } catch (e) { fail(e); }
  };
  const testBtn = !isNew && h('button', { class: 'btn', onclick: test }, 'Тест');
  const s = sheet(h('div', null,
    h('div', { class: 'emo-field' }, prev,
      h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, 'Иконка'), h('div', { class: 'hint', style: 'margin:2px 0 0' }, 'Премиум-эмодзи из библиотеки')),
      h('button', { class: 'btn sm', onclick: () => pickEmoji(setEmo) }, 'Выбрать'), clearBtn),
    Field('Название', inp('name', { placeholder: 'Claude Sonnet 5.5' })),
    Field('ID модели у провайдера', inp('model', { placeholder: 'claude-sonnet-5-5' }), 'Точно как в API провайдера'),
    Field('Тип', kindSel),
    Field('Формат API', apiSel),
    apiHint,
    h('div', { style: 'height:10px' }),
    h('div', { class: 'row2', style: 'margin:0' },
      Field('Цена за запрос, ₽', inp('price', { type: 'number', step: '0.01', min: 0, inputmode: 'decimal' })),
      Field('Мощность, %', inp('power', { type: 'number', min: 0, max: 100 }))),
    h('div', { class: 'row2', style: 'margin:0' },
      Field('Бейдж', inp('badge', { placeholder: 'NEW', maxlength: 12 })),
      Field('Метка справа', inp('tag', { placeholder: 'PRO', maxlength: 10 }))),
    Field('Описание', area('description', { rows: 3 })),
    Field('Запасной эмодзи', inp('emoji', { maxlength: 8 }), 'Показывается, если премиум-эмодзи недоступен'),
    tog('active', 'Активна', 'Видна пользователям'),
    visionRow,
    h('details', { class: 'adv' }, h('summary', null, 'Дополнительно'),
      Field('Системный промпт модели', area('system_prompt', { rows: 4 }), 'Добавляется к общему промпту из настроек'),
      ctxRow,
      h('div', { class: 'row2', style: 'margin:0' },
        Field('Temperature', inp('temperature', { type: 'number', step: '0.1', placeholder: 'по умолч.' })),
        Field('Сортировка', inp('sort', { type: 'number' }))),
      Field('Base URL', inp('base_url', { placeholder: 'пусто — AI_BASE_URL из окружения' })),
      Field('API-ключ', inp('api_key', { placeholder: 'пусто — AI_API_KEY из окружения', autocomplete: 'off' })),
      Field('Доп. параметры запроса (JSON)', area('extra', { rows: 3, placeholder: '{"size": "1024x1024"}' }))),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn primary', onclick: save }, svg('check'), 'Сохранить'),
      testBtn,
      !isNew && h('button', { class: 'btn danger', onclick: del }, svg('trash'))),
    !isNew && h('p', { class: 'hint' }, 'Тест использует сохранённые настройки и не списывает деньги.'),
    testOut), { title: isNew ? 'Новая модель' : m.name });
  setEmo(emojiId);
  syncKind();
}

// Выдача баланса: по ID/@username (из «Люди») или конкретному пользователю
function openGrant(user, after) {
  let who, amount, note;
  const kind = h('select', { class: 'input' }, h('option', { value: 'topup' }, 'Пополнение — рефереру начислится %'), h('option', { value: 'bonus' }, 'Бонус — подарок без реферального %'));
  const s = sheet(h('form', { onsubmit: async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await api('admin/grant', { user: who.value, amount: amount.value, kind: kind.value, note: note.value });
      hap.ok();
      toast(`${r.user.name}: баланс ${fmt(r.user.balance)} ₽`);
      s.close();
      after?.();
    } catch (er) { fail(er); btn.disabled = false; }
  } },
    Field('Пользователь', who = h('input', { class: 'input', value: user ? String(user.id) : '', placeholder: 'ID или @username' })),
    Field('Сумма, ₽', amount = h('input', { class: 'input', type: 'number', step: '0.01', inputmode: 'decimal', placeholder: '100' })),
    Field('Тип', kind),
    Field('Комментарий', note = h('input', { class: 'input', placeholder: 'необязательно, например «Оплата по СБП»' })),
    h('p', { class: 'hint', style: 'margin:0 4px 12px' }, 'Пользователь получит уведомление в боте.'),
    h('button', { class: 'btn primary', type: 'submit' }, svg('check'), 'Начислить')), { title: 'Выдать баланс' });
}

async function openUser(id, after) {
  const s = sheet(h('div', null, Skel(120, 0), Skel(200)), { title: 'Пользователь' });
  const load = async () => {
    const d = await api(`admin/users/${id}`);
    const u = d.user, st = d.stats;
    let amount;
    const deduct = async e => {
      const btn = e.currentTarget, v = Number(String(amount.value).replace(',', '.'));
      if (!(v > 0)) return fail(new Error('Введи сумму'));
      if (!(await confirmBox(`Списать ${fmt(v)} ₽?`))) return;
      btn.disabled = true;
      try {
        await api(`admin/users/${id}`, { delta: -v, note: 'Списание администратором' });
        hap.ok();
        toast(`Списано ${fmt(v)} ₽`);
        await load();
        after?.();
      } catch (er) { fail(er); } finally { btn.disabled = false; }
    };
    const flag = (key, label, hint) => {
      const sw = Switch(u[key]);
      sw.onchange = async () => {
        try { await api(`admin/users/${id}`, { [key]: sw.checked }); toast('Сохранено'); } catch (e) { fail(e); sw.checked = !sw.checked; }
      };
      return ToggleRow(label, sw, hint);
    };
    s.set(h('div', null,
      h('div', { class: 'sheet-hero' }, Avatar(u, 76), h('h3', null, userName(u)),
        h('p', { class: 'sheet-sub', style: 'cursor:pointer', onclick: () => copy(String(u.id)) }, `${u.username ? '@' + u.username + ' · ' : ''}ID ${u.id}`)),
      h('div', { class: 'tiles', style: 'margin-top:0' },
        Tile('Баланс', `${fmt(u.balance)} ₽`),
        Tile('Потрачено', `${fmt(st.spent)} ₽`, `${st.requests} ${plural(st.requests, ['запрос', 'запроса', 'запросов'])}`),
        Tile('С нами', `${st.days} дн.`, `с ${dFull(st.since)}`),
        Tile('Рефералы', st.refs, `доход ${fmt(st.ref_earned)} ₽`)),
      h('button', { class: 'btn primary', style: 'margin:12px 0', onclick: () => openGrant(u, async () => { await load(); after?.(); }) }, svg('plus'), 'Выдать баланс'),
      h('div', { style: 'display:flex;gap:8px;margin-bottom:12px' },
        amount = h('input', { class: 'input', type: 'number', inputmode: 'decimal', placeholder: 'Сумма списания, ₽' }),
        h('button', { class: 'btn danger', style: 'width:auto;padding:0 18px', onclick: deduct }, 'Списать')),
      flag('is_admin', 'Администратор', 'Доступ к админ-панели'),
      flag('banned', 'Заблокирован', 'Приложение и бот перестанут работать для него'),
      d.requests.length > 0 && h('div', { class: 'section', style: 'background:var(--card)' }, h('h3', null, 'Запросы'),
        d.requests.map(r => h('div', { class: 'feed' },
          h('div', { class: 'feed-main' }, h('b', null, r.model_name), h('div', { class: 'mono' }, r.prompt || ''), r.error && h('div', { class: 'err-text' }, r.error)),
          h('div', { class: 'feed-side' }, h('span', { class: `st st-${r.status}` }, STATUS[r.status] || r.status), h('span', { class: 'mono' }, `${timeAgo(r.created_at)} · ${fmt(r.price)} ₽`))))),
      d.payments.length > 0 && h('div', { class: 'section', style: 'background:var(--card)' }, h('h3', null, 'Баланс'),
        d.payments.map(p => h('div', { class: 'feed' },
          h('div', { class: 'feed-main' }, h('b', null, (PAY_KIND[p.method]?.[2] || (() => p.method))(p))),
          h('div', { class: 'feed-side' }, h('b', { style: p.amount > 0 ? 'color:var(--green)' : '' }, `${p.amount > 0 ? '+' : ''}${fmt(p.amount)} ₽`), h('span', { class: 'mono' }, timeAgo(p.created_at))))))));
  };
  try { await load(); } catch (e) { s.set(h('div', { class: 'out err' }, e.message)); }
}

/* ───────────── Вход для браузера ───────────── */

function renderLogin() {
  S.view = 'login';
  document.body.classList.remove('on-chat');
  let pass;
  mount(h('div', { class: 'login' }, h('div', { class: 'login-card' },
    h('div', { class: 'login-logo' }, svg('logo')),
    h('h1', null, 'Dreinn AI'),
    h('p', { class: 'muted' }, 'Вход в админ-панель'),
    h('form', { onsubmit: async e => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        const r = await api('admin/login', { password: pass.value });
        store.set('admin_token', r.token);
        auth = `Admin ${r.token}`;
        boot();
      } catch (er) { fail(er); btn.disabled = false; }
    } },
      pass = h('input', { class: 'input', type: 'password', placeholder: 'Пароль (ADMIN_PASSWORD)', autocomplete: 'current-password', autofocus: true }),
      h('button', { class: 'btn primary', style: 'margin-top:10px', type: 'submit' }, 'Войти')),
    h('p', { class: 'hint', style: 'margin-top:18px;text-align:center' }, 'Чат и профиль открываются из Telegram-бота.'))));
}

/* ───────────── Запуск ───────────── */

async function boot() {
  if (!auth) return renderLogin();
  try {
    Object.assign(S, await api('bootstrap'));
  } catch (e) {
    if (!auth) return;
    return mount(h('div', { class: 'login' }, h('div', { class: 'login-card' }, h('div', { class: 'empty-t' }, 'Не удалось загрузить'), h('p', { class: 'muted' }, e.message),
      h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Обновить'))));
  }
  if (!S.me) {
    S.view = 'admin';
    return renderAdmin();
  }
  const start = qs.get('tab') || tg?.initDataUnsafe?.start_param || '';
  if (start === 'admin' && S.admin) return openAdmin();
  go(['chat', 'history', 'info', 'profile'].includes(start) ? start : 'chat');
}

// Ссылки и кнопки «Копировать» внутри ответов моделей
document.addEventListener('click', e => {
  const a = e.target.closest('.md a');
  if (a) { e.preventDefault(); openLink(a.href); return; }
  const c = e.target.closest('.code-copy');
  if (c) copy(c.closest('pre').querySelector('code').textContent);
});

if (inTG) {
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor('#000000');
    tg.setBackgroundColor('#000000');
    tg.setBottomBarColor?.('#000000');
    tg.disableVerticalSwipes?.();
  } catch {}
  tg.BackButton.onClick(() => {
    if (sheets.length) sheets.at(-1).close();
    else if (S.view === 'admin' && S.me) closeAdmin();
    else if (S.view === 'app' && S.tab !== 'chat') go('chat');
  });
  tg.onEvent('fullscreenChanged', () => S.view === 'app' && S.tab === 'chat' && !S.chat.messages.length && render());
  tg.onEvent('viewportChanged', () => S.tab === 'chat' && scrollBottom());
}

boot();
