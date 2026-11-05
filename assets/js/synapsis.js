// Synapsis: grafo de notas (red de fuerzas en SVG, sin dependencias) + filtro
// por año sobre el grafo y el índice cronológico. Solo actúa en /synapsis/.
//
// Datos: #syn-graph-data (lo emite layouts/_default/synapsis.html)
//   nodes: [{ t: título, u: url, y: año, d: fecha, in: citas entrantes }]
//   links: [origen, destino, tipo, origen, destino, tipo, …] — tripletas planas
//          (append de Hugo aplana slices); tipo 1 = cita, 0 = afinidad
// El layout se calcula una sola vez, de forma determinista (mismo grafo →
// mismo dibujo), antes de pintar. El filtro por año no recalcula nada:
// atenúa lo que queda fuera y encuadra lo que queda dentro, así el mapa
// mental del lector se conserva entre años.
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

  var data = null;
  try { data = JSON.parse(dataEl ? dataEl.textContent : 'null'); } catch (e) { data = null; }
  if (!root || !data || !data.nodes || !data.nodes.length) {
    if (years && window.vmYearFilter) window.vmYearFilter(years, applyIndex);
    return;
  }

  var nodes = data.nodes.map(function (n, i) {
    return { i: i, t: n.t, u: n.u, y: n.y, d: n.d, inc: n.in || 0, hub: false, deg: 0, cites: 0, aff: 0,
             x: 0, y2: 0, vx: 0, vy: 0, nb: {} };
  });
  var flat = data.links || [], triples = [];
  for (var q = 0; q + 2 < flat.length; q += 3) triples.push([flat[q], flat[q + 1], flat[q + 2]]);
  var links = triples.map(function (l) {
    var s = nodes[l[0]], t = nodes[l[1]];
    s.deg++; t.deg++;
    if (l[2]) { s.cites++; t.cites++; } else { s.aff++; t.aff++; }
    s.nb[t.i] = true; t.nb[s.i] = true;
    return { s: s, t: t, cite: !!l[2] };
  });
  // hub = de las más citadas (≥3 citas entrantes y en el ~12 % superior);
  // con "citada 2 veces" casi medio grafo era hub y nada destacaba
  var incs = nodes.map(function (n) { return n.inc; }).sort(function (a, b) { return b - a; });
  var hubMin = Math.max(3, incs[Math.floor(nodes.length * 0.12)] || 0);
  nodes.forEach(function (n) {
    n.hub = n.inc >= hubMin;
    n.r = 3 + Math.sqrt(n.deg) * 1.6 + (n.hub ? 2 : 0);
  });

  // ── Layout de fuerzas (repulsión + resortes + gravedad + colisión) ──
  // Arranca en una espiral de Fermat (determinista) y enfría en N ticks.
  function layout() {
    var n = nodes.length, golden = Math.PI * (3 - Math.sqrt(5));
    nodes.forEach(function (d, i) {
      var r = 12 * Math.sqrt(i + 0.5), a = i * golden;
      d.x = r * Math.cos(a); d.y2 = r * Math.sin(a);
    });
    var TICKS = 360, alpha = 1, decay = 1 - Math.pow(0.001, 1 / TICKS);
    for (var k = 0; k < TICKS; k++) {
      // repulsión entre todos los pares (n ≈ 100–300: O(n²) sobra)
      for (var i = 0; i < n; i++) {
        var a = nodes[i];
        for (var j = i + 1; j < n; j++) {
          var b = nodes[j];
          var dx = b.x - a.x, dy = b.y2 - a.y2, d2 = dx * dx + dy * dy || 0.01;
          if (d2 > 160000) continue;                   // > 400 u: despreciable
          var f = -120 * alpha / d2;
          a.vx += dx * f; a.vy += dy * f;
          b.vx -= dx * f; b.vy -= dy * f;
        }
      }
      // resortes: las citas tiran más corto que la afinidad
      links.forEach(function (l) {
        var s = l.s, t = l.t;
        var dx = t.x + t.vx - s.x - s.vx, dy = t.y2 + t.vy - s.y2 - s.vy;
        var dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var want = l.cite ? 48 : 74;
        var str = (l.cite ? 0.9 : 0.5) / Math.min(s.deg, t.deg);
        var f = (dist - want) / dist * alpha * str;
        dx *= f; dy *= f;
        var bias = s.deg / (s.deg + t.deg);
        t.vx -= dx * bias; t.vy -= dy * bias;
        s.vx += dx * (1 - bias); s.vy += dy * (1 - bias);
      });
      // gravedad suave hacia el centro (mantiene juntas las islas sueltas);
      // más fuerte en vertical para que el dibujo salga apaisado, como el marco
      nodes.forEach(function (d) { d.vx -= d.x * 0.007 * alpha; d.vy -= d.y2 * 0.016 * alpha; });
      // colisión: que los círculos no se monten
      for (i = 0; i < n; i++) {
        a = nodes[i];
        for (j = i + 1; j < n; j++) {
          b = nodes[j];
          var min = a.r + b.r + 3;
          dx = b.x - a.x; dy = b.y2 - a.y2;
          var dd = dx * dx + dy * dy;
          if (dd < min * min) {
            var dist2 = Math.sqrt(dd) || 0.01, push = (min - dist2) / dist2 * 0.5;
            a.x -= dx * push; a.y2 -= dy * push;
            b.x += dx * push; b.y2 += dy * push;
          }
        }
      }
      nodes.forEach(function (d) {
        d.vx *= 0.6; d.vy *= 0.6;
        d.x += d.vx; d.y2 += d.vy;
      });
      alpha += (0 - alpha) * decay;
    }
  }
  layout();
  // marco vertical (móvil): se transpone el dibujo para que lo llene
  if (root.clientWidth < root.clientHeight * 1.1) {
    nodes.forEach(function (d) { var t = d.x; d.x = d.y2; d.y2 = t; });
  }

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
  var glow = el('filter', { id: 'syn-glow', x: '-100%', y: '-100%', width: '300%', height: '300%' }, defs);
  el('feGaussianBlur', { stdDeviation: '3', result: 'b' }, glow);
  var fm = el('feMerge', {}, glow);
  el('feMergeNode', { in: 'b' }, fm);
  el('feMergeNode', { in: 'SourceGraphic' }, fm);

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
      'aria-label': n.t + ' (' + n.d + ')' }, gNodes);
    el('circle', { r: n.r.toFixed(1), class: 'syn-dot' }, a);
    var tx = el('text', { class: 'syn-label', y: (n.r + 2).toFixed(1), dy: '1em' }, a);
    n.lbl = short(n.t, 28);
    tx.textContent = n.lbl;
    n.el = a; n.txt = tx;
  });
  root.insertBefore(svg, root.firstChild);

  // prioridad de etiqueta: las más citadas primero
  var ranked = nodes.slice().sort(function (a, b) { return b.inc - a.inc || b.deg - a.deg; });

  // ── Vista: zoom y desplazamiento ──
  var W = 0, H = 0, view = { k: 1, x: 0, y: 0 }, anim = 0, baseK = 1;
  var MIN_K = 0.2, MAX_K = 6;

  function size() {
    W = root.clientWidth; H = root.clientHeight;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  }
  function paint() {
    vp.setAttribute('transform', 'translate(' + view.x.toFixed(2) + ',' + view.y.toFixed(2) + ') scale(' + view.k.toFixed(4) + ')');
    // texto y trazos a tamaño constante en pantalla
    gNodes.style.fontSize = (11 / view.k) + 'px';
    root.style.setProperty('--syn-k', view.k);
    if (!lblQueued) { lblQueued = true; requestAnimationFrame(placeLabels); }
  }

  // Etiquetas fijas sin choques: de lejos solo las 7 notas más citadas de lo
  // visible; de cerca (o con pocas notas en el año) todas las que quepan.
  // Colocación voraz por prioridad, con cajas estimadas (Fira Code ≈ .62em).
  var lblQueued = false;
  function placeLabels() {
    lblQueued = false;
    var close = view.k >= baseK * 2.2;
    var all = close || (core !== nodes && core.length <= 24);
    var budget = all ? Infinity : 7, placed = [];
    ranked.forEach(function (n) {
      var ok = false;
      if (budget > 0 && n.el.getAttribute('data-out') == null && (close || !n.el.classList.contains('is-edge'))) {
        var sx = view.x + n.x * view.k, sy = view.y + n.y2 * view.k;
        var w = n.lbl.length * 6.9 + 6, h = 15;
        var box = { x: sx - w / 2, y: sy + n.r * view.k + 2, w: w, h: h };
        var anchor = 'middle';
        if (box.x < 4) { anchor = 'start'; box.x = sx - 4; }
        else if (box.x + w > W - 44) { anchor = 'end'; box.x = sx - w + 4; }   // 44: columna de botones
        ok = sx > -20 && sx < W + 20 && sy > -20 && sy < H + 20 && placed.every(function (p) {
          return box.x > p.x + p.w || box.x + box.w < p.x || box.y > p.y + p.h || box.y + box.h < p.y;
        });
        if (ok) {
          placed.push(box); budget--;
          n.txt.setAttribute('text-anchor', anchor);
          n.txt.setAttribute('x', anchor === 'middle' ? 0 : (anchor === 'start' ? -n.r : n.r));
        }
      }
      n.el.classList.toggle('is-lbl', ok);
    });
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
    if (instant || reduceMotion) { view = t; paint(); return; }
    var from = { k: view.k, x: view.x, y: view.y }, t0 = performance.now(), dur = 420;
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      view = { k: from.k + (t.k - from.k) * e, x: from.x + (t.x - from.x) * e, y: from.y + (t.y - from.y) * e };
      paint();
      if (p < 1) anim = requestAnimationFrame(step);
    })(t0);
  }
  function zoomAt(f, px, py) {
    cancelAnimationFrame(anim);
    var k = Math.max(MIN_K, Math.min(MAX_K, view.k * f)), r = k / view.k;
    view = { k: k, x: px - r * (px - view.x), y: py - r * (py - view.y) };
    paint();
  }
  function local(e) {
    var r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }

  var shown = nodes, core = nodes;   // visibles (año + vecinas) / solo las del año
  function fit(instant) { baseK = target(nodes).k; goTo(target(core), instant); }

  // rueda: solo con Ctrl/⌘ (o en pantalla completa) para no secuestrar el scroll
  svg.addEventListener('wheel', function (e) {
    if (!(e.ctrlKey || e.metaKey || root.classList.contains('is-full'))) {
      root.classList.add('show-hint');
      clearTimeout(root._hint);
      root._hint = setTimeout(function () { root.classList.remove('show-hint'); }, 1400);
      return;
    }
    e.preventDefault();
    var p = local(e);
    zoomAt(Math.exp(-e.deltaY * 0.0022), p.x, p.y);
  }, { passive: false });

  // arrastre (pan) y pellizco (zoom) con pointer events
  var ptrs = new Map(), moved = false, last = null, pinch = 0;
  svg.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    ptrs.set(e.pointerId, local(e));
    moved = false; last = local(e); pinch = 0;
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', function (e) {
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
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    root.classList.add('is-panning');
    cancelAnimationFrame(anim);
    view.x += dx; view.y += dy; last = p;
    paint();
  });
  function up(e) {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = 0;
    if (ptrs.size === 1) last = ptrs.values().next().value;
    if (!ptrs.size) root.classList.remove('is-panning');
  }
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  // un arrastre que termina sobre un nodo no debe abrirlo
  svg.addEventListener('click', function (e) { if (moved) { e.preventDefault(); moved = false; } }, true);

  // ── Hover / foco: resalta la nota, sus vecinas y sus aristas ──
  var tip = root.querySelector('.syn-tip');
  function focus(n) {
    root.classList.add('is-focus');
    nodes.forEach(function (m) {
      m.el.classList.toggle('is-on', m === n);
      m.el.classList.toggle('is-nb', !!n.nb[m.i]);
    });
    links.forEach(function (l) { l.el.classList.toggle('is-on', l.s === n || l.t === n); });
    var parts = [];
    if (n.cites) parts.push(n.cites + (n.cites === 1 ? ' cita' : ' citas'));
    if (n.aff) parts.push(n.aff + ' por afinidad');
    tip.innerHTML = '';
    var b = document.createElement('strong'); b.textContent = n.t; tip.appendChild(b);
    var s = document.createElement('span'); s.textContent = n.d + (parts.length ? ' · ' + parts.join(' · ') : ''); tip.appendChild(s);
    tip.hidden = false;
    var r = svg.getBoundingClientRect(), rr = root.getBoundingClientRect();
    var sx = (view.x + n.x * view.k) * (r.width / W) + (r.left - rr.left);
    var sy = (view.y + n.y2 * view.k) * (r.height / H) + (r.top - rr.top);
    var tw = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(rr.width - tw - 8, sx - tw / 2)) + 'px';
    tip.style.top = Math.max(8, sy - n.r * view.k - tip.offsetHeight - 10) + 'px';
  }
  function blur() {
    root.classList.remove('is-focus');
    nodes.forEach(function (m) { m.el.classList.remove('is-on', 'is-nb'); });
    links.forEach(function (l) { l.el.classList.remove('is-on'); });
    tip.hidden = true;
  }
  nodes.forEach(function (n) {
    n.el.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch' && !ptrs.size) focus(n); });
    n.el.addEventListener('pointerleave', blur);
    n.el.addEventListener('focus', function () { focus(n); });
    n.el.addEventListener('blur', blur);
  });

  // ── Controles ──
  root.querySelector('.syn-tools').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'in') zoomAt(1.35, W / 2, H / 2);
    else if (act === 'out') zoomAt(1 / 1.35, W / 2, H / 2);
    else if (act === 'fit') fit();
    else if (act === 'full') toggleFull();
  });
  function toggleFull(force) {
    var on = force != null ? force : !root.classList.contains('is-full');
    root.classList.toggle('is-full', on);
    document.documentElement.classList.toggle('vm-lightbox-open', on);   // bloquea el scroll
    size(); fit(true);
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('is-full')) toggleFull(false);
  });

  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { size(); fit(true); }, 120);
  });

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
    nodes.forEach(function (n) {
      n.el.classList.toggle('is-out', !!year && !keep[n.i]);
      if (year && !keep[n.i]) n.el.setAttribute('data-out', ''); else n.el.removeAttribute('data-out');
      n.el.classList.toggle('is-edge', keep[n.i] === 2);   // vecina de otro año
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
})();
