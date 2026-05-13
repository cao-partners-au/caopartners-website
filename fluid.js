// CAO Partners — WebGL2 Navier-Stokes fluid simulation for the hero.
// Stam-style velocity + pressure solver with 6 Jacobi iterations per frame,
// vorticity confinement, dye advection, autonomous turbulence, and
// cursor/click disturbance. 256x256 internal grid, upscaled to viewport.

(function fluidHero() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.getElementById('hero-fluid');
  if (!canvas) return;

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) return; // graceful fallback to dark gradient

  // Need float buffer extension for high-precision sim
  const extColorFloat = gl.getExtension('EXT_color_buffer_float');
  if (!extColorFloat) return;
  gl.getExtension('OES_texture_float_linear');

  // ---- shaders ----------------------------------------------------------
  const VERT = `#version 300 es
  in vec2 a_pos;
  out vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }`;

  function fragSrc(id) {
    return document.getElementById(id).textContent;
  }

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('shader compile error:', gl.getShaderInfoLog(sh), src);
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  function link(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('link error:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  const vs = compile(gl.VERTEX_SHADER, VERT);
  if (!vs) return;
  function mkProg(fragId) {
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc(fragId));
    if (!fs) return null;
    const p = link(vs, fs);
    if (!p) return null;
    // gather uniforms
    const u = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { program: p, u };
  }

  const prog = {
    advect:   mkProg('frag-advect'),
    splat:    mkProg('frag-splat'),
    divg:     mkProg('frag-divergence'),
    pressure: mkProg('frag-pressure'),
    gradient: mkProg('frag-gradient'),
    curl:     mkProg('frag-curl'),
    vorticity:mkProg('frag-vorticity'),
    display:  mkProg('frag-display'),
  };
  for (const k in prog) if (!prog[k]) return;

  // ---- fullscreen quad --------------------------------------------------
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // ---- textures / FBOs --------------------------------------------------
  const SIM_W = 256, SIM_H = 256;
  const DYE_W = 512, DYE_H = 512;

  function createFBO(w, h, internalFmt, format, type, filter) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, w, h, 0, format, type, null);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0,0,0,1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo, w, h, texelX: 1/w, texelY: 1/h };
  }
  function createDoubleFBO(w, h, internalFmt, format, type, filter) {
    let a = createFBO(w, h, internalFmt, format, type, filter);
    let b = createFBO(w, h, internalFmt, format, type, filter);
    return {
      width: w, height: h, texelX: 1/w, texelY: 1/h,
      read() { return a; },
      write() { return b; },
      swap() { const t = a; a = b; b = t; },
    };
  }

  // Velocity = RG16F (2-channel), Pressure/Div/Curl = R16F (1-channel), Dye = RGBA16F
  let velocity, dye, pressure, divergence, curl;
  try {
    velocity   = createDoubleFBO(SIM_W, SIM_H, gl.RG16F, gl.RG, gl.HALF_FLOAT, gl.LINEAR);
    dye        = createDoubleFBO(DYE_W, DYE_H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    pressure   = createDoubleFBO(SIM_W, SIM_H, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
    divergence = createFBO(SIM_W, SIM_H, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
    curl       = createFBO(SIM_W, SIM_H, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
  } catch (e) {
    return; // fall back to gradient
  }

  // ---- helpers ----------------------------------------------------------
  function blit(target) {
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function bindTex(loc, tex, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  // ---- input ------------------------------------------------------------
  const pointer = {
    x: 0, y: 0, dx: 0, dy: 0, lastX: 0, lastY: 0,
    down: false, moved: false,
  };
  function setPointer(clientX, clientY, isDown) {
    const r = canvas.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    const y = 1 - (clientY - r.top) / r.height;
    pointer.dx = x - pointer.x;
    pointer.dy = y - pointer.y;
    pointer.x = x;
    pointer.y = y;
    pointer.moved = Math.abs(pointer.dx) > 0 || Math.abs(pointer.dy) > 0;
    if (isDown !== undefined) pointer.down = isDown;
  }
  window.addEventListener('mousemove', (e) => setPointer(e.clientX, e.clientY));
  window.addEventListener('touchmove', (e) => {
    if (e.touches.length) setPointer(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  // Click → impulse blast (push out, then draw back)
  const pendingBlasts = []; // { x, y, time, phase }
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = 1 - (e.clientY - r.top) / r.height;
    pendingBlasts.push({ x, y, t: performance.now(), phase: 'out' });
  });

  // Autonomous turbulence — invisible force injection every 2-3s
  let nextAuto = performance.now() + 1000;

  // ---- splat ------------------------------------------------------------
  function splat(x, y, dx, dy, color, radius) {
    const aspect = canvas.width / canvas.height;
    // velocity splat
    gl.useProgram(prog.splat.program);
    bindTex(prog.splat.u.u_target, velocity.read().tex, 0);
    gl.uniform2f(prog.splat.u.u_point, x, y);
    gl.uniform3f(prog.splat.u.u_color, dx, dy, 0);
    gl.uniform1f(prog.splat.u.u_radius, radius);
    gl.uniform1f(prog.splat.u.u_aspectRatio, aspect);
    blit(velocity.write());
    velocity.swap();

    // dye splat
    bindTex(prog.splat.u.u_target, dye.read().tex, 0);
    gl.uniform3f(prog.splat.u.u_color, color[0], color[1], color[2]);
    blit(dye.write());
    dye.swap();
  }

  // ---- main step --------------------------------------------------------
  let last = performance.now();
  let raf = null;
  let visible = true;

  function step(now) {
    raf = requestAnimationFrame(step);
    if (!visible) return;
    let dt = (now - last) / 1000;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0.001) return; // cap 60fps roughly
    last = now;

    // 1. Inject from pointer drag
    if (pointer.moved && (pointer.dx !== 0 || pointer.dy !== 0)) {
      const force = 1800;
      const dye_blue   = 0.40;
      const dye_white  = 0.06;
      splat(
        pointer.x, pointer.y,
        pointer.dx * force, pointer.dy * force,
        [dye_blue, dye_white, 0],
        0.00015
      );
      pointer.dx = 0;
      pointer.dy = 0;
      pointer.moved = false;
    }

    // 2. Autonomous turbulence
    if (now > nextAuto) {
      const x = 0.15 + Math.random() * 0.7;
      const y = 0.15 + Math.random() * 0.7;
      const ang = Math.random() * Math.PI * 2;
      const mag = 250 + Math.random() * 350;
      splat(
        x, y,
        Math.cos(ang) * mag, Math.sin(ang) * mag,
        [0.18 + Math.random() * 0.12, 0.03 + Math.random() * 0.05, 0],
        0.00022
      );
      nextAuto = now + (2000 + Math.random() * 1000);
    }

    // 3. Click impulse blasts (push out, then draw back ~250ms later)
    for (let i = pendingBlasts.length - 1; i >= 0; i--) {
      const b = pendingBlasts[i];
      const age = now - b.t;
      if (b.phase === 'out' && age < 16) {
        // ring of outward velocity splats
        const N = 14;
        const mag = 3000;
        for (let k = 0; k < N; k++) {
          const a = (k / N) * Math.PI * 2;
          const ox = Math.cos(a) * 0.025;
          const oy = Math.sin(a) * 0.025;
          splat(
            b.x + ox, b.y + oy,
            Math.cos(a) * mag, Math.sin(a) * mag,
            [0.5, 0.12, 0],
            0.0001
          );
        }
        b.phase = 'wait';
      } else if (b.phase === 'wait' && age > 280) {
        // inward draw-back
        const N = 14;
        const mag = 1400;
        for (let k = 0; k < N; k++) {
          const a = (k / N) * Math.PI * 2;
          const ox = Math.cos(a) * 0.05;
          const oy = Math.sin(a) * 0.05;
          splat(
            b.x + ox, b.y + oy,
            -Math.cos(a) * mag, -Math.sin(a) * mag,
            [0.2, 0.04, 0],
            0.00012
          );
        }
        pendingBlasts.splice(i, 1);
      } else if (age > 1500) {
        pendingBlasts.splice(i, 1);
      }
    }

    // 4. Curl
    gl.useProgram(prog.curl.program);
    bindTex(prog.curl.u.u_velocity, velocity.read().tex, 0);
    gl.uniform2f(prog.curl.u.u_texelSize, velocity.texelX, velocity.texelY);
    blit(curl);

    // 5. Vorticity confinement
    gl.useProgram(prog.vorticity.program);
    bindTex(prog.vorticity.u.u_velocity, velocity.read().tex, 0);
    bindTex(prog.vorticity.u.u_curl, curl.tex, 1);
    gl.uniform2f(prog.vorticity.u.u_texelSize, velocity.texelX, velocity.texelY);
    gl.uniform1f(prog.vorticity.u.u_curlStrength, 28.0);
    gl.uniform1f(prog.vorticity.u.u_dt, dt);
    blit(velocity.write());
    velocity.swap();

    // 6. Divergence
    gl.useProgram(prog.divg.program);
    bindTex(prog.divg.u.u_velocity, velocity.read().tex, 0);
    gl.uniform2f(prog.divg.u.u_texelSize, velocity.texelX, velocity.texelY);
    blit(divergence);

    // 7. Clear pressure (decay)
    gl.useProgram(prog.splat.program);
    bindTex(prog.splat.u.u_target, pressure.read().tex, 0);
    gl.uniform2f(prog.splat.u.u_point, -10, -10);
    gl.uniform3f(prog.splat.u.u_color, 0, 0, 0);
    gl.uniform1f(prog.splat.u.u_radius, 0.0001);
    gl.uniform1f(prog.splat.u.u_aspectRatio, 1);
    blit(pressure.write());
    pressure.swap();

    // 8. Jacobi pressure solve — 6 iterations (spec says 4+)
    gl.useProgram(prog.pressure.program);
    gl.uniform2f(prog.pressure.u.u_texelSize, velocity.texelX, velocity.texelY);
    for (let i = 0; i < 6; i++) {
      bindTex(prog.pressure.u.u_pressure, pressure.read().tex, 0);
      bindTex(prog.pressure.u.u_divergence, divergence.tex, 1);
      blit(pressure.write());
      pressure.swap();
    }

    // 9. Subtract pressure gradient
    gl.useProgram(prog.gradient.program);
    bindTex(prog.gradient.u.u_pressure, pressure.read().tex, 0);
    bindTex(prog.gradient.u.u_velocity, velocity.read().tex, 1);
    gl.uniform2f(prog.gradient.u.u_texelSize, velocity.texelX, velocity.texelY);
    blit(velocity.write());
    velocity.swap();

    // 10. Advect velocity
    gl.useProgram(prog.advect.program);
    gl.uniform2f(prog.advect.u.u_texelSize, velocity.texelX, velocity.texelY);
    gl.uniform1f(prog.advect.u.u_dt, dt);
    gl.uniform1f(prog.advect.u.u_dissipation, 0.2);
    bindTex(prog.advect.u.u_velocity, velocity.read().tex, 0);
    bindTex(prog.advect.u.u_source, velocity.read().tex, 1);
    blit(velocity.write());
    velocity.swap();

    // 11. Advect dye (slower dissipation — streaks linger ~3-4s)
    gl.uniform1f(prog.advect.u.u_dissipation, 0.992);
    bindTex(prog.advect.u.u_velocity, velocity.read().tex, 0);
    bindTex(prog.advect.u.u_source, dye.read().tex, 1);
    blit(dye.write());
    dye.swap();

    // 12. Display
    gl.useProgram(prog.display.program);
    bindTex(prog.display.u.u_dye, dye.read().tex, 0);
    blit(null);
  }

  // ---- resize -----------------------------------------------------------
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  resize();
  window.addEventListener('resize', resize);

  // ---- visibility / pause -----------------------------------------------
  if ('IntersectionObserver' in window) {
    const hero = canvas.closest('.hero');
    if (hero) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { visible = e.isIntersecting; });
      }, { threshold: 0.02 });
      io.observe(hero);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) visible = false;
    else visible = true;
  });

  // ---- seed: initial dye splash so first frame isn't black --------------
  function seed() {
    for (let i = 0; i < 6; i++) {
      const x = 0.2 + Math.random() * 0.6;
      const y = 0.3 + Math.random() * 0.4;
      const ang = Math.random() * Math.PI * 2;
      splat(x, y, Math.cos(ang) * 600, Math.sin(ang) * 600, [0.4, 0.08, 0], 0.0003);
    }
  }
  seed();

  canvas.classList.add('ready');
  raf = requestAnimationFrame(step);
})();
