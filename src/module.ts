import { PanelPlugin } from '@grafana/data';

import { MapaPanel } from './components/MapaPanel';
import { ServiceMapOptions, defaultOptions } from './types';

export const plugin = new PanelPlugin<ServiceMapOptions>(MapaPanel).setPanelOptions((builder) =>
  builder
    .addRadio({
      path: 'direction',
      name: 'Dirección del layout',
      description: 'Por capas de izquierda a derecha, o de arriba abajo.',
      defaultValue: defaultOptions.direction,
      settings: {
        options: [
          { value: 'LR', label: 'Izquierda → derecha' },
          { value: 'TB', label: 'Arriba → abajo' },
        ],
      },
    })
    .addBooleanSwitch({
      path: 'groupLanes',
      name: 'Separar en franjas',
      description:
        'Aplicaciones, servicios compartidos y lo que está fuera del clúster, cada cosa en su franja. ' +
        'Compartido es la infraestructura (bases de datos, colas, brokers, almacenamiento) que usan ' +
        'al menos dos servicios distintos; la que solo usa uno se queda junto a él.',
      defaultValue: defaultOptions.groupLanes,
    })
    .addTextInput({
      path: 'filterVariable',
      name: 'Variable que filtra el clic',
      description:
        'Nombre de la variable del dashboard, sin $. Un clic en un nodo la pone en ese nodo y todo el ' +
        'dashboard se filtra; otro clic en el mismo nodo vuelve a All. Si el dashboard no tiene esa ' +
        'variable, el clic no hace nada.',
      defaultValue: defaultOptions.filterVariable,
      settings: {
        placeholder: 'servicio',
      },
    })
    .addTextInput({
      path: 'nodeLink',
      name: 'Enlace al hacer doble clic en un nodo',
      description:
        'URL con huecos del nodo pulsado: ${nodo.servicio}, ${nodo.tipo}, ${nodo.namespace}, ' +
        '${nodo.cluster}, ${nodo.id}. Admite también variables del dashboard ($cluster, ${__from}, ${__to}). ' +
        'Con ${nodo.tipo} en la ruta, una sola plantilla lleva a un dashboard distinto por clase de servicio. ' +
        'Vacío: el doble clic no hace nada. Ctrl o Cmd + doble clic abre en pestaña nueva.',
      defaultValue: defaultOptions.nodeLink,
      settings: {
        placeholder: '/d/tipo-${nodo.tipo}?var-servicio=${nodo.servicio}&from=${__from}&to=${__to}',
      },
    })
);
