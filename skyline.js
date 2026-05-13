/* CAO Partners — CTA Skyline Animation
 * Buildings spawn from the bottom, constructed out of blue pulse nodes
 * connected by edges. Each building loops on its own timeline.
 */
(function () {
  'use strict';

  const canvas = document.querySelector('.cta-skyline');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;
  let buildings = [];
  let pulses = [];
  let running = true;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function makeBuilding(centerX, depth, delayStart, sizeHint) {
    sizeHint = sizeHint || {};
    const widthBase  = sizeHint.widthBase  != null ? sizeHint.widthBase  : (80 + Math.random() * 120);
    const heightBase = sizeHint.heightBase != null ? sizeHint.heightBase : (140 + Math.random() * 260);
    const w = widthBase * (1 - depth * 0.30);
    const h = heightBase * (1 - depth * 0.35);
    const opacity = 1 - depth * 0.45;

    const cols = Math.max(2, Math.round(w / 18));
    const rows = Math.max(4, Math.round(h / 20));
    const nodes = [];

    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const onEdge = i === 0 || i === cols || j === 0 || j === rows;
        const isCorner = (i === 0 || i === cols) && (j === 0 || j === rows);
        const isFloorLine = j > 0 && j < rows && (j % 2 === 0) && (i % 2 === 0);
        if (onEdge || isFloorLine || Math.random() < 0.06) {
          nodes.push({
            lx: (i / cols) * w,
            ly: (j / rows) * h,
            delay: 1 - (j / rows) + (Math.random() - 0.5) * 0.08,
            corner: isCorner,
            edge: onEdge,
          });
        }
      }
    }

    const edges = [];
    const maxLink = Math.max(w / cols, h / rows) * 1.55;
    for (let a = 0; a < nodes.length; a++) {
      const candidates = [];
      for (let b = 0; b < nodes.length; b++) {
        if (a === b) continue;
        const d = Math.hypot(nodes[a].lx - nodes[b].lx, nodes[a].ly - nodes[b].ly);
        if (d < maxLink) candidates.push({ b, d });
      }
      candidates.sort((p, q) => p.d - q.d);
      candidates.slice(0, 4).forEach((c) => {
        if (c.b > a) edges.push({ a, b: c.b, d: c.d });
      });
    }

    return {
      cx: centerX,
      baselineDrop: depth * 0.10,
      w, h, depth, opacity,
      nodes, edges,
      t: 0,
      delayStart,
      tBuild: 3.5 + Math.random() * 1.2,
      tHold:  3.0 + Math.random() * 2.0,
      tFade:  1.5 + Math.random() * 0.6,
      tGap:   0.6 + Math.random() * 1.0,
      nextPulse: 0,
    };
  }

  function spawn() {
    buildings = [];
    pulses = [];
    const count = Math.max(9, Math.floor(W / 110));

    // Spawn the crane support + cranes FIRST so we can size the left edge
    // tower relative to the left crane's height.
    let leftCrane = null;
    if (W > 700) {
      const leftSupport  = makeBuilding(W * 0.18, 0.10, 0.2, { widthBase: 95 + Math.random() * 30, heightBase: 170 + Math.random() * 70 });
      const rightSupport = makeBuilding(W * 0.82, 0.10, 0.4, { widthBase: 95 + Math.random() * 30, heightBase: 170 + Math.random() * 70 });
      buildings.push(leftSupport, rightSupport);
      leftCrane = makeCraneOnTop(leftSupport, 'left');
      const rightCrane = makeCraneOnTop(rightSupport, 'right');
      buildings.push(leftCrane, rightCrane);
    }

    const leftCraneTopY = leftCrane
      ? (H - leftCrane.anchor.h - leftCrane.anchor.baselineDrop * H * 0.05) - leftCrane.h + 4
      : null;

    for (let i = 0; i < count; i++) {
      const depth = Math.random() < 0.5 ? Math.random() * 0.35 : 0.35 + Math.random() * 0.55;
      const slot = (i + 0.5) / count;
      const jitter = (Math.random() - 0.5) * (W / count) * 0.55;
      const cx = slot * W + jitter;
      // First few buildings start nearly immediately so motion is visible at once.
      const delay = i < 3 ? Math.random() * 0.4 : Math.random() * 5.0;
      // Anchor the skyline with tall edge towers. Rightmost reaches near the
      // canvas top; leftmost sits just a touch above the left crane.
      const isLeftEdge = i === 0;
      const isRightEdge = i === count - 1;
      let sizeHint;
      let edgeDepth = depth;
      if (isRightEdge) {
        edgeDepth = 0.04;
        const mult = 1 - edgeDepth * 0.35;
        sizeHint = { widthBase: 130 + Math.random() * 25, heightBase: Math.max(380, (H - 10) / mult) };
      } else if (isLeftEdge) {
        edgeDepth = 0.06;
        const mult = 1 - edgeDepth * 0.35;
        // Target top ~20px above the left crane top; fall back to a static
        // tall value if there's no crane (narrow viewport).
        const targetTopY = leftCraneTopY != null
          ? Math.max(8, leftCraneTopY - 22)
          : 80;
        const targetH = Math.max(280, H - targetTopY);
        sizeHint = { widthBase: 115 + Math.random() * 25, heightBase: targetH / mult };
      }
      buildings.push(makeBuilding(cx, edgeDepth, delay, sizeHint));
    }
    buildings.sort((a, b) => b.depth - a.depth);
  }

  function makeCraneOnTop(anchor, side) {
    // Compute how much vertical room is left above the support so the
    // crane top stays inside the canvas.
    const anchorTopY = H - anchor.h - anchor.baselineDrop * H * 0.05;
    const desiredTotalH = 220 + Math.random() * 50;
    const maxTotalH = Math.max(140, anchorTopY - 12);
    const totalH = Math.min(desiredTotalH, maxTotalH);
    const mastH = Math.max(110, totalH - 24); // 24 ≈ cabinH + padTop + 6
    const crane = makeCrane(anchor.cx, Math.max(0, anchor.depth - 0.05), 0, side, { mastH });
    crane.anchor = anchor;
    crane.delayStart = anchor.delayStart + anchor.tBuild;
    crane.tBuild = 3.0;
    crane.tHold  = Math.max(0.6, anchor.tHold + anchor.tFade - crane.tBuild - 0.4);
    crane.tFade  = 0.4;
    crane.tGap   = anchor.tBuild + anchor.tGap;
    return crane;
  }

  // --- crane factory: tall mast + horizontal jib + counter-jib + hook ---
  // Jib points RIGHT by default. side === 'right' mirrors the geometry so
  // a right-side crane's jib points LEFT (inward, toward the title).
  function makeCrane(centerX, depth, delayStart, side, opts) {
    opts = opts || {};
    const mastH = opts.mastH != null ? opts.mastH : (190 + Math.random() * 50);
    const mastW = 12;
    const cabinH = 14;
    const jibLen = 100 + Math.random() * 25;
    const counterLen = 30;
    const hookDrop = 26 + Math.random() * 10;

    const padTop = 4;
    const w = mastW + jibLen + counterLen + 8;
    const h = mastH + cabinH + padTop + 6;
    const opacity = 1 - depth * 0.3;

    const nodes = [];

    const mastLeft = counterLen + 4;
    const mastRight = mastLeft + mastW;
    const mastBaseY = h - 4;
    const mastTopY = cabinH + padTop;
    const jibTopY = padTop + 1;
    const jibBotY = padTop + 11;
    const cabinTopY = padTop;
    const cabinBotY = mastTopY;

    // Mast — bottom-first delays so it builds upward
    const mastRows = 12;
    for (let j = 0; j <= mastRows; j++) {
      const ly = mastBaseY - (j / mastRows) * (mastBaseY - mastTopY);
      const corner = j === 0 || j === mastRows;
      const delay = 1 - j / mastRows;
      nodes.push({ lx: mastLeft,  ly, delay, corner, edge: true });
      nodes.push({ lx: mastRight, ly, delay, corner, edge: true });
    }

    // Cabin
    nodes.push({ lx: mastLeft - 4,  ly: cabinBotY, delay: 0.06, corner: true, edge: true });
    nodes.push({ lx: mastRight + 4, ly: cabinBotY, delay: 0.06, corner: true, edge: true });
    nodes.push({ lx: mastLeft - 4,  ly: cabinTopY, delay: 0.03, corner: true, edge: true });
    nodes.push({ lx: mastRight + 4, ly: cabinTopY, delay: 0.03, corner: true, edge: true });

    // Jib — long arm
    const jibSegments = 9;
    for (let i = 1; i <= jibSegments; i++) {
      const lx = mastRight + (i / jibSegments) * jibLen;
      const t = i / jibSegments;
      const corner = i === jibSegments;
      nodes.push({ lx, ly: jibTopY, delay: 0.05 + t * 0.18, corner, edge: true });
      nodes.push({ lx, ly: jibBotY, delay: 0.05 + t * 0.18, corner, edge: true });
    }

    // Counter-jib — short arm
    const counterSegments = 3;
    for (let i = 1; i <= counterSegments; i++) {
      const lx = mastLeft - (i / counterSegments) * counterLen;
      const t = i / counterSegments;
      nodes.push({ lx, ly: jibTopY, delay: 0.05 + t * 0.10, corner: i === counterSegments, edge: true });
      nodes.push({ lx, ly: jibBotY, delay: 0.05 + t * 0.10, corner: i === counterSegments, edge: true });
    }

    // Hook line dangling from the jib tip
    const hookX = mastRight + jibLen;
    nodes.push({ lx: hookX, ly: jibBotY + hookDrop * 0.55, delay: 0.18, corner: false, edge: true });
    nodes.push({ lx: hookX, ly: jibBotY + hookDrop,        delay: 0.24, corner: true,  edge: true });

    // Right-side cranes: mirror so the jib points LEFT (toward title)
    if (side === 'right') {
      nodes.forEach((n) => { n.lx = w - n.lx; });
    }

    // Edges by proximity
    const edges = [];
    for (let a = 0; a < nodes.length; a++) {
      const adj = [];
      for (let b = 0; b < nodes.length; b++) {
        if (a === b) continue;
        const d = Math.hypot(nodes[a].lx - nodes[b].lx, nodes[a].ly - nodes[b].ly);
        if (d < 30) adj.push({ b, d });
      }
      adj.sort((p, q) => p.d - q.d);
      adj.slice(0, 4).forEach((c) => { if (c.b > a) edges.push({ a, b: c.b, d: c.d }); });
    }

    return {
      cx: centerX,
      baselineDrop: depth * 0.05,
      w, h, depth, opacity,
      nodes, edges,
      t: 0,
      delayStart,
      tBuild: 4.5 + Math.random(),
      tHold:  4.5 + Math.random() * 2,
      tFade:  1.8,
      tGap:   0.9,
      nextPulse: 0,
      isCrane: true,
    };
  }

  // Where this drawable's bbox bottom sits in canvas coords.
  // Cranes anchored to a support building rise from the building's top.
  function getBaselineY(b) {
    if (b.anchor) {
      const anchorTop = H - b.anchor.h - b.anchor.baselineDrop * H * 0.05;
      return anchorTop - b.h + 4; // slight overlap into the building roof
    }
    return H - b.h - b.baselineDrop * H * 0.05;
  }

  function emitPulse(b, edge) {
    pulses.push({
      b, edge,
      t: 0,
      life: 0.55 + Math.random() * 0.35,
      dir: Math.random() < 0.5 ? 1 : -1,
    });
  }

  const CORE = '210, 230, 255';
  const GLOW = '110, 164, 255';
  const FILL = '18, 105, 255';

  let last = 0;
  function frame(now) {
    if (!running) { last = now; requestAnimationFrame(frame); return; }
    if (!last) last = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    ctx.clearRect(0, 0, W, H);

    // Horizon glow
    const grd = ctx.createLinearGradient(0, H * 0.4, 0, H);
    grd.addColorStop(0, 'rgba(18, 105, 255, 0)');
    grd.addColorStop(0.8, 'rgba(18, 105, 255, 0.08)');
    grd.addColorStop(1, 'rgba(18, 105, 255, 0.18)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    buildings.forEach((b) => {
      b.t += dt;
      const total = b.tBuild + b.tHold + b.tFade + b.tGap;
      let local = b.t - b.delayStart;
      if (local < 0) return;
      local = local % total;

      const inBuild = local < b.tBuild;
      const inHold  = local >= b.tBuild && local < b.tBuild + b.tHold;
      const inFade  = local >= b.tBuild + b.tHold && local < b.tBuild + b.tHold + b.tFade;
      const inGap   = !inBuild && !inHold && !inFade;

      const buildP = inBuild ? local / b.tBuild : 1;
      const fadeP  = inFade  ? (local - b.tBuild - b.tHold) / b.tFade : (inGap ? 1 : 0);
      const alpha  = (1 - fadeP) * b.opacity;
      if (inGap || alpha <= 0.001) return;

      const bx = b.cx - b.w / 2;
      const by = getBaselineY(b);

      const nodeAlive = (n) => buildP >= n.delay * 0.85;
      const edgeAlive = (e) => nodeAlive(b.nodes[e.a]) && nodeAlive(b.nodes[e.b]);

      // 1) Edges
      ctx.lineWidth = b.depth < 0.4 ? 1.2 : 0.85;
      b.edges.forEach((e) => {
        if (!edgeAlive(e)) return;
        const na = b.nodes[e.a], nb = b.nodes[e.b];
        ctx.strokeStyle = `rgba(${GLOW}, ${0.35 * alpha})`;
        ctx.beginPath();
        ctx.moveTo(bx + na.lx, by + na.ly);
        ctx.lineTo(bx + nb.lx, by + nb.ly);
        ctx.stroke();
      });

      // 2) Silhouette fill once mostly built
      if (buildP > 0.55) {
        const f = ((buildP - 0.55) / 0.45) * 0.10 * alpha;
        ctx.fillStyle = `rgba(${FILL}, ${f})`;
        ctx.fillRect(bx, by, b.w, b.h);
      }

      // 3) Nodes
      b.nodes.forEach((n, i) => {
        const px = bx + n.lx, py = by + n.ly;
        const alive = nodeAlive(n);
        const sinceAlive = alive ? buildP - n.delay * 0.85 : 0;

        if (!alive) {
          const lookahead = n.delay * 0.85 - buildP;
          if (lookahead < 0.06 && lookahead > 0) {
            const a = (1 - lookahead / 0.06) * 0.6 * alpha;
            ctx.fillStyle = `rgba(${GLOW}, ${a})`;
            ctx.beginPath();
            ctx.arc(px, py, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
          return;
        }

        const flash = Math.max(0, 1 - sinceAlive * 12);
        const baseR = n.corner ? 2.4 : 1.7;
        const pulse = 0.78 + 0.22 * Math.sin(b.t * 2.5 + i * 0.7);

        // outer glow
        ctx.fillStyle = `rgba(${GLOW}, ${(0.35 + 0.45 * flash) * pulse * alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, baseR * (3.5 + flash * 2.5), 0, Math.PI * 2);
        ctx.fill();
        // core
        ctx.fillStyle = `rgba(${CORE}, ${(0.95 + 0.05 * flash) * alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, baseR + flash * 0.8, 0, Math.PI * 2);
        ctx.fill();
      });

      // 4) Traveling pulses on live edges (front buildings only)
      if (!inFade && b.depth < 0.55) {
        b.nextPulse -= dt;
        if (b.nextPulse <= 0) {
          b.nextPulse = 0.16 + Math.random() * 0.28;
          const live = b.edges.filter(edgeAlive);
          if (live.length) {
            emitPulse(b, live[Math.floor(Math.random() * live.length)]);
          }
        }
      }
    });

    // Traveling pulses
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += dt;
      if (p.t >= p.life) { pulses.splice(i, 1); continue; }
      const u = p.dir === 1 ? p.t / p.life : 1 - p.t / p.life;
      const b = p.b;
      const total = b.tBuild + b.tHold + b.tFade + b.tGap;
      const local = ((b.t - b.delayStart) % total + total) % total;
      const fadeP = local >= b.tBuild + b.tHold && local < b.tBuild + b.tHold + b.tFade
        ? (local - b.tBuild - b.tHold) / b.tFade : (local >= b.tBuild + b.tHold + b.tFade ? 1 : 0);
      const alpha = (1 - fadeP) * b.opacity;
      if (alpha <= 0.01) continue;
      const na = b.nodes[p.edge.a], nb = b.nodes[p.edge.b];
      const bx = b.cx - b.w / 2;
      const by = getBaselineY(b);
      const px = bx + na.lx + (nb.lx - na.lx) * u;
      const py = by + na.ly + (nb.ly - na.ly) * u;
      ctx.fillStyle = `rgba(${GLOW}, ${0.55 * alpha})`;
      ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(${CORE}, ${0.95 * alpha})`;
      ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
    }

    requestAnimationFrame(frame);
  }

  const prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Pause only when fully scrolled away — use a generous root margin so the
  // animation is already running when the user approaches the section.
  if ('IntersectionObserver' in window && !prefersReduce) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { running = e.isIntersecting; });
    }, { rootMargin: '400px 0px 400px 0px', threshold: 0 });
    io.observe(canvas);
  } else if (prefersReduce) {
    running = false;
  }

  let resizeTO;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(() => { resize(); spawn(); }, 120);
  });

  resize();
  spawn();
  requestAnimationFrame(frame);
})();
