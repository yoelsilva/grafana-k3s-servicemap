# Changelog

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
