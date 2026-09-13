// Synapsis: filtro por año sobre el grafo de notas y el índice cronológico.
// Solo actúa en /synapsis/ (contenedor #syn-years). El grafo mermaid se poda en
// la fuente (data-vmSrc, guardada por extended_footer.html) y se re-renderiza
// con window.__vmRenderMermaid; el índice cronológico solo oculta bloques.
(function () {
  'use strict';

  var years = document.getElementById('syn-years');
  if (!years || !window.vmYearFilter) return;

  var graph = document.getElementById('syn-graph');
  var empty = document.querySelector('.syn-graph-empty');
  var dataEl = document.getElementById('syn-graph-years');
  var nodeYear = {};
  try { nodeYear = JSON.parse(dataEl ? dataEl.textContent : '{}') || {}; } catch (e) { nodeYear = {}; }

  var RE_NODE = /^\s*(n\d+)\[/;
  var RE_EDGE = /^\s*(n\d+)\s+(-->|-\.-)\s+(n\d+)\s*$/;
  var RE_CLICK = /^\s*click\s+(n\d+)\s/;
  var RE_CLASS = /^\s*class\s+(n\d+)\s/;

  // Poda la definición mermaid: nodos del año + sus vecinos directos (y las
  // aristas que los unen). Con año vacío devuelve la fuente completa.
  function prune(src, year) {
    if (!year) return src;
    var lines = src.split('\n');
    var keep = {};
    Object.keys(nodeYear).forEach(function (id) { if (nodeYear[id] === year) keep[id] = true; });
    var edges = [];
    lines.forEach(function (ln) {
      var m = RE_EDGE.exec(ln);
      if (m && (keep[m[1]] || keep[m[3]])) edges.push(m);
    });
    var show = Object.assign({}, keep);
    edges.forEach(function (m) { show[m[1]] = true; show[m[3]] = true; });
    if (!Object.keys(show).length) return null;

    return lines.filter(function (ln) {
      var m;
      if ((m = RE_NODE.exec(ln))) return !!show[m[1]];
      if ((m = RE_EDGE.exec(ln))) return !!(show[m[1]] && show[m[3]]);
      if ((m = RE_CLICK.exec(ln))) return !!show[m[1]];
      if ((m = RE_CLASS.exec(ln))) return !!show[m[1]];
      return true; // cabecera, classDef, etc.
    }).join('\n');
  }

  var fullSrc = null;

  function applyGraph(year) {
    if (!graph) return;
    // La fuente completa la guarda extended_footer en data-vmSrc antes del
    // primer render; si aún no corrió, el <pre> todavía tiene el texto.
    if (fullSrc == null) fullSrc = graph.dataset.vmSrc != null ? graph.dataset.vmSrc : graph.textContent;
    var src = prune(fullSrc, year);
    var wrap = graph.parentElement;
    if (src == null) {
      wrap.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    wrap.hidden = false;
    if (empty) empty.hidden = true;
    graph.dataset.vmSrc = src;
    if (typeof window.__vmRenderMermaid === 'function') window.__vmRenderMermaid();
  }

  function applyIndex(year) {
    document.querySelectorAll('.syn-year[data-year]').forEach(function (el) {
      el.hidden = !!(year && el.getAttribute('data-year') !== year);
    });
  }

  var pendingYear = null;
  function apply(year) {
    applyIndex(year);
    // Sin año y sin poda previa no hay nada que hacer: el render inicial
    // de extended_footer ya muestra el grafo completo.
    if (!year && fullSrc == null) return;
    // mermaid carga con defer + módulo inline: si aún no está, esperar.
    if (typeof window.__vmRenderMermaid !== 'function') { pendingYear = year; return; }
    applyGraph(year);
  }

  window.vmYearFilter(years, apply);

  // El módulo de mermaid corre después de este bundle: reintentar el año
  // pendiente cuando aparezca el renderer.
  if (pendingYear != null) {
    var tries = 0;
    var t = setInterval(function () {
      if (typeof window.__vmRenderMermaid === 'function' || ++tries > 100) {
        clearInterval(t);
        if (pendingYear != null) { var y = pendingYear; pendingYear = null; applyGraph(y); }
      }
    }, 50);
  }
})();
