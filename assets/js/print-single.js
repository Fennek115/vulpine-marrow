/* Formato inteligente del print de post individual (single.print.html).
   Aplica el mismo keep título+colchón del informe combinado (print-keep.js),
   pero sobre la impresión NATIVA del navegador (acá no hay Paged.js): el
   navegador respeta el `break-inside: avoid` del envoltorio .pf-keep, cosa
   que `break-after: avoid` a secas no logra (Gecko lo ignora). */

import { keepHeadingsWithContent } from './print-keep.js';

(async function () {
  /* señal para scripts/build-pdf.mjs (y cualquier headless): documento listo */
  function ready() { document.documentElement.dataset.pfReady = '1'; }

  var root = document.querySelector('.pf-content');
  if (!root) { ready(); return; }

  /* el contenido del post trae loading="lazy": para medir alturas reales (y
     para que ninguna imagen falte al imprimir) acá se carga todo de una */
  root.querySelectorAll('img[loading]').forEach(function (img) {
    img.setAttribute('loading', 'eager');
  });

  /* mermaid re-renderiza async en su propio <script>: esperar a que cada
     pre.mermaid tenga su <svg> antes de medir (con tope defensivo) */
  function mermaidPending() {
    return Array.prototype.some.call(document.querySelectorAll('pre.mermaid'), function (p) {
      return !p.querySelector('svg');
    });
  }
  var t0 = Date.now();
  while (mermaidPending() && Date.now() - t0 < 10000) {
    await new Promise(function (r) { setTimeout(r, 150); });
  }

  await document.fonts.ready;
  await Promise.all(Array.prototype.map.call(root.querySelectorAll('img'), function (img) {
    return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
  }));

  keepHeadingsWithContent(root);
  ready();
})();
