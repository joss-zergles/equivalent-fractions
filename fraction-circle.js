/* Shared FractionCircle component (used by index.html and compare.html) */
const SVG_NS = 'http://www.w3.org/2000/svg';
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
const CIRCLE_THEMES = {
  coral: ['#ffa25b', '#ff7a59', '#ff4f8b'],
  teal: ['#6ff0d2', '#19d3a2', '#0fa3c9'],
};

class FractionCircle {
  constructor(svg, { interactive = false, onSliceClick = null, mini = false, theme = 'coral' } = {}) {
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
          <stop offset="0%" stop-color="${CIRCLE_THEMES[theme][0]}"/>
          <stop offset="55%" stop-color="${CIRCLE_THEMES[theme][1]}"/>
          <stop offset="100%" stop-color="${CIRCLE_THEMES[theme][2]}"/>
        </linearGradient>
      </defs>
      ${mini ? '' : `<circle class="plate-shadow" cx="${this.cx}" cy="${this.cy + 8}" r="${this.r}"/>`}
      <circle class="plate" cx="${this.cx}" cy="${this.cy}" r="${this.r}" fill="url(#${this.id}-plate)"/>
      <path class="shade" fill="url(#${this.id}-fill)"/>
      <g class="lines"></g>
      <g class="labels"></g>
      <circle class="rim" cx="${this.cx}" cy="${this.cy}" r="${this.r}"/>
      <g class="hits"></g>
      <circle class="hub" cx="${this.cx}" cy="${this.cy}" r="${mini ? 5 : 3.2}"/>`;
    this.shadeEl = svg.querySelector('.shade');
    this.linesG = svg.querySelector('.lines');
    this.labelsG = svg.querySelector('.labels');
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

  /** small numbers 1..d in the middle of each slice (skipped on mini circles / when too thin) */
  updateLabels(n, d, animate) {
    const old = [...this.labelsG.children];
    const sameLayout = old.length === d && this.labelD === d;
    this.labelD = d;

    // same pieces, only the shading changed: just recolour
    if (sameLayout) {
      old.forEach((t, i) => t.classList.toggle('on', i < n));
      return;
    }

    old.forEach((t) => {
      if (!animate) { t.remove(); return; }
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 400);
    });

    if (this.mini || d > 60) return;

    const rr = d === 1 ? 0 : d <= 6 ? 0.6 : d <= 16 ? 0.7 : 0.8;
    const rho = this.r * rr;
    const arc = d === 1 ? 60 : (2 * Math.PI * rho) / d;
    const size = Math.max(4.5, Math.min(22, arc * 0.55));
    const delay0 = animate ? 650 : 0;
    const stagger = Math.min(35, 500 / d);

    for (let i = 0; i < d; i++) {
      const mid = (i + 0.5) / d * Math.PI * 2 - Math.PI / 2;
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', (this.cx + rho * Math.cos(mid)).toFixed(2));
      t.setAttribute('y', (this.cy + rho * Math.sin(mid)).toFixed(2));
      t.setAttribute('font-size', size.toFixed(2));
      t.classList.add('seg-label');
      if (i < n) t.classList.add('on');
      t.textContent = i + 1;
      if (animate) {
        t.style.opacity = '0';
        setTimeout(() => { t.style.opacity = '1'; }, delay0 + i * stagger);
      }
      this.labelsG.appendChild(t);
    }
  }

  setFraction(n, d, { animate = true, pop = false } = {}) {
    this.n = n; this.d = d;
    const w = d > 60 ? 0.7 : d > 36 ? 1 : d > 18 ? 1.4 : 2;
    this.svg.style.setProperty('--cut-w', this.mini ? w * 2.6 : w);
    this.updateLines(d, animate);
    this.updateLabels(n, d, animate);
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

