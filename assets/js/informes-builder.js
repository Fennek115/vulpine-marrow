/* Constructor de informes PDF combinados (página /informes/).
   La selección y el orden se codifican en la URL de la vista print
   (?p=slug1,slug2&t=Título&s=Subtítulo): esa URL ES el informe — guardarla
   o compartirla reproduce siempre la misma colección. Si la página se abre
   con esos parámetros, el estado se precarga (permite editar un informe
   existente desde el enlace «constructor» de su toolbar). */

(function () {
  'use strict';

  var root = document.getElementById('vm-informes');
  if (!root) return;

  var printUrl = root.dataset.print;
  var rows = Array.prototype.slice.call(root.querySelectorAll('.vm-inf__row'));
  var titleBySlug = {};
  rows.forEach(function (r) { titleBySlug[r.dataset.slug] = r.dataset.title; });

  var order = [];   // slugs en orden de lectura

  var selList = document.getElementById('vm-inf-sel');
  var hint = document.getElementById('vm-inf-hint');
  var count = document.getElementById('vm-inf-count');
  var msg = document.getElementById('vm-inf-msg');
  var titleIn = document.getElementById('vm-inf-title');
  var subIn = document.getElementById('vm-inf-sub');
  var openBtn = document.getElementById('vm-inf-open');
  var copyBtn = document.getElementById('vm-inf-copy');
  var filterIn = document.getElementById('vm-inf-filter');

  /* ---- precarga desde la URL (editar un informe existente) ---- */
  var qs = new URLSearchParams(location.search);
  (qs.get('p') || '').split(',').forEach(function (s) {
    s = s.trim();
    if (s && titleBySlug[s] && order.indexOf(s) === -1) order.push(s);
  });
  if (qs.get('t')) titleIn.value = qs.get('t');
  if (qs.get('s')) subIn.value = qs.get('s');

  /* ---- pool: checkboxes ---- */
  rows.forEach(function (row) {
    var cb = row.querySelector('input[type="checkbox"]');
    cb.addEventListener('change', function () {
      var slug = cb.dataset.slug;
      var i = order.indexOf(slug);
      if (cb.checked && i === -1) order.push(slug);
      if (!cb.checked && i !== -1) order.splice(i, 1);
      render();
    });
  });

  /* ---- filtro ---- */
  filterIn.addEventListener('input', function () {
    var q = filterIn.value.trim().toLowerCase();
    rows.forEach(function (row) {
      row.hidden = q !== '' && row.dataset.haystack.indexOf(q) === -1;
    });
  });

  /* ---- lista de orden ---- */
  function move(slug, delta) {
    var i = order.indexOf(slug);
    var j = i + delta;
    if (i === -1 || j < 0 || j >= order.length) return;
    order[i] = order[j];
    order[j] = slug;
    render();
  }

  function render() {
    selList.textContent = '';
    order.forEach(function (slug, i) {
      var li = document.createElement('li');
      var t = document.createElement('span');
      t.className = 't';
      t.textContent = titleBySlug[slug];
      li.appendChild(t);
      [
        ['↑', function () { move(slug, -1); }, i === 0],
        ['↓', function () { move(slug, 1); }, i === order.length - 1],
        ['✕', function () { order.splice(order.indexOf(slug), 1); render(); }, false]
      ].forEach(function (def) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = def[0];
        b.disabled = def[2];
        b.addEventListener('click', def[1]);
        li.appendChild(b);
      });
      selList.appendChild(li);
    });

    rows.forEach(function (row) {
      row.querySelector('input[type="checkbox"]').checked = order.indexOf(row.dataset.slug) !== -1;
    });

    hint.hidden = order.length > 0;
    count.textContent = order.length ? '· ' + order.length : '';
    openBtn.disabled = copyBtn.disabled = order.length === 0;
    msg.textContent = '';
  }

  function buildUrl() {
    var ps = new URLSearchParams();
    ps.set('p', order.join(','));
    if (titleIn.value.trim()) ps.set('t', titleIn.value.trim());
    if (subIn.value.trim()) ps.set('s', subIn.value.trim());
    return printUrl + '?' + ps.toString();
  }

  openBtn.addEventListener('click', function () {
    window.open(buildUrl(), '_blank');
  });

  copyBtn.addEventListener('click', function () {
    var abs = new URL(buildUrl(), location.href).href;
    navigator.clipboard.writeText(abs).then(function () {
      msg.textContent = 'Enlace copiado — guárdalo: reproduce siempre este informe.';
    }, function () {
      msg.textContent = abs;   // fallback: mostrarlo para copiar a mano
    });
  });

  render();
})();
