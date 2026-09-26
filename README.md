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

## El dashboard, listo para importar

[`dashboards/mapa-de-servicio.json`](dashboards/mapa-de-servicio.json) trae el mapa ya
configurado: variables `$cluster` y `$servicio`, la consulta en Table e Instant, franjas
encendidas, **clic** en un nodo para filtrar el mapa por ese servicio y **doble clic** para
abrir su detalle.

En Grafana: **Dashboards → New → Import**, sube el fichero y elige tu Prometheus cuando lo
pida. Si ya lo tenías importado, impórtalo encima (mismo UID, `servicemap`) y sobrescribe.

El filtro **Servicio** lista **todos** los nodos del mapa, no solo los que declaran
dependencias: también los que solo las reciben, como una base de datos, un broker o un
servicio de otro namespace. Eso no se puede hacer con `label_values`, que lee una sola
etiqueta, así que la variable junta `src` y `dst` con `label_replace` y los extrae con una
expresión regular:

```promql
query_result(count by (nombre) (
  label_replace(dependencia{cluster="$cluster"}, "nombre", "$1", "src", "(.*)")
  or
  label_replace(dependencia{cluster="$cluster"}, "nombre", "$1", "dst", "(.*)")
))
```

con regex `/nombre="([^"]+)"/`.

**Si un servicio no aparece en el filtro**, hay dos causas y se distinguen mirando las métricas
del mapper:

1. Su namespace no se escanea → no sale en ningún sitio. `count by (namespace) (dependencia)`
   dice qué namespaces producen flechas; `dependencia_mapper_namespace_error` con
   `motivo="403"` dice cuáles faltan por permisos.
2. Su namespace sí se escanea, pero **nadie lo nombra** en una variable de entorno y él no
   declara ninguna dependencia. El mapa dibuja lo declarado: si no aparece en ninguna
   declaración, no existe para el mapa. Esto no se arregla escaneando más.

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
- **Clic en un nodo**: filtra el dashboard por ese servicio. **Otro clic** en el mismo nodo
  quita el filtro. El nodo filtrado se marca con un borde azul más grueso.
- **Doble clic en un nodo**: abre su detalle (ver «Enlace al hacer doble clic»).
- **Ajustar** encuadra el mapa. **Reordenar** recalcula el layout.

## Opciones del panel

| Opción | Valores | Por defecto |
|---|---|---|
| Dirección del layout | Izquierda → derecha · Arriba → abajo | Izquierda → derecha |
| Separar en franjas | Sí · No | Sí |
| Variable que filtra el clic | Nombre de una variable del dashboard, sin `$` | `servicio` |
| Enlace al hacer doble clic en un nodo | Plantilla de URL (ver abajo) | Vacío: el doble clic no hace nada |

### Franjas

El mapa se divide en tres franjas, en el orden en que fluye el tráfico:

| Franja | Qué va en ella |
|---|---|
| **Aplicaciones** | Tus servicios, y la infraestructura que solo usa uno de ellos (el Redis privado de un servicio se queda a su lado) |
| **Servicios compartidos** | Bases de datos, colas, brokers, almacenamiento, búsqueda y correo que usan **al menos dos** servicios distintos |
| **Fuera del clúster** | Lo que no controlas y no es infraestructura compartida: proveedores, APIs de terceros |

Un Postgres fuera del clúster que usan seis servicios va a **compartidos**, no a «fuera»:
es ante todo la base de datos común, y que está fuera ya lo dice su borde discontinuo.

Si solo hay una franja con nodos, no se dibuja ninguna caja: una caja alrededor de todo
el mapa no separa nada.

### Clic: filtrar

El clic pone la variable del dashboard (`$servicio` por defecto) en el nodo pulsado, igual que
si lo eligieras en el desplegable de arriba. Por eso se filtran a la vez el mapa y el resto de
paneles, la URL se puede compartir tal cual y el botón atrás del navegador lo deshace.

- Otro clic en el mismo nodo vuelve a **All**. Si la variable no admite All, el segundo clic
  no hace nada.
- Si el dashboard no tiene esa variable, el clic no hace nada, y el tooltip no lo ofrece.
- Arrastrar un nodo no filtra.
- Si también hay enlace de doble clic, el clic espera un cuarto de segundo antes de filtrar:
  filtrar refresca el mapa, y el segundo clic de un doble clic caería sobre un mapa recién
  recolocado.

### Enlace al hacer doble clic en un nodo

Una URL con huecos que se rellenan con los datos del nodo pulsado:

| Hueco | Qué mete |
|---|---|
| `${nodo.servicio}` | El nombre visible del nodo |
| `${nodo.tipo}` | Su clase: `postgres`, `redis`, `kafka`, `mqtt`, `http`, `grpc`… |
| `${nodo.namespace}` | Dónde vive (necesita mapper ≥ 0.5.0) |
| `${nodo.cluster}` | Su clúster |
| `${nodo.id}` | Su id, por si hace falta algo exacto |

Las variables del dashboard siguen funcionando igual que en cualquier otro sitio de
Grafana: `$cluster`, `${__from}`, `${__to}`. Los huecos llevan el prefijo `nodo.` para
no chocar con ellas: `$servicio` es el filtro del dashboard y `${nodo.servicio}` el nodo
que has pulsado.

**Un dashboard por clase de servicio con una sola plantilla.** Si pones `${nodo.tipo}` en
la ruta y llamas a tus dashboards `tipo-postgres`, `tipo-redis`, `tipo-http`…, cada nodo
te lleva al suyo:

```
/d/tipo-${nodo.tipo}?var-servicio=${nodo.servicio}&var-ns=${nodo.namespace}&from=${__from}&to=${__to}
```

Pulsar `postgres-main` lleva a `/d/tipo-postgres?var-servicio=postgres-main&…`, y pulsar
`redis-core`, a `/d/tipo-redis?…`.

Cómo se comporta:

- El tooltip avisa «Doble clic: abrir detalle» solo si hay plantilla.
- **Arrastrar un nodo no navega.**
- **Ctrl** o **Cmd** + doble clic abre en pestaña nueva.
- Una URL absoluta (`https://…`, un runbook, un repo) se abre siempre en pestaña nueva.
- Si Grafana está servido bajo un subpath, se tiene en cuenta solo.

Está vacío por defecto a propósito: un enlace a un dashboard que no existe haría que el
primer clic de cualquiera acabara en un 404 y pareciera que el panel está roto.

## El dashboard de detalle del servicio

[`dashboards/servicio.json`](dashboards/servicio.json) (uid `servicemap-servicio`) es al que
lleva el doble clic del mapa de referencia. **Es uno solo para todos los servicios del clúster**:
arriba se eligen cluster, namespace y servicio, y el doble clic llega con los tres puestos.

Sirve para **dimensionar**: cuánta CPU, RAM y disco usa de verdad cada servicio. Por defecto
enseña **7 días**, que es lo mínimo para decidir; con una hora no se ven los picos de la semana.

| Panel | Qué enseña | Cómo se usa para decidir |
|---|---|---|
| CPU media · p95 · máxima | Núcleos del pod que más usa, en el rango | La *request* de CPU, cerca del p95. Un pico por encima solo va más lento |
| RAM media · p95 · máxima | Working set del pod que más usa, en el rango | El límite de memoria lo marca la **máxima**, con margen: si el pod lo pasa, muere por OOM |
| CPU y RAM por pod | Las dos cosas en el tiempo, con media y máximo de cada pod | Picos por hora, y fugas de memoria (una línea que solo sube) |
| Disco | Cada volumen del servicio: usado, capacidad, % ocupado y días hasta llenarse | Cuándo hay que ampliarlo |

**Solo lleva lo que tiene datos en producción.** Se comprobó métrica a métrica antes de
montarlo: CPU y RAM salen de cAdvisor y el disco del kubelet, los tres vía Alloy. Lo que no
llega no está: ni límites ni requests configurados, ni reinicios, ni estrangulamiento de CPU,
porque kube-state-metrics no llega con la etiqueta `cluster` y cAdvisor no manda los
`container_spec_*`. Si algún día llegan, se añaden.

Cómo asocia cada cosa a un servicio, que es donde se puede equivocar:

- **Los pods, por nombre**: `<servicio>-<hash>-<id>` para un Deployment y `<servicio>-<n>`
  para un StatefulSet. Funciona porque el nombre del nodo en el mapa es el del workload. **Si al
  servicio le has puesto un alias en el ConfigMap del mapper**, el nombre ya no coincide.
- **Se agrupa por pod, nunca por contenedor**: dos Deployments distintos pueden tener un
  contenedor con el mismo nombre, y agrupar por contenedor los sumaría como si fueran uno.
- **Los volúmenes, también por nombre**: `<servicio>-pvc` o `<servicio>-data`. El kubelet no
  dice qué pod monta cada volumen, así que un volumen con otro nombre no aparece en ningún
  servicio. Un servicio sin volumen enseña «Sin volumen persistente».
- **El selector de servicio** solo ofrece servicios con pods medidos: no deja elegir nada que
  vaya a salir vacío.

De ahí la regla para los alias del mapper: **solo para lo que no es un workload del clúster**
(IPs, NodePorts, hosts de fuera), **nunca para un Service interno**. Desde el mapper 0.5.0 un
Service interno ya se resuelve solo al workload que hay detrás, y un alias encima gana sobre esa
resolución: cambia el id del nodo y deja el detalle sin pods.

Un nodo fuera del clúster (un proveedor, una base de datos en una máquina suelta) no tiene pods
aquí, así que su detalle sale vacío.

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
    - k3s-servicemap-panel@0.5.0@https://github.com/yoelsilva/grafana-k3s-servicemap/releases/download/v0.5.0/k3s-servicemap-panel-0.5.0.zip
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
