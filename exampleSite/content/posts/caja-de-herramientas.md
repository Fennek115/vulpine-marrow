---
title: "Caja de herramientas"
date: 2024-05-21T18:00:00-03:00
tags: ["demo", "shortcodes", "proyecto"]
series: ["Guías"]
summary: "Referencia rápida de los shortcodes del tema, con tabla, citas e insignias."
---

Este post pertenece a la serie **Guías** (de ahí la etiqueta `⟐` arriba) y reúne,
a modo de chuleta, los bloques reutilizables del tema. Si recién llegás, empezá
por la [[bienvenida]].

## Shortcodes de un vistazo

| Shortcode | Para qué sirve | Procesa markdown |
|-----------|----------------|------------------|
| `callout` | Aviso destacado por color | sí |
| `command` | Comando copiable | no |
| `terminal` | Sesión de terminal: comando + salida | no |
| `badge`   | Etiqueta inline de color | no |
| `figure`  | Imagen con caption y crédito | no |

## Citas

Las citas en bloque mantienen el estilo de terminal, con su marcador a la
izquierda:

> Un buen tema no se nota: se nota el contenido.

## Estados con insignias

Las insignias sirven para anotar severidad o estado sin romper el flujo del
texto: {{< badge green >}}resuelto{{< /badge >}} {{< badge orange >}}en curso{{< /badge >}} {{< badge red >}}bloqueado{{< /badge >}} {{< badge teal >}}nota{{< /badge >}}.

## Un comando con prompt propio

El `prompt` del shortcode `command` es decorativo y no se copia; útil para
distinguir, por ejemplo, una consola de PowerShell:

{{< command prompt="PS>" >}}Get-ChildItem -Recurse -Filter *.md | Measure-Object{{< /command >}}

## Una sesión de terminal

Cuando importa la salida y no solo el comando, `terminal` muestra ambos en una
ventana. El comando se copia; la salida va literal, sin interpretar markdown.
Con `max` se pliegan las líneas que sobran:

{{< terminal cmd="ls -la content/posts" title="demo · contenido" max="4" >}}
total 24
drwxr-xr-x 4 demo demo 4096 may 21 18:00 .
drwxr-xr-x 5 demo demo 4096 may 21 18:00 ..
-rw-r--r-- 1 demo demo 2210 may 21 18:00 bienvenida.md
-rw-r--r-- 1 demo demo 2894 may 21 18:00 caja-de-herramientas.md
drwxr-xr-x 2 demo demo 4096 may 21 18:00 diagramas-y-flujos
-rw-r--r-- 1 demo demo 2517 may 21 18:00 jardin-de-notas.md
{{< /terminal >}}
