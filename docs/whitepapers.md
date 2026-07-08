# Whitepapers (PDF curados)

Un **whitepaper** es un documento curado en PDF —una síntesis defensiva que
condensa y reordena una serie de posts, no la mera concatenación de ellos—.
A diferencia del **constructor de informes** (`/informes/`, que ensambla posts
ad-hoc en el navegador con `informe-doc.js`), un whitepaper es **una página
Hugo con prosa propia**: se escribe una vez, en markdown, y se integra en el
mismo pipeline de impresión (report.css, Paged.js, mermaid→img, enlaces reales).

## Estándar de calidad (el nivel de referencia)

El primer whitepaper — **Nightmare Eclipse** (`content/whitepapers/nightmare-eclipse/`)
— fija el listón. Un whitepaper del archivo **no se publica** hasta cumplir esto;
sirve de checklist para el próximo.

**Alcance y encuadre.**
- Público objetivo: investigadores / profesionales de ciberseguridad. Español
  neutro, técnico, sin relleno.
- Marco **defensivo**: mecanismos a nivel conceptual, **sin pasos de
  weaponización ni código ofensivo**. Nota de autor explícita (laboratorio
  aislado; se publica el *qué observar*, no el *cómo armar*).
- Terminología: **«clase de vulnerabilidad»**, no «clase de bug». (Regla del
  proyecto; también se aplicó retroactivamente a los posts de la serie.)
- TLP:CLEAR en portada + banner al inicio del cuerpo.

**Estructura mínima** (ajustable, pero todas estas piezas presentes): resumen
ejecutivo · alcance/metodología/nota de autor · el actor · la campaña de un
vistazo (tabla) · el patrón técnico unificado (con mermaid) · análisis por pieza
· cadena real documentada (con mermaid) · IoCs · **mapa MITRE ATT&CK** ·
**ingeniería de detección** · mitigación · estado a la fecha · conclusiones ·
**glosario** · referencias.

**Profundidad de detección (lo que distingue un whitepaper de un resumen).**
- Detección en **varios formatos y ordenada de más resiliente a más frágil**:
  Sigma + KQL + **YARA** + PowerShell de salud, con la tesis «caza la clase, no
  el indicador» hecha explícita.
- **Honestidad de procedencia (no negociable).** Si una regla adapta un patrón
  público, se **acredita** (`credit`/`source` en el `meta` YARA, o cita en
  prosa) y `author` queda para quien la **recopiló/adaptó**, nunca para reclamar
  la técnica. Antes de escribir una regla «propia», comprobar OSS existente
  (p. ej. la signature-base de Nextron/Florian Roth). Los IoC frágiles (nombres
  de binario, *named pipes*) se marcan como complementarios; la señal resiliente
  es comportamental.

**Verificación de hechos.** Todo CVE / IoC / fecha contrastado contra fuentes
públicas (NVD, MSRC, CISA/KEV, vendors). Distinguir artefacto de PoC de IoC de
intrusión real. Referencias con **hipervínculos reales**; cada `CVE-YYYY-NNNN`
enlaza a su ficha NVD (automático, ver abajo).

**Forma.** ≥16 páginas A4, portada de marca (Fira Code + violeta, paleta clara
`--pf-*`), índice con números de página reales, pie corrido, cada sección abre
en página nueva, **cero páginas en blanco**, mermaids rasterizados y legibles.
Verificado con `pdfinfo` + `pdftoppm` (ver «Generar y revisar»).

## Arquitectura

| Pieza | Rol |
|---|---|
| `content/whitepapers/<slug>/index.md` | El documento: markdown curado + front matter. Page bundle (imágenes al lado). |
| `layouts/whitepapers/single.print.html` | Vista imprimible `/whitepapers/<slug>/print.html`: portada desde front matter, índice, contenido, Paged.js. |
| `layouts/whitepapers/single.html` | Landing HTML con botón de descarga del PDF pre-generado. |
| `assets/css/print/whitepaper.css` | Estilos de print propios (índice con nº de página, badges, mermaid-img), concatenados tras `report.css`. |
| `assets/js/whitepaper-doc.js` | Pipeline cliente: autolink CVE→NVD, mermaid→img, nº de página del índice, Paged.js. |
| `hugo.toml` → `[[cascade]] path="/whitepapers/**"` | Habilita el output `print` en la sección. `[params] mainSections=["posts"]` la mantiene fuera del blog/RSS. |
| `scripts/pdf-manifest.mjs` → `whitepapers: [...]` | Lista de slugs a pre-generar. |
| `scripts/build-pdf.mjs` | Renderiza cada whitepaper a `static/pdf/<slug>.pdf` (Chromium + Paged.js). |

El PDF final se sirve como archivo estático en `https://fennek.org/pdf/<slug>.pdf`
y se **commitea** al repo (como los demás PDFs del manifiesto).

## Añadir un whitepaper nuevo

1. **Crear el markdown**: `content/whitepapers/<slug>/index.md` con el front matter:

   ```yaml
   ---
   title: "Título del whitepaper"
   subtitle: "Bajada larga que va bajo el título en la portada."
   kicker: "informe de inteligencia de amenazas · síntesis defensiva"
   date: 2026-07-07T20:00:00-03:00
   verified: "7-jul-2026"        # opcional: "(datos verificados al …)" en la portada
   author: "dust115"
   scope: "análisis de fuentes públicas; mecanismos a nivel conceptual, sin código ofensivo"
   summary: "Una línea para listados y metadatos."
   tags: ["whitepaper", "…"]
   ---
   ```

2. **Escribir el cuerpo** en markdown. Está disponible todo el toolkit del tema:
   - Encabezados `##` / `###` → alimentan el índice con números de página.
   - Shortcodes: `{{</* tlp level="clear" */>}}`, `{{</* callout type="info|tip|warning|danger|note" */>}}`, `{{</* badge green */>}}…{{</* /badge */>}}`.
   - Diagramas ` ```mermaid ` (se rasterizan a imagen para el PDF).
   - Bloques de código ` ```yaml/kql/powershell/yara ` para reglas de detección.
   - Los tokens `CVE-YYYY-NNNN` se **autoenlazan a su ficha NVD** — escríbelos como
     texto o `código`, sin enlace manual.
   - **Cada sección principal (`## N · …`) abre en página nueva** automáticamente
     (`break-before: page` en `whitepaper.css`), así ningún título queda varado al
     pie con su tabla derramada a la hoja siguiente. Las subsecciones (`###`)
     fluyen. La primera sección comparte hoja con la banda TLP que la precede.
   - **Glosario opcional pero recomendado**: una sección `## N · Glosario` con una
     tabla `término | definición` justo antes de Referencias.
   - **Reglas de detección con honestidad de procedencia**: si adaptas un patrón
     público (YARA/Sigma), acredítalo (`credit`/`source` en el `meta`) y reserva
     `author` para quien lo **recopiló/adaptó**, no para reclamar la técnica.

   Front matter que consume la portada: `author` ya no se muestra (el crédito de
   portada es un enlace fijo a `fennek.org/portafolio/`); `kicker`, `subtitle`,
   `verified` y `scope` sí alimentan la portada y el bloque de metadatos.

3. **Registrar el slug** en `scripts/pdf-manifest.mjs`:

   ```js
   whitepapers: [
     'nightmare-eclipse',
     '<slug>',          // ← nuevo
   ],
   ```

4. **Generar y revisar el PDF**:

   ```bash
   hugo --gc --minify              # sin warnings
   node scripts/build-pdf.mjs      # → static/pdf/<slug>.pdf
   pdfinfo static/pdf/<slug>.pdf   # nº de páginas, A4
   ```

   `build-pdf.mjs` reutiliza un `hugo server` si ya hay uno en el puerto; si no,
   levanta uno propio. Revisa el PDF (márgenes, mermaids, enlaces) y commitéalo.

## Notas de diseño

- **Paged.js, no page.pdf a secas.** El pie corrido (marca + `pág N / M`), el
  encabezado por sección y los números de página del índice viven en los
  *margin boxes* de `@page`, que Chromium **no** renderiza sin Paged.js. El
  pipeline pagina con Paged.js (`window.PagedConfig.auto = false`) y marca
  `html[data-pf-ready]`; `build-pdf.mjs` espera esa señal y exporta con
  `page.pdf({ preferCSSPageSize: true })`, así el A4 y los márgenes salen del
  `@page` de `report.css` (no se duplican con los de `page.pdf`).
- **Mermaid → img.** Paged.js corrompe el SVG inline al clonarlo; por eso cada
  diagrama se serializa a un `<img>` data-URI antes de paginar (con
  `htmlLabels:false` para que no queden `<foreignObject>`). Misma técnica que
  `informe-doc.js`.
- **Fuera del stream del blog.** La sección `whitepapers` no está en
  `mainSections`, así que no aparece en la home, el RSS ni las "notas
  relacionadas". Se enlaza a mano donde convenga.
