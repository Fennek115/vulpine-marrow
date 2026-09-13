// Filtro por año (partials/year-filter.html): estado + sincronía con ?y= en la URL.
// Expone window.vmYearFilter(root, onChange) → devuelve { get() }.
// Cada página decide qué hacer con el año (search.js filtra el índice,
// synapsis.js poda el grafo y el índice cronológico).
(function () {
  'use strict';

  window.vmYearFilter = function (root, onChange) {
    var year = '';
    var btns = Array.prototype.slice.call(root.querySelectorAll('.vm-years__btn'));

    function paint() {
      btns.forEach(function (b) {
        var on = (b.getAttribute('data-year') || '') === year;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    function syncUrl() {
      try {
        var u = new URL(window.location.href);
        if (year) u.searchParams.set('y', year); else u.searchParams.delete('y');
        history.replaceState(null, '', u);
      } catch (e) { /* sin historial: no importa */ }
    }

    function set(y, silent) {
      year = y || '';
      paint();
      if (!silent) syncUrl();
      onChange(year);
    }

    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('.vm-years__btn');
      if (!b || !root.contains(b)) return;
      set(b.getAttribute('data-year') || '');
    });

    // Estado inicial desde ?y= (solo si existe un botón para ese año).
    var y0 = new URLSearchParams(window.location.search).get('y') || '';
    if (y0 && !btns.some(function (b) { return b.getAttribute('data-year') === y0; })) y0 = '';
    set(y0, true);

    return { get: function () { return year; } };
  };
})();
