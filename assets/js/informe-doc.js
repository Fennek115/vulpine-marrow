/* Ensamblador del informe PDF combinado (/informes/print.html?p=...).
   Fetchea el print.html de cada post (misma origin, ya generado por Hugo),
   y funde todo en un solo documento:
     - portada maestra (título/subtítulo de la URL),
     - índice maestro: una entrada por pieza + sus H2/H3, con números de
       página reales (target-counter de Paged.js),
     - portadilla por pieza (parte N/M, título, fecha, fuente),
     - IDs y anclas prefijados por slug (evita colisiones entre posts:
       #referencias, #fn:1, ...),
     - enlaces entre piezas del informe reescritos a anclas internas,
     - secciones "Referencias" extraídas de cada pieza y consolidadas al
       final, dedupeadas por URL en orden de primera aparición.
   Al final renderiza mermaid (si hay diagramas) y recién entonces pagina
   con Paged.js (window.PagedConfig.auto=false lo mantiene a la espera). */

import { keepHeadingsWithContent } from './print-keep.js';

(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);
  var slugs = (qs.get('p') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  slugs = slugs.filter(function (s, i) { return slugs.indexOf(s) === i; });   // sin duplicados

  var docTitle = (qs.get('t') || '').trim() || 'Informe combinado';
  var docSub = (qs.get('s') || '').trim();
  var base = document.body.dataset.postsBase || '/posts/';
  var builderUrl = document.body.dataset.builder || '/informes/';

  var statusEl = document.getElementById('pf-status');
  function say(m) { if (statusEl) statusEl.textContent = m; }

  if (!slugs.length) {
    statusEl.remove();
    document.getElementById('pf-empty').hidden = false;
    return;
  }

  document.title = docTitle + ' — dust115 · skullfox archive';

  main().catch(function (err) {
    console.error(err);
    say('Error ensamblando el informe: ' + err.message);
  });

  /* ================= pipeline ================= */

  async function main() {
    say('descargando ' + slugs.length + ' piezas…');
    var parts = [];
    for (var i = 0; i < slugs.length; i++) {
      var p = await fetchPart(slugs[i]);
      if (p) parts.push(p);
      say('descargando piezas… ' + (i + 1) + '/' + slugs.length);
    }
    if (!parts.length) throw new Error('no se pudo cargar ninguna pieza');

    say('ensamblando…');
    var refs = [];
    parts.forEach(function (part, i) {
      preparePart(part, parts, refs);
      part.n = i + 1;
    });

    var root = document.createElement('div');
    root.id = 'pf-root';
    root.appendChild(buildCover(parts));
    root.appendChild(buildMasterToc(parts));
    parts.forEach(function (part) {
      root.appendChild(buildPartCover(part, parts.length));
      root.appendChild(part.content);
    });
    if (refs.length) root.appendChild(buildRefs(refs));
    document.body.appendChild(root);

    /* mermaid antes de paginar (Paged congela el layout) */
    if (root.querySelector('pre.mermaid')) {
      say('renderizando diagramas…');
      await renderMermaid();
    }

    /* medir con las fuentes reales y las imágenes ya decodificadas,
       si no Paged.js pagina con alturas equivocadas */
    say('cargando fuentes e imágenes…');
    await document.fonts.ready;
    await Promise.all(Array.prototype.map.call(root.querySelectorAll('img'), function (img) {
      return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
    }));

    /* con las alturas ya reales (fuentes+imágenes), atar cada título a un
       colchón de contenido para que ninguna sección arranque al pie */
    parts.forEach(function (part) { keepHeadingsWithContent(part.content); });

    say('paginando (Paged.js)…');
    statusEl.remove();
    /* nada ajeno al informe debe entrar a la paginación */
    document.querySelectorAll('body > script').forEach(function (s) { s.remove(); });
    var empty = document.getElementById('pf-empty');
    if (empty) empty.remove();

    await window.PagedPolyfill.preview();
    fillPageNumbers();
    stylePreview();
    addToolbar();
    /* señal para scripts/build-pdf.mjs (y cualquier headless): documento listo */
    document.documentElement.dataset.pfReady = '1';
  }

  /* Paged.js elimina las reglas @media screen y promueve las @media print a
     "siempre" (para previsualizar el print en pantalla). Eso deja el visor sin
     el centrado de hojas → las páginas se pegan a la izquierda. No hay forma de
     apuntar "solo pantalla" por CSS tras Paged, así que el centrado va inline.

     OJO (bug de la hoja en blanco en Firefox): Paged.js 0.4.3 NO tiene ninguna
     `@media print { .pagedjs_pages { display:block !important } }`, así que
     cualquier estilo de visor sobre `.pagedjs_pages` (flex, gap, …) SÍ entra a
     la impresión y Gecko lo fragmenta mal (hojas en blanco). Por eso:
       1) el centrado se hace con `margin: 0 auto` en cada `.pagedjs_page` — es
          inerte al imprimir (ahí el ancho de la hoja == ancho del contenedor,
          así que los márgenes auto valen 0) y NO se toca el contenedor;
       2) igual, antes de imprimir se quitan TODOS los estilos de visor
          (beforeprint) y se reponen después (afterprint), de modo que el PDF
          es exactamente la salida de Paged.js (que en Chromium es impecable). */
  function stylePreview() {
    var pages = document.querySelector('.pagedjs_pages');
    if (!pages) return;
    var previewNodes = Array.prototype.slice.call(pages.querySelectorAll('.pagedjs_page'));

    function applyPreview() {
      previewNodes.forEach(function (pg) {
        pg.style.marginLeft = 'auto';
        pg.style.marginRight = 'auto';
        pg.style.boxShadow = '0 2px 20px rgba(36, 31, 49, .14)';
      });
    }
    function clearPreview() {
      previewNodes.forEach(function (pg) {
        pg.style.marginLeft = '';
        pg.style.marginRight = '';
        pg.style.boxShadow = '';
      });
    }
    applyPreview();
    window.addEventListener('beforeprint', clearPreview);
    window.addEventListener('afterprint', applyPreview);
  }

  /* números de página del índice: en vez de target-counter() de CSS (que en
     esta versión de Paged.js resolvía a 0), se leen del DOM ya paginado —
     en qué .pagedjs_page cayó el ancla de cada entrada */
  function fillPageNumbers() {
    var pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'));
    document.querySelectorAll('.pf-mtoc a').forEach(function (a) {
      var span = a.querySelector('.pf-mtoc-p');
      var href = a.getAttribute('href');
      if (!span || !href || href.charAt(0) !== '#') return;
      var target;
      try { target = document.getElementById(decodeURIComponent(href.slice(1))); }
      catch (e) { target = null; }
      var page = target && target.closest('.pagedjs_page');
      var n = page ? (page.getAttribute('data-page-number') || (pages.indexOf(page) + 1)) : null;
      span.textContent = n || '—';
    });
  }

  /* ================= fetch + extracción ================= */

  async function fetchPart(slug) {
    var url = new URL(base + slug + '/print.html', location.href);
    var res;
    try {
      res = await fetch(url);
    } catch (e) { res = null; }
    if (!res || !res.ok) {
      console.warn('[informe] pieza omitida (no se pudo cargar):', slug);
      return null;
    }
    var doc = new DOMParser().parseFromString(await res.text(), 'text/html');

    var content = doc.querySelector('.pf-content');
    if (!content) { console.warn('[informe] pieza omitida (sin .pf-content):', slug); return null; }

    var meta = {};
    doc.querySelectorAll('.pf-meta dt').forEach(function (dt) {
      var dd = dt.nextElementSibling;
      if (dd) meta[dt.textContent.trim()] = dd.textContent.trim();
    });

    return {
      slug: slug,
      url: url,
      title: text(doc.querySelector('.pf-title')) || slug,
      tagline: text(doc.querySelector('.pf-tagline')),
      date: meta['fecha'] || '',
      tags: meta['tags'] || '',
      toc: doc.querySelector('.pf-toc nav'),
      content: document.adoptNode(content)
    };
  }

  function text(el) { return el ? el.textContent.trim() : ''; }

  /* tags como lista, sin el tag interno "proyecto" (portafolio) — el tema lo
     excluye en la nube de tags y en terms.html; acá igual */
  function tagList(str) {
    return (str || '').split('·').map(function (t) { return t.trim(); })
      .filter(function (t) { return t && t !== 'proyecto'; });
  }

  /* ================= normalización por pieza ================= */

  function preparePart(part, parts, refs) {
    var c = part.content;
    c.classList.add('pf-part-body');

    /* URLs relativas del post (imágenes de page bundles, etc.) → absolutas
       respecto de SU url original, no de /informes/ */
    c.querySelectorAll('[src]').forEach(function (el) {
      el.setAttribute('src', new URL(el.getAttribute('src'), part.url).href);
    });
    /* el print del post trae loading="lazy": acá TODO tiene que cargar antes de
       paginar — una imagen que llega después de preview() reflowea dentro de
       hojas ya cortadas (huecos y páginas en blanco), y el await de img.decode()
       puede quedar pendiente para siempre si el navegador nunca la pide */
    c.querySelectorAll('img[loading]').forEach(function (img) {
      img.setAttribute('loading', 'eager');
    });
    c.querySelectorAll('img[srcset], source[srcset]').forEach(function (el) {
      el.setAttribute('srcset', el.getAttribute('srcset').split(',').map(function (c0) {
        var seg = c0.trim().split(/\s+/);
        seg[0] = new URL(seg[0], part.url).href;
        return seg.join(' ');
      }).join(', '));
    });

    prefixAnchors(c, part.slug);
    if (part.toc) {
      part.toc.removeAttribute('id');   // Hugo emite id="TableOfContents": colisiona
      prefixAnchors(part.toc, part.slug);
    }

    /* enlaces a OTRAS piezas del informe → ancla interna de su portadilla */
    var members = {};
    parts.forEach(function (p) { members[p.slug] = true; });
    c.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (href.charAt(0) === '#') return;
      var u;
      try { u = new URL(href, part.url); } catch (e) { return; }
      if (u.origin !== location.origin) {
        a.setAttribute('href', u.href);   // absolutizar enlaces relativos salientes
        return;
      }
      var m = u.pathname.match(/\/posts\/([^\/]+)\/?(?:print\.html)?$/);
      if (m && members[m[1]]) {
        /* con ancla → al heading prefijado de esa pieza; sin ancla → a su portadilla */
        var target = u.hash ? m[1] + '-' + u.hash.slice(1) : 'pf-part--' + m[1];
        a.setAttribute('href', '#' + target);
      } else {
        a.setAttribute('href', u.href);
      }
    });

    extractRefs(part, refs);
  }

  function prefixAnchors(rootEl, slug) {
    rootEl.querySelectorAll('[id]').forEach(function (el) {
      el.id = slug + '-' + el.id;
    });
    rootEl.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.setAttribute('href', '#' + slug + '-' + a.getAttribute('href').slice(1));
    });
  }

  /* saca la sección "Referencias" de la pieza y acumula sus <li> */
  function extractRefs(part, refs) {
    var h2 = Array.prototype.find.call(part.content.querySelectorAll('h2'), function (h) {
      return /^referencias\b/i.test(h.textContent.trim());
    });
    if (!h2) return;

    var doomed = [h2];
    var node = h2.nextElementSibling;
    while (node && node.tagName !== 'H2') {
      doomed.push(node);
      node = node.nextElementSibling;
    }
    doomed.forEach(function (n) {
      n.querySelectorAll && n.querySelectorAll('li').forEach(function (li) {
        var a = li.querySelector('a[href]');
        var key = a ? a.href.replace(/\/+$/, '').toLowerCase() : li.textContent.trim().toLowerCase();
        if (!refs.some(function (r) { return r.key === key; })) {
          refs.push({ key: key, li: li });
        }
      });
      n.remove();
    });

    /* si el TOC de la pieza listaba "Referencias", quitar esa entrada */
    if (part.toc) {
      part.toc.querySelectorAll('a').forEach(function (a) {
        if (/^referencias\b/i.test(a.textContent.trim())) {
          var li = a.closest('li');
          if (li) li.remove();
        }
      });
    }
  }

  /* ================= construcción del documento ================= */

  function el(tag, cls, textContent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (textContent) e.textContent = textContent;
    return e;
  }

  function buildCover(parts) {
    var cover = el('header', 'pf-cover');

    var top = el('div', 'pf-cover-top');
    top.appendChild(el('span', 'pf-mark', '✦'));
    var brand = el('div');
    brand.appendChild(el('div', 'pf-wm', 'dust115 · skullfox archive'));
    brand.appendChild(el('div', 'pf-wm-sub', 'offensive & defensive security'));
    top.appendChild(brand);
    cover.appendChild(top);

    var mid = el('div', 'pf-cover-mid');
    mid.appendChild(el('div', 'pf-kicker', 'informe combinado · ' + parts.length + (parts.length === 1 ? ' pieza' : ' piezas')));
    var h1 = el('h1', 'pf-title', docTitle);
    mid.appendChild(h1);
    if (docSub) mid.appendChild(el('p', 'pf-tagline', docSub));
    cover.appendChild(mid);

    var dl = el('dl', 'pf-meta');
    function row(dt, dd) {
      dl.appendChild(el('dt', null, dt));
      dl.appendChild(el('dd', null, dd));
    }
    row('contiene', parts.map(function (p) { return p.title; }).join('  ·  '));
    var tagset = [];
    parts.forEach(function (p) {
      tagList(p.tags).forEach(function (t) {
        if (tagset.indexOf(t) === -1) tagset.push(t);
      });
    });
    if (tagset.length) row('tags', tagset.join(' · '));
    row('snapshot', new Date().toISOString().slice(0, 10));
    cover.appendChild(dl);

    var foot = el('div', 'pf-cover-foot');
    foot.appendChild(el('span', null, 'TLP:CLEAR'));
    foot.appendChild(el('span', null, 'una huella en la piedra digital'));
    cover.appendChild(foot);

    return cover;
  }

  function buildMasterToc(parts) {
    var nav = el('nav', 'pf-toc pf-mtoc');
    nav.appendChild(el('h2', null, 'Índice'));
    var ol = el('ol', 'pf-mtoc__parts');

    parts.forEach(function (part) {
      var li = el('li');
      var a = el('a', 'pf-mtoc__part');
      a.setAttribute('href', '#pf-part--' + part.slug);
      a.appendChild(el('span', 'pf-mtoc-t', part.n + '. ' + part.title));
      a.appendChild(el('i', 'pf-mtoc-l'));
      a.appendChild(el('span', 'pf-mtoc-p'));   /* nº de página, lo llena fillPageNumbers() */
      li.appendChild(a);

      if (part.toc) {
        var ul = part.toc.querySelector('ul');
        if (ul && ul.querySelector('a')) {
          /* re-estructurar cada enlace del sub-TOC: texto + leader + nº de pág */
          ul.querySelectorAll('a').forEach(function (sa) {
            var t = el('span', 'pf-mtoc-t');
            while (sa.firstChild) t.appendChild(sa.firstChild);
            sa.appendChild(t);
            sa.appendChild(el('i', 'pf-mtoc-l'));
            sa.appendChild(el('span', 'pf-mtoc-p'));
          });
          var sub = el('div', 'pf-mtoc__sub');
          sub.appendChild(document.adoptNode(ul));
          li.appendChild(sub);
        }
      }
      ol.appendChild(li);
    });

    nav.appendChild(ol);
    return nav;
  }

  function buildPartCover(part, total) {
    var sec = el('section', 'pf-part');
    sec.id = 'pf-part--' + part.slug;
    sec.appendChild(el('div', 'pf-part__kicker', 'parte ' + part.n + ' / ' + total));
    var h2 = el('h2', 'pf-part__title', part.title);
    sec.appendChild(h2);
    if (part.tagline) sec.appendChild(el('p', 'pf-part__tagline', part.tagline));
    var meta = el('div', 'pf-part__meta');
    if (part.date) meta.appendChild(el('span', null, part.date));
    var ptags = tagList(part.tags);
    if (ptags.length) meta.appendChild(el('span', null, ptags.join(' · ')));
    sec.appendChild(meta);
    return sec;
  }

  function buildRefs(refs) {
    var sec = el('section', 'pf-refs');
    sec.appendChild(el('h2', null, 'Referencias'));
    var ol = el('ol');
    refs.forEach(function (r) {
      var li = document.adoptNode(r.li);
      ol.appendChild(li);
    });
    sec.appendChild(ol);
    return sec;
  }

  /* ================= mermaid + toolbar ================= */

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
      /* etiquetas como <text> SVG, no <foreignObject>: sobreviven a Paged.js
         y a la impresión (si no, se ven solo las flechas, sin cajas ni texto) */
      htmlLabels: false, flowchart: { htmlLabels: false },
      themeVariables: {
        darkMode: false, background: '#ffffff',
        primaryColor: '#f3ecfa', primaryTextColor: '#241f31', primaryBorderColor: '#9141ac',
        secondaryColor: '#eadcf6', tertiaryColor: '#faf7fc',
        lineColor: '#9141ac', fontFamily: "'Fira Code', monospace"
      }
    });
    await mermaid.run({ querySelector: 'pre.mermaid' });

    /* Paged.js corrompe los <svg> inline al clonarlos (pierde los <text> y
       les infla la altura → SVG vacío e inquebrable que dispara "Layout
       repeated" y trunca el flujo). Serializamos cada diagrama ya renderizado
       a un <img> data-URI: un átomo que Paged.js clona sin tocar. Con
       htmlLabels:false el SVG no tiene <foreignObject>, así que rasteriza
       limpio dentro del <img>. */
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

  /* La barra usa la clase propia `pf-cbar` (NO `pf-toolbar`): Paged.js promueve
     las @media print de report.css/collection.css a "siempre", y ahí vive
     `.pf-toolbar{display:none!important}` — con ese nombre la barra quedaría
     oculta también en el visor (no se podía tocar "Exportar PDF"). Con clase
     propia esa regla no la alcanza. Para el print real no se usa @media (Paged
     también la promovería): se oculta con los eventos beforeprint/afterprint,
     que son de motor y no dependen del CSS. */
  function addToolbar() {
    var bar = el('div', 'pf-cbar');
    /* Paged.js quita `position: fixed` de las hojas (rompe su modelo de
       paginación), así que el anclaje va inline — Paged no toca los estilos
       inline de un elemento agregado después de preview(). */
    bar.style.position = 'fixed';
    bar.style.top = '14px';
    bar.style.right = '14px';
    bar.style.zIndex = '50';
    var btn = el('button', null, '⎙ Exportar PDF');
    btn.addEventListener('click', function () { window.print(); });
    bar.appendChild(btn);
    var edit = el('a', 'pf-cbar-edit', '✎ constructor');
    edit.setAttribute('href', builderUrl + '?' + qs.toString());
    bar.appendChild(edit);
    bar.appendChild(el('span', 'pf-cbar-hint', 'A4 · Ctrl/Cmd + P → Guardar como PDF'));
    document.body.appendChild(bar);

    /* que la barra no salga impresa en el PDF */
    window.addEventListener('beforeprint', function () { bar.style.display = 'none'; });
    window.addEventListener('afterprint', function () { bar.style.display = ''; });
  }
})();
