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

    say('paginando (Paged.js)…');
    statusEl.remove();
    /* nada ajeno al informe debe entrar a la paginación */
    document.querySelectorAll('body > script').forEach(function (s) { s.remove(); });
    var empty = document.getElementById('pf-empty');
    if (empty) empty.remove();

    await window.PagedPolyfill.preview();
    addToolbar();
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
      source: meta['fuente'] || url.href.replace(/print\.html$/, ''),
      toc: doc.querySelector('.pf-toc nav'),
      content: document.adoptNode(content)
    };
  }

  function text(el) { return el ? el.textContent.trim() : ''; }

  /* ================= normalización por pieza ================= */

  function preparePart(part, parts, refs) {
    var c = part.content;
    c.classList.add('pf-part-body');

    /* URLs relativas del post (imágenes de page bundles, etc.) → absolutas
       respecto de SU url original, no de /informes/ */
    c.querySelectorAll('[src]').forEach(function (el) {
      el.setAttribute('src', new URL(el.getAttribute('src'), part.url).href);
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
    row('fuente', document.body.dataset.site || location.origin);
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
    meta.appendChild(el('span', null, part.source));
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

  async function renderMermaid() {
    var mermaid = (await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')).default;
    mermaid.initialize({
      startOnLoad: false, theme: 'base', securityLevel: 'loose',
      themeVariables: {
        darkMode: false, background: '#ffffff',
        primaryColor: '#f3ecfa', primaryTextColor: '#241f31', primaryBorderColor: '#9141ac',
        secondaryColor: '#eadcf6', tertiaryColor: '#faf7fc',
        lineColor: '#9141ac', fontFamily: "'Fira Code', monospace"
      }
    });
    await mermaid.run({ querySelector: 'pre.mermaid' });
  }

  function addToolbar() {
    var bar = el('div', 'pf-toolbar');
    var btn = el('button', null, '⎙ Exportar PDF');
    btn.addEventListener('click', function () { window.print(); });
    bar.appendChild(btn);
    var edit = el('a', 'pf-edit', '✎ constructor');
    edit.setAttribute('href', builderUrl + '?' + qs.toString());
    bar.appendChild(edit);
    bar.appendChild(el('span', 'pf-hint', 'A4 · Ctrl/Cmd + P → Guardar como PDF'));
    document.body.appendChild(bar);
  }
})();
