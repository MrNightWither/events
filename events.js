'use strict';

// Adresse des Cloudflare Workers, der die Anmeldung an Discord weiterleitet.
// Die echten Discord Webhooks liegen NUR dort als geheime Variable, nie im Code.
const ANMELDUNG_URL = 'https://nwu-anmeldung.nwu-brand.workers.dev';

const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/adminpannel-f0aab/databases/(default)/documents/';
const EVENT_TYPES = {
  tournament: 'TURNIER',
  verlosung: 'VERLOSUNG',
  community: 'COMMUNITY',
  stream: 'STREAM',
  challenge: 'CHALLENGE',
  sonstiges: 'SONSTIGES'
};
// Vergangene Events werden so lange nach Beginn noch angezeigt
const SHOW_AFTER_START_MS = 12 * 60 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Baut ein Element nur mit textContent. Eingeschleuster Code wird so nie ausgeführt.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

// ---------- Daten aus Firestore lesen (nur lesen, ohne SDK) ----------
function readFields(fields) {
  const out = {};
  for (const [key, val] of Object.entries(fields || {})) {
    if ('stringValue' in val) out[key] = val.stringValue;
    else if ('booleanValue' in val) out[key] = val.booleanValue;
    else if ('timestampValue' in val) out[key] = val.timestampValue;
    else if ('integerValue' in val) out[key] = Number(val.integerValue);
    else if ('doubleValue' in val) out[key] = val.doubleValue;
  }
  return out;
}

async function fetchCollection(name) {
  const res = await fetch(FIRESTORE + name + '?pageSize=100', { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error('Laden fehlgeschlagen');
  const json = await res.json();
  return (json.documents || []).map((doc) => ({ id: doc.name.split('/').pop(), ...readFields(doc.fields) }));
}

// ---------- Anzeige ----------
// Datum und Uhrzeit stehen auf zwei Zeilen: oben der Tag, darunter die Zeit.
// Events und Streams benutzen dieselbe Schreibweise, damit beide Listen
// nebeneinander gelesen werden koennen.
function fillTime(node, date) {
  if (!date || isNaN(date)) {
    node.append('TBA', el('span', 't', '--:--'));
    return node;
  }
  node.append(
    date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }),
    el('span', 't', date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }))
  );
  return node;
}

function renderEvent(ev) {
  const typeKey = Object.prototype.hasOwnProperty.call(EVENT_TYPES, ev.type) ? ev.type : 'sonstiges';
  const date = ev.eventDate ? new Date(ev.eventDate) : null;

  const card = el('div', 'event-card type-' + typeKey + ' fade-in');

  const time = fillTime(el('div', 'event-time'), date);

  const content = el('div', 'event-content');
  content.append(el('div', 'event-type', EVENT_TYPES[typeKey]));
  content.append(el('div', 'event-title', ev.title || 'Event'));
  const prize = el('div', 'event-prize-line');
  prize.append(el('span', 'event-prize-label', 'Preis'), el('span', 'event-prize', ev.prizePool || 'Ruhm & Ehre'));
  content.append(prize);
  if (ev.description) content.append(el('div', 'event-desc', ev.description));

  const btnWrap = el('div', 'event-button');
  const btn = el('button', 'btn-gold', 'Anmelden');
  btn.type = 'button';
  btn.addEventListener('click', () => openModal(ev.id, typeKey, ev.title || 'Event'));
  btnWrap.append(btn);

  card.append(time, content, btnWrap);
  return card;
}

// Ein Stream verschwindet 6 Stunden nach Beginn, maximal so viele werden angezeigt
const STREAM_KEEP_MS = 6 * 60 * 60 * 1000;
const MAX_STREAMS = 6;

function dayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that - today) / 86400000);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  return null;
}

function renderStream(s) {
  const d = new Date(s.streamDate);
  const card = el('div', 'stream-card fade-in');
  const time = fillTime(el('div', 'stream-time'), d);
  const info = el('div', 'stream-info');
  info.append(el('div', 'stream-game', s.game || 'TBA'), el('div', 'stream-platform', s.platform || 'Twitch & TikTok'));
  card.append(time, info);
  const label = dayLabel(d);
  if (label) card.append(el('div', 'tag' + (label === 'Heute' ? ' heute' : ''), label));
  return card;
}

function zaehler(n, ein, viele) {
  return n + ' ' + (n === 1 ? ein : viele);
}

async function load() {
  try {
    const now = Date.now();
    const events = (await fetchCollection('events'))
      .filter((ev) => {
        const t = new Date(ev.eventDate).getTime();
        return isNaN(t) || t + SHOW_AFTER_START_MS > now;
      })
      .sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));

    let streams = [];
    try {
      streams = (await fetchCollection('streamingplan'))
        .filter((st) => {
          const t = new Date(st.streamDate).getTime();
          return !isNaN(t) && t + STREAM_KEEP_MS > now;
        })
        .sort((a, b) => new Date(a.streamDate) - new Date(b.streamDate))
        .slice(0, MAX_STREAMS);
    } catch (e) { /* Streaming Plan ist optional */ }

    $('loading').hidden = true;

    if (!events.length && !streams.length) {
      $('emptyState').hidden = false;
      return;
    }
    if (events.length) {
      $('eventsSection').hidden = false;
      $('eventsMeta').textContent = zaehler(events.length, 'Event', 'Events');
      $('eventsList').replaceChildren(...events.map(renderEvent));
    }
    if (streams.length) {
      $('streamingSection').hidden = false;
      $('streamMeta').textContent = zaehler(streams.length, 'Termin', 'Termine');
      $('streamingList').replaceChildren(...streams.map(renderStream));
    }
  } catch (e) {
    $('loading').removeAttribute('aria-busy');
    $('loading').className = 'note error';
    $('loading').replaceChildren(el('p', null, 'Die Events lassen sich gerade nicht laden. Schau solange auf dem Discord Server vorbei.'));
  }
}

// ---------- Anmeldung ----------
let currentEventId = null;
let lastOpener = null;

function openModal(eventId, eventType, eventTitle) {
  currentEventId = eventId;
  lastOpener = document.activeElement;
  $('modalTitle').textContent = 'Anmelden: ' + eventTitle;
  $('gameName-group').hidden = eventType !== 'tournament';
  $('scrim').hidden = false;
  $('registrationModal').hidden = false;
  document.body.classList.add('locked');
  $('fUsername').focus();
}

function closeModal() {
  $('registrationModal').hidden = true;
  $('scrim').hidden = true;
  document.body.classList.remove('locked');
  $('registrationForm').reset();
  setStatus('', '');
  currentEventId = null;
  if (lastOpener) lastOpener.focus();
}

function setStatus(text, type) {
  const s = $('formStatus');
  s.textContent = text;
  s.className = 'form-status' + (type ? ' ' + type : '');
}

$('scrim').addEventListener('click', closeModal);
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('registrationModal').hidden) closeModal(); });

$('registrationForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('fUsername').value.trim();
  const discordName = $('fDiscord').value.trim();
  const gameName = $('fGame').value.trim();

  if (username.length < 2 || discordName.length < 2) {
    setStatus('Bitte Username und Discord Name ausfüllen.', 'error');
    return;
  }
  if (!$('fConsent').checked) {
    setStatus('Bitte der Datenübermittlung zustimmen.', 'error');
    return;
  }

  const btn = $('fSubmit');
  btn.disabled = true;
  setStatus('Wird gesendet...', '');

  try {
    const res = await fetch(ANMELDUNG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({
        eventId: currentEventId,
        username: username.slice(0, 40),
        discordName: discordName.slice(0, 40),
        gameName: gameName.slice(0, 40),
        consent: true,
        website: $('fWebsite').value
      })
    });
    if (!res.ok) throw new Error('Status ' + res.status);
    setStatus('Anmeldung erfolgreich.', 'success');
    setTimeout(closeModal, 1500);
  } catch (err) {
    setStatus('Anmeldung fehlgeschlagen. Versuch es später, melde dich auf Discord oder schreib an nwu.business@nightwither.de.', 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------- Leiste ----------
const bar = $('bar');
const onScroll = () => bar.classList.toggle('scrolled', window.scrollY > 10);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ---------- Partikel ----------
// Gleiche Funkenflug wie auf Linkseite und Shop: die Bitmap wird mit der
// Geraetepixeldichte multipliziert, gerechnet wird weiter in CSS-Pixeln.
const canvas = $('particle-canvas');
const ctx = canvas.getContext('2d');
let viewW = window.innerWidth;
let viewH = window.innerHeight;

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  canvas.style.width = viewW + 'px';
  canvas.style.height = viewH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const PARTICLE_COUNT = viewW < 600 ? 60 : 110;
const particles = [];

function resetParticle(p, fresh) {
  p.x = Math.random() * viewW;
  p.y = Math.random() * viewH;
  p.r = p.r || Math.random() * 1.4 + 0.3;
  p.dx = (Math.random() - 0.5) * 0.08;
  p.dy = -Math.random() * 0.12 - 0.02;
  p.life = fresh ? Math.random() : 1;
  return p;
}
for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(resetParticle({}, true));

function drawParticles() {
  ctx.clearRect(0, 0, viewW, viewH);
  for (const p of particles) {
    const a = Math.max(0, p.life) * 0.8;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(201, 168, 76, ${a})`;
    ctx.fill();
    p.x += p.dx;
    p.y += p.dy;
    p.life -= 0.0035;
    if (p.life <= 0 || p.y < -4) resetParticle(p, false);
  }
  if (!reduceMotion) requestAnimationFrame(drawParticles);
}
drawParticles();
load();
