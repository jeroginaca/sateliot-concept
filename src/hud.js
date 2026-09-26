// Persistent telemetry panel. Chapters describe rows as data; the HUD owns the DOM.
//
//   hud.show('pass', [{ id: 'elev', label: 'hud.elev' }, ...])
//   hud.set('elev', '42.1°', 'ok')
//   hud.bars(3)
//
// Labels are i18n keys. Values are either plain strings or { key } for translated values.
import { i18n } from './i18n.js';

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-head">
        <span class="hud-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span class="hud-title" data-i18n="hud.title">${i18n.t('hud.title')}</span>
        <span class="hud-chapter mono"></span>
      </div>
      <dl class="hud-rows"></dl>`;
    this.rowsEl = root.querySelector('.hud-rows');
    this.chapterEl = root.querySelector('.hud-chapter');
    this.barEls = [...root.querySelectorAll('.hud-bars i')];
    this.rows = new Map();
    this.mode = null;
    this.currentBars = -1;
    i18n.onChange(() => this.relabel());
  }

  show(mode, rows, chapterLabel = '') {
    if (mode === this.mode) return;
    this.mode = mode;
    this.chapterEl.textContent = chapterLabel;
    this.rows.clear();
    this.rowsEl.textContent = '';
    for (const r of rows) {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.dataset.label = r.label;
      dt.textContent = i18n.t(r.label);
      this.rowsEl.append(dt, dd);
      const row = { dt, dd, value: null, tone: null };
      this.rows.set(r.id, row);
      if (r.value !== undefined) this.set(r.id, r.value, r.tone);
    }
    this.root.classList.remove('swap');
    void this.root.offsetWidth; // restart the swap animation
    this.root.classList.add('swap');
  }

  set(id, value, tone = '') {
    const row = this.rows.get(id);
    if (!row) return;
    const text = typeof value === 'object' && value ? i18n.t(value.key) : String(value);
    if (row.text !== text) {
      row.dd.textContent = text;
      row.text = text;
    }
    row.value = value;
    if (row.tone !== tone) {
      row.dd.className = tone ? `tone-${tone}` : '';
      row.tone = tone;
    }
  }

  bars(n) {
    n = Math.max(0, Math.min(4, Math.round(n)));
    if (n === this.currentBars) return;
    this.currentBars = n;
    this.barEls.forEach((el, i) => el.classList.toggle('on', i < n));
  }

  relabel() {
    this.rowsEl.querySelectorAll('dt').forEach((dt) => { dt.textContent = i18n.t(dt.dataset.label); });
    for (const [id, row] of this.rows) {
      if (row.value == null) continue;
      row.text = null;
      this.set(id, row.value, row.tone);
    }
  }
}
