# Propuesta al mapper: qué workload monta cada volumen

Estado: **sin aprobar**. Escrita el 2026-09-28 para la sesión del mapper, que no estaba abierta.
Es una métrica nueva: no cambia `dependencia` ni nada de lo que ya se emite.

Todos los nombres de este documento son de ejemplo. El repo es público.

## El problema

El dashboard de detalle del servicio (`dashboards/servicio.json`) enseña el disco de cada
servicio con `kubelet_volume_stats_used_bytes` y `kubelet_volume_stats_capacity_bytes`. Esas
métricas traen `namespace` y `persistentvolumeclaim`, pero **no el pod que monta el volumen**.

Hoy el dashboard los asocia por nombre: `<servicio>-pvc` o `<servicio>-data`. En producción
falla al menos una vez: un Deployment `router-engine` monta un volumen `router-data`, así que su
detalle dice «Sin volumen persistente», que es falso.

No hay otra fuente para arreglarlo:

- kube-state-metrics (`kube_pod_spec_volumes_persistentvolumeclaims_info`) no llega al
  Prometheus central con la etiqueta `cluster` del clúster de trabajo.
- Adivinar por prefijo da falsos positivos: `app-portal-server-pvc` saldría en el detalle de
  todos los `app-*`.

## Lo que ya sabe el mapper

El mapper lee el spec de cada Deployment y StatefulSet. La asociación está ahí:

- `spec.template.spec.volumes[].persistentVolumeClaim.claimName`, en los dos.
- En un StatefulSet, además, `spec.volumeClaimTemplates`: el PVC real se llama
  `<plantilla>-<statefulset>-<ordinal>`, uno por réplica.

## Métrica propuesta

```
dependencia_volumen{namespace, workload, workload_tipo, persistentvolumeclaim} 1
```

- Una serie por pareja workload–PVC.
- Solo declaración, como el resto del mapper: lo que dice el spec, sin comprobar nada.
- Si el PVC declarado no existe, se emite igual; el cruce con el kubelet lo dejará sin datos de uso.
- Los nombres de las etiquetas los decide el mapper; el dashboard se adapta.

## Lo que hará el dashboard cuando llegue

Cruzar `kubelet_volume_stats_*` con `dependencia_volumen` por `(namespace, persistentvolumeclaim)`,
con un solo join, y quedarse con los de `workload="$servicio"`. La asociación por nombre
desaparece.
