/* =========================================================
   Fraction Matcher – drag two circles on top of each other
   to see whether their cut lines line up
   ========================================================= */
const MAX_START_DEN = 12;   // biggest denominator children can pick (12 × 11 = 132 pieces at most)
const SIDES = ['a', 'b'];
const LETTER = { a: 'A', b: 'B' };

const $ = (sel) => document.querySelector(sel);
const lcm = (a, b) => (a / gcd(a, b)) * b;
const other = (w) => (w === 'a' ? 'b' : 'a');

const NAMES = {
  1: ['whole', 'wholes'], 2: ['half', 'halves'], 3: ['third', 'thirds'], 4: ['quarter', 'quarters'],
  5: ['fifth', 'fifths'], 6: ['sixth', 'sixths'], 7: ['seventh', 'sevenths'], 8: ['eighth', 'eighths'],
  9: ['ninth', 'ninths'], 10: ['tenth', 'tenths'], 11: ['eleventh', 'elevenths'], 12: ['twelfth', 'twelfths'],
};
/** "halves", "sevenths", "35ths", "21sts"… */
function denName(d, plural = true) {
  if (NAMES[d]) return NAMES[d][plural ? 1 : 0];
  const t = d % 100, u = d % 10;
  const suffix = t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th';
  return `${d}${suffix}${plural ? 's' : ''}`;
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);

const fracHTML = ({ n, d }, cls = '') => `<span class="frac ${cls}"><span class="n">${n}</span><span class="d">${d}</span></span>`;

/* ---------------------------------------------------------
   State – each circle is n/d, with every piece cut into k
   smaller pieces (k = 1 until the child presses "Cut")
   --------------------------------------------------------- */
const state = {
  a: { n: 1, d: 2, k: 1 },
  b: { n: 2, d: 6, k: 1 },
  stage: [],   // order dropped in: [0] sits underneath (solid), [1] on top (striped)
  showHow: false, // dotted "how to cut" lines only appear once the child asks for them
};
const shown = (w) => ({ n: state[w].n * state[w].k, d: state[w].d * state[w].k });

const els = {
  zone: $('#drop-zone'), stack: $('#stack'), hint: $('#drop-hint'), legend: $('#legend'),
  eq: $('#cmp-eq'), explain: $('#cmp-explain'), match: $('#match-layer'),
  convert: $('#convert-btn'), undo: $('#undo-btn'), clear: $('#clear-btn'),
};

const side = {};
SIDES.forEach((w) => {
  const card = $(`#card-${w}`);
  const theme = w === 'a' ? 'coral' : 'teal';
  const layer = new FractionCircle($(`#layer-${w}`), { theme });
  // the circle on top is drawn with stripes so you can see the one underneath through it
  layer.svg.querySelector('defs').insertAdjacentHTML('beforeend', `
    <pattern id="${layer.id}-stripes" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="7" height="7" fill="${CIRCLE_THEMES[theme][2]}" fill-opacity="0.16"/>
      <rect width="3.2" height="7" fill="${CIRCLE_THEMES[theme][2]}"/>
    </pattern>`);
  side[w] = {
    card,
    num: card.querySelector('.num input'),
    den: card.querySelector('.den input'),
    src: card.querySelector('.drag-src'),
    note: card.querySelector('.cut-note'),
    circle: new FractionCircle(card.querySelector('.drag-src svg'), { theme }),
    layer,
  };
});
new FractionCircle($('#logo-circle'), { mini: true }).setFraction(2, 3, { animate: false });

function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

/* ---------- steppers ---------- */
function bindStepper(w, which) {
  const input = which === 'n' ? side[w].num : side[w].den;
  const box = input.parentElement;
  const set = (v) => {
    const s = state[w];
    if (which === 'n') {
      if (v < 0 || v > s.d) { shake(box); v = clamp(v, 0, s.d); }
      s.n = v;
    } else {
      if (v < 1 || v > MAX_START_DEN) { shake(box); v = clamp(v, 1, MAX_START_DEN); }
      if (v !== s.d) {
        s.d = v;
        s.n = Math.min(s.n, v);
        SIDES.forEach((x) => { state[x].k = 1; }); // new pieces → any cutting plan starts again
        state.showHow = false;
      }
    }
    render();
  };
  const cur = () => (which === 'n' ? state[w].n : state[w].d);
  box.querySelector('[data-step="-"]').addEventListener('click', () => set(cur() - 1));
  box.querySelector('[data-step="+"]').addEventListener('click', () => set(cur() + 1));
  input.addEventListener('change', () => {
    const v = parseInt(input.value, 10);
    if (Number.isNaN(v)) render(); else set(v);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('focus', () => input.select());
}
SIDES.forEach((w) => { bindStepper(w, 'n'); bindStepper(w, 'd'); });

/* ---------------------------------------------------------
   Drag & drop – pointer events so it works with fingers too.
   A tap (or Enter) also drops the circle in.
   --------------------------------------------------------- */
function makeGhost(w) {
  const svg = side[w].circle.svg;
  const r = svg.getBoundingClientRect();
  const el = svg.cloneNode(true);
  el.classList.add('drag-ghost');
  Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  document.body.appendChild(el);
  return { el, r };
}

function flyGhost(g, done) {
  const t = els.stack.getBoundingClientRect();
  const tx = t.left + t.width / 2 - (g.r.left + g.r.width / 2);
  const ty = t.top + t.height / 2 - (g.r.top + g.r.height / 2);
  g.el.style.transition = 'transform 0.4s cubic-bezier(.3, 1.2, .5, 1), opacity 0.4s';
  requestAnimationFrame(() => { g.el.style.transform = `translate(${tx}px, ${ty}px) scale(${t.width / g.r.width})`; });
  setTimeout(() => { g.el.remove(); done(); }, 420);
}

function targetAt(x, y, w) {
  const inside = (el) => { const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  if (inside(els.zone)) return 'stage';
  if (inside(side[other(w)].src)) return 'other';
  return null;
}

function drop(w, ontoOther = false) {
  // dropping one circle onto the other puts both in the overlap zone, the dragged one on top
  if (ontoOther && !state.stage.includes(w) && !state.stage.includes(other(w))) state.stage.push(other(w));
  if (!state.stage.includes(w)) state.stage.push(w);
  if (ontoOther && !state.stage.includes(other(w))) state.stage.push(other(w));
  render();
  const r = els.zone.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) els.zone.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function bindDrag(w) {
  const src = side[w].src;
  let drag = null;
  const highlight = (t) => {
    els.zone.classList.toggle('over', t === 'stage');
    side[other(w)].src.classList.toggle('over', t === 'other');
  };

  src.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag) return;
    e.preventDefault();
    src.focus({ preventScroll: true });
    src.setPointerCapture(e.pointerId);
    drag = { x0: e.clientX, y0: e.clientY, ghost: null };
  });
  src.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.ghost) {
      if (Math.hypot(dx, dy) < 8) return;
      drag.ghost = makeGhost(w);
      src.classList.add('dragging');
    }
    drag.ghost.el.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
    highlight(targetAt(e.clientX, e.clientY, w));
  });
  const end = (e, cancelled) => {
    if (!drag) return;
    const { ghost } = drag;
    drag = null;
    highlight(null);
    if (!ghost) { // a tap: fly straight into the overlap zone
      if (!cancelled) flyGhost(makeGhost(w), () => drop(w));
      return;
    }
    const t = cancelled ? null : targetAt(e.clientX, e.clientY, w);
    if (t) {
      flyGhost(ghost, () => { src.classList.remove('dragging'); drop(w, t === 'other'); });
    } else { // missed – slide back home
      ghost.el.style.transition = 'transform 0.3s ease';
      ghost.el.style.transform = '';
      setTimeout(() => { ghost.el.remove(); src.classList.remove('dragging'); }, 320);
    }
  };
  src.addEventListener('pointerup', (e) => end(e, false));
  src.addEventListener('pointercancel', (e) => end(e, true));
  // released somewhere we never heard about (e.g. outside the window) – don't leave the ghost stuck
  src.addEventListener('lostpointercapture', (e) => end(e, true));
  src.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drop(w); }
  });
}
SIDES.forEach(bindDrag);

/* ---------- buttons ---------- */
els.convert.addEventListener('click', () => {
  if (!state.showHow) { state.showHow = true; render(); return; } // first press: show how, second: cut
  const L = lcm(shown('a').d, shown('b').d);
  SIDES.forEach((w) => { state[w].k = L / state[w].d; });
  render();
});
els.undo.addEventListener('click', () => {
  SIDES.forEach((w) => { state[w].k = 1; });
  state.showHow = false;
  render();
});
els.clear.addEventListener('click', () => {
  state.stage = [];
  render();
});

const PRESETS = [[1, 2, 3, 6], [1, 2, 2, 6], [2, 3, 5, 6], [1, 5, 1, 7], [3, 5, 4, 7], [3, 4, 2, 3], [3, 4, 5, 6]];
PRESETS.forEach(([an, ad, bn, bd]) => {
  const b = document.createElement('button');
  b.className = 'ghost preset';
  b.innerHTML = `${fracHTML({ n: an, d: ad }, 'small a')}<span>&amp;</span>${fracHTML({ n: bn, d: bd }, 'small b')}`;
  b.setAttribute('aria-label', `Try ${an}/${ad} and ${bn}/${bd}`);
  b.addEventListener('click', () => {
    state.a = { n: an, d: ad, k: 1 };
    state.b = { n: bn, d: bd, k: 1 };
    state.showHow = false;
    render();
  });
  $('#presets').appendChild(b);
});

/* ---------------------------------------------------------
   Render
   --------------------------------------------------------- */
function render({ animate = true } = {}) {
  const A = shown('a'), B = shown('b');
  const L = lcm(A.d, B.d);

  SIDES.forEach((w) => {
    const s = state[w], sh = shown(w), S = side[w];
    const pos = state.stage.indexOf(w);
    S.num.value = s.n;
    S.den.value = s.d;
    S.num.max = s.d;

    S.circle.setFraction(sh.n, sh.d, { animate });

    S.layer.setFraction(sh.n, sh.d, { animate });
    S.layer.shadeEl.setAttribute('fill', `url(#${S.layer.id}-${pos === 1 ? 'stripes' : 'fill'})`);
    S.layer.svg.classList.toggle('in', pos >= 0);
    S.layer.svg.classList.toggle('bottom', pos === 0);
    S.layer.svg.classList.toggle('top', pos === 1);
    S.src.classList.toggle('placed', pos >= 0);

    S.note.innerHTML = s.k > 1
      ? `✂️ Cut into ${denName(sh.d)}: ${fracHTML(s, `small ${w}`)} = ${fracHTML(sh, `small ${w}`)}`
      : '';
  });

  renderStage(A, B, L);
}

function renderStage(A, B, L) {
  const both = state.stage.length === 2;
  const same = A.d === B.d;
  const fits = !same && L === Math.max(A.d, B.d);

  els.zone.classList.toggle('empty', !state.stage.length);
  els.zone.classList.toggle('full', both);
  els.hint.textContent = !state.stage.length ? 'Drag circle A or B in here'
    : both ? '' : `Now drag circle ${LETTER[other(state.stage[0])]} on top!`;
  els.legend.innerHTML = state.stage
    .map((w, i) => `<span class="key ${w} ${i ? 'striped' : 'solid'}"><i></i>${LETTER[w]} ${fracHTML(shown(w), `small ${w}`)}</span>`)
    .join('');

  const sym = both && same ? (A.n > B.n ? '>' : A.n < B.n ? '<' : '=') : '?';
  els.eq.innerHTML = `${fracHTML(A, 'a')}<span class="cmp-sym ${sym === '?' ? 'unknown' : ''}">${sym}</span>${fracHTML(B, 'b')}`;

  renderMatch(A, B, both, same);

  // explanation + what the Cut button does
  let html, kind = '';
  if (same) {
    const d = A.d;
    if (!both) {
      html = `Both circles are cut into <strong>${denName(d)}</strong>, so all the pieces are the same size. Drag them together and count!`;
    } else if (A.n === B.n) {
      const baseDiffers = state.a.n !== state.b.n || state.a.d !== state.b.d;
      html = `🎉 <strong>Exactly the same amount!</strong> Every line matches and both have <b>${A.n}</b> ${denName(d, A.n !== 1)} shaded` +
        (baseDiffers ? ` — so ${fracHTML(state.a, 'small a')} = ${fracHTML(state.b, 'small b')}` : '') + '.';
      kind = 'mul';
    } else {
      const big = A.n > B.n ? 'a' : 'b';
      const diff = Math.abs(A.n - B.n);
      html = `Every line matches, so now we can just <strong>count the pieces</strong>: A has <b class="na">${A.n}</b> and B has <b class="nb">${B.n}</b>. ` +
        `<strong>${LETTER[big]} is bigger</strong> by ${diff} ${denName(d, diff !== 1)} — the glowing bit!`;
      kind = 'mul';
    }
  } else if (!both) {
    html = 'Drag <strong>both</strong> circles into the overlap zone. Do their lines match up?';
  } else {
    const how = state.showHow;
    const btn = (icon, text, small) => `<span class="op-sym">${icon}</span><span class="op-text">${text}<small>${small}</small></span>`;
    if (fits) {
      const small = A.d < B.d ? 'a' : 'b';
      const sd = shown(small).d, bd = L;
      html = `✨ Look at the gold lines: every line on the <strong>${denName(sd)}</strong> circle lands exactly on a line of the <strong>${denName(bd)}</strong> circle! ` +
        (how
          ? `That means each ${denName(sd, false)} is the same as <strong>${bd / sd} ${denName(bd)}</strong>. Cut each ${denName(sd, false)} into ${bd / sd} and the pieces will all be the same size.`
          : `But the pieces are different sizes, so we can’t count them yet…`);
      els.convert.innerHTML = how
        ? btn('✂️', `Cut the ${denName(sd)}`, `into ${denName(bd)}`)
        : btn('🔍', 'How can we make them match?', 'show me');
    } else {
      const g = gcd(A.d, B.d);
      html = `🤔 The lines don’t line up! ${cap(denName(A.d))} and ${denName(B.d)} are different-sized pieces, so we can’t compare them by counting. ` +
        (g > 1 ? 'Only the gold lines match. ' : '') +
        (how
          ? `<strong>${L}</strong> is the smallest number both go into (${A.d} × ${L / A.d} = ${L} and ${B.d} × ${L / B.d} = ${L}), ` +
            `so the dotted lines show how to cut both circles into <strong>${denName(L)}</strong>.`
          : '');
      kind = 'div';
      els.convert.innerHTML = how
        ? btn('✂️', 'Cut both', `into ${denName(L)}`)
        : btn('🔍', 'How can we make them match?', 'show me');
    }
  }
  els.explain.className = `explain ${kind}`;
  els.explain.innerHTML = html;

  els.convert.hidden = same || !both;
  els.undo.hidden = state.a.k === 1 && state.b.k === 1;
  els.clear.hidden = !state.stage.length;
}

/** gold lines where both circles have a cut, dotted lines showing where to cut (once asked for),
    and a glowing wedge for the difference once the pieces match */
let matchKey = '';
function renderMatch(A, B, both, same) {
  const g = gcd(A.d, B.d);
  const wedge = both && same && A.n !== B.n ? [Math.min(A.n, B.n) / A.d, Math.max(A.n, B.n) / A.d] : null;
  const showHow = both && !same && state.showHow;
  const key = `${both}|${A.d}|${B.d}|${wedge}|${showHow}`;
  if (key === matchKey) return;
  matchKey = key;

  const geo = side.a.layer; // same geometry as every stage circle
  els.match.innerHTML = '';
  if (!both) return;

  if (showHow) {
    const L = lcm(A.d, B.d);
    for (let i = 0; i < L; i++) {
      if ((i * A.d) % L === 0 || (i * B.d) % L === 0) continue; // already a real cut on one of the circles
      const [x, y] = geo.pt(i / L);
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', `M${geo.cx} ${geo.cy} L${x.toFixed(2)} ${y.toFixed(2)}`);
      p.classList.add('how-line');
      p.style.animationDelay = `${i * Math.min(25, 600 / L)}ms`;
      els.match.appendChild(p);
    }
  }

  if (wedge) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', geo.wedgePath(...wedge));
    p.classList.add('diff-wedge');
    els.match.appendChild(p);
  }

  if (g < 2) return; // only the starting line is shared
  const w = g > 24 ? 1.3 : g > 12 ? 2 : 3.2;
  const stagger = Math.min(60, 700 / g);
  for (let i = 0; i < g; i++) {
    const [x, y] = geo.pt(i / g);
    const d = `M${geo.cx} ${geo.cy} L${x.toFixed(2)} ${y.toFixed(2)}`;
    ['match-under', 'match-line'].forEach((cls) => {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('pathLength', '1');
      p.classList.add(cls);
      p.style.strokeWidth = cls === 'match-line' ? w : w + 2.4;
      els.match.appendChild(p);
      setTimeout(() => { p.style.strokeDashoffset = '0'; }, 650 + i * stagger);
    });
  }
}

/* ---------- go! ---------- */
render({ animate: false });
