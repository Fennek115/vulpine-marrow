# Arquitectura

Cómo está construido el tema por dentro. Para *usarlo* mirá
[`configuration.md`](configuration.md) y [`features.md`](features.md).

## Origen: standalone, derivado de Terminal

Vulpine Marrow nació como una capa de *skin* sobre el tema
[Terminal](https://github.com/panr/hugo-theme-terminal) de panr, pero terminó
**autónomo**: las piezas base que aún se usaban se vendorizaron dentro del tema
y se cortó la dependencia. No hace falta tener Terminal instalado.

Qué se heredó de Terminal (MIT, ver [`../LICENSE.md`](../LICENSE.md)):

| Pieza | Archivo | Rol |
|-------|---------|-----|
| Esqueleto HTML | `layouts/_default/baseof.html` | `<html>`, contenedor, bloques `main`/`footer` |
| Cabecera `<head>` | `layouts/partials/head.html` | meta + OG + carga de CSS (reescrito) |
| Pie | `layouts/partials/footer.html` | footer + bundle JS (reescrito: lema + repo) |
| Cover, comentarios, fecha, paginación | `partials/{cover,comments,post-date,pagination}.html` | utilidades sin cambios |
| Listado de taxonomías | `_default/terms.html` | índice de `/tags/` |
| CSS base | `assets/css/base/*.css` | reset, tipografía, code, syntax, etc. |
| JS | `assets/js/{code,menu}.js` | botón de copia en bloques + menú móvil |

Todo lo demás (single, list, term, index, 404, synapsis, search, las vistas
print, informes y whitepapers, los partials del garden, el header, los
shortcodes, el *skin* CSS y el resto del JS) es propio.

## Herencia de plantillas

`baseof.html` define el armazón y delega en bloques:

```
baseof.html
├── <head> → partial "head.html" → partial "extended_head.html"
├── partial "header.html" → partial "logo.html"
├── block "main"  ← lo definen single/list/term/index/synapsis/404
└── block "footer" → partial "footer.html" → partial "extended_footer.html"
```

- **`head.html`** arma el CSS (ver abajo) y mete metadatos OG/Twitter/RSS.
- **`extended_head.html`** inyecta el script anti-FOUC del modo claro (corre
  *antes* del primer paint) y un `<meta>` de ambientación del sitio.
- **`extended_footer.html`** cablea el toggle de tema y, si la página tiene
  diagramas, carga y re-renderiza mermaid.

## Pipeline de CSS

`head.html` produce **un solo bundle**, concatenando en orden explícito y luego
`minify` + `fingerprint`:

```
tokens/{colors,typography,spacing}.css   ← design system (define --vm-*)
        │
base/{buttons,code,footer,gist,header,   ← Terminal, orden alfabético original
      main,menu,pagination,post,syntax,
      terminal,terms}.css
        │
skin/{01-bridge … 11-codice-svg}.css     ← overrides Vulpine Marrow (ganan)
        ↓
/css/vm-bundle.<hash>.css                 ← un request, cacheable
```

El **orden importa**: los tokens definen las variables, la base de Terminal
pinta el chasis y el *skin* lo sobreescribe al final (como hacía el viejo
`static/style.css`). El bridge (`skin/01-bridge.css`) mapea las variables de
Terminal (`--background`, `--accent`, …) a los tokens `--vm-*`, así el modo
claro y la paleta se propagan solos.

### Las fuentes van aparte (y por qué)

Los `@font-face` de Fira Code **no** entran al bundle: `partials/head.html`
los inserta **inline** en un `<style>` del `<head>`, con cada `url()`
templado vía `absURL` (seguro bajo un `baseURL` con subpath). Inline en vez
de `<link>` por rendimiento: ahorra un request CSS bloqueante y el navegador
descubre las fuentes en el primer parse del HTML; además `head.html` hace
`preload` del subset latino (`firacode-4.woff2`), el único que usa casi toda
página. Si entraran al bundle fingerprinted (servido desde `/css/…`), una ruta
relativa se rompería — por eso son la única excepción al bundle.

`static/vm/tokens/fonts.css` (mismos `@font-face`, con `url(../fonts/)`
relativa) sigue existiendo: lo enlazan los layouts *print* (`single.print`,
`list.print`), que generan PDFs y no necesitan la optimización inline.

### El *skin* está partido en 10

`skin/01..11.css` nacieron como cortes contiguos del antiguo `static/style.css`;
del 09 en adelante son agregados posteriores. El número fija el orden de carga
(se concatena en secuencia). El `04` no existe: era el estilo de la vieja
sección del Códice, que se eliminó en 0.6.0 (lo que quedaba de `codice-list`
pasó a `07-shortcodes.css`). Reparto:

| Archivo | Contenido |
|---------|-----------|
| `01-bridge.css` | bridge de variables, body/fuente, links, tags, botones, code, header/footer, paginación, posts base |
| `02-layout.css` | ancho único del sitio (`--vm-home`), home curada, listado feed, vista de post (prosa justificada, imágenes/figuras centradas, tablas responsive) |
| `03-garden.css` | wikilinks + backlinks |
| `05-elements.css` | blockquotes, hr, estilo base de tablas, scrollbar, selección, callouts, TOC, mermaid |
| `06-header.css` | header de una fila, logo `dust115$`, botón de tema, menú |
| `07-shortcodes.css` | command / terminal / figure (centrada) / badge / tlp / codice-list |
| `08-synapsis.css` | página Synapsis (grafo de fuerzas, controles, leyenda, grupos de color `data-g`) |
| `09-lightbox.css` | lightbox de imágenes/SVG/mermaid (overlay, barra, sombras) |
| `10-portafolio-search.css` | landing del portafolio, buscador y filtro por año |
| `11-codice-svg.css` | piezas del shortcode `codice-svg` (trazo desde los tokens) |

## Pipeline de JS

`footer.html` pasa cada script por `js.Build` y los concatena en un
`bundle.js` minificado **y con `fingerprint`** (el hash en el nombre invalida la
caché del navegador cuando cambia el JS), cargado con `defer`:

| Script | Rol |
|--------|-----|
| `menu.js` | menú móvil de Terminal (inerte si no hay `.menu`, se conserva por compatibilidad) |
| `code.js` | botón de copia en bloques de código (`command` y `terminal` traen su propio script inline) |
| `lightbox.js` | visor de imágenes/SVG/mermaid (ver *Features*) |
| `backtotop.js` | botón «subir al inicio» |
| `yearfilter.js` | filtro por año compartido (`?y=`) |
| `search.js` | motor de búsqueda (solo actúa si hay `.vm-search`) |
| `synapsis.js` | grafo de Synapsis (solo actúa si hay `#syn-graph-data`) |

Cada script sale temprano si su página no tiene el elemento que necesita, así
que un solo bundle sirve a todo el sitio. El toggle de tema y la carga de
mermaid (autohospedado, `static/vm/js/mermaid.min.js`) los maneja
`extended_footer.html` inline.

### Pipeline de impresión (PDF)

Las vistas *print* (`_default/single.print.html`, `informes/list.print.html`,
`whitepapers/single.print.html`) son documentos aparte que **no** usan el bundle
del sitio. Cada una arma su propia hoja concatenando `assets/css/print/`
(`report.css` + `collection.css` o `whitepaper.css`, según el caso) y su
script:

- `print-single.js` — post individual, impresión nativa del navegador.
- `informe-doc.js` — informe combinado, ensamblado en el cliente y paginado
  con Paged.js (`static/vm/js/paged.polyfill.min.js`).
- `whitepaper-doc.js` — whitepaper, también con Paged.js.

Los tres usan `print-keep.js` para no dejar títulos colgados al pie de la hoja.
El print de un post carga mermaid con su propio `<script>`; el informe y el
whitepaper lo inyectan bajo demanda (`window.VM_MERMAID_SRC`). La página `informes/list.html` (el
constructor) usa `informes-builder.js`.

### Render hooks

`layouts/_default/_markup/` contiene los render hooks de markdown:

- `render-codeblock-mermaid.html` — detecta los bloques ```` ```mermaid ````.
- `render-table.html` — envuelve cada tabla en `<div class="table-wrap">` para
  el scroll horizontal responsive (ver *Features → Tablas*).
- `render-link.html` — los enlaces a otro host abren en pestaña nueva con
  `rel="noopener noreferrer"`; anclas y enlaces internos no cambian.

## Requisitos

- **Hugo extended ≥ 0.128** — usa `resources.Concat`, `minify`, `fingerprint`,
  `js.Build` y `Page.Store`.
- Sin Node ni PostCSS: todo el procesamiento de assets es nativo de Hugo.
