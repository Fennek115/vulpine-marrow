/* Salto de página "inteligente" compartido por las dos vistas de impresión
   (single.print.html vía print-single.js, y el informe combinado vía
   informe-doc.js). `break-after: avoid` en un título solo lo pega a su primera
   línea (y Gecko directamente lo ignora), así que una sección podía arrancar
   al pie: título + 1–2 líneas y corte. Acá cada título (h2/h3/h4) se envuelve
   junto a un colchón de contenido siguiente en un `.pf-keep { break-inside:
   avoid }` (regla en report.css): si ese bloque no entra al pie, baja entero a
   la página siguiente → la sección arranca limpia. Requiere alturas reales →
   correr con el contenido ya en el DOM y las fuentes/imágenes cargadas. */

export function keepHeadingsWithContent(root) {
  var KEEP_PX = 200;                       // colchón mínimo bajo el título
  var MAX_PX = 340;                        // tope del colchón de texto
  /* título + UN bloque grande (figura/tabla/código) también se atan, pero solo
     si el grupo entero cabe en una hoja — si no, el título quedaba varado al
     pie. El límite por altura de hoja es lo que evita la hoja en blanco
     (grupo inquebrable > página): área útil A4 = 297mm − 17 − 16 = 264mm ≈
     998px; margen de seguridad. */
  var MAX_GROUP_PX = 920;
  var isHeading = function (el) { return el && /^H[2-4]$/.test(el.tagName); };
  var kids = Array.prototype.slice.call(root.children);
  for (var i = 0; i < kids.length; i++) {
    if (!isHeading(kids[i])) continue;
    var group = [kids[i]];
    var sum = 0, j = i + 1;
    while (j < kids.length && !isHeading(kids[j])) {
      var h = kids[j].offsetHeight || 0;
      if (sum + h > MAX_PX) break;         // no engordar el grupo (evita hojas en blanco)
      group.push(kids[j]);
      sum += h;
      j++;
      if (sum >= KEEP_PX) break;           // ya hay colchón suficiente
    }
    if (sum === 0 && kids[j] && !isHeading(kids[j])) {
      /* sin colchón REAL (nada tras el título, o solo <p> vacíos de altura 0
         — residuo típico de shortcodes en Markdown — que NO cuentan como
         contenido): el bloque que sigue es grande, atarlo igual si cabe */
      var big = (kids[i].offsetHeight || 0) + (kids[j].offsetHeight || 0);
      if (big <= MAX_GROUP_PX) {
        group.push(kids[j]);
        sum += kids[j].offsetHeight || 0;
        j++;
      }
    }
    /* sum === 0 → o el título no tiene nada medible detrás, o su bloque
       siguiente ni siquiera cabe en una hoja entera: no se envuelve, el
       bloque grande pagina solo (las tablas repiten cabecera). */
    if (sum === 0 || group.length < 2) continue;
    var keep = document.createElement('div');
    keep.className = 'pf-keep';
    kids[i].parentNode.insertBefore(keep, kids[i]);
    group.forEach(function (g) { keep.appendChild(g); });
    i = j - 1;                             // saltar lo ya envuelto (kids es snapshot)
  }
}
