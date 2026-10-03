/* =========================================================
   Fraction Explorer – logic
   ========================================================= */
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_START_DEN = 24;   // biggest denominator children can type in
const MAX_DEN = 120;        // biggest denominator after multiplying (slices get too thin beyond this)
const FACTORS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

const $ = (sel) => document.querySelector(sel);
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
let uid = 0;

/* ---------------------------------------------------------
   FractionCircle – draws a circle cut into d equal slices
   with n of them shaded. The shaded region is drawn as one
   wedge, and the cut lines are drawn on top. That means when
   we multiply/divide, the shading never moves – only the cut
   lines appear or disappear. That's the key visual idea!
   --------------------------------------------------------- */
class FractionCircle {
  constructor(svg, { interactive = false, onSliceClick = null, mini = false } = {}) {
    this.svg = svg;
    this.id = `fc${uid++}`;
    this.mini = mini;
    this.interactive = interactive;
    this.onSliceClick = onSliceClick;
    this.cx = 100; this.cy = 100; this.r = mini ? 94 : 90;
    this.value = 0; this.n = 0; this.d = 1;
    this.lines = new Map(); // key (reduced angle "a/b") -> <path>

    svg.setAttribute('viewBox', '0 0 200 200');
    svg.classList.add('fraction-circle');
    if (mini) svg.classList.add('mini');
    svg.innerHTML = `
      <defs>
        <radialGradient id="${this.id}-plate" cx="40%" cy="35%" r="75%">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#e4ddff"/>
        </radialGradient>
        <linearGradient id="${this.id}-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffa25b"/>
          <stop offset="55%" stop-color="#ff7a59"/>
          <stop offset="100%" stop-color="#ff4f8b"/>
        </linearGradient>
      </defs>
      ${mini ? '' : `<circle class="plate-shadow" cx="${this.cx}" cy="${this.cy + 8}" r="${this.r}"/>`}
      <circle class="plate" cx="${this.cx}" cy="${this.cy}" r="${this.r}" fill="url(#${this.id}-plate)"/>
      <path class="shade" fill="url(#${this.id}-fill)"/>
      <g class="lines"></g>
      <circle class="rim" cx="${this.cx}" cy="${this.cy}" r="${this.r}"/>
      <g class="hits"></g>
      <circle class="hub" cx="${this.cx}" cy="${this.cy}" r="${mini ? 5 : 3.2}"/>`;
    this.shadeEl = svg.querySelector('.shade');
    this.linesG = svg.querySelector('.lines');
    this.hitsG = svg.querySelector('.hits');
    if (mini) svg.querySelector('.rim').style.strokeWidth = 8;
  }

  /** point on the rim for a fraction of a full turn (0 = 12 o'clock, clockwise) */
  pt(frac) {
    const a = frac * Math.PI * 2 - Math.PI / 2;
    return [this.cx + this.r * Math.cos(a), this.cy + this.r * Math.sin(a)];
  }

  wedgePath(a0, a1) {
    const { cx, cy, r } = this;
    if (a1 - a0 >= 0.99999) {
      return `M${cx} ${cy - r} A${r} ${r} 0 1 1 ${cx} ${cy + r} A${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
    }
    const [x0, y0] = this.pt(a0);
    const [x1, y1] = this.pt(a1);
    const large = a1 - a0 > 0.5 ? 1 : 0;
    return `M${cx} ${cy} L${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
  }

  drawShade(v) {
    this.shadeEl.setAttribute('d', v <= 0.00001 ? '' : this.wedgePath(0, Math.min(v, 1)));
  }

  animateValue(target, dur = 650) {
    cancelAnimationFrame(this.raf);
    const from = this.value;
    if (Math.abs(from - target) < 1e-9) { this.value = target; this.drawShade(target); return; }
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      this.value = from + (target - from) * e;
      this.drawShade(this.value);
      if (p < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** all cut positions for d slices, keyed by their reduced angle so 1/2 == 2/4 == 3/6 */
  lineKeys(d) {
    if (d < 2) return [];
    const out = [];
    for (let i = 0; i < d; i++) {
      const g = gcd(i, d);
      out.push({ key: `${i / g}/${d / g}`, frac: i / d });
    }
    return out;
  }

  updateLines(d, animate) {
    const next = this.lineKeys(d);
    const nextKeys = new Set(next.map((k) => k.key));
    const removed = [...this.lines.keys()].filter((k) => !nextKeys.has(k));
    const added = next.filter((k) => !this.lines.has(k.key));

    // cuts that disappear (pieces being joined) – glow gold, then retract into the centre
    const rStagger = Math.min(45, 700 / Math.max(1, removed.length));
    removed.forEach((key, i) => {
      const el = this.lines.get(key);
      this.lines.delete(key);
      if (!animate) { el.remove(); return; }
      const delay = 350 + i * rStagger;
      el.classList.add('leaving');
      setTimeout(() => { el.style.strokeDashoffset = '1'; el.style.opacity = '0'; }, delay);
      setTimeout(() => el.remove(), delay + 650);
    });

    // new cuts (pieces being split) – grow from the centre outwards, highlighted in white
    const aStagger = Math.min(45, 700 / Math.max(1, added.length));
    added.forEach((k, i) => {
      const el = document.createElementNS(SVG_NS, 'path');
      const [x, y] = this.pt(k.frac);
      el.setAttribute('d', `M${this.cx} ${this.cy} L${x.toFixed(3)} ${y.toFixed(3)}`);
      el.setAttribute('pathLength', '1');
      el.classList.add('cut');
      this.lines.set(k.key, el);
      if (!animate) { this.linesG.appendChild(el); return; }
      const delay = i * aStagger;
      el.classList.add('new');
      el.style.strokeDashoffset = '1';
      this.linesG.appendChild(el);
      setTimeout(() => { el.style.strokeDashoffset = '0'; }, 30 + delay);
      setTimeout(() => el.classList.remove('new'), 1500 + delay);
    });
  }

  buildHits(d) {
    this.hitsG.innerHTML = '';
    for (let i = 0; i < d; i++) {
      const el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', this.wedgePath(i / d, (i + 1) / d));
      el.classList.add('hit');
      el.addEventListener('click', () => this.onSliceClick && this.onSliceClick(i));
      this.hitsG.appendChild(el);
    }
  }

  setFraction(n, d, { animate = true, pop = false } = {}) {
    this.n = n; this.d = d;
    const w = d > 60 ? 0.7 : d > 36 ? 1 : d > 18 ? 1.4 : 2;
    this.svg.style.setProperty('--cut-w', this.mini ? w * 2.6 : w);
    this.updateLines(d, animate);
    if (animate) this.animateValue(n / d);
    else { this.value = n / d; this.drawShade(this.value); }
    if (this.interactive) this.buildHits(d);
    this.svg.setAttribute('aria-label', `A circle cut into ${d} equal pieces with ${n} shaded`);
    if (pop) {
      this.svg.classList.remove('pop');
      void this.svg.getBoundingClientRect();
      this.svg.classList.add('pop');
    }
  }
}

/* ---------------------------------------------------------
   App state & UI
   --------------------------------------------------------- */
const state = {
  start: { n: 3, d: 4 },
  current: { n: 3, d: 4 },
  factor: 2,
  lastOp: null,           // { type: 'mul' | 'div', k, prev: {n,d} }
  history: [],            // [{ n, d, op }]
};

const els = {
  num: $('#numerator'), den: $('#denominator'),
  chips: $('#factor-chips'),
  mulBtn: $('#multiply-btn'), divBtn: $('#divide-btn'),
  divHint: $('#divide-hint'),
  equation: $('#equation'),
  shaded: $('#stat-shaded'), total: $('#stat-total'),
  explain: $('#explain'),
  trail: $('#trail'),
};

const startCircle = new FractionCircle($('#start-circle'), {
  interactive: true,
  onSliceClick: (i) => {
    // tap a slice to shade up to it; tap the last shaded slice again to un-shade it
    const n = state.start.n === i + 1 ? i : i + 1;
    setStart(n, state.start.d);
  },
});
const currentCircle = new FractionCircle($('#current-circle'));
new FractionCircle($('#logo-circle'), { mini: true }).setFraction(3, 4, { animate: false });

const fracHTML = (n, d, cls = '') => `<span class="frac ${cls}"><span class="n">${n}</span><span class="d">${d}</span></span>`;

function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

function bump(el, text) {
  if (el.textContent === String(text)) return;
  el.textContent = text;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

/* ---------- step 1: starting fraction ---------- */
function setStart(n, d, { animate = true } = {}) {
  d = clamp(Math.round(d) || 1, 1, MAX_START_DEN);
  n = clamp(Math.round(n) || 0, 0, d);
  state.start = { n, d };
  state.current = { n, d };
  state.lastOp = null;
  state.history = [{ n, d, op: null }];
  els.num.value = n;
  els.den.value = d;
  els.num.max = d;
  startCircle.setFraction(n, d, { animate });
  currentCircle.setFraction(n, d, { animate });
  setExplain(defaultExplain(), '');
  render();
}

function defaultExplain() {
  const { n, d } = state.current;
  return `This circle is cut into <b class="d">${d}</b> equal piece${d === 1 ? '' : 's'} and <b class="n">${n}</b> ${n === 1 ? 'is' : 'are'} shaded. ` +
    `Pick a number, then press <strong>Multiply</strong> or <strong>Divide</strong>. Keep your eye on the orange part… does it change?`;
}

function bindStepper(input, minusBtn, plusBtn, which) {
  const apply = (delta) => {
    const { n, d } = state.start;
    if (which === 'n') {
      const nn = n + delta;
      if (nn < 0 || nn > d) { shake(input.parentElement); return; }
      setStart(nn, d);
    } else {
      const dd = d + delta;
      if (dd < 1 || dd > MAX_START_DEN) { shake(input.parentElement); return; }
      setStart(Math.min(n, dd), dd);
    }
  };
  minusBtn.addEventListener('click', () => apply(-1));
  plusBtn.addEventListener('click', () => apply(1));
  input.addEventListener('change', () => {
    const v = parseInt(input.value, 10);
    if (Number.isNaN(v)) { input.value = which === 'n' ? state.start.n : state.start.d; return; }
    if (which === 'n') {
      if (v > state.start.d) shake(input.parentElement);
      setStart(v, state.start.d);
    } else {
      if (v > MAX_START_DEN || v < 1) shake(input.parentElement);
      setStart(state.start.n, v);
    }
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('focus', () => input.select());
}
bindStepper(els.num, $('#num-minus'), $('#num-plus'), 'n');
bindStepper(els.den, $('#den-minus'), $('#den-plus'), 'd');

/* ---------- step 2: multiply / divide ---------- */
FACTORS.forEach((k) => {
  const b = document.createElement('button');
  b.className = 'chip';
  b.id = `factor-${k}`;
  b.setAttribute('role', 'radio');
  b.dataset.k = k;
  b.innerHTML = `${k}`;
  b.addEventListener('click', () => { state.factor = k; render(); });
  els.chips.appendChild(b);
});

const canDivide = ({ n, d }, k) => n % k === 0 && d % k === 0;

function applyChange(next, op) {
  state.current = next;
  state.lastOp = op;
  state.history.push({ ...next, op });
  currentCircle.setFraction(next.n, next.d, { pop: true });
  render(true);
}

function multiply() {
  const k = state.factor;
  const { n, d } = state.current;
  if (d * k > MAX_DEN) {
    shake(els.mulBtn);
    setExplain(`Whoa! That would make <b class="d">${d * k}</b> pieces — too tiny to see. Try dividing first, or pick a smaller number.`, 'warn');
    return;
  }
  applyChange({ n: n * k, d: d * k }, { type: 'mul', k, prev: { n, d } });
  setExplain(
    `✂️ Every piece was cut into <strong>${k}</strong> smaller pieces. ` +
    `So now there are ${k} times as many pieces (<b class="d">${d}</b> → <b class="d">${d * k}</b>) ` +
    `and ${k} times as many shaded pieces (<b class="n">${n}</b> → <b class="n">${n * k}</b>). ` +
    `The pieces got smaller, but the shaded part is <strong>exactly the same size</strong>!`, 'mul');
}

function divide(kOverride) {
  const k = kOverride || state.factor;
  const { n, d } = state.current;
  if (!canDivide(state.current, k)) {
    shake(els.divBtn);
    const why = [];
    if (n % k) why.push(`<b class="n">${n}</b> shaded piece${n === 1 ? '' : 's'}`);
    if (d % k) why.push(`<b class="d">${d}</b> piece${d === 1 ? '' : 's'}`);
    setExplain(`Hmm… we can't join ${why.join(' or ')} into equal groups of <strong>${k}</strong> — some would be left over. ` +
      (commonFactors().length ? `Try one of the numbers with a ÷ badge.` : `This fraction can't be divided any further — it's already as simple as it gets!`), 'warn');
    return;
  }
  applyChange({ n: n / k, d: d / k }, { type: 'div', k, prev: { n, d } });
  setExplain(
    `🧩 Every <strong>${k}</strong> pieces were joined together into 1 bigger piece. ` +
    `So now there are <b class="d">${d / k}</b> pieces instead of <b class="d">${d}</b>, ` +
    `and <b class="n">${n / k}</b> shaded instead of <b class="n">${n}</b>. ` +
    `Bigger pieces, fewer of them — but the shaded part is <strong>still exactly the same size</strong>!`, 'div');
}

function commonFactors() {
  const { n, d } = state.current;
  const out = [];
  for (let k = 2; k <= d; k++) if (canDivide(state.current, k)) out.push(k);
  return out;
}

els.mulBtn.addEventListener('click', multiply);
els.divBtn.addEventListener('click', () => divide());

$('#simplify-btn').addEventListener('click', () => {
  const { n, d } = state.current;
  const g = n === 0 ? d : gcd(n, d);
  if (g <= 1) {
    shake($('#simplify-btn'));
    setExplain(`${fracHTML(n, d, 'small')} is already in its <strong>simplest form</strong> — there's no number (bigger than 1) that goes into both <b class="n">${n}</b> and <b class="d">${d}</b>.`, '');
    return;
  }
  divide(g);
});

$('#reset-btn').addEventListener('click', () => {
  const { n, d } = state.start;
  setStart(n, d);
});

function setExplain(html, kind) {
  els.explain.className = `explain ${kind || ''}`;
  els.explain.innerHTML = html;
}

/* ---------- render ---------- */
function render(fresh = false) {
  const { n, d } = state.current;
  const factors = commonFactors();

  // factor chips
  els.chips.querySelectorAll('.chip').forEach((b) => {
    const k = +b.dataset.k;
    b.setAttribute('aria-checked', String(k === state.factor));
    b.innerHTML = `${k}${canDivide(state.current, k) ? '<span class="can-div" title="You can divide by this">÷</span>' : ''}`;
  });

  // button labels / availability
  const k = state.factor;
  els.mulBtn.querySelector('small').textContent = `cut each piece into ${k}`;
  els.divBtn.querySelector('small').textContent = `join pieces in groups of ${k}`;
  els.divBtn.classList.toggle('unavailable', !canDivide(state.current, k));
  els.mulBtn.classList.toggle('unavailable', d * k > MAX_DEN);

  els.divHint.innerHTML = factors.length
    ? `You can divide ${n}/${d} by: <strong>${factors.join(', ')}</strong>`
    : `${n}/${d} can't be divided — it's in <strong>simplest form</strong>.`;

  // equation
  const op = state.lastOp;
  if (op) {
    const sym = op.type === 'mul' ? '×' : '÷';
    els.equation.innerHTML =
      `${fracHTML(op.prev.n, op.prev.d)}
       <span class="eq-op ${op.type}"><span>${sym} ${op.k}</span><span>${sym} ${op.k}</span></span>
       <span class="eq-eq">=</span>
       ${fracHTML(n, d, fresh ? 'fresh' : '')}`;
  } else {
    els.equation.innerHTML = `${fracHTML(n, d)}<span class="prompt">Multiply or divide the top <em>and</em> the bottom by the same number…</span>`;
  }

  // stats
  bump(els.shaded, n);
  bump(els.total, d);

  renderTrail();
}

function renderTrail() {
  els.trail.innerHTML = '';
  state.history.forEach((h, i) => {
    if (h.op) {
      const sym = h.op.type === 'mul' ? '×' : '÷';
      const a = document.createElement('div');
      a.className = 'trail-arrow';
      a.innerHTML = `<span class="tag ${h.op.type}">${sym}${h.op.k}</span><span class="arr">→</span>`;
      els.trail.appendChild(a);
    }
    const item = document.createElement('div');
    item.className = `trail-item${i === state.history.length - 1 ? ' current' : ''}`;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('role', 'img');
    item.appendChild(svg);
    item.insertAdjacentHTML('beforeend', fracHTML(h.n, h.d, 'small'));
    els.trail.appendChild(item);
    new FractionCircle(svg, { mini: true }).setFraction(h.n, h.d, { animate: false });
  });
  els.trail.scrollLeft = els.trail.scrollWidth;
}

/* ---------- go! ---------- */
setStart(3, 4, { animate: false });
