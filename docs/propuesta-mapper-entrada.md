# Propuesta al mapper: la entrada de tráfico en el mapa

Estado: **propuesta**, pendiente de que el repo del mapper la acepte o la cambie. Según §9
del CLAUDE.md, los cambios de contrato empiezan allí; el panel los adopta después.

Todos los nombres, direcciones y dominios de este documento son de ejemplo. El repo es
público.

## Qué se quiere ver

Hoy el mapa empieza en los workloads: dibuja quién llama a quién según las variables de
entorno. Falta el principio de la historia, por dónde entra el tráfico al clúster:

```
Internet ──443──▶ gateway ──app.example.com──▶ servicio-a
                     │ ───mqtt.example.com───▶ broker
certificados ┈┈gestiona┈┈▶ gateway    (TLS)
balanceador  ┈┈gestiona┈┈▶ gateway    (IP pública)
```

Las flechas de ruta llevan el **hostname** como etiqueta. Las de *gestiona* son de otra
naturaleza: no pasan tráfico, mantienen algo vivo. El panel las pintará distintas para que
no se confundan con llamadas.

## Requisito: autodescubrimiento, cero configuración

Lo pidió Yoel explícitamente: nada de listar a mano qué gateway, qué proveedor o qué
emisor de certificados hay. **Se descubre por tipo de recurso estándar, nunca por nombre.**
Si mañana se cambia Envoy por otra implementación de Gateway API, o el proveedor de nube,
tiene que seguir funcionando sin tocar nada.

| Pieza | Cómo se descubre | Si no existe |
|---|---|---|
| Gateways y rutas | `gateway.networking.k8s.io/v1`: `Gateway`, `HTTPRoute` (después `GRPCRoute`, `TLSRoute`) | CRD ausente → se omite, una línea de log al arrancar |
| Certificados | `cert-manager.io/v1`: `Certificate`, cruzando su `spec.secretName` con los `listeners[].tls.certificateRefs` del Gateway | Idem |
| Balanceador | El Service `type: LoadBalancer` que publica el Gateway, con `status.loadBalancer.ingress` | Sin IP asignada → estado rojo, no ausencia |
| Proveedor de nube | El esquema del `spec.providerID` de los nodos (`hcloud://`, `aws://`, `gce://`…) | Sin providerID → «balanceador» sin apellido |

Todo esto es independiente de la implementación: Gateway API es estándar, y cert-manager se
reconoce por su CRD.

## Contrato propuesto (0.6.0)

Filas nuevas en la métrica `dependencia`, con una etiqueta nueva que distingue la
naturaleza de la flecha:

| Etiqueta nueva | Valores | Notas |
|---|---|---|
| `relacion` | `llama` · `enruta` · `gestiona` | Ausente equivale a `llama`, así las filas actuales no cambian |
| `host` | hostnames de la ruta, separados por coma | Solo en `enruta` |

Y `src_tipo` gana dos valores: `gateway` e `internet`.

### `enruta`: del gateway a cada backend

Una fila por cada `backendRef` de cada ruta que cuelgue del Gateway:

| Campo | Valor |
|---|---|
| `src` / `src_id` / `src_tipo` | el Gateway, `n_<gateway>`, `gateway` |
| `dst`, `dst_id`, `dst_svc`, `dst_ns` | el backend, resuelto como hoy: Service → workload dueño |
| `dst_port` | el puerto del `backendRef` |
| `clave` | `HTTPRoute <ns>/<nombre>`, el equivalente a la variable de entorno |
| `host` | los `hostnames` de la ruta |
| `Value` | la sonda TCP al backend, como cualquier otra flecha |

Una ruta sin `backendRefs` (por ejemplo, la que solo redirige de HTTP a HTTPS) no genera fila.

### Internet → gateway

Una fila con `src="internet"`, `src_tipo="internet"`, destino el Gateway, `dst_addr` la
dirección de `status.addresses` y `dst_port` el de cada listener.

Cuidado con el `Value`: sondear la IP pública del propio Gateway desde dentro del clúster
depende de que la red haga *hairpin*, y en muchos proveedores no lo hace. Si no se puede
sondear de forma fiable, mejor `Value=2` (no sondeado) que un rojo falso.

### `gestiona`: certificados y balanceador (segundo paso)

| Origen | Estado (`Value`) |
|---|---|
| El emisor de certificados → Gateway | 1 si el `Certificate` está `Ready`, 0 si no |
| El balanceador → Gateway | 1 si el Service tiene IP externa asignada, 0 si no |

Más una métrica aparte, que es lo más útil de todo esto y es barata:

```
dependencia_certificado_caduca_segundos{certificado, namespace, gateway}
```

Segundos hasta `status.notAfter`. Con eso el panel puede avisar de un certificado a punto de
caducar antes de que tumbe la entrada.

### RBAC

Un ClusterRole de **solo lectura** que añada `get`/`list` sobre `gateways` y `httproutes`
(`gateway.networking.k8s.io`), `certificates` (`cert-manager.io`) y `nodes` (para el
`providerID`). Las rutas viven en varios namespaces, así que a nivel de namespace no basta.

## Fases

1. **`enruta` + Internet**: el camino real del tráfico. Es lo que más aporta.
2. **`gestiona` + caducidad de certificados.**

## Lo que hará el panel cuando llegue

- Una **franja de Entrada** a la izquierda, con Internet, el Gateway y lo que lo gestiona.
- Flechas `enruta` con el hostname como etiqueta; flechas `gestiona` punteadas y finas.
- Mientras el mapper no emita estas filas, el panel no cambia nada: todas las etiquetas
  nuevas son opcionales.

Antes de publicar, que el mapper confirme los nombres (`relacion`, `host`, los valores de
`src_tipo`) para que el panel los adopte tal cual.
