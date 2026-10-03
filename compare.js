/* =========================================================
   Fraction Matcher – drag two circles on top of each other
   to see whether their cut lines line up
   ========================================================= */
const MAX_START_DEN = 12;   // biggest denominator children can pick (12 × 11 = 132 pieces at most)
const MAX_TRY = 144;        // biggest number of pieces we'll offer to try
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
   State – each circle shows n/d. After pressing "Cut",
   `orig` remembers what it was before so we can join back.
   --------------------------------------------------------- */
const state = {
  a: { n: 1, d: 2, orig: null },
  b: { n: 2, d: 6, orig: null },
  stage: [],      // order dropped in: [0] sits underneath (solid), [1] on top (see-through)
  showHow: false, // has the child asked "how can we make them match?"
  tryN: null,     // the number of pieces they're currently trying
  tried: {},      // N -> true/false, so the choices remember what's been tried
};

function resetTry() {
  state.showHow = false;
  state.tryN = null;
  state.tried = {};
}

const els = {
  zone: $('#drop-zone'), stack: $('#stack'), hint: $('#drop-hint'), legend: $('#legend'),
  eq: $('#cmp-eq'), explain: $('#cmp-explain'), match: $('#match-layer'),
  tryPanel: $('#try-panel'), tryChips: $('#try-chips'),
  convert: $('#convert-btn'), undo: $('#undo-btn'), clear: $('#clear-btn'),
};

const side = {};
SIDES.forEach((w) => {
  const card = $(`#card-${w}`);
  const theme = w === 'a' ? 'coral' : 'teal';
  const layer = new FractionCircle($(`#layer-${w}`), { theme });
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

/* ---------- changing a circle ---------- */
function setShaded(w, n) {
  const s = state[w];
  if (n === s.n) return;
  s.n = n;
  s.orig = null; // no longer just a cut-up copy of the old fraction
  render();
}

function setPieces(w, d) {
  // new pieces → put any cut circles back and start the puzzle again
  SIDES.forEach((x) => { if (state[x].orig) Object.assign(state[x], state[x].orig, { orig: null }); });
  const s = state[w];
  s.d = d;
  s.n = Math.min(s.n, d);
  resetTry();
  render();
}

function bindStepper(w, which) {
  const input = which === 'n' ? side[w].num : side[w].den;
  const box = input.parentElement;
  const set = (v) => {
    const s = state[w];
    if (which === 'n') {
      if (v < 0 || v > s.d) { shake(box); v = clamp(v, 0, s.d); }
      setShaded(w, v);
    } else {
      if (v < 1 || v > MAX_START_DEN) { shake(box); v = clamp(v, 1, MAX_START_DEN); }
      if (v !== s.d) setPieces(w, v);
    }
    render();
  };
  // after cutting, the +/− on the bottom number carry on from the original pieces
  const cur = () => (which === 'n' ? state[w].n : (state[w].orig || state[w]).d);
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

/** tap a slice to shade up to it; tap the last shaded slice again to un-shade it */
function tapSlice(w, x, y) {
  const r = side[w].circle.svg.getBoundingClientRect();
  const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
  if (Math.hypot(dx, dy) > r.width * 0.45) return; // missed the circle
  const turn = (Math.atan2(dx, -dy) / (Math.PI * 2) + 1) % 1; // 0 at 12 o'clock, clockwise
  const { n, d } = state[w];
  const i = Math.min(d - 1, Math.floor(turn * d));
  setShaded(w, n === i + 1 ? i : i + 1);
}

/* ---------------------------------------------------------
   Drag & drop – pointer events so it works with fingers too.
   Only a drag puts a circle in the overlap zone; a tap shades.
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
      document.body.classList.add('is-dragging'); // stop the drag selecting text on the page
      getSelection().removeAllRanges();
    }
    drag.ghost.el.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
    highlight(targetAt(e.clientX, e.clientY, w));
  });
  const end = (e, cancelled) => {
    if (!drag) return;
    const { ghost, x0, y0 } = drag;
    drag = null;
    highlight(null);
    document.body.classList.remove('is-dragging');
    if (!ghost) { // a tap, not a drag
      if (!cancelled) tapSlice(w, x0, y0);
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
}
SIDES.forEach(bindDrag);

/* ---------------------------------------------------------
   "How can we make them match?" – numbers to try
   --------------------------------------------------------- */
/** a few sensible guesses, including the tempting wrong ones (the bigger number, adding them) */
function tryOptions(A, B) {
  const L = lcm(A.d, B.d);
  const opts = new Set([Math.max(A.d, B.d), A.d + B.d, A.d * B.d, L, 2 * L]);
  return [...opts].filter((n) => n >= 2 && n <= MAX_TRY).sort((x, y) => x - y);
}
const works = (N, A, B) => N % A.d === 0 && N % B.d === 0;

/** why trying N pieces does or doesn't work, in kid-sized words */
function tryExplain(N, A, B) {
  const L = lcm(A.d, B.d);
  const okFor = (d) => N % d === 0;
  const why = (d) => (N === d
    ? `the ${denName(d)} circle already has ${N} pieces`
    : `${N} is in the ${d} times table (${d} × ${N / d} = ${N})`);

  if (works(N, A, B)) {
    return {
      kind: 'mul',
      html: N === L
        ? `✅ <strong>Yes!</strong> ${cap(why(A.d))}, and ${why(B.d)}. So every line lands on a dotted line — and <strong>${N}</strong> is the smallest number that works!`
        : `✅ <strong>That works too!</strong> ${cap(why(A.d))}, and ${why(B.d)}, so every line lands on a dotted line. But the pieces are tiny — can you find a <strong>smaller</strong> number that works?`,
    };
  }
  const bad = [A.d, B.d].filter((d) => !okFor(d));
  const good = [A.d, B.d].filter(okFor);
  let html = '❌ <strong>Not quite.</strong> ';
  if (N === A.d + B.d) html += `Adding the bottom numbers (${A.d} + ${B.d}) doesn’t work. `;
  html += bad.length === 2
    ? `${N} isn’t in the ${A.d} or the ${B.d} times table, so lines from <strong>both</strong> circles land in the middle of a piece (the red lines).`
    : `${N} isn’t in the ${bad[0]} times table, so some ${denName(bad[0])} lines land in the middle of a piece (the red lines).`;
  if (good.length === 1) html += ` It works for the ${denName(good[0])}, though!`;
  return { kind: 'warn', html };
}

function cutInto(N) {
  SIDES.forEach((w) => {
    const s = state[w];
    if (N === s.d) return;
    s.orig = s.orig || { n: s.n, d: s.d };
    s.n *= N / s.d;
    s.d = N;
  });
  resetTry();
  render();
}

/* ---------- buttons ---------- */
els.convert.addEventListener('click', () => {
  if (!state.showHow) { state.showHow = true; render(); return; }
  if (state.tryN && works(state.tryN, state.a, state.b)) cutInto(state.tryN);
});
els.undo.addEventListener('click', () => {
  SIDES.forEach((w) => { const s = state[w]; if (s.orig) Object.assign(s, s.orig, { orig: null }); });
  resetTry();
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
    state.a = { n: an, d: ad, orig: null };
    state.b = { n: bn, d: bd, orig: null };
    resetTry();
    render();
  });
  $('#presets').appendChild(b);
});

/* ---------------------------------------------------------
   Render
   --------------------------------------------------------- */
function render({ animate = true } = {}) {
  const A = state.a, B = state.b;

  SIDES.forEach((w) => {
    const s = state[w], S = side[w];
    const pos = state.stage.indexOf(w);
    S.num.value = s.n;
    S.den.value = s.d;
    S.num.max = s.d;

    S.circle.setFraction(s.n, s.d, { animate });

    S.layer.setFraction(s.n, s.d, { animate });
    S.layer.svg.classList.toggle('in', pos >= 0);
    S.layer.svg.classList.toggle('bottom', pos === 0);
    S.layer.svg.classList.toggle('top', pos === 1);
    S.src.classList.toggle('placed', pos >= 0);

    S.note.innerHTML = s.orig
      ? `✂️ Cut into ${denName(s.d)}: ${fracHTML(s.orig, `small ${w}`)} = ${fracHTML(s, `small ${w}`)}`
      : '';
  });

  renderStage(A, B);
}

function renderStage(A, B) {
  const both = state.stage.length === 2;
  const same = A.d === B.d;
  const L = lcm(A.d, B.d);
  const fits = !same && L === Math.max(A.d, B.d);
  const puzzle = both && !same; // the lines don't all match yet

  els.zone.classList.toggle('empty', !state.stage.length);
  els.zone.classList.toggle('full', both);
  els.hint.textContent = !state.stage.length ? 'Drag circle A or B in here'
    : both ? '' : `Now drag circle ${LETTER[other(state.stage[0])]} on top!`;
  els.legend.innerHTML = state.stage
    .map((w, i) => `<span class="key ${w} ${i ? 'see-through' : 'solid'}"><i></i>${LETTER[w]} ${fracHTML(state[w], `small ${w}`)}</span>`)
    .join('');

  const sym = both && same ? (A.n > B.n ? '>' : A.n < B.n ? '<' : '=') : '?';
  els.eq.innerHTML = `${fracHTML(A, 'a')}<span class="cmp-sym ${sym === '?' ? 'unknown' : ''}">${sym}</span>${fracHTML(B, 'b')}`;

  renderMatch(A, B, both, same);

  // explanation
  let html, kind = '';
  if (same) {
    const d = A.d;
    if (!both) {
      html = `Both circles are cut into <strong>${denName(d)}</strong>, so all the pieces are the same size. Drag them together and count!`;
    } else if (A.n === B.n) {
      const oa = A.orig || A, ob = B.orig || B;
      const baseDiffers = oa.n !== ob.n || oa.d !== ob.d;
      html = `🎉 <strong>Exactly the same amount!</strong> Every line matches and both have <b>${A.n}</b> ${denName(d, A.n !== 1)} shaded` +
        (baseDiffers ? ` — so ${fracHTML(oa, 'small a')} = ${fracHTML(ob, 'small b')}` : '') + '.';
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
  } else if (state.tryN) {
    ({ html, kind } = tryExplain(state.tryN, A, B));
  } else {
    const g = gcd(A.d, B.d);
    html = fits
      ? `✨ Look at the gold lines: every line on the <strong>${denName(Math.min(A.d, B.d))}</strong> circle lands exactly on a line of the <strong>${denName(L)}</strong> circle! But the pieces are different sizes, so we can’t count them yet…`
      : `🤔 The lines don’t line up! ${cap(denName(A.d))} and ${denName(B.d)} are different-sized pieces, so we can’t compare them by counting.` +
        (g > 1 ? ' Only the gold lines match.' : '');
    if (state.showHow) html += ` <strong>How many pieces could we cut both circles into so that every line matches?</strong> Pick a number to try it!`;
    kind = fits ? '' : 'div';
  }
  els.explain.className = `explain ${kind}`;
  els.explain.innerHTML = html;

  // numbers to try
  els.tryPanel.hidden = !(puzzle && state.showHow);
  if (!els.tryPanel.hidden) {
    els.tryChips.innerHTML = '';
    tryOptions(A, B).forEach((N) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.tryN === N));
      b.setAttribute('aria-label', `Try cutting both circles into ${N} pieces`);
      const tried = state.tried[N];
      b.innerHTML = `${N}${tried === undefined ? '' : `<span class="mark ${tried ? 'good' : 'bad'}">${tried ? '✓' : '✗'}</span>`}`;
      b.addEventListener('click', () => {
        state.tryN = N;
        state.tried[N] = works(N, A, B);
        render();
      });
      els.tryChips.appendChild(b);
    });
  }

  // main button: first "how?", then "cut" once they've found a number that works
  const btn = (icon, text, small) => `<span class="op-sym">${icon}</span><span class="op-text">${text}<small>${small}</small></span>`;
  const canCut = state.tryN && works(state.tryN, A, B);
  if (!state.showHow) {
    els.convert.innerHTML = btn('🔍', 'How can we make them match?', 'show me');
  } else if (canCut) {
    const N = state.tryN;
    const needCut = SIDES.filter((w) => state[w].d !== N);
    els.convert.innerHTML = needCut.length === 1
      ? btn('✂️', `Cut the ${denName(state[needCut[0]].d)}`, `into ${denName(N)}`)
      : btn('✂️', 'Cut both', `into ${denName(N)}`);
  }
  els.convert.hidden = !puzzle || (state.showHow && !canCut);
  els.undo.hidden = !A.orig && !B.orig;
  els.clear.hidden = !state.stage.length;
}

/** gold lines where both circles have a cut, dotted lines + red misfits for the number being tried,
    and a glowing wedge for the difference once the pieces match */
let matchKey = '';
function renderMatch(A, B, both, same) {
  const g = gcd(A.d, B.d);
  const wedge = both && same && A.n !== B.n ? [Math.min(A.n, B.n) / A.d, Math.max(A.n, B.n) / A.d] : null;
  const N = both && !same ? state.tryN : null;
  const key = `${both}|${A.d}|${B.d}|${wedge}|${N}`;
  if (key === matchKey) return;
  matchKey = key;

  const geo = side.a.layer; // same geometry as every stage circle
  const line = (frac, cls) => {
    const [x, y] = geo.pt(frac);
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', `M${geo.cx} ${geo.cy} L${x.toFixed(2)} ${y.toFixed(2)}`);
    p.classList.add(cls);
    els.match.appendChild(p);
    return p;
  };
  els.match.innerHTML = '';
  if (!both) return;

  if (N) {
    // dotted lines: where cutting into N pieces would add new cuts
    for (let i = 0; i < N; i++) {
      if ((i * A.d) % N === 0 || (i * B.d) % N === 0) continue; // already a real cut on one of the circles
      line(i / N, 'how-line').style.animationDelay = `${i * Math.min(25, 600 / N)}ms`;
    }
  }

  if (wedge) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', geo.wedgePath(...wedge));
    p.classList.add('diff-wedge');
    els.match.appendChild(p);
  }

  if (g >= 2) {
    const w = g > 24 ? 1.3 : g > 12 ? 2 : 3.2;
    const stagger = Math.min(60, 700 / g);
    for (let i = 0; i < g; i++) {
      ['match-under', 'match-line'].forEach((cls) => {
        const p = line(i / g, cls);
        p.setAttribute('pathLength', '1');
        p.style.strokeWidth = cls === 'match-line' ? w : w + 2.4;
        setTimeout(() => { p.style.strokeDashoffset = '0'; }, 650 + i * stagger);
      });
    }
  }

  if (N) {
    // red: real cuts that don't land on any of the N pieces' lines
    [A.d, B.d].forEach((d) => {
      for (let j = 1; j < d; j++) if ((j * N) % d !== 0) line(j / d, 'miss-line');
    });
  }
}

/* ---------- go! ---------- */
render({ animate: false });
