# CLAUDE.md — grafana-k3s-servicemap

Plugin de panel para Grafana que dibuja el **mapa de dependencias declaradas** de los
clústeres de Tecopos: nodos por servicio, flechas por conexión declarada y puerto,
color por estado de la sonda. Sustituye al Node Graph nativo como panel principal
del NOC, usando exactamente los mismos datos.

Este fichero es la fuente de verdad del proyecto. Si algo aquí contradice el código,
el código está mal.

| | |
|---|---|
| Repositorio | `grafana-k3s-servicemap` → https://github.com/yoelsilva/grafana-k3s-servicemap |
| Id del plugin | `k3s-servicemap-panel` (org `k3s` · nombre `servicemap` · tipo `panel`) |
| Grafana objetivo | 13.1.1 |

El andamio lo generó `@grafana/create-plugin`. Sus reglas de herramienta viven en
`.config/AGENTS/instructions.md` y siguen vigentes; la más importante:
**no se modifica nada dentro de `.config/`**. Lo que haya que ajustar del entorno de
desarrollo se hace desde la raíz (p. ej. el `docker-compose.yaml` que fija la versión).

---

## 1. Contexto del sistema (lo que este plugin NO hace)

Hay tres piezas y este repo es solo la tercera:

| Pieza | Repo | Qué hace |
|---|---|---|
| Stack de observabilidad | (values Helm) | kube-prometheus-stack en el clúster central; Alloy en cada clúster de trabajo hace `remote_write` al Prometheus central con `external_labels.cluster` |
| **dependencias-mapper** | `dependencias-mapper` | Un pod por clúster. Lee Deployments/StatefulSets + ConfigMaps, deduce dependencias de las env (`*_HOST`, `*_URL`, `host:puerto`), sondea por TCP y expone la métrica `dependencia` |
| **grafana-k3s-servicemap** | este repo | Dibuja `dependencia`. Nada más. |

**El plugin no consulta Kubernetes, no sondea nada, no calcula estado.** Recibe filas de
Prometheus y las dibuja. Toda la lógica de "qué es una dependencia" y "está viva o no"
vive en el mapper. Si falta un dato para dibujar, se añade al mapper como etiqueta,
no se deduce en el plugin.

---

## 2. Contrato de datos (inmutable sin acordarlo con el mapper)

Una fila por flecha declarada. Consulta de referencia, *Format = Table*, *Instant*:

```promql
dependencia{cluster="$cluster", src=~"$servicio"} or dependencia{cluster="$cluster", dst=~"$servicio"}
```

| Campo | Tipo | Significado |
|---|---|---|
| `src` | string | nombre legible del origen (workload) |
| `src_id` | string | id seguro del origen: `[A-Za-z0-9_]+`, estable entre ciclos |
| `src_tipo` | string | `deployment` \| `statefulset` |
| `dst` | string | nombre legible del destino: alias > workload dueño > host |
| `dst_id` | string | id seguro del destino. **Es un id de pantalla, no una identidad**: sale de `alias > workload dueño > host`, así que cambia si alguien edita el alias en el ConfigMap del mapper. Vale para dibujar; no vale como clave de correlación con otras fuentes |
| `dst_svc` | string | nombre del Service de Kubernetes si el destino es interno; `""` si no |
| `dst_addr` | string | host tal como estaba escrito en la variable |
| `dst_port` | string | puerto |
| `clave` | string | variable de entorno que originó la flecha (p. ej. `REDIS_HOST`) |
| `dst_kind` | string | **opcional**, desde mapper 0.3.0. Qué clase de cosa es el destino: uno de los valores de `ServiceKind` salvo `other`. Decide el icono |
| `externo` | string | `"true"` si el destino no es un Service del namespace |
| `namespace` | string | namespace del origen |
| `cluster` | string | lo pone Alloy |
| `Value` | number | **0** sonda falla · **1** alcanzable · **2** no sondeado |

Reglas derivadas que el plugin debe respetar:

- **Un nodo por `*_id` distinto**, tanto si aparece como origen como si aparece como destino.
  El mismo servicio puede ser ambas cosas (un servicio de negocio recibe del gateway y llama a Redis).
- **Una flecha por fila.** Dos filas con mismo `src_id`/`dst_id` y distinto `dst_port` son dos flechas.
- El estado de un **nodo** se deriva de sus flechas **entrantes**: si alguna tiene `Value == 0`,
  el nodo destino está "caído" para al menos un llamador.
- Métricas de apoyo que el panel puede consultar en queries adicionales (opcional):
  `dependencia_fallo_motivo{dst,dst_port,motivo}` (`timeout|refused|dns|error`),
  `dependencia_duracion_segundos{dst,dst_port}`.

Con `cluster` multi-valor puede haber nodos con el mismo `dst_id` en clústeres distintos.
Si el usuario selecciona varios clústeres, el id de nodo es `cluster + "/" + dst_id`.

**El mapa puede ir por delante de la realidad.** El mapper lee la *declaración* —el spec
del Deployment y el contenido actual del ConfigMap—, no las variables que tiene el pod en
marcha. Si alguien edita un ConfigMap y no reinicia el workload, la flecha nueva aparece en
el mapa aunque el pod siga con la configuración vieja. Es coherente con «mapa declarado»,
pero conviene saberlo antes de fiarse.

Sobre `dst_kind`: el mapper la emite solo cuando lo sabe —del esquema de la URL
(`postgresql://`, `mqtt://`) o de prefijos de clave inequívocos (`REDIS_`, `KAFKA_`…)—
y **nunca emite `other`**; cuando no sabe, manda la etiqueta vacía. El panel deduce
entonces del puerto. `isDeclaredKind()` rechaza `other` explícitamente, así que el panel
no depende de que el mapper se porte bien: si algún día lo emitiera, la deducción por
puerto seguiría funcionando.

---

## 3. Especificación visual (lo que se ve)

Referencia: el tablero "Mapa declarado" del lienzo de diseño. Recrearlo, no reinterpretarlo.

**Layout**: por capas, izquierda → derecha (dagre, `rankdir: LR`). Los nodos sin flechas
entrantes (el gateway, las webs) a la izquierda; los que solo reciben (Redis, Postgres, externos)
a la derecha. Opción para `TB`.

**Nodos**: rectángulo redondeado, ~170×46 px, etiqueta = `dst`/`src` legible en una línea,
con el icono de su clase a la izquierda. Nacieron de 140 px y se ensancharon en la 0.2.2:
el icono se comía el espacio del texto y los nombres se cortaban antes de tiempo.
Borde 1.5 px:

| Estado | Borde |
|---|---|
| todas las flechas entrantes OK | gris `#8E8E9E` |
| alguna flecha entrante con `Value == 0` | rojo `#F2495C`, 2.5 px |
| `externo == "true"` | además, discontinuo `4 3`; color azul `#5794F2` si está OK |

**Flechas**: dirigidas, punta en el destino. Etiqueta = `dst_port`, 9-10 px, solo si el zoom
lo permite (ocultar por debajo de 0.6). Color por `Value`:

| `Value` | Color | Grosor |
|---|---|---|
| 1 | `#8E8E9E` | 1.5 |
| 0 | `#F2495C` | 2.5 |
| 2 | `#5794F2` discontinua | 1.5 |

**Interacción**:
- zoom con rueda, pan con arrastre del fondo, arrastre de nodos (posición no persistente).
- hover en flecha → tooltip: `src → dst:port`, `clave`, `dst_svc`, `dst_addr`, y `motivo` si hay query de motivos.
- hover en nodo → tooltip: nombre, nº de flechas entrantes/salientes, cuántas en rojo.
- clic en nodo → **data link** configurable (por defecto `/d/servicio-detalle?var-servicio=${__data.fields.src}`).
- botón "Ajustar" (fit) y "Reordenar" (relayout).

**Tema**: usar `useTheme2()` de `@grafana/ui`; fondos y textos desde el tema, nunca hardcodeados. Los tres
colores de estado sí son fijos (son semánticos, no de tema).

**Rendimiento**: fluido con 200 nodos / 500 flechas. Con más, degradar (ocultar etiquetas de
flecha, desactivar animaciones), nunca fallar.

**Estados vacíos**: sin datos → mensaje "Sin flechas para $cluster / $servicio"; campos que
faltan (p. ej. sin `src_id`) → aviso claro indicando que el mapper debe ser ≥ 0.2.0.

---

## 4. Stack técnico (decidido; no cambiar sin motivo escrito)

- **Esqueleto**: `@grafana/create-plugin` → tipo *panel*, id `k3s-servicemap-panel`.
  TypeScript estricto, React.
  `create-plugin` **no funciona en Windows** (exige WSL); el andamio se generó dentro de un
  contenedor `node:22-bookworm-slim` con el repo montado. Si hay que regenerar o actualizar
  el andamio, mismo camino.
- **Grafo**: `cytoscape` + `cytoscape-dagre` (layout por capas). Alternativa aceptada si dagre
  no basta: `cytoscape-elk`. **No** D3 a mano, **no** ECharts, **no** librerías sin releases en el último año.
  `cytoscape` trae sus propios tipos: no instalar `@types/cytoscape`.
- **Todo empaquetado en el plugin.** Ninguna carga desde CDN en tiempo de ejecución: el
  navegador de quien mira el dashboard puede no tener Internet.
- Sin backend (plugin *frontend-only*). Sin `localStorage`.
- Versiones fijadas en `package.json` (sin `^`). Actualizar con `npm outdated` a propósito.
- Grafana objetivo: **13.1.1** (clúster central, imagen `release-13.1.1#patched`).
  `plugin.json` → `"grafanaDependency": ">=13.0.0"`. El Grafana de desarrollo se fija a
  `grafana/grafana:13.1.1` desde el `docker-compose.yaml` de la raíz, no a `latest`.
- **React 18, no 19.** El salto a React 19 ocurre en Grafana **13.2**, no en 13.1:
  `@grafana/ui@13.1.x` declara `peerDependencies.react: ^18.0.0` y `@grafana/ui@13.2.x`
  declara `>=19`. Como el objetivo es 13.1.1, el plugin va contra React 18.3.1.
  Webpack externaliza `react`, así que quien manda es el React que sirve Grafana en runtime.
  Si algún día el clúster central sube a 13.2+, este punto se revisa antes de subir `@grafana/*`.

---

## 5. Estructura del repo

```
grafana-k3s-servicemap/
├── CLAUDE.md                 ← este fichero
├── README.md                 ← instalación y opciones, para quien no lee código
├── CHANGELOG.md
├── .config/                  ← gestionado por create-plugin. NO TOCAR.
├── src/
│   ├── module.ts             ← registro del PanelPlugin y editor de opciones
│   ├── plugin.json
│   ├── types.ts              ← Options del panel; tipos del contrato de datos (§2)
│   ├── components/
│   │   ├── MapaPanel.tsx     ← PanelProps → grafo. Sin lógica de negocio.
│   │   ├── Tooltip.tsx
│   │   └── Toolbar.tsx       ← fit / relayout / dirección
│   ├── graph/
│   │   ├── build.ts          ← DataFrame → {nodes, edges} (puro, testeable)
│   │   ├── style.ts          ← estilos cytoscape a partir del tema + §3
│   │   └── layout.ts         ← configuración dagre
│   └── img/logo.svg
├── tests/                    ← Playwright para el panel (Jest vive junto al código en src/)
├── provisioning/             ← dashboards y datasource para el Grafana de desarrollo
├── .github/workflows/
└── docker-compose.yaml       ← Grafana de desarrollo, fijado a 13.1.1
```

Regla de oro: **`src/graph/build.ts` no importa nada de React ni de Grafana UI.** Recibe
data frames, devuelve nodos y flechas. Es donde viven los tests de verdad.

---

## 6. Comandos

```bash
npm install
npm run dev            # build en watch
npm run server         # Grafana de desarrollo en http://localhost:3000 con el plugin montado
npm run typecheck
npm run lint
npm run test           # Jest en watch (solo lo cambiado)
npm run test:ci        # Jest de una pasada, el que corre en CI
npm run e2e            # Playwright (requiere `npm run server`)
npm run build          # dist/ listo para empaquetar
```

Datos de desarrollo: `provisioning/` incluye un datasource TestData con un CSV que reproduce
el contrato de §2 (unas 30 filas con los tres valores). No hace falta un Prometheus real para
desarrollar. Para probar contra datos reales: `kubectl port-forward` al Prometheus central y
un datasource apuntando a `http://host.docker.internal:9090`.

---

## 7. Release e instalación

Versionado semántico. `CHANGELOG.md` obligatorio por versión.

```bash
git tag v0.1.0 && git push --tags
# → release.yml construye, empaqueta dist/ como k3s-servicemap-panel-0.1.0.zip y publica el Release
```

Instalación en el clúster central (values de kube-prometheus-stack):

```yaml
grafana:
  grafana.ini:
    plugins:
      allow_loading_unsigned_plugins: k3s-servicemap-panel
  plugins:
    - k3s-servicemap-panel@0.2.2@https://github.com/yoelsilva/grafana-k3s-servicemap/releases/download/v0.2.2/k3s-servicemap-panel-0.2.2.zip
```

Subir de versión = cambiar la URL + `helm upgrade`. Nunca `:latest` ni ramas: siempre un tag.

El plugin va **sin firmar** a propósito: es privado. No perseguir la firma del catálogo salvo
que se decida publicarlo.

---

## 8. Fases y criterio de hecho

**v0.1 — Se ve el mapa**
- Lee `dependencia`, dibuja nodos y flechas con dagre LR, colores de §3, tooltip básico.
- Funciona con el CSV de desarrollo y con el Prometheus real.
- Hecho cuando: el dashboard "Mapa de dependencias" muestra lo mismo que Node Graph pero por capas, y `npm run test:ci` cubre `build.ts` al 100 % de ramas.

**v0.2 — Es un panel de Grafana de verdad**
- Editor de opciones: dirección (LR/TB), mostrar puertos, umbral de zoom para etiquetas, plantilla de data link.
- Clic en nodo abre el data link con las variables del dashboard.
- Tema claro correcto.
- Hecho cuando: alguien que no es el autor lo configura desde el editor sin leer código.

**v0.3 — Aguanta el crecimiento**
- Multi-clúster (ids compuestos), query opcional de `dependencia_fallo_motivo` en el tooltip.
- 200 nodos / 500 flechas sin caídas de frames apreciables.
- Hecho cuando: el dashboard con `cluster = All` es usable.

Después de v0.3, no añadir funciones sin un caso de uso concreto escrito en un issue.

---

## 9. Convenciones

- Idioma: código e identificadores en inglés; comentarios, README, CHANGELOG, textos de UI
  y mensajes de error en **español**.
- Commits: `tipo(ámbito): descripción` (`feat(graph): layout TB`, `fix(style): borde externo en tema claro`).
- Un PR por cambio funcional. CI verde obligatorio. Sin dependencias nuevas en un PR de bugfix.
- Cualquier cambio al contrato de datos (§2) empieza en el repo del mapper, y este repo lo adopta
  después con soporte para ambas versiones durante al menos una release.
- Ante la duda entre "más bonito" y "más legible con 80 flechas", legible.

## 10. Qué NO hacer

- **No meter datos reales de la red en el repo: es público.** Ni IPs internas, ni
  NodePorts, ni hostnames de Tecopos, ni nombres reales de servicios. Los ejemplos usan
  direcciones de documentación (`10.0.0.x`, `203.0.113.x`, `.example.com`) y nombres
  genéricos. El mapa real es material de reconocimiento de red y en git sobrevive en el
  historial aunque se borre en un commit posterior; se ve en Grafana, no aquí.
- No consultar la API de Kubernetes, ni sondear, ni calcular estado en el plugin.
- No cargar nada por red en tiempo de ejecución (fuentes, librerías, iconos).
- No persistir posiciones de nodos ni usar `localStorage`/`sessionStorage`.
- No introducir un backend de plugin.
- No modificar `.config/`, ni cambiar el id o el tipo del plugin en `plugin.json`.
- No copiar el aspecto de Node Graph "para que se parezca": la razón de existir de este panel es el layout por capas.
- No añadir soporte para otras métricas "por si acaso".
