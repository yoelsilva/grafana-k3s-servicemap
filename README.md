# Mapa de dependencias — `k3s-servicemap-panel`

Panel de Grafana que dibuja el **mapa de dependencias declaradas** de los clústeres:
un nodo por servicio, una flecha por conexión declarada y puerto, y el color según el
estado de la sonda.

Sustituye al Node Graph nativo usando exactamente los mismos datos. La diferencia es el
**layout por capas**: quien llama queda a la izquierda, quien solo recibe (Redis,
Postgres, externos) a la derecha.

El panel **no consulta Kubernetes, no sondea nada y no calcula estado**. Recibe filas de
Prometheus y las dibuja. Todo lo demás lo hace `dependencias-mapper`.

---

## Qué hace falta para que se vea algo

Una query a la métrica `dependencia`, en **Format = Table** y **Instant**:

```promql
dependencia{cluster="$cluster", src=~"$servicio"} or dependencia{cluster="$cluster", dst=~"$servicio"}
```

Cada fila es una flecha. El panel necesita al menos estas etiquetas: `src`, `src_id`,
`dst`, `dst_id` y `dst_port`. Si falta alguna, el panel lo dice en pantalla en vez de
quedarse en blanco (normalmente significa que el mapper es anterior a la 0.2.0).

El resto son opcionales y solo enriquecen el tooltip: `dst_svc`, `dst_addr`, `clave`,
`externo`, `cluster`, `namespace`.

## Cómo leer el dibujo

**Nodos**

| Aspecto | Significa |
|---|---|
| Borde gris | Todas sus flechas entrantes responden |
| Borde rojo, más grueso | Alguna flecha entrante tiene la sonda caída |
| Borde discontinuo azul | Destino **fuera del clúster** |

El borde discontinuo señala lo que no controlas: un proveedor en internet, una base de
datos en una máquina suelta. Un Service de otro namespace es interno y se pinta normal;
su namespace aparece en el tooltip.

Requiere **mapper ≥ 0.5.0**. Con versiones anteriores, `externo` significaba «fuera del
namespace del origen» y los vecinos internos salían marcados como externos.

Un nodo que también aparece como origen nunca se pinta como externo, aunque alguien lo
haya declarado por IP.

**Flechas**

| Aspecto | `Value` | Significa |
|---|---|---|
| Gris fina | 1 | La sonda llega |
| Roja gruesa | 0 | La sonda falla |
| Azul discontinua | 2 | No sondeado |

La etiqueta de la flecha es el puerto. Se oculta al alejar el zoom por debajo de 0.6,
porque a ese tamaño solo es ruido.

## Interacción

- Rueda para zoom, arrastrar el fondo para desplazar, arrastrar un nodo para moverlo
  (la posición **no** se guarda: al recargar vuelve al layout calculado).
- Pasar por encima de un nodo muestra cuántas flechas entran, cuántas salen y cuántas
  están caídas.
- Pasar por encima de una flecha muestra la variable de entorno que la originó, el
  Service y la dirección de destino.
- **Ajustar** encuadra el mapa. **Reordenar** recalcula el layout.

## Opciones del panel

| Opción | Valores | Por defecto |
|---|---|---|
| Dirección del layout | Izquierda → derecha · Arriba → abajo | Izquierda → derecha |

## Instalación

El plugin va **sin firmar** a propósito: es privado, no está en el catálogo de Grafana.
Hay que permitirlo explícitamente.

En los values de `kube-prometheus-stack`:

```yaml
grafana:
  grafana.ini:
    plugins:
      allow_loading_unsigned_plugins: k3s-servicemap-panel
  plugins:
    - k3s-servicemap-panel@0.3.0@https://github.com/yoelsilva/grafana-k3s-servicemap/releases/download/v0.3.0/k3s-servicemap-panel-0.3.0.zip
```

Subir de versión es cambiar la URL y hacer `helm upgrade`. Siempre un tag, nunca una rama
ni `latest`.

Requiere **Grafana >= 13.0.0**. Probado contra 13.1.1, que es la del clúster central.

## Desarrollo

```bash
npm install
npm run dev          # build en watch
npm run server       # Grafana 13.1.1 en http://localhost:3000 con el plugin montado
```

El Grafana de desarrollo viene con el dashboard **Mapa de dependencias** ya provisionado
y treinta filas de ejemplo que reproducen el contrato, con los tres estados de sonda. No
hace falta un Prometheus real.

Para cambiar esos datos de prueba se edita la constante `CSV` de
`provisioning/dashboards/make-dashboard.js` y se ejecuta:

```bash
node provisioning/dashboards/make-dashboard.js
```

Para probar contra datos reales, un `kubectl port-forward` al Prometheus central y un
datasource apuntando a `http://host.docker.internal:9090`.

```bash
npm run typecheck
npm run lint
npm run test:ci      # Jest
npm run e2e          # Playwright (requiere `npm run server` levantado)
npm run build
```

### Si `npm run e2e` no encuentra navegador

En algunas máquinas la descarga del Chromium de Playwright falla. Si ya tienes Chrome o
Edge instalado, úsalos en su lugar:

```bash
PW_CHANNEL=chrome GRAFANA_URL=http://127.0.0.1:3000 npm run e2e
```

`GRAFANA_URL` con `127.0.0.1` importa: en Windows, Chrome resuelve `localhost` a IPv6 y
el Grafana de Docker solo escucha en IPv4.

La lógica que convierte las filas en nodos y flechas vive aislada en
`src/graph/build.ts`, sin nada de React ni de Grafana UI, y es la que está cubierta por
tests. Si algo se dibuja mal, ahí es donde hay que mirar primero.
