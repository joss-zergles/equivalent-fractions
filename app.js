/* =========================================================
   Fraction Explorer – logic
   ========================================================= */
const MAX_START_DEN = 24;   // biggest denominator children can type in
const MAX_DEN = 120;        // biggest denominator after multiplying (slices get too thin beyond this)
const FACTORS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

const $ = (sel) => document.querySelector(sel);

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
  // after multiplying by k, number each old piece's new slices 1..k for a moment
  currentCircle.setFraction(next.n, next.d, { pop: true, group: op.type === 'mul' ? op.k : 0 });
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
    `✂️ Every piece was cut into <strong>${k}</strong> smaller pieces${d * k <= 60 ? ` — look at the numbers 1 to ${k} in each one` : ''}! ` +
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
