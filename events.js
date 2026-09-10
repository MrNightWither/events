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
function renderEvent(ev) {
  const typeKey = Object.prototype.hasOwnProperty.call(EVENT_TYPES, ev.type) ? ev.type : 'sonstiges';
  const date = ev.eventDate ? new Date(ev.eventDate) : null;
  const valid = date && !isNaN(date);

  const card = el('div', 'event-card type-' + typeKey + ' fade-in');

  const time = el('div', 'event-time');
  time.append(valid ? date.toLocaleDateString('de-DE') : 'TBA', document.createElement('br'),
    valid ? date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--');

  const content = el('div', 'event-content');
  content.append(el('div', 'event-title', ev.title || 'Event'));
  const meta = el('div', 'event-meta');
  meta.append(el('div', 'event-type', EVENT_TYPES[typeKey]));
  content.append(meta);
  const prize = el('div', 'event-prize-line');
  prize.append(el('span', 'event-prize-label', 'Preis:'), ' ', el('span', 'event-prize', ev.prizePool || 'Ruhm & Ehre'));
  content.append(prize);
  if (ev.description) content.append(el('div', 'event-desc', ev.description));

  const btnWrap = el('div', 'event-button');
  const btn = el('button', 'event-btn', 'Anmelden');
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
  const time = el('div', 'stream-time');
  time.append(
    d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }),
    document.createElement('br'),
    d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  );
  const info = el('div', 'stream-info');
  info.append(el('div', 'stream-game', s.game || 'TBA'), el('div', 'stream-platform', s.platform || 'Twitch & TikTok'));
  card.append(time, info);
  const label = dayLabel(d);
  if (label) card.append(el('div', 'stream-badge', label));
  return card;
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

    $('loading').style.display = 'none';

    if (!events.length && !streams.length) {
      $('emptyState').style.display = 'block';
      return;
    }
    if (events.length) {
      $('eventsSection').style.display = 'flex';
      $('eventsList').replaceChildren(...events.map(renderEvent));
    }
    if (streams.length) {
      $('streamingSection').style.display = 'flex';
      $('streamingList').replaceChildren(...streams.map(renderStream));
    }
  } catch (e) {
    const p = el('p', null, 'Fehler beim Laden. Schau auf Discord vorbei!');
    p.style.cssText = 'color:#f87171;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.2em';
    $('loading').replaceChildren(p);
  }
}

// ---------- Anmeldung ----------
let currentEventId = null;
let lastOpener = null;

function openModal(eventId, eventType, eventTitle) {
  currentEventId = eventId;
  lastOpener = document.activeElement;
  $('modalTitle').textContent = 'Anmelden: ' + eventTitle;
  $('gameName-group').style.display = eventType === 'tournament' ? 'block' : 'none';
  $('registrationModal').classList.add('active');
  $('fUsername').focus();
}

function closeModal() {
  $('registrationModal').classList.remove('active');
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

$('modalClose').addEventListener('click', closeModal);
$('registrationModal').addEventListener('click', (e) => { if (e.target.id === 'registrationModal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('registrationModal').classList.contains('active')) closeModal(); });

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
    setStatus('✓ Anmeldung erfolgreich!', 'success');
    setTimeout(closeModal, 1500);
  } catch (err) {
    setStatus('✗ Anmeldung fehlgeschlagen. Versuch es später oder melde dich auf Discord.', 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------- Partikel ----------
const canvas = $('particle-canvas');
const ctx = canvas.getContext('2d');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const particles = [];
function resetParticle(p) {
  p.x = Math.random() * canvas.width;
  p.y = Math.random() * canvas.height;
  p.r = p.r || Math.random() * 1.5 + 0.3;
  p.dx = (Math.random() - 0.5) * 0.08;
  p.dy = (Math.random() - 0.5) * 0.08;
  p.life = Math.random();
  p.alpha = Math.random() * 0.8 + 0.2;
  return p;
}
for (let i = 0; i < 120; i++) particles.push(resetParticle({}));

function drawParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(201, 168, 76, ${p.alpha})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(240, 208, 128, ${p.alpha * 0.5})`;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    p.x += p.dx;
    p.y += p.dy;
    p.life -= 0.004;
    p.alpha = p.life * 0.8;
    if (p.life <= 0) { resetParticle(p); p.life = 1; }
    if (p.x < -p.r) p.x = canvas.width + p.r;
    if (p.x > canvas.width + p.r) p.x = -p.r;
    if (p.y < -p.r) p.y = canvas.height + p.r;
    if (p.y > canvas.height + p.r) p.y = -p.r;
  });
  if (!reduceMotion) requestAnimationFrame(drawParticles);
}
drawParticles();
load();
