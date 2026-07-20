# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Changed
- **Ruta crítica de render más corta** (regla de los ~14 kB del primer
  round-trip): los `@font-face` de Fira Code van ahora **inline** en el
  `<head>` (con `url()` vía `absURL`) en vez de un `<link>` a
  `vm/tokens/fonts.css` — un request CSS bloqueante menos y descubrimiento
  de fuentes en el primer parse del HTML; se agrega `preload` del subset
  latino (`firacode-4.woff2`) y `defer` en el bundle JS del footer.
  `static/vm/tokens/fonts.css` se conserva para los layouts *print* (PDF).

## [0.5.0] — 2026-07-07

### Added
- **Export PDF de posts (output format `print`)**: vista de impresión standalone
  por post (`/posts/<slug>/print.html`, layout `_default/single.print.html`,
  hoja `assets/css/print/report.css`). Página CLARA A4 con portada sobria,
  índice único, pie corrido con marca + número de página (`@page` margin
  boxes), y reglas anti-corte: tablas enteras con `<thead>` repetido,
  `break-after: avoid` en títulos, `orphans/widows`. Botón «⎙ PDF» en el
  single del blog. El sitio decide qué secciones lo emiten (cascade
  `outputs`); mermaid se re-renderiza con paleta clara.
- **Constructor de informes PDF combinados** (sección `informes`): página
  `layouts/informes/list.html` para elegir posts y su orden (filtro, ↑/↓,
  título/subtítulo), y vista `layouts/informes/list.print.html` que ensambla
  el documento **client-side** desde el `print.html` de cada pieza
  (`js/informe-doc.js`): portada maestra, índice maestro H2/H3 con números
  de página reales, portadillas por pieza, IDs/anclas prefijados por slug,
  enlaces entre piezas reescritos a anclas internas y sección «Referencias»
  consolidada (dedupe por URL). La portada lista los tags combinados de todas
  las piezas (dedupe, sin el tag interno `proyecto`) y cada portadilla los tags
  de su post — no se imprime ninguna URL. La selección viaja en la URL
  (`print.html?p=slug1,slug2&t=Título`), así cualquier combinación es un
  enlace reproducible — no hay colecciones precocinadas. El botón «⎙ PDF» del
  post (junto a los tags) es el **único** acceso a la exportación: enlaza al
  constructor precargado con ese post (`/informes/?p=<slug>&t=<título>`), sin
  una vía de PDF paralela.
- **Paged.js 0.4.3 vendoreado** (MIT, `static/vm/js/paged.polyfill.min.js`):
  pagina el informe combinado en el navegador; habilita `string-set` (running
  header con la parte actual) y la maqueta multipágina. Los números de página
  del índice se calculan en JS tras paginar (leyendo el `data-page-number` de
  la `.pagedjs_page` donde cae cada ancla) porque `target-counter()` de CSS
  resolvía a 0 en esta versión. Solo se carga en la vista de colección; el
  print de post individual sigue sin dependencias. Hoja propia
  `assets/css/print/collection.css`.
- **Saltos de página "inteligentes" (las DOS vistas de print)**: antes una
  sección podía arrancar al pie de la hoja (título + 1–2 líneas y corte, o el
  título directamente varado solo). Con las alturas ya reales,
  `keepHeadingsWithContent()` (módulo compartido `assets/js/print-keep.js`)
  envuelve cada título (h2/h3/h4) junto a un colchón de contenido siguiente
  (~200px, hasta el próximo título, con tope de ~340px) en un `.pf-keep {
  break-inside: avoid }` (regla en report.css): si el grupo no entra al pie,
  baja entero → la sección arranca limpia. Los `<p>` vacíos (residuo de
  shortcodes en Markdown) tienen altura 0 y NO cuentan como colchón. Si lo que
  sigue al título es UN bloque grande (figura/tabla/código), también se atan —
  pero solo si el grupo cabe entero en una hoja (~920px): ese límite es lo que
  evita la hoja en blanco (grupo inquebrable > página); si no cabe, el bloque
  pagina solo (las tablas repiten cabecera). Lo usan el informe combinado
  (`informe-doc.js`, antes de Paged.js) y el print de post individual
  (`js/print-single.js`, nuevo: espera mermaid + fuentes + imágenes y envuelve
  para la impresión nativa, donde Gecko ignora `break-after: avoid`).

- **Señal `data-pf-ready` en `<html>`** al terminar de preparar cada vista de
  print (keeper aplicado; en el informe, Paged.js ya paginado): la esperan los
  scripts headless que pre-generan PDFs (p. ej. `scripts/build-pdf.mjs` del
  sitio) para capturar en el momento correcto.

### Fixed
- **Informe combinado: imágenes `loading="lazy"` rompían la paginación (hojas
  en blanco intercaladas / ensamblado colgado).** El print de cada post trae
  las imágenes con `loading="lazy"`; en el informe eso significaba que las que
  quedaban bajo el pliegue no cargaban antes de `preview()`: Paged.js paginaba
  con alturas falsas y, cuando las imágenes por fin llegaban, refloweaban
  contenido dentro de hojas ya cortadas (huecos y páginas en blanco a mitad
  del documento). Además el `await img.decode()` podía quedar pendiente para
  siempre (colgado en «cargando fuentes e imágenes…»). Fix en `informe-doc.js`:
  forzar `loading="eager"` en todas las imágenes de cada pieza antes de
  esperar su `decode()`.
- **Print: una imagen más alta que la hoja dejaba hojas en blanco.** Las
  imágenes de contenido solo tenían `max-width`; un retrato grande excedía el
  alto de página y, con `break-inside: avoid` en la figura, Paged.js entraba
  en «Layout repeated» (y la impresión nativa recortaba). Ahora
  `.pf-content img/svg` llevan `max-height: 200mm` (report.css), preservando
  proporción.
- **Informe combinado en Firefox: botón «Exportar PDF» invisible y hojas
  pegadas a la izquierda en el visor.** Paged.js, para previsualizar el print
  en pantalla, **elimina las reglas `@media screen` y promueve las `@media
  print` a “siempre”**. Eso hacía que `@media print { .pf-toolbar {
  display:none } }` ocultara la barra también en el visor (no se podía tocar
  el botón) y que el centrado de hojas (que vivía en `@media screen`)
  desapareciera (las páginas quedaban a la izquierda). Como tras Paged.js no
  hay forma de apuntar «solo pantalla» por CSS, ambos se resuelven por JS
  (`informe-doc.js`): la barra usa clase propia `pf-cbar` con anclaje inline
  (`position: fixed`, que Paged.js también quita de las hojas) y se oculta al
  imprimir vía `beforeprint`/`afterprint`; el centrado del visor se aplica como
  estilo inline (`margin: 0 auto` en cada `.pagedjs_page`, inerte al imprimir
  porque ahí el ancho de la hoja == el del contenedor).
- **Informe combinado: el centrado del visor contaminaba la impresión (posible
  causa de la hoja en blanco en Firefox).** La versión previa centraba con
  `display:flex; gap:8mm` sobre `.pagedjs_pages`, creyendo que Paged.js forzaba
  `display:block!important` al imprimir — pero Paged.js 0.4.3 **no** tiene esa
  regla, así que el `gap:8mm` entre 35 hojas A4 entraba al PDF y Gecko lo
  fragmentaba mal. Ahora el centrado es `margin:0 auto` (inerte al imprimir) y,
  por las dudas, `beforeprint` quita TODOS los estilos de visor y `afterprint`
  los repone → el PDF es exactamente la salida de Paged.js.
- **Informe combinado: `size: A4` explícito en la página nombrada `cover`.**
  Sin él, Paged.js le asignaba su tamaño por defecto (letter) y quedaban dos
  `@page` con size distinto (letter + a4) en el print real — ambigüedad que
  Gecko puede resolver metiendo una hoja en blanco.
- **Informe combinado: hoja en BLANCO al inicio del PDF (Firefox) y páginas
  sin pie.** La portada usa `page: cover` para no llevar pie corrido, pero
  Paged.js **propaga el nombre de página hacia adelante**: sin reancla, `cover`
  se derramaba a ~11 páginas (índice, portadillas, contenido), que quedaban
  sin pie y, en Firefox, provocaban una hoja en blanco al comienzo. Fix:
  reanclar al `@page` por defecto todo lo posterior a la portada
  (`.pf-mtoc, .pf-part, .pf-refs { page: auto }`) — la portada leak baja de 11
  a 1 página.
- **Informe combinado: mermaid quedaba en blanco y truncaba el documento.**
  Verificado con Chromium headless: Paged.js corrompe los `<svg>` inline al
  clonarlos (pierde los `<text>`, infla la altura ~1148px); ese SVG vacío e
  inquebrable disparaba `"Layout repeated"` y **cortaba el flujo** (9 páginas
  en vez de 35, con hojas en blanco al final y números de índice sin resolver).
  Fix: tras `mermaid.run`, cada diagrama se serializa a un `<img>` data-URI —
  átomo que Paged.js clona intacto — con la altura acotada (`max-height`) para
  que nunca exceda una página. En print de post individual (impresión nativa
  del navegador, sin Paged.js) el SVG inline se conserva, con
  `htmlLabels: false` para etiquetas SVG en vez de `<foreignObject>`.
- **Informe combinado: los números del índice salían «0» / faltaban.**
  `target-counter()` de CSS resolvía a 0 en Paged.js 0.4.3; ahora se calculan
  en JS tras paginar. (Con el flujo ya completo, los 60 renglones resuelven.)
- **Informe combinado: portadillas ya no dejan el título colgado.** La
  portadilla de cada pieza era un bloque pesado (borde grueso + márgenes) que
  stranded un par de líneas de contenido antes del salto; ahora es un
  separador fino con `break-after: avoid`, así el contenido arranca en la
  misma página que su título y fluye continuo.
- **`single.print.html`: el contenido con wikilinks salía escapado.** El
  partial `wikilinks.html` devuelve string cuando resuelve `[[ ]]`
  (`replaceRE`), y la vista print no lo pasaba por `safeHTML`, así que todo
  post con wikilinks imprimía su HTML como texto plano.

## [0.4.3] — 2026-07-04

### Fixed
- **Lightbox: los SVG inline estilizados por CSS descendente ya no pierden su
  estilo al ampliarse.** El clon que va al stage era el `<svg>` pelado, así que
  las piezas del laboratorio (`.codice-svg`) quedaban sin colores, sin fuentes
  y sin animaciones (una mancha oscura sobre el fondo del overlay). Ahora
  `lightbox.js` conserva el wrapper con sus clases al clonar, y
  `skin/09-lightbox.css` neutraliza solo su layout de página
  (margen/máximos) — el marco de la pieza se conserva y las animaciones
  siguen corriendo dentro del lightbox.
- **Lightbox: topes CSS del stage alineados con `sizeTo()`** (92vw/88vh en
  ambos lados). El desajuste anterior (90vw/86vh en CSS vs 0.92/0.88 en JS)
  podía recortar un solo eje del clon y deformar la relación de aspecto.
- **Pieza `codice-svg/terminal`: ojos `parpado` reposicionados.** Los grupos
  animados tenían el `translate` de posición como atributo `transform` y la
  animación CSS de parpadeo (que también anima `transform`) lo pisaba,
  desplazando los ojos al origen del SVG. El translate ahora vive en un `<g>`
  externo propio y la clase animada en un `<g>` interno.

## [0.4.2] — 2026-07-02

### Added
- **Nube de tags en `/synapsis/`**: nueva sección entre el grafo y el índice
  cronológico que expone el vocabulario de tags del blog (hasta ahora `/tags/`
  se generaba pero no estaba enlazado en ninguna parte). Cada tag se dimensiona
  por frecuencia de uso y enlaza a su taxonomía `/tags/<t>/`. Se construye solo
  desde los posts (`Type` `posts`), así el Códice —que usa su propio esquema
  `códice` + era— no entra; el tag interno `proyecto` (portafolio) se omite,
  igual que en `terms.html`. Estilos en `skin/08-synapsis.css` (`.tag-cloud`).

## [0.4.1] — 2026-07-02

### Fixed
- **Wikilinks en texto plano**: los `[[clave|alias]]` ya no aparecen literales en
  la meta `description`/`og:description`, en los summaries de los listados
  (`post-card`), en el índice del buscador (`index.json`) ni en el feed RSS. El
  partial `wikilinks.html` solo opera sobre el `.Content` renderizado (vista
  single); estos contextos usan `.Summary`/`.Plain`/`.Description`, donde los
  `[[ ]]` sobrevivían. Nuevo partial `wikilinks-plain.html` reduce la sintaxis a
  su texto visible (`[[clave|alias]] → alias`, `[[clave]] → clave`) sin enlace, y
  se aplica en `head.html`, `post-card.html`, `index.json` y un override
  `_default/rss.xml`.

## [0.4.0] — 2026-07-01

### Added
- **Grafo de Synapsis auto-actualizable**: además de las aristas por wikilink
  explícito (flecha sólida), el grafo suma **aristas por afinidad temática**
  (línea punteada `-.-`) calculadas en cada build con el motor *Related
  Content* de Hugo (config `[related]`: `tags`/`series`/`date`). Top 3 por
  post, pares deduplicados, sin repetir los ya citados por wikilink, y solo
  entre posts del blog (las secciones tipo libro no entran automático). Un
  post nuevo aparece en el grafo por sus tags sin necesidad de citarlo a mano.
- **«Notas relacionadas»** (`partials/related.html`): hasta 3 posts afines al
  pie de cada entrada del blog, con el mismo motor Related; automático, sin
  tocar el contenido. Reutiliza las clases CSS de backlinks (sin CSS nuevo).
- **Lightbox en el grafo de Synapsis**: `lightbox.js` también se engancha a
  `.syn-graph` (antes solo `.post-content`), así el grafo se abre a pantalla
  completa con zoom/pan/pinch como cualquier mermaid de un post. Los clicks
  sobre nodos (enlaces `click` de mermaid) no se interceptan; cursor `zoom-in`
  en el lienzo y `pointer` sobre los nodos (`09-lightbox.css`).

Detalle en [`docs/features.md`](docs/features.md).

## [0.3.0] — 2026-06-29

### Added
- **Búsqueda full-text** sin dependencias ni CDN: índice `index.json` generado en
  build (output JSON de la home, `layouts/index.json`) + `js/search.js` (tokeniza
  sin diacríticos, scoring AND con peso por campo —título/tag/summary/cuerpo—,
  resaltado `<mark>`, snippet de contexto, carga **perezosa** del índice y prefill
  desde `?q=`). Página `/buscar/` (`layout: "search"`, `layouts/_default/search.html`)
  y acceso con **icono de lupa** en el header, junto al toggle de tema. El índice
  cubre **sólo el blog** (`Type == "posts"`, excluida la serie del Códice), con el
  `content` **capado a 8000 chars** por entrada para acotar el peso del índice.
  Estilos en `10-portafolio-search.css`; `search.js` se suma al bundle JS del footer.
- **Landing de portafolio por tag** (`layouts/portafolio/list.html`): reúne los
  posts etiquetados `proyecto` bajo `/portafolio/` (orden por fecha, reusa
  `post-card.html`) sin sacarlos del stream del blog. El tag `proyecto` es
  **interno**: se oculta de los chips de los posts (`post-card.html`) y de la lista
  de términos (`terms.html`).

Detalle de cada feature en [`docs/features.md`](docs/features.md).

## [0.2.0] — 2026-06-20

### Added
- **Lightbox** sin dependencias (`js/lightbox.js` + `09-lightbox.css`): click/tap
  en imágenes, SVG o diagramas mermaid abre un overlay a pantalla completa con
  zoom (rueda), *pan* (arrastre), **pinch** táctil de dos dedos, barra de
  controles y atajos de teclado (`+`/`-`/`0`/`Esc`). Delegación de eventos sobre
  `.post-content` para que funcione con SVG renderizados async.
- **Tablas responsive** (`layouts/_default/_markup/render-table.html`): las tablas
  markdown se envuelven en `.table-wrap` con scroll horizontal **dentro de su
  caja** (no empujan el ancho de la página), *scroll shadows* sin JS como pista de
  desplazamiento (sombra **violeta** de la paleta, visible en móvil), y celdas que
  ya no se cortan a mitad de palabra.
- Botón flotante **«subir al inicio»** (`#vm-top`): aparece tras desplazarse,
  scroll suave (respeta `prefers-reduced-motion`), violeta sólido con flecha
  blanca y `env(safe-area-inset-bottom)` para el notch. Vive en el footer y se
  suma al bundle JS (`js/backtotop.js`).

### Changed
- **Tipografía y ancho de lectura** de los posts: columna de lectura unificada y
  anchos manejados por tokens de espaciado; prosa justificada e imágenes/figuras
  centradas para una lectura más pareja (`02-layout.css`, `tokens/spacing.css`,
  `07-shortcodes.css`).

Detalle de cada feature en [`docs/features.md`](docs/features.md).

## [0.1.0] — 2026-06-19

Primera versión: extracción del *skin* Vulpine Marrow del sitio dust115 a un tema
Hugo autónomo.

### Added
- Tema **standalone** derivado de Terminal (panr, MIT): se vendorizaron las
  piezas base necesarias y se cortó la dependencia.
- Modo claro / oscuro con toggle en el header, persistencia en `localStorage` y
  anti-FOUC.
- Tokens del design system (`assets/css/tokens/`) + Fira Code self-hosted.
- Diagramas **mermaid theme-aware** (carga condicional + re-render al cambiar de
  tema).
- **Digital garden**: wikilinks `[[ ]]` y backlinks «Mencionado en».
- Página **Synapsis**: grafo dirigido de los wikilinks (mermaid/dagre) + índice
  cronológico.
- Listado feed de columna única; navegación prev/next consciente de la serie;
  TOC opt-in.
- Shortcodes: `listening`, `ascii`, `commit`, `codice-list`, `callout`,
  `command`, `figure`, `badge`, `tlp`.
- Pipeline de CSS en un bundle ordenado (tokens → base → skin),
  `Concat`+`minify`+`fingerprint`.
- Logo de texto parametrizable vía `params.logo.logoText` (default `dust115`).
- `exampleSite/` con posts de demostración que ejercitan todas las features.
- Capturas en `images/` (`screenshot.png`, `tn.png` y showcase) + footer con
  lema «mortui vivos docent» y enlace al repo.
- Documentación en `docs/` (architecture, configuration, features, shortcodes).
