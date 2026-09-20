# Changelog

## 0.2.0 — Se lee de un vistazo

Todo esto sale de usar el panel contra un clúster real: con ochenta flechas, el
mapa salía legible en la teoría e ilegible en la práctica.

### Añadido

- **Iconos por clase de servicio.** El mapper puede declararla en la etiqueta
  `dst_kind`; si no la emite, el panel la deduce del puerto (5432 → postgres,
  6379 → redis, 9092 → kafka…). La etiqueta del mapper siempre gana. Los puertos
  ambiguos como el 8080 quedan fuera a propósito: mejor un icono genérico que uno
  que miente.
  Los iconos son siluetas por categoría embebidas como SVG en el bundle, nunca
  cargadas por red (§10), y no son logos de producto.
- Dashboard de desarrollo **«Mapa de servicio — carga»** con 61 flechas y 36
  nodos, para ver el layout al tamaño de un clúster de verdad.

### Cambiado

- **Las flechas ya no se cruzan.** Se pasa de curvas bezier a enrutado ortogonal:
  las diagonales largas eran lo que convertía el mapa en espagueti. Separación
  entre capas de 110 a 150 px, entre nodos de 28 a 36.
- **Todo lo que solo recibe se alinea a la derecha.** Dagre colocaba cada nodo
  por su distancia al origen, así que los Redis y los Postgres quedaban
  desperdigados por columnas distintas. Ahora la capa se calcula por distancia al
  final, que es lo que §3 pedía desde el principio.
- **El zoom con la rueda es cinco veces más rápido.** Estaba en 0.2, una quinta
  parte de lo normal; acercarse a un nodo costaba una eternidad. Zoom máximo de
  3 a 4 y mínimo de 0.15 a 0.1.
- El nombre visible del plugin pasa a `grafana-k3s-servicemap`.

El **id del plugin no cambia**: sigue siendo `k3s-servicemap-panel`. Grafana no
permite cambiarlo y hacerlo rompería las instalaciones existentes.

### Corregido

- La línea de instalación que documentábamos usaba `url;carpeta`, el formato del
  viejo `grafana-cli`. El instalador de Grafana 13 separa por `@`, así que se
  tragaba la URL entera como id de plugin y, al ser un módulo bloqueante,
  **impedía arrancar Grafana**. El formato correcto es `id@version@url`.
- Los tests e2e estaban rotos y nunca se habían llegado a ejecutar.
- `npm ci` fallaba: el lock no cuadraba con las versiones fijadas a mano.

## 0.1.1 — Nombres coherentes

Sin cambios de comportamiento: el panel dibuja exactamente lo mismo.

### Cambiado

- El nombre visible del plugin pasa de «Mapa de dependencias» a
  **`grafana-k3s-servicemap`**, que es como se llama el proyecto. Es el texto que
  aparece en el selector de visualizaciones de Grafana.
- El repositorio se renombra a `grafana-k3s-servicemap` (nació con una errata,
  `rafana-`), y con él las URLs de instalación y del código fuente.

El **id del plugin no cambia**: sigue siendo `k3s-servicemap-panel`. Grafana no
permite cambiarlo y hacerlo rompería las instalaciones existentes.

### Corregido

- La línea de instalación que documentábamos usaba `url;carpeta`, el formato del
  viejo `grafana-cli`. El instalador de Grafana 13 separa por `@`, así que se
  tragaba la URL entera como id de plugin y, al ser un módulo bloqueante, **impedía
  arrancar Grafana**. El formato correcto es `id@version@url`.

## 0.1.0 — Se ve el mapa

Primera versión. Cubre la fase v0.1 del CLAUDE.md: leer la métrica `dependencia` y
dibujarla por capas.

### Añadido

- Lectura del contrato de datos §2 desde data frames en formato tabla, incluidas las
  queries múltiples (`Value #A`).
- Grafo con cytoscape y layout por capas con dagre, en horizontal o vertical.
- Colores de estado según §3: gris para la sonda OK, rojo para la caída, azul
  discontinuo para lo no sondeado. Nodos externos con borde discontinuo.
- El estado de un nodo se deriva de sus flechas entrantes.
- Ids de nodo compuestos (`cluster/id`) cuando hay más de un clúster en los datos.
- Tooltips en nodo y en flecha, botones de ajustar y reordenar, y ocultado de las
  etiquetas de puerto por debajo de zoom 0.6.
- Opción de panel para la dirección del layout.
- Aviso en pantalla cuando faltan etiquetas obligatorias o hay filas sin `src_id` /
  `dst_id`, en vez de dibujar un panel vacío.
- Dashboard y datasource de desarrollo con treinta filas de ejemplo.

### Notas

- El plugin se distribuye sin firmar; hay que añadirlo a
  `allow_loading_unsigned_plugins`.
- Construido contra Grafana 13.1.1 y **React 18**. React 19 entra en Grafana 13.2, no
  en 13.1: revisar antes de subir los `@grafana/*`.
- El bundle pesa unos 479 KiB porque cytoscape va dentro. Es deliberado: el navegador
  de quien mira el dashboard puede no tener Internet.
