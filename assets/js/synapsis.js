// Synapsis: grafo de notas (red de fuerzas en SVG, sin dependencias) + filtro
// por año sobre el grafo y el índice cronológico. Solo actúa en /synapsis/.
//
// Datos: #syn-graph-data (lo emite layouts/_default/synapsis.html)
//   nodes: [{ t: título, u: url, y: grupo del filtro (año), d: texto del
//             tooltip (fecha), in: citas entrantes, g?: grupo de color 0–9 }]
//   links: [origen, destino, tipo, origen, destino, tipo, …] — tripletas planas
//          (append de Hugo aplana slices); tipo 1 = cita, 0 = afinidad
//
// Rendimiento:
// - El layout se calcula una vez, determinista (mismo grafo → mismo dibujo),
//   con arreglos tipados, y se guarda en localStorage con una clave que
//   depende de los datos: desde la segunda visita no se recalcula.
// - Pan/zoom en vivo mueven el <svg> con un transform CSS (lo compone la
//   GPU, sin repintar); al terminar el gesto se aplica la vista al SVG una
//   sola vez y se recolocan las etiquetas.
// - El hover solo toca la nota, sus vecinas y sus aristas.
// El filtro por año no recalcula nada: atenúa lo que queda fuera y encuadra
// lo que queda dentro, así el mapa mental del lector se conserva entre años.
(function () {
  'use strict';

  var root = document.getElementById('syn-graph');
  var dataEl = document.getElementById('syn-graph-data');
  var years = document.getElementById('syn-years');
  var empty = document.querySelector('.syn-graph-empty');

  var NS = 'http://www.w3.org/2000/svg';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function applyIndex(year) {
    document.querySelectorAll('.syn-year[data-year]').forEach(function (el) {
      el.hidden = !!(year && el.getAttribute('data-year') !== year);
    });
  }

  var raw = dataEl ? dataEl.textContent : '';
  var data = null;
  try { data = JSON.parse(raw || 'null'); } catch (e) { data = null; }
  if (!root || !data || !data.nodes || !data.nodes.length) {
    if (years && window.vmYearFilter) window.vmYearFilter(years, applyIndex);
    return;
  }

  // El grafo se arma después del primer pintado: la página aparece y
  // responde antes, y el grafo entra con su fundido (.is-ready).
  requestAnimationFrame(function () { setTimeout(init, 0); });

  function init() {
  var nodes = data.nodes.map(function (n, i) {
    return { i: i, t: n.t, u: n.u, y: n.y, d: n.d, g: n.g, inc: n.in || 0, hub: false,
             deg: 0, cites: 0, aff: 0, x: 0, y2: 0, nb: {}, ls: [] };
  });
  var flat = data.links || [], links = [];
  for (var q = 0; q + 2 < flat.length; q += 3) {
    var s = nodes[flat[q]], t = nodes[flat[q + 1]], cite = !!flat[q + 2];
    if (!s || !t) continue;
    var l = { s: s, t: t, cite: cite };
    s.deg++; t.deg++;
    if (cite) { s.cites++; t.cites++; } else { s.aff++; t.aff++; }
    s.nb[t.i] = true; t.nb[s.i] = true;
    s.ls.push(l); t.ls.push(l);
    links.push(l);
  }
  // hub = de las más citadas (≥3 citas entrantes y en el ~12 % superior);
  // con "citada 2 veces" casi medio grafo era hub y nada destacaba
  var incs = nodes.map(function (n) { return n.inc; }).sort(function (a, b) { return b - a; });
  var hubMin = Math.max(3, incs[Math.floor(nodes.length * 0.12)] || 0);
  nodes.forEach(function (n) {
    n.hub = n.inc >= hubMin;
    n.r = 3 + Math.sqrt(n.deg) * 1.6 + (n.hub ? 2 : 0);
  });

  // ── Layout de fuerzas (repulsión + colisión, resortes, gravedad) ──
  // Arranca en una espiral de Fermat (determinista) y enfría en TICKS pasos.
  // Arreglos tipados y bucles planos: ~4× más rápido que objetos + forEach.
  function layout() {
    var n = nodes.length, m = links.length, golden = Math.PI * (3 - Math.sqrt(5));
    var X = new Float64Array(n), Y = new Float64Array(n), VX = new Float64Array(n), VY = new Float64Array(n);
    var R = new Float64Array(n), DEG = new Float64Array(n);
    var LS = new Int32Array(m), LT = new Int32Array(m);
    var WANT = new Float64Array(m), STR = new Float64Array(m), BIAS = new Float64Array(m);
    var i, j, k;
    for (i = 0; i < n; i++) {
      var r0 = 12 * Math.sqrt(i + 0.5), a0 = i * golden;
      X[i] = r0 * Math.cos(a0); Y[i] = r0 * Math.sin(a0);
      R[i] = nodes[i].r; DEG[i] = nodes[i].deg;
    }
    for (k = 0; k < m; k++) {
      var L = links[k], ds = L.s.deg, dt = L.t.deg;
      LS[k] = L.s.i; LT[k] = L.t.i;
      WANT[k] = L.cite ? 48 : 74;                    // las citas tiran más corto
      STR[k] = (L.cite ? 0.9 : 0.5) / Math.min(ds, dt);
      BIAS[k] = ds / (ds + dt);
    }
    var TICKS = 240, alpha = 1, decay = 1 - Math.pow(0.001, 1 / TICKS);
    for (var tick = 0; tick < TICKS; tick++) {
      // repulsión y colisión en una sola pasada por pares (corte a 400 u)
      for (i = 0; i < n; i++) {
        var xi = X[i], yi = Y[i], ri = R[i], fxi = 0, fyi = 0;
        for (j = i + 1; j < n; j++) {
          var dx = X[j] - xi, dy = Y[j] - yi, d2 = dx * dx + dy * dy;
          if (d2 > 160000) continue;
          if (d2 < 0.01) d2 = 0.01;
          var f = -120 * alpha / d2;
          var min = ri + R[j] + 3;
          if (d2 < min * min) {                         // se montan: separar
            var d = Math.sqrt(d2);
            f -= (min - d) / d * 0.5;
          }
          fxi += dx * f; fyi += dy * f;
          VX[j] -= dx * f; VY[j] -= dy * f;
        }
        VX[i] += fxi; VY[i] += fyi;
      }
      for (k = 0; k < m; k++) {
        var si = LS[k], ti = LT[k];
        var lx = X[ti] + VX[ti] - X[si] - VX[si], ly = Y[ti] + VY[ti] - Y[si] - VY[si];
        var dist = Math.sqrt(lx * lx + ly * ly) || 0.01;
        var fl = (dist - WANT[k]) / dist * alpha * STR[k], b = BIAS[k];
        lx *= fl; ly *= fl;
        VX[ti] -= lx * b; VY[ti] -= ly * b;
        VX[si] += lx * (1 - b); VY[si] += ly * (1 - b);
      }
      // gravedad suave al centro (junta las islas sueltas); más fuerte en
      // vertical para que el dibujo salga apaisado, como el marco
      for (i = 0; i < n; i++) {
        VX[i] = (VX[i] - X[i] * 0.007 * alpha) * 0.6;
        VY[i] = (VY[i] - Y[i] * 0.016 * alpha) * 0.6;
        X[i] += VX[i]; Y[i] += VY[i];
      }
      alpha += (0 - alpha) * decay;
    }
    var out = new Array(n * 2);
    for (i = 0; i < n; i++) { out[i * 2] = Math.round(X[i] * 10) / 10; out[i * 2 + 1] = Math.round(Y[i] * 10) / 10; }
    return out;
  }

  // caché del layout: la clave cambia si cambian los datos o el algoritmo
  function hash(str) {
    var h = 0x811c9dc5;
    for (var c = 0; c < str.length; c++) { h ^= str.charCodeAt(c); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  var cacheKey = 'vm-syn:2:' + hash(raw);
  var pos = null;
  try {
    pos = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (!pos || pos.length !== nodes.length * 2) pos = null;
  } catch (e) { pos = null; }
  if (!pos) {
    pos = layout();
    try {
      for (var key in localStorage) if (key.indexOf('vm-syn:') === 0 && key !== cacheKey) localStorage.removeItem(key);
      localStorage.setItem(cacheKey, JSON.stringify(pos));
    } catch (e) { /* sin almacenamiento: se recalcula la próxima vez */ }
  }
  // marco vertical (móvil): se transpone el dibujo para que lo llene
  var portrait = root.clientWidth < root.clientHeight * 1.1;
  nodes.forEach(function (d, i) {
    d.x = portrait ? pos[i * 2 + 1] : pos[i * 2];
    d.y2 = portrait ? pos[i * 2] : pos[i * 2 + 1];
  });

  // ── SVG ──
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function short(t, max) { return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t; }

  var svg = el('svg', { class: 'syn-svg', role: 'group', 'aria-label': 'Grafo de notas' });
  var defs = el('defs', {}, svg);
  var mk = el('marker', { id: 'syn-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5',
    markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse' }, defs);
  el('path', { d: 'M0,1 L9,5 L0,9 z', class: 'syn-arrow' }, mk);

  var vp = el('g', { class: 'syn-vp' }, svg);
  var gLinks = el('g', { class: 'syn-links' }, vp);
  var gNodes = el('g', { class: 'syn-nodes' }, vp);

  links.forEach(function (l) {
    // la cita termina en el borde del círculo destino, no en su centro
    var dx = l.t.x - l.s.x, dy = l.t.y2 - l.s.y2, d = Math.sqrt(dx * dx + dy * dy) || 1;
    var ex = l.cite ? l.t.x - dx / d * (l.t.r + 2) : l.t.x;
    var ey = l.cite ? l.t.y2 - dy / d * (l.t.r + 2) : l.t.y2;
    l.el = el('line', { x1: l.s.x.toFixed(1), y1: l.s.y2.toFixed(1), x2: ex.toFixed(1), y2: ey.toFixed(1),
      class: 'syn-link ' + (l.cite ? 'syn-link--cite' : 'syn-link--aff') }, gLinks);
    if (l.cite) l.el.setAttribute('marker-end', 'url(#syn-arrow)');
  });

  nodes.forEach(function (n) {
    var a = el('a', { href: n.u, class: 'syn-node' + (n.hub ? ' is-hub' : ''),
      transform: 'translate(' + n.x.toFixed(1) + ',' + n.y2.toFixed(1) + ')',
      'aria-label': n.t + (n.d ? ' (' + n.d + ')' : '') }, gNodes);
    if (n.g != null) a.setAttribute('data-g', n.g);
    // halo en vez de filtro SVG: un filtro se re-rasteriza en cada fotograma
    if (n.hub) el('circle', { r: (n.r + 5).toFixed(1), class: 'syn-halo' }, a);
    el('circle', { r: n.r.toFixed(1), class: 'syn-dot' }, a);
    var tx = el('text', { class: 'syn-label', y: (n.r + 2).toFixed(1), dy: '1em' }, a);
    n.lbl = short(n.t, 28);
    tx.textContent = n.lbl;
    n.el = a; n.txt = tx;
  });
  root.insertBefore(svg, root.firstChild);

  // prioridad de etiqueta: las más citadas primero
  var ranked = nodes.slice().sort(function (a, b) { return b.inc - a.inc || b.deg - a.deg; });

  // ── Vista ──
  // `cv` es la vista aplicada al SVG; `view`, la vista en curso. Durante un
  // gesto solo cambia `view` y la diferencia se muestra con un transform CSS.
  var W = 0, H = 0, anim = 0, baseK = 1;
  var view = { k: 1, x: 0, y: 0 }, cv = { k: 1, x: 0, y: 0 };
  var MIN_K = 0.2, MAX_K = 6;

  function size() {
    W = root.clientWidth; H = root.clientHeight;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  }
  var live = 0, idle = 0;
  function show() {                                 // vista en curso, vía CSS
    if (!live) live = requestAnimationFrame(function () {
      live = 0;
      var s = view.k / cv.k;
      svg.style.transform = 'translate(' + (view.x - s * cv.x).toFixed(2) + 'px,' + (view.y - s * cv.y).toFixed(2) + 'px) scale(' + s.toFixed(4) + ')';
      root.classList.add('is-moving');
    });
  }
  function commit() {                               // aplica la vista al SVG
    cancelAnimationFrame(live); live = 0;
    clearTimeout(idle);
    var zoomed = view.k !== cv.k;
    cv = { k: view.k, x: view.x, y: view.y };
    vp.setAttribute('transform', 'translate(' + cv.x.toFixed(2) + ',' + cv.y.toFixed(2) + ') scale(' + cv.k.toFixed(4) + ')');
    svg.style.transform = '';
    root.classList.remove('is-moving');
    // texto a tamaño constante en pantalla (solo cambia con el zoom)
    if (zoomed || !gNodes.style.fontSize) gNodes.style.fontSize = (11 / cv.k) + 'px';
    placeLabels();
  }
  function settle() { clearTimeout(idle); idle = setTimeout(commit, 160); }

  // Etiquetas fijas sin choques: de lejos solo las 7 notas más citadas de lo
  // visible; de cerca (o con pocas notas en el año) todas las que quepan.
  // Colocación voraz por prioridad, con cajas estimadas (Fira Code ≈ .62em).
  function placeLabels() {
    var close = cv.k >= baseK * 2.2;
    var all = close || (core !== nodes && core.length <= 24);
    var budget = all ? Infinity : 7, placed = [];
    for (var r = 0; r < ranked.length; r++) {
      var n = ranked[r], ok = false;
      if (budget > 0 && !n.out && (close || !n.edge)) {
        var sx = cv.x + n.x * cv.k, sy = cv.y + n.y2 * cv.k;
        var w = n.lbl.length * 6.9 + 6, h = 15;
        var bx = sx - w / 2, by = sy + n.r * cv.k + 2, anchor = 'middle';
        if (bx < 4) { anchor = 'start'; bx = sx - 4; }
        else if (bx + w > W - 44) { anchor = 'end'; bx = sx - w + 4; }   // 44: columna de botones
        ok = sx > -20 && sx < W + 20 && sy > -20 && sy < H + 20;
        for (var p = 0; ok && p < placed.length; p++) {
          var o = placed[p];
          if (!(bx > o.x + o.w || bx + w < o.x || by > o.y + o.h || by + h < o.y)) ok = false;
        }
        if (ok) {
          placed.push({ x: bx, y: by, w: w, h: h }); budget--;
          if (n.anchor !== anchor) {
            n.anchor = anchor;
            n.txt.setAttribute('text-anchor', anchor);
            n.txt.setAttribute('x', anchor === 'middle' ? 0 : (anchor === 'start' ? -n.r : n.r));
          }
        }
      }
      if (n.lblOn !== ok) { n.lblOn = ok; n.el.classList.toggle('is-lbl', ok); }
    }
  }
  function bounds(list) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(function (n) {
      x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r);
      y0 = Math.min(y0, n.y2 - n.r); y1 = Math.max(y1, n.y2 + n.r + 14);
    });
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  function target(list) {
    var b = bounds(list), px = Math.min(70, W * 0.08), py = 30;   // margen lateral para las etiquetas
    var k = Math.min((W - px * 2) / Math.max(b.x1 - b.x0, 60), (H - py * 2) / Math.max(b.y1 - b.y0, 60));
    k = Math.max(MIN_K, Math.min(2.4, k));
    return { k: k, x: W / 2 - k * (b.x0 + b.x1) / 2, y: H / 2 - k * (b.y0 + b.y1) / 2 };
  }
  function goTo(t, instant) {
    cancelAnimationFrame(anim);
    if (instant || reduceMotion) { view = t; commit(); return; }
    var from = { k: view.k, x: view.x, y: view.y }, t0 = performance.now(), dur = 420;
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      view = { k: from.k + (t.k - from.k) * e, x: from.x + (t.x - from.x) * e, y: from.y + (t.y - from.y) * e };
      if (p < 1) { show(); anim = requestAnimationFrame(step); } else commit();
    })(t0);
  }
  function zoomAt(f, px, py) {
    cancelAnimationFrame(anim);
    var k = Math.max(MIN_K, Math.min(MAX_K, view.k * f)), r = k / view.k;
    view = { k: k, x: px - r * (px - view.x), y: py - r * (py - view.y) };
    show();
  }
  // coordenadas locales del marco (no del <svg>, que se mueve en los gestos)
  function local(e) {
    var r = root.getBoundingClientRect();
    return { x: e.clientX - r.left - root.clientLeft, y: e.clientY - r.top - root.clientTop };
  }

  var shown = nodes, core = nodes;   // visibles (año + vecinas) / solo las del año
  function fit(instant) { baseK = target(nodes).k; goTo(target(core), instant); }

  // rueda: solo con Ctrl/⌘ (o en pantalla completa) para no secuestrar el scroll
  root.addEventListener('wheel', function (e) {
    if (!(e.ctrlKey || e.metaKey || root.classList.contains('is-full'))) {
      root.classList.add('show-hint');
      clearTimeout(root._hint);
      root._hint = setTimeout(function () { root.classList.remove('show-hint'); }, 1400);
      return;
    }
    e.preventDefault();
    var p = local(e);
    zoomAt(Math.exp(-e.deltaY * 0.0022), p.x, p.y);
    settle();
  }, { passive: false });

  // Arrastre (pan) y pellizco (zoom) con pointer events. El puntero se
  // captura recién cuando el gesto pasa de 4 px: capturarlo al apretar
  // desviaba el clic al <svg> y los nodos dejaban de abrir su post.
  var ptrs = new Map(), moved = false, last = null, pinch = 0;
  root.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || e.target.closest('.syn-tools')) return;
    var p = local(e);
    ptrs.set(e.pointerId, p);
    moved = false; last = p; pinch = 0;
  });
  root.addEventListener('pointermove', function (e) {
    if (!ptrs.has(e.pointerId)) return;
    var p = local(e);
    ptrs.set(e.pointerId, p);
    if (ptrs.size === 2) {
      var it = ptrs.values(), a = it.next().value, b = it.next().value;
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomAt(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = d; moved = true;
      return;
    }
    var dx = p.x - last.x, dy = p.y - last.y;
    if (!moved) {
      if (Math.hypot(dx, dy) < 4) return;
      moved = true;
      try { root.setPointerCapture(e.pointerId); } catch (err) { /* puntero ya liberado */ }
      root.classList.add('is-panning');
      hideFocus();
    }
    cancelAnimationFrame(anim);
    view.x += dx; view.y += dy; last = p;
    show();
  });
  function up(e) {
    if (!ptrs.delete(e.pointerId)) return;
    if (ptrs.size < 2) pinch = 0;
    if (ptrs.size === 1) last = ptrs.values().next().value;
    if (!ptrs.size) {
      root.classList.remove('is-panning');
      if (moved) commit();
    }
  }
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  // los nodos son <a>: sin esto, arrastrar desde uno inicia el
  // "arrastrar enlace" nativo del navegador en vez de mover el grafo
  root.addEventListener('dragstart', function (e) { e.preventDefault(); });
  // un arrastre que termina sobre un nodo no debe abrirlo
  root.addEventListener('click', function (e) { if (moved) { e.preventDefault(); moved = false; } }, true);

  // ── Hover / foco: resalta la nota, sus vecinas y sus aristas ──
  // Solo se marcan esas piezas (el resto se atenúa con una clase en el marco).
  var tip = root.querySelector('.syn-tip'), lit = null;
  function mark(n, on) {
    n.el.classList.toggle('is-on', on);
    n.ls.forEach(function (l) {
      l.el.classList.toggle('is-on', on);
      (l.s === n ? l.t : l.s).el.classList.toggle('is-nb', on);
    });
  }
  function focus(n) {
    if (lit === n) return;
    if (lit) mark(lit, false);
    lit = n; mark(n, true);
    root.classList.add('is-focus');
    var parts = [];
    if (n.cites) parts.push(n.cites + (n.cites === 1 ? ' cita' : ' citas'));
    if (n.aff) parts.push(n.aff + ' por afinidad');
    tip.textContent = '';
    var b = document.createElement('strong'); b.textContent = n.t; tip.appendChild(b);
    var info = (n.d ? [n.d] : []).concat(parts).join(' · ');
    if (info) { var s = document.createElement('span'); s.textContent = info; tip.appendChild(s); }
    tip.hidden = false;
    var sx = view.x + n.x * view.k, sy = view.y + n.y2 * view.k;
    var tw = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(W - tw - 8, sx - tw / 2)) + 'px';
    tip.style.top = Math.max(8, sy - n.r * view.k - tip.offsetHeight - 10) + 'px';
  }
  function hideFocus() {
    if (lit) { mark(lit, false); lit = null; }
    root.classList.remove('is-focus');
    tip.hidden = true;
  }
  nodes.forEach(function (n) {
    // sin hover con un botón apretado: atenuar ~700 piezas a mitad de un
    // arrastre dispara repintados en cada fotograma
    n.el.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch' && !e.buttons && !ptrs.size) focus(n); });
    n.el.addEventListener('pointerleave', function () { if (lit === n) hideFocus(); });
    // solo el foco de teclado: un clic también enfoca el <a>, y resaltar ahí
    // dispararía el atenuado justo al empezar un arrastre
    n.el.addEventListener('focus', function () { if (n.el.matches(':focus-visible')) focus(n); });
    n.el.addEventListener('blur', function () { if (lit === n) hideFocus(); });
  });

  // ── Controles ──
  root.querySelector('.syn-tools').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'in') { zoomAt(1.35, W / 2, H / 2); settle(); }
    else if (act === 'out') { zoomAt(1 / 1.35, W / 2, H / 2); settle(); }
    else if (act === 'fit') fit();
    else if (act === 'full') toggleFull();
  });
  function toggleFull(force) {
    var on = force != null ? force : !root.classList.contains('is-full');
    root.classList.toggle('is-full', on);
    document.documentElement.classList.toggle('vm-lightbox-open', on);   // bloquea el scroll
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('is-full')) toggleFull(false);
  });

  // cambios de tamaño del marco (ventana, pantalla completa): re-encuadrar
  function onResize() {
    if (root.hidden || (root.clientWidth === W && root.clientHeight === H)) return;
    size(); fit(true);
  }
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(root);
  else window.addEventListener('resize', onResize);

  // ── Filtro por año: atenuar fuera del año, encuadrar lo de dentro ──
  function applyGraph(year, instant) {
    var keep = {};
    if (year) {
      nodes.forEach(function (n) { if (n.y === year) keep[n.i] = true; });
      links.forEach(function (l) {
        if (keep[l.s.i] && !keep[l.t.i]) keep[l.t.i] = 2;
        if (keep[l.t.i] && !keep[l.s.i]) keep[l.s.i] = 2;
      });
    }
    shown = year ? nodes.filter(function (n) { return keep[n.i]; }) : nodes;
    core = year ? nodes.filter(function (n) { return keep[n.i] === true; }) : nodes;
    var none = !shown.length;
    root.hidden = none;
    if (empty) empty.hidden = !none;
    if (none) return;
    if (!W) size();
    nodes.forEach(function (n) {
      n.out = !!year && !keep[n.i];
      n.edge = keep[n.i] === 2;                        // vecina de otro año
      n.el.classList.toggle('is-out', n.out);
      n.el.classList.toggle('is-edge', n.edge);
    });
    links.forEach(function (l) { l.el.classList.toggle('is-out', !!year && !(keep[l.s.i] && keep[l.t.i])); });
    fit(instant);
  }

  size();
  var first = true;
  function apply(year) {
    applyIndex(year);
    applyGraph(year, first);
    first = false;
  }
  if (years && window.vmYearFilter) window.vmYearFilter(years, apply);
  else apply('');
  requestAnimationFrame(function () { root.classList.add('is-ready'); });
  }
})();
