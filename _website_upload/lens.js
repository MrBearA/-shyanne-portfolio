// Whole-page fish-eye lens.
// The page scrolls inside #lens (a fixed, screen-sized box) and an SVG displacement filter bends
// that box like a curved CRT / fish-eye glass. Clicks are re-aimed to what you see under the pointer.
(function () {
  const root = document.documentElement;
  const lens = document.getElementById('lens');
  const toggle = document.getElementById('lens-toggle');
  const img = document.getElementById('lens-map');
  const disp = document.getElementById('lens-disp');
  const filt = document.getElementById('fisheye-page');
  if (!lens || !toggle || !img || !disp || !filt) return;

  const K = 0.16;            // bulge strength
  const MAP_SCALE = 0.5;     // the map is drawn at half size and stretched
  const STORE = 'sc-lens';

  // Safari draws SVG filters on HTML badly, so the lens is not offered there.
  const ua = navigator.userAgent;
  const isSafari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS/.test(ua);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (isSafari) { toggle.hidden = true; return; }

  let W = 0, H = 0, S = 1;

  // Where on the (unbent) page the pixel at screen point (x, y) comes from.
  function source(x, y) {
    const px = (x / W) * 2 - 1, py = (y / H) * 2 - 1;
    const f = (1 + K * (px * px + py * py)) / (1 + K);
    return [((px * f) + 1) / 2 * W, ((py * f) + 1) / 2 * H];
  }

  function buildMap() {
    W = lens.clientWidth; H = lens.clientHeight;
    if (!W || !H) return;
    const mw = Math.max(2, Math.round(W * MAP_SCALE)), mh = Math.max(2, Math.round(H * MAP_SCALE));
    // Largest shift happens at the corners.
    const c = source(W, H);
    S = 2 * Math.max(Math.abs(c[0] - W), Math.abs(c[1] - H)) + 2;
    const cv = document.createElement('canvas');
    cv.width = mw; cv.height = mh;
    const ctx = cv.getContext('2d');
    const data = ctx.createImageData(mw, mh);
    const d = data.data;
    for (let j = 0; j < mh; j++) {
      const y = (j + 0.5) / mh * H;
      for (let i = 0; i < mw; i++) {
        const x = (i + 0.5) / mw * W;
        const s = source(x, y);
        const o = (j * mw + i) * 4;
        d[o] = Math.round((0.5 + (s[0] - x) / S) * 255);
        d[o + 1] = Math.round((0.5 + (s[1] - y) / S) * 255);
        d[o + 2] = 128;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(data, 0, 0);
    const url = cv.toDataURL('image/png');
    img.setAttribute('href', url);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
    for (const el of [filt, img]) { el.setAttribute('width', W); el.setAttribute('height', H); }
    disp.setAttribute('scale', S.toFixed(2));
  }

  function setOn(on, save) {
    const was = root.classList.contains('lens-on');
    if (on === was) { if (on) buildMap(); return; }
    // Carry the scroll position between the window and the lens box.
    const y = was ? lens.scrollTop : window.scrollY;
    root.classList.toggle('lens-on', on);
    if (on) { buildMap(); lens.scrollTop = y; } else { window.scrollTo(0, y); }
    toggle.setAttribute('aria-pressed', String(on));
    toggle.setAttribute('aria-checked', String(on));
    toggle.querySelector('.lt-state').textContent = on ? 'ON' : 'OFF';
    if (save) { try { localStorage.setItem(STORE, on ? '1' : '0'); } catch (e) {} }
    window.dispatchEvent(new CustomEvent('pagelens', { detail: { on } }));
  }

  let saved = null;
  try { saved = localStorage.getItem(STORE); } catch (e) {}
  const startOn = saved === null ? (window.innerWidth >= 700 && !reduce) : saved === '1';
  setOn(startOn, false);
  toggle.addEventListener('click', () => setOn(!root.classList.contains('lens-on'), true));

  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (root.classList.contains('lens-on')) buildMap(); }, 120);
  });

  // Re-aim clicks: the pointer is over a bent image, so find what is really shown there.
  const HIT = 'a[href],button,label,input,select,textarea,summary,[tabindex]:not([tabindex="-1"]),[role="button"]';
  let replaying = false;
  lens.addEventListener('click', (e) => {
    if (replaying || !root.classList.contains('lens-on')) return;
    if (e.detail === 0) return; // keyboard "click": no pointer, nothing to re-aim
    const r = lens.getBoundingClientRect();
    const [sx, sy] = source(e.clientX - r.left, e.clientY - r.top);
    const under = document.elementFromPoint(sx + r.left, sy + r.top);
    if (!under || under === e.target) return;
    const want = under.closest(HIT);
    const got = e.target.closest ? e.target.closest(HIT) : null;
    if (want === got) return;
    // Dragging in the 3D viewer is not a click on anything else.
    if (!want && !got) return;
    e.preventDefault();
    e.stopPropagation();
    if (!want) return; // looked like empty space: don't click the hidden thing under the pointer
    replaying = true;
    try {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(want.tagName) && want.type !== 'checkbox' && want.type !== 'radio' && want.type !== 'button') want.focus();
      else want.click();
    } finally { replaying = false; }
  }, true);
})();
