/* Pipeline de impresión del whitepaper curado (/whitepapers/<slug>/print.html).
   A diferencia del informe combinado (informe-doc.js, que fetchea posts y los
   ensambla), aquí el documento YA está renderizado por Hugo desde un único
   markdown curado. Este módulo solo lo prepara para el PDF:
     - autoenlaza cada token CVE-YYYY-NNNN a su ficha de la NVD,
     - rasteriza los diagramas mermaid a <img> data-URI (Paged.js corrompe el
       SVG inline — misma técnica que informe-doc.js),
     - reestructura el índice (.TableOfContents de Hugo) a [texto·líder·nº] y
       llena los números de página una vez paginado,
     - ata cada título a un colchón de contenido (print-keep.js),
     - pagina con Paged.js (window.PagedConfig.auto=false lo mantiene a la espera)
       y marca data-pf-ready para scripts/build-pdf.mjs. */

import { keepHeadingsWithContent } from './print-keep.js';

(function () {
  'use strict';

  var NVD = 'https://nvd.nist.gov/vuln/detail/';
  var CVE_RE = /\bCVE-\d{4}-\d{4,7}\b/;

  var statusEl = document.getElementById('pf-status');
  function say(m) { if (statusEl) statusEl.textContent = m; }

  main().catch(function (err) {
    console.error(err);
    say('Error preparando el whitepaper: ' + err.message);
  });

  async function main() {
    var content = document.querySelector('.pf-content');
    if (!content) throw new Error('sin .pf-content');

    autolinkCves(content);
    markLongTables(content);

    if (content.querySelector('pre.mermaid')) {
      say('renderizando diagramas…');
      await renderMermaid();
    }

    say('cargando fuentes e imágenes…');
    await document.fonts.ready;
    await Promise.all(Array.prototype.map.call(content.querySelectorAll('img'), function (img) {
      img.setAttribute('loading', 'eager');
      return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
    }));

    restructureToc();
    keepHeadingsWithContent(content);
    /* cada sección (h2) ya abre en hoja nueva vía `break-before: page`. El
       colchón `.pf-keep` (break-inside:avoid) que keepHeadings pone sobre un h2
       se APILA con ese break-before → Paged.js mete una hoja fantasma (doble
       salto). Se desenvuelven los keep que empiezan por h2; los de h3/h4 (para
       huérfanos a media página) se conservan. */
    content.querySelectorAll('.pf-keep').forEach(function (k) {
      if (k.firstElementChild && k.firstElementChild.tagName === 'H2') {
        while (k.firstChild) k.parentNode.insertBefore(k.firstChild, k);
        k.remove();
      }
    });

    say('paginando (Paged.js)…');
    if (statusEl) statusEl.remove();
    /* nada ajeno al documento debe entrar a la paginación */
    document.querySelectorAll('body > script').forEach(function (s) { s.remove(); });

    await window.PagedPolyfill.preview();
    fillPageNumbers();
    stylePreview();
    addToolbar();
    document.documentElement.dataset.pfReady = '1';
  }

  /* ================= CVE → NVD ================= */

  /* envuelve cada token CVE-YYYY-NNNN en un enlace a su ficha NVD, sin tocar
     los que ya estén dentro de un <a>. Recorre nodos de texto (también los de
     dentro de <code>), así los CVE en tablas y en código quedan clicables. */
  function autolinkCves(root) {
    var re = new RegExp(CVE_RE.source, 'g');
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || node.nodeValue.indexOf('CVE-') === -1) return NodeFilter.FILTER_REJECT;
        if (node.parentNode && node.parentNode.closest('a')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var targets = [];
    for (var n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n);

    targets.forEach(function (node) {
      re.lastIndex = 0;
      var text = node.nodeValue, frag = document.createDocumentFragment(), last = 0, m;
      while ((m = re.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var a = document.createElement('a');
        a.href = NVD + m[0];
        a.textContent = m[0];
        frag.appendChild(a);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  /* ================= tablas largas ================= */

  /* Una tabla con muchas filas (el mapa MITRE consolidado, el glosario) es más
     alta que la caja de página; como report.css la deja break-inside:avoid,
     Paged.js la empuja entera a la hoja siguiente y deja su título huérfano.
     Se marca .pf-table--long para permitir el corte entre filas (whitepaper.css);
     la cabecera se repite y las filas no se parten (report.css). El umbral (>12
     filas) aísla esas dos tablas; la siguiente más grande del documento tiene 9. */
  function markLongTables(root) {
    root.querySelectorAll('table').forEach(function (t) {
      if (t.querySelectorAll('tr').length > 12) t.classList.add('pf-table--long');
    });
  }

  /* ================= índice ================= */

  /* Hugo emite el TOC como <nav id="TableOfContents"><ul>… . Cada <a> pasa a
     [span.wp-t = texto][i.wp-l = líder][span.wp-p = nº de página]. */
  function restructureToc() {
    var nav = document.querySelector('.pf-toc--wp nav');
    if (!nav) return;
    nav.removeAttribute('id');   // Hugo pone id="TableOfContents"; evita colisión
    nav.querySelectorAll('a[href^="#"]').forEach(function (a) {
      var t = document.createElement('span');
      t.className = 'wp-t';
      while (a.firstChild) t.appendChild(a.firstChild);
      a.appendChild(t);
      var l = document.createElement('i'); l.className = 'wp-l'; a.appendChild(l);
      var p = document.createElement('span'); p.className = 'wp-p'; a.appendChild(p);
    });
  }

  /* nº de página del índice: se lee del DOM ya paginado (en qué .pagedjs_page
     cayó el ancla de cada entrada) — target-counter() resolvía a 0 en esta
     versión de Paged.js. */
  function fillPageNumbers() {
    var pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'));
    document.querySelectorAll('.pf-toc--wp a[href^="#"]').forEach(function (a) {
      var span = a.querySelector('.wp-p');
      var href = a.getAttribute('href');
      if (!span || !href) return;
      var target;
      try { target = document.getElementById(decodeURIComponent(href.slice(1))); }
      catch (e) { target = null; }
      var page = target && target.closest('.pagedjs_page');
      var num = page ? (page.getAttribute('data-page-number') || (pages.indexOf(page) + 1)) : null;
      span.textContent = num || '—';
    });
  }

  /* ================= mermaid ================= */

  /* mermaid autohospedado (build IIFE → window.mermaid); se carga bajo
     demanda inyectando el <script>. La ruta la fija el layout en
     window.VM_MERMAID_SRC (relURL, segura bajo subpath). */
  function loadMermaid() {
    return new Promise(function (resolve, reject) {
      if (window.mermaid) return resolve(window.mermaid);
      var s = document.createElement('script');
      s.src = window.VM_MERMAID_SRC || '/vm/js/mermaid.min.js';
      s.onload = function () { resolve(window.mermaid); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function renderMermaid() {
    var mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false, theme: 'base', securityLevel: 'loose',
      htmlLabels: false, flowchart: { htmlLabels: false },
      themeVariables: {
        darkMode: false, background: '#ffffff',
        primaryColor: '#f3ecfa', primaryTextColor: '#241f31', primaryBorderColor: '#9141ac',
        secondaryColor: '#eadcf6', tertiaryColor: '#faf7fc',
        lineColor: '#9141ac', fontFamily: "'Fira Code', monospace"
      }
    });
    await mermaid.run({ querySelector: 'pre.mermaid' });

    /* SVG inline → <img> data-URI: átomo que Paged.js clona sin corromper.
       Con htmlLabels:false no hay <foreignObject> y rasteriza limpio. */
    document.querySelectorAll('pre.mermaid svg').forEach(function (svg) {
      var rect = svg.getBoundingClientRect();
      var w = Math.ceil(rect.width) || 600, h = Math.ceil(rect.height) || 400;
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      var xml = new XMLSerializer().serializeToString(svg);
      var img = document.createElement('img');
      img.className = 'pf-mermaid-img';
      img.setAttribute('width', w);
      img.setAttribute('height', h);
      img.style.aspectRatio = w + ' / ' + h;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      var pre = svg.closest('pre.mermaid');
      (pre || svg).replaceWith(img);
    });
  }

  /* ================= visor (pantalla) ================= */

  /* centrado de hojas: inline, inmune a que Paged.js promueva las @media print
     (ver la nota extensa en informe-doc.js) */
  function stylePreview() {
    var pages = document.querySelector('.pagedjs_pages');
    if (!pages) return;
    var nodes = Array.prototype.slice.call(pages.querySelectorAll('.pagedjs_page'));
    function apply() {
      nodes.forEach(function (pg) {
        pg.style.marginLeft = 'auto'; pg.style.marginRight = 'auto';
        pg.style.boxShadow = '0 2px 20px rgba(36, 31, 49, .14)';
      });
    }
    function clear() {
      nodes.forEach(function (pg) {
        pg.style.marginLeft = ''; pg.style.marginRight = ''; pg.style.boxShadow = '';
      });
    }
    apply();
    window.addEventListener('beforeprint', clear);
    window.addEventListener('afterprint', apply);
  }

  function addToolbar() {
    var bar = document.createElement('div');
    bar.className = 'pf-cbar';
    bar.style.position = 'fixed'; bar.style.top = '14px'; bar.style.right = '14px'; bar.style.zIndex = '50';
    var btn = document.createElement('button');
    btn.textContent = '⎙ Exportar PDF';
    btn.addEventListener('click', function () { window.print(); });
    bar.appendChild(btn);
    var hint = document.createElement('span');
    hint.className = 'pf-cbar-hint';
    hint.textContent = 'A4 · Ctrl/Cmd + P → Guardar como PDF';
    bar.appendChild(hint);
    document.body.appendChild(bar);
    window.addEventListener('beforeprint', function () { bar.style.display = 'none'; });
    window.addEventListener('afterprint', function () { bar.style.display = ''; });
  }
})();
