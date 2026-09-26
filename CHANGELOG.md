# Changelog

## Sin publicar

Solo cambian los dashboards: el plugin es el mismo de la 0.5.0 y no hace falta release.

### Cambiado: el dashboard del servicio, solo con lo que tiene datos

- `dashboards/servicio.json` pasa a servir para **dimensionar**: CPU y RAM media, p95 y máxima
  del pod que más usa, las dos en el tiempo por pod, y una tabla de **disco** con usado,
  capacidad, % ocupado y días hasta llenarse de cada volumen. Rango por defecto, 7 días.
- **Fuera todo lo que no tenía datos en producción**: réplicas, reinicios, límites, última
  terminación, estrangulamiento, red, logs y conexiones. Cada métrica que queda se comprobó
  antes contra el Prometheus real, y cada consulta contra datos sintéticos con valores
  conocidos.
- Se agrupa por pod y no por contenedor: dos Deployments pueden compartir nombre de contenedor.
- El selector de servicio solo ofrece servicios con pods medidos.
- El disco es una tabla y no una fila de paneles por volumen: en Grafana 13.1.1 una fila
  repetida por una variable sin valores no desaparece, se pinta vacía. La tabla dice «Sin
  volumen persistente».

## 0.5.0 — Cada cosa en su franja, y clic para filtrar

### Cambiado: clic filtra, doble clic abre el detalle

- **Un clic en un nodo filtra el dashboard** por ese servicio: pone la variable `$servicio` en
  él, y el mapa y el resto de paneles se filtran a la vez. **Otro clic en el mismo nodo quita
  el filtro** (vuelve a All). El botón atrás del navegador también lo deshace.
- El nodo por el que está filtrado el dashboard se marca con un borde azul más grueso.
- **El enlace de la 0.4.0 pasa al doble clic.** La opción se llama ahora «Enlace al hacer doble
  clic en un nodo»; la plantilla y sus huecos no cambian, así que los dashboards que ya la
  tenían siguen funcionando, solo que con doble clic.
- Opción nueva **«Variable que filtra el clic»**, `servicio` por defecto. Si el dashboard no
  tiene esa variable, el clic no hace nada.
- El tooltip dice qué hará cada cosa: «Clic: filtrar por este nodo» o «quitar el filtro», y
  «Doble clic: abrir detalle».
- Si hay enlace de doble clic, el clic espera 250 ms antes de filtrar, para no confundir el
  primer clic de un doble clic con uno simple. Sin enlace, filtra al momento.

### Añadido: dashboard de detalle del servicio

- `dashboards/servicio.json` (uid `servicemap-servicio`): uno para todos los servicios del
  clúster, elegido por selector (cluster, namespace, servicio). Pods, réplicas, reinicios,
  CPU, memoria y red por pod con sus límites, CPU estrangulada, motivo de la última
  terminación, volumen de logs y errores, **los logs en un panel propio** con un cuadro de
  búsqueda, y las conexiones declaradas del servicio con el estado de su sonda.
- Lo genera `dashboards/make-servicio.js`.
- El mapa de referencia lleva ahí con doble clic.

### Añadido

- **Franjas**: el mapa se divide en *Aplicaciones*, *Servicios compartidos* y *Fuera del
  clúster*, cada una con su caja de fondo y su título. Separa lo tuyo, lo común a todos y lo
  que no controlas, que es lo que importa al leer un mapa de dependencias.
- «Compartido» es la infraestructura que usan **al menos dos servicios distintos**. Un Redis
  privado de un solo servicio se queda en Aplicaciones, junto a quien lo usa.
- La infraestructura compartida va a su franja aunque esté fuera del clúster: la base de
  datos común es ante todo la base de datos común.
- Opción **«Separar en franjas»** en el editor, encendida por defecto.
- Funciona en horizontal y en vertical.

### Detalles

- Dagre sigue colocando el mapa como antes; después cada franja se desplaza en bloque. Así se
  conservan el orden por capas y los cruces que dagre ya había resuelto.
- Las cajas se dibujan **detrás** de las flechas, no encima. No responden al ratón: el hover,
  el clic y el arrastre siguen llegando a los nodos que tienen dentro.
- Con una sola franja no se dibuja ninguna caja.

### Corregido

- Tildes en los textos de la interfaz: «Dirección del layout», «Entrantes caídas», «fuera del
  clúster», «Dirección» en el tooltip de las flechas, y las descripciones del editor.

### También en este cambio

- `docs/propuesta-mapper-entrada.md`: la propuesta al mapper para dibujar la entrada de tráfico
  (Gateway API, certificados y balanceador), autodescubierta por tipo de recurso.

## 0.4.0 — Clic en un nodo

Cierra el hueco más grande que quedaba de la fase v0.2 de §8: hasta ahora, pulsar un nodo
no hacía nada.

### Añadido

- **Enlace al hacer clic en un nodo**, configurable desde el editor con una plantilla de
  URL. Huecos: `${nodo.servicio}`, `${nodo.tipo}`, `${nodo.namespace}`, `${nodo.cluster}`,
  `${nodo.id}`; las variables del dashboard (`$cluster`, `${__from}`, `${__to}`) siguen
  funcionando porque la URL pasa después por el interpolador de Grafana.
- **Un dashboard por clase de servicio con una sola plantilla**: con `${nodo.tipo}` en la
  ruta, `/d/tipo-${nodo.tipo}` lleva cada nodo al dashboard de su clase. Es el puente hacia
  los dashboards de métricas por tipo de servicio.
- Cursor en forma de mano y aviso «Clic: abrir detalle» en el tooltip, solo cuando hay
  plantilla.
- Ctrl/Cmd + clic abre en pestaña nueva. Las URL absolutas se abren siempre fuera.
- Enlace de ejemplo en el dashboard de desarrollo «carga», para probarlo sin montar nada.

### Detalles de comportamiento

- **Arrastrar un nodo no navega**: el evento es `tap`, que cytoscape distingue del arrastre.
- **Vacío por defecto.** Un enlace a un dashboard inexistente convertiría el primer clic de
  cualquiera en un 404.
- Los valores del nodo van codificados para URL, lo que además impide que un `$` en un
  nombre se cuele como variable en la interpolación de Grafana.
- Los huecos llevan el prefijo `nodo.` para no chocar con las variables `$servicio` y
  `$cluster` que ya tienen los dashboards.

Verificado en navegador real: el clic lleva a la URL con los huecos rellenos y `${__from}`
resuelto, arrastrar no saca del dashboard, y sin plantilla el clic no hace nada. 119 tests
unitarios; `link.ts` y `build.ts` al 100 % de ramas.

## 0.3.0 — Externo quiere decir fuera del clúster

Adopta el contrato del **mapper 0.5.0**. Incluye todo lo que iba a ser la 0.2.2, que se
quedó sin publicar para no obligar a instalar dos veces.

### Cambiado

- **El borde discontinuo azul ya significa lo que parece.** Con mapper ≥ 0.5.0, `externo`
  quiere decir «sale del clúster»; antes significaba «fuera del namespace del origen» y
  marcaba como externos a vecinos perfectamente internos. El panel no necesitó cambiar
  código —dibuja lo que le llega—, pero sí el texto: el tooltip vuelve a decir
  **«Externo: fuera del clúster»**.
- Los nodos pasan de 140 a 170 px de ancho. Al meter los iconos en la 0.2.0 reduje el
  espacio del texto de 124 a 94 px sin compensar, y las etiquetas se cortaban antes de
  tiempo.

### Añadido

- **El namespace de cada nodo en el tooltip**, leído de la etiqueta `dst_ns` que emite el
  mapper desde la 0.5.0. Al dejar de marcarse externos, los destinos de otros namespaces
  perdían la información de dónde viven.

### Corregido

- **Los iconos salían recortados.** Un cuadrado se veía como una esquina suelta. El SVG del
  data URI declaraba solo `viewBox`, sin `width` ni `height`, y sin dimensiones explícitas
  cada motor lo rasteriza a su manera.

### Nota sobre los ids

El mapper 0.5.0 cambia el `dst_id` de los destinos que antes no sabía resolver:
`n_emqx_svc_brokers` pasa a `n_emqx`. En el panel eso aparece como un nodo nuevo, no como
el mismo renombrado. Es inofensivo aquí —no se persiste nada— pero conviene saberlo si
algún día se comparan versiones.

## 0.2.2 — Los iconos se ven enteros (no publicada)

### Corregido

- **Los iconos salían recortados.** Un cuadrado se veía como una esquina suelta.
  El SVG del data URI declaraba solo `viewBox`, sin `width` ni `height`, y sin
  dimensiones explícitas cada motor lo rasteriza a su manera.
- **Las etiquetas se cortaban antes de tiempo.** Al meter los iconos en la 0.2.0
  reduje el espacio del texto de 124 a 94 px para hacerles sitio, y no compensé el
  ancho del nodo. Los nodos pasan de 140 a 170 px y el texto vuelve a tener sus
  124 px, ahora con el icono dentro.

### Cambiado

- El tooltip decía «Externo: sí», que se lee como «está fuera del clúster». Dice
  ahora **«Alcance: fuera del namespace de origen»**, que es lo que la etiqueta
  `externo` significa hoy de verdad: el mapper la calcula contra el namespace de
  quien llama, así que un Service de otro namespace sale marcado igual que un host
  en internet. El README lo explica con el caso concreto.

### Nota

Se acordó con el repo del mapper que `externo` pase a significar «sale del
clúster». Cuando eso se publique, este texto vuelve a ser «Externo» y el borde
discontinuo pasará a señalar solo lo que de verdad está fuera.

## 0.2.1 — Cada flecha por su carril

Sale de mirar la 0.2.0 con datos reales: el mapa estaba ordenado, pero seguía sin
poder leerse.

### Añadido

- **Resaltado al pasar el ratón.** Sobre un nodo, todo lo que no le concierne baja
  al 12 %: se ve de un vistazo quién le llama y a qué llama. Sobre una flecha,
  ella y sus dos extremos. Es lo que convierte un mapa denso en algo que responde
  a «¿de qué depende esto?» en vez de obligar a leerlo entero.
- Tests para `layout.ts`: el cálculo de capas, el corte de ciclos y el reparto de
  carriles. Eran funciones puras con lógica no trivial y estaban sin cubrir.

### Corregido

- **Las flechas ya no se dibujan unas encima de otras.** Con enrutado ortogonal,
  el tramo vertical cae a mitad de camino entre columnas, así que diez flechas
  saliendo del mismo nodo compartían línea: se veía **una** donde había diez.
  Ahora cada una gira en un punto distinto del hueco y coge su propio carril.

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
