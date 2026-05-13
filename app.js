/* CAO Partners — site interactions */
(function () {
  'use strict';

  // --- nav scrolled state ---
  const nav = document.querySelector('.nav');
  const onScroll = () => {
    if (window.scrollY > 8) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // --- reveal on scroll ---
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
  }

  // --- counter animation on proof bar ---
  const counters = document.querySelectorAll('[data-counter]');
  if ('IntersectionObserver' in window && counters.length) {
    const cio = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const target = parseFloat(el.dataset.counter);
        const suffix = el.dataset.suffix || '';
        const prefix = el.dataset.prefix || '';
        const duration = 1400;
        const start = performance.now();
        const isInt = Number.isInteger(target);
        const step = (now) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          const v = target * eased;
          el.textContent = prefix + (isInt ? Math.round(v).toLocaleString() : v.toFixed(0)) + suffix;
          if (t < 1) requestAnimationFrame(step);
          else el.textContent = prefix + (isInt ? target.toLocaleString() : target) + suffix;
        };
        requestAnimationFrame(step);
        cio.unobserve(el);
      });
    }, { threshold: 0.5 });
    counters.forEach((el) => cio.observe(el));
  }

  // --- modals ---
  const openModal = (id) => {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    const firstInput = m.querySelector('input, select, textarea');
    if (firstInput) setTimeout(() => firstInput.focus(), 240);
  };
  const closeModal = (m) => {
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  document.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openModal(btn.dataset.open);
    });
  });

  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay);
    });
    overlay.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(overlay));
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(closeModal);
    }
  });

  // --- hero neural network canvas ---
  (function heroNetwork() {
    const canvas = document.getElementById('hero-network');
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = null;
    let startTime = performance.now();

    // Anatomical heart at centre, surrounded by 8-12 nodes connected
    // via curved synapses. Heart pulses every 1.2s; on each pulse, a
    // bright impulse fires along every synapse, brightening the node.
    const PULSE_PERIOD = 1200; // ms
    const PULSE_DUR = 300;     // ms scale animation
    const IMPULSE_DUR = 600;   // ms impulse travel
    const NODE_BRIGHT_DUR = 350; // ms node glow after arrival

    let nodes = [];
    let synapses = [];
    let centerX = 0, centerY = 0;
    let heartScale = 1; // ranges from 0..1 to drive base size to viewport

    function resize() {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      centerX = w / 2;
      centerY = h / 2;
      heartScale = Math.max(0.7, Math.min(1.6, Math.min(w, h) / 520));
    }
    function rand(a, b) { return a + Math.random() * (b - a); }

    function build() {
      nodes = [];
      synapses = [];
      const count = 12; // 8-12
      // Nodes span out across the entire hero, elliptically — wider on landscape
      const baseRX = Math.max(220, Math.min(w * 0.46, w / 2 - 60));
      const baseRY = Math.max(160, Math.min(h * 0.44, h / 2 - 40));
      for (let i = 0; i < count; i++) {
        // Distribute around heart with angular jitter; alternate near/far rings
        const baseAng = (i / count) * Math.PI * 2 - Math.PI / 2;
        const ang = baseAng + rand(-0.14, 0.14);
        const ringMul = (i % 2 === 0) ? rand(0.82, 1.0) : rand(0.6, 0.78);
        const nx = centerX + Math.cos(ang) * baseRX * ringMul;
        const ny = centerY + Math.sin(ang) * baseRY * ringMul;
        nodes.push({
          x: nx, y: ny,
          radius: rand(2.6, 3.8),
          brightUntil: 0,
        });
        // synapse control point — curved path from heart to node
        const midX = (centerX + nx) / 2;
        const midY = (centerY + ny) / 2;
        const perpX = -(ny - centerY);
        const perpY = (nx - centerX);
        const plen = Math.hypot(perpX, perpY) || 1;
        const dist = Math.hypot(nx - centerX, ny - centerY);
        const bow = rand(-0.24, 0.24) * dist;
        const cpx = midX + (perpX / plen) * bow;
        const cpy = midY + (perpY / plen) * bow;
        synapses.push({ cpx, cpy, node: nodes[i] });
      }
    }

    // Anatomical heart — clinical line-art (stroke only, medical-illustration style).
    // Drawn around (0,0); scale s. alpha controls overall opacity (target ~0.3).
    function drawHeart(cx, cy, s, alpha, glow) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const stroke      = `rgba(18, 105, 255, ${alpha})`;
      const strokeMid   = `rgba(18, 105, 255, ${alpha * 0.78})`;
      const strokeFaint = `rgba(18, 105, 255, ${alpha * 0.55})`;
      const fillBg      = `rgba(8, 22, 58, ${alpha * 0.45})`;

      // Outer silhouette — asymmetric anatomical heart
      const body = new Path2D();
      body.moveTo(-5, -55);
      body.bezierCurveTo(-30, -75, -75, -68, -92, -42);
      body.bezierCurveTo(-108, -10, -95, 30, -68, 58);
      body.bezierCurveTo(-48, 80, -22, 95, 0, 112);
      body.bezierCurveTo(20, 95, 50, 70, 72, 42);
      body.bezierCurveTo(100, 10, 108, -22, 90, -50);
      body.bezierCurveTo(72, -72, 35, -72, 18, -55);
      body.bezierCurveTo(10, -50, 0, -50, -5, -55);
      body.closePath();

      // Subtle dark-blue interior fill
      ctx.fillStyle = fillBg;
      ctx.fill(body);

      // Outer silhouette
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = stroke;
      ctx.stroke(body);

      // Pulse halo — thin outer ring expanding slightly on systole
      if (glow > 0) {
        ctx.lineWidth = 1.2 + glow * 2.6;
        ctx.strokeStyle = `rgba(18, 105, 255, ${alpha * 0.55 * glow})`;
        ctx.stroke(body);
      }

      // Atrioventricular sulcus (coronary groove) — line between atria and ventricles
      ctx.lineWidth = 1.0;
      ctx.strokeStyle = strokeMid;
      ctx.beginPath();
      ctx.moveTo(-90, -38);
      ctx.bezierCurveTo(-58, -22, -18, -16, 18, -18);
      ctx.bezierCurveTo(52, -20, 80, -32, 92, -48);
      ctx.stroke();

      // Interventricular sulcus (septum line) — curves down to apex
      ctx.lineWidth = 0.95;
      ctx.strokeStyle = strokeMid;
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.bezierCurveTo(-10, 20, 0, 60, 4, 108);
      ctx.stroke();

      // Right atrium appendage (inner curve, upper left)
      ctx.lineWidth = 0.85;
      ctx.strokeStyle = strokeFaint;
      ctx.beginPath();
      ctx.moveTo(-72, -58);
      ctx.bezierCurveTo(-66, -42, -50, -38, -38, -44);
      ctx.stroke();

      // Left atrium hint (upper right)
      ctx.beginPath();
      ctx.moveTo(38, -62);
      ctx.bezierCurveTo(55, -52, 72, -50, 80, -54);
      ctx.stroke();

      // Chamber labels via inner curves — RV, LV, RA, LA suggestion
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = strokeFaint;
      ctx.beginPath();
      // RV inner wall
      ctx.moveTo(-55, -2);
      ctx.bezierCurveTo(-50, 30, -32, 60, -10, 90);
      // LV inner wall
      ctx.moveTo(60, 0);
      ctx.bezierCurveTo(58, 30, 40, 60, 18, 90);
      ctx.stroke();

      // Aorta arch — two parallel curves curving up and to the right
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      ctx.moveTo(18, -58);
      ctx.bezierCurveTo(36, -104, 90, -116, 100, -72);
      ctx.stroke();
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = strokeMid;
      ctx.beginPath();
      ctx.moveTo(34, -58);
      ctx.bezierCurveTo(48, -92, 78, -100, 86, -75);
      ctx.stroke();
      // aortic valve plane
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(18, -58);
      ctx.lineTo(34, -58);
      ctx.stroke();

      // Brachiocephalic / left common carotid / left subclavian branches off the arch
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      ctx.moveTo(52, -100);
      ctx.lineTo(52, -120);
      ctx.moveTo(66, -108);
      ctx.lineTo(68, -122);
      ctx.moveTo(82, -110);
      ctx.lineTo(88, -122);
      ctx.stroke();

      // Pulmonary trunk — two parallel lines, splitting into L/R pulmonary arteries
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      ctx.moveTo(-10, -56);
      ctx.bezierCurveTo(-16, -78, -22, -94, -24, -110);
      ctx.moveTo(8, -56);
      ctx.bezierCurveTo(2, -78, -4, -94, -6, -110);
      ctx.stroke();
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-24, -110);
      ctx.lineTo(-6, -110);
      ctx.stroke();
      // bifurcation branches
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(-24, -110);
      ctx.lineTo(-46, -120);
      ctx.moveTo(-6, -110);
      ctx.lineTo(14, -118);
      ctx.stroke();

      // Superior vena cava (top-left of heart, viewer's left) — two parallel lines
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      ctx.moveTo(-66, -54);
      ctx.lineTo(-72, -120);
      ctx.moveTo(-54, -52);
      ctx.lineTo(-60, -120);
      ctx.stroke();

      // Inferior vena cava — bottom-left exit
      ctx.beginPath();
      ctx.moveTo(-48, 80);
      ctx.lineTo(-58, 122);
      ctx.moveTo(-32, 86);
      ctx.lineTo(-42, 122);
      ctx.stroke();

      // Pulmonary veins (right side, entering left atrium) — four small stubs
      ctx.lineWidth = 0.85;
      ctx.strokeStyle = strokeMid;
      ctx.beginPath();
      ctx.moveTo(86, -50);
      ctx.lineTo(108, -54);
      ctx.moveTo(88, -38);
      ctx.lineTo(110, -38);
      ctx.moveTo(90, -22);
      ctx.lineTo(112, -20);
      ctx.moveTo(88, -10);
      ctx.lineTo(108, -6);
      ctx.stroke();

      // Coronary arteries — thin surface vessels (LAD, RCA, circumflex)
      ctx.lineWidth = 0.75;
      ctx.strokeStyle = strokeFaint;
      ctx.beginPath();
      // LAD — follows septum down toward apex
      ctx.moveTo(8, -16);
      ctx.bezierCurveTo(12, 20, 8, 60, 2, 100);
      // RCA — down the right side (viewer's left)
      ctx.moveTo(-18, -18);
      ctx.bezierCurveTo(-32, 5, -42, 35, -38, 60);
      // Circumflex — around the back
      ctx.moveTo(40, -18);
      ctx.bezierCurveTo(58, -2, 64, 22, 58, 48);
      ctx.stroke();

      // Apex marker
      ctx.lineWidth = 1.0;
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      ctx.arc(2, 112, 1.4, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }

    // Quadratic bezier point
    function qbez(p0x, p0y, p1x, p1y, p2x, p2y, t) {
      const u = 1 - t;
      return {
        x: u * u * p0x + 2 * u * t * p1x + t * t * p2x,
        y: u * u * p0y + 2 * u * t * p1y + t * t * p2y,
      };
    }

    function frame(nowAbs) {
      const now = nowAbs - startTime;
      // Solid clear (no trails — clean nervous-system look)
      ctx.fillStyle = '#04050f';
      ctx.fillRect(0, 0, w, h);

      // Pulse cycle 0..1
      const cyclePos = now % PULSE_PERIOD;
      const pulseStarted = cyclePos; // ms since last pulse start

      // Heart scale animation: easeInOut over PULSE_DUR (1.0 -> 1.08 -> 1.0)
      let scaleMul = 1;
      let glow = 0;
      if (pulseStarted < PULSE_DUR) {
        const t = pulseStarted / PULSE_DUR;
        // ease in-out, peak at 0.5
        const e = t < 0.5
          ? 2 * t * t
          : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const tri = t < 0.5 ? e * 2 : (1 - e) * 2; // 0..1..0
        scaleMul = 1 + 0.08 * tri;
        glow = tri;
      }

      // Synapses (static base, but get bright when impulse passes overhead)
      for (const s of synapses) {
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.quadraticCurveTo(s.cpx, s.cpy, s.node.x, s.node.y);
        ctx.strokeStyle = 'rgba(110, 164, 255, 0.18)';
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }

      // Impulses — fire at pulse start, travel 0..1 over IMPULSE_DUR.
      // Render only when active.
      const impulseT = pulseStarted < IMPULSE_DUR ? pulseStarted / IMPULSE_DUR : -1;
      if (impulseT >= 0) {
        // ease-out cubic so impulse decelerates as it nears the node
        const eased = 1 - Math.pow(1 - impulseT, 3);
        for (const s of synapses) {
          const p = qbez(centerX, centerY, s.cpx, s.cpy, s.node.x, s.node.y, eased);
          // fade out near the end of travel
          const alpha = impulseT < 0.85 ? 1 : (1 - (impulseT - 0.85) / 0.15);
          // bright glowing dot
          ctx.shadowColor = '#1269ff';
          ctx.shadowBlur = 16;
          ctx.fillStyle = `rgba(150, 190, 255, ${alpha})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          // inner core
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
          ctx.fill();

          // mark arrival → brighten node briefly
          if (impulseT >= 1 - 1/60) {
            s.node.brightUntil = now + NODE_BRIGHT_DUR;
          }
        }
        // detect end-of-travel one frame: schedule node brighten at impulseT crossing 1
        if (pulseStarted >= IMPULSE_DUR - 16 && pulseStarted < IMPULSE_DUR) {
          for (const s of synapses) s.node.brightUntil = now + NODE_BRIGHT_DUR;
        }
      }

      // Nodes
      for (const n of nodes) {
        const brightT = Math.max(0, (n.brightUntil - now) / NODE_BRIGHT_DUR);
        const alpha = 0.55 + brightT * 0.45;
        const glowR = brightT;
        if (glowR > 0) {
          ctx.shadowColor = '#1269ff';
          ctx.shadowBlur = 18 * glowR;
        }
        ctx.fillStyle = `rgba(110, 164, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + brightT * 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (brightT > 0) {
          // outer ring
          ctx.strokeStyle = `rgba(110, 164, 255, ${brightT * 0.4})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radius + 4 + brightT * 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Heart (drawn over synapses) — #1269ff at ~30% opacity, line-art clinical
      drawHeart(centerX, centerY, heartScale * scaleMul, 0.3, glow);

      raf = requestAnimationFrame(frame);
    }

    canvas.style.pointerEvents = 'none';

    function start() {
      resize();
      build();
      canvas.classList.add('ready');
      raf = requestAnimationFrame(frame);
    }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = null; }

    let resizeT;
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => { stop(); start(); }, 180);
    });

    // Pause when hero offscreen
    if ('IntersectionObserver' in window) {
      const hero = canvas.closest('.hero');
      const ho = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !raf) raf = requestAnimationFrame(frame);
          else if (!e.isIntersecting) stop();
        });
      }, { threshold: 0.05 });
      ho.observe(hero);
    }

    start();
  })();

  // --- smooth anchor scroll ---
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href === '#' || href.length < 2) return;
    a.addEventListener('click', (e) => {
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        const top = target.getBoundingClientRect().top + window.scrollY - 70;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  // --- Business operations panel: loop the bar fill + percentage count ---
  (function () {
    const panel = document.querySelector('.role-visual .rv-panel');
    if (!panel) return;
    const bars = [];
    panel.querySelectorAll('.rv-cell').forEach((cell) => {
      const fill  = cell.querySelector('.rv-c-bar i');
      const value = cell.querySelector('.rv-c-v');
      if (!fill || !value) return;
      const target = parseFloat(fill.getAttribute('data-target') || '0');
      bars.push({ fill, value, target });
      fill.style.width = '0%';
      value.textContent = '0%';
    });
    if (!bars.length) return;

    const prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduce) {
      bars.forEach((b) => {
        b.fill.style.width = b.target + '%';
        b.value.textContent = b.target + '%';
      });
      return;
    }

    let running = false;
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { running = e.isIntersecting; });
      }, { threshold: 0.2 });
      io.observe(panel);
    } else {
      running = true;
    }

    const STAGGER = 180;
    const FILL    = 1600;
    const HOLD    = 2400;
    const RESET   = 600;
    const PAUSE   = 400;
    const CYCLE   = FILL + HOLD + RESET + PAUSE;
    const LOOP    = CYCLE + STAGGER * (bars.length - 1) + 200;

    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const easeInCubic  = (t) => t * t * t;

    let t = 0;
    let last = 0;
    function tick(now) {
      if (!last) last = now;
      const dt = now - last;
      last = now;
      if (running) t = (t + dt) % LOOP;

      bars.forEach((b, i) => {
        const local = ((t - i * STAGGER) % LOOP + LOOP) % LOOP;
        let p;
        if (local < FILL) {
          p = easeOutCubic(local / FILL);
        } else if (local < FILL + HOLD) {
          p = 1;
        } else if (local < FILL + HOLD + RESET) {
          p = 1 - easeInCubic((local - FILL - HOLD) / RESET);
        } else {
          p = 0;
        }
        const pct = p * b.target;
        b.fill.style.width = pct + '%';
        b.value.textContent = Math.round(pct) + '%';
      });

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  })();

})();
