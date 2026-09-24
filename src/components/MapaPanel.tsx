import { css } from '@emotion/css';
import { locationUtil, type GrafanaTheme2, type PanelProps } from '@grafana/data';
import { getTemplateSrv, locationService } from '@grafana/runtime';
import { Alert, useStyles2, useTheme2 } from '@grafana/ui';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildGraph } from '../graph/build';
import {
  HEAVY_GRAPH_EDGES,
  PORT_LABEL_ZOOM_THRESHOLD,
  dagreLayout,
  sinkAlignedMinLen,
  spreadTaxiTurns,
} from '../graph/layout';
import { Lane, Placed, bandPositions, classifyLanes, laneBoxes } from '../graph/lanes';
import { FilterVariable, activeFilter, isFilteredBy, nextFilterValue, toFilterVariable } from '../graph/filter';
import { fillNodeLink, isExternalLink } from '../graph/link';
import { createTapClassifier } from '../graph/taps';
import {
  CLASS_FADED,
  CLASS_FILTERED,
  CLASS_LANE,
  CLASS_NO_LABEL,
  KIND_ICONS,
  NODE_HEIGHT,
  NODE_WIDTH,
  buildStylesheet,
} from '../graph/style';
import { GraphNode, LayoutDirection, ProbeState, ServiceMapOptions } from '../types';
import { Toolbar } from './Toolbar';
import { Tooltip, TooltipContent } from './Tooltip';

// cytoscape-dagre se registra una sola vez por carga del bundle.
let dagreRegistered = false;
function registerDagre() {
  if (!dagreRegistered) {
    cytoscape.use(dagre);
    dagreRegistered = true;
  }
}

const NODE_SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT };
/** Hueco entre franjas. Tiene que superar 2 × margen + titulo, o las cajas se pisan en vertical. */
const LANE_GAP = 90;
const LANE_PADDING = 20;
const LANE_HEADER = 30;

/** Los nodos reales del grafo con su posicion actual; las cajas de franja no cuentan. */
function placedNodes(cy: cytoscape.Core, lanes: ReadonlyMap<string, Lane>): Placed[] {
  // Con el selector dentro de `nodes()` la coleccion sigue siendo de nodos; con
  // `.not()` despues, TypeScript la trata como elementos genericos.
  return cy.nodes(`:not(.${CLASS_LANE})`).map((node) => ({
    id: node.id(),
    x: node.position('x'),
    y: node.position('y'),
    lane: lanes.get(node.id()) ?? 'aplicacion',
  }));
}

/**
 * Redibuja las cajas de fondo. Con una sola franja no se dibuja ninguna: una caja
 * enorme titulada «Aplicaciones» alrededor de todo el mapa no separa nada.
 */
function drawLaneBoxes(cy: cytoscape.Core, lanes: ReadonlyMap<string, Lane>, direction: LayoutDirection) {
  cy.remove(`node.${CLASS_LANE}`);
  const placed = placedNodes(cy, lanes);
  if (new Set(placed.map((node) => node.lane)).size < 2) {
    return;
  }
  const boxes = laneBoxes(placed, direction, NODE_SIZE, LANE_PADDING, LANE_HEADER);
  cy.add(
    boxes.map((box) => ({
      group: 'nodes' as const,
      data: { id: `__franja_${box.lane}`, label: box.label, w: box.width, h: box.height },
      position: { x: box.x, y: box.y },
      classes: CLASS_LANE,
      selectable: false,
      grabbable: false,
      locked: true,
    }))
  );
}

/** Separa las franjas moviendo cada una en bloque, y pinta sus cajas. */
function separateLanes(cy: cytoscape.Core, lanes: ReadonlyMap<string, Lane>, direction: LayoutDirection) {
  const next = bandPositions(placedNodes(cy, lanes), direction, NODE_SIZE, LANE_GAP);
  cy.batch(() => {
    next.forEach((position, id) => cy.getElementById(id).position(position));
    drawLaneBoxes(cy, lanes, direction);
  });
}

/** La variable que filtra el clic, tal como esta ahora en el dashboard. */
function readFilterVariable(name: string): FilterVariable | null {
  return toFilterVariable(getTemplateSrv().getVariables(), name);
}

/** Pone el filtro del dashboard en el nodo pulsado, o lo quita si ya estaba. */
function applyFilter(name: string, node: GraphNode) {
  const variable = readFilterVariable(name);
  if (!variable) {
    return;
  }
  const value = nextFilterValue(variable, node.label);
  if (value === null) {
    return;
  }
  // `push`, no `replace`: el boton atras del navegador deshace el filtro.
  locationService.partial({ [`var-${variable.name}`]: value }, false);
}

/** Abre la plantilla de enlace con los datos del nodo. */
function openNodeLink(template: string, node: GraphNode, replaceVariables: (value: string) => string, newTab: boolean) {
  const filled = fillNodeLink(template, node);
  if (!filled) {
    return;
  }
  // Primero los huecos del nodo, despues las variables del dashboard.
  const url = replaceVariables(filled);
  if (isExternalLink(url)) {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else if (newTab) {
    // Grafana puede estar servido bajo un subpath; `assureBaseUrl` lo añade.
    window.open(locationUtil.assureBaseUrl(url), '_blank', 'noopener');
  } else {
    // Navegacion interna sin recargar la pagina.
    locationService.push(locationUtil.stripBaseFromUrl(url));
  }
}

const STATE_CLASS: Record<ProbeState, string> = {
  [ProbeState.Down]: 'state-down',
  [ProbeState.Up]: 'state-up',
  [ProbeState.NotProbed]: 'state-notprobed',
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    position: 'relative',
    overflow: 'hidden',
  }),
  canvas: css({
    width: '100%',
    height: '100%',
  }),
  empty: css({
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
  }),
  warning: css({
    position: 'absolute',
    left: theme.spacing(1),
    bottom: theme.spacing(1),
    right: theme.spacing(1),
    zIndex: 1,
  }),
});

interface Props extends PanelProps<ServiceMapOptions> {}

export const MapaPanel: React.FC<Props> = ({ options, data, width, height, replaceVariables }) => {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [tooltip, setTooltip] = useState<TooltipContent | null>(null);

  const graph = useMemo(() => buildGraph(data.series), [data.series]);

  const nodeLabels = useMemo(() => {
    const labels = new Map<string, string>();
    graph.nodes.forEach((node) => labels.set(node.id, node.label));
    return labels;
  }, [graph.nodes]);

  // Los handlers de hover se registran una sola vez al montar, asi que leen las
  // etiquetas por referencia en vez de capturarlas en el closure.
  const nodeLabelsRef = useRef(nodeLabels);
  useEffect(() => {
    nodeLabelsRef.current = nodeLabels;
  }, [nodeLabels]);

  // Mismo motivo para el enlace: la plantilla cambia desde el editor y las
  // variables del dashboard cambian al filtrar, pero el handler es el de siempre.
  const nodeLinkRef = useRef(options.nodeLink);
  const filterVariableRef = useRef(options.filterVariable);
  const replaceVariablesRef = useRef(replaceVariables);
  useEffect(() => {
    nodeLinkRef.current = options.nodeLink;
    filterVariableRef.current = options.filterVariable;
    replaceVariablesRef.current = replaceVariables;
  }, [options.nodeLink, options.filterVariable, replaceVariables]);

  const lanes = useMemo(() => classifyLanes(graph.nodes, graph.edges), [graph.nodes, graph.edges]);

  // Al soltar un nodo arrastrado hay que reajustar las cajas, y ese handler tambien
  // se registra una sola vez.
  const lanesRef = useRef(lanes);
  const groupLanesRef = useRef(options.groupLanes);
  const directionRef = useRef(options.direction);
  useEffect(() => {
    lanesRef.current = lanes;
    groupLanesRef.current = options.groupLanes;
    directionRef.current = options.direction;
  }, [lanes, options.groupLanes, options.direction]);

  const turns = useMemo(() => spreadTaxiTurns(graph.edges), [graph.edges]);

  const elements = useMemo<cytoscape.ElementDefinition[]>(() => {
    const nodes = graph.nodes.map((node) => ({
      // El icono se resuelve aqui y no en `build.ts`, que es puro y no sabe de
      // como se pinta nada.
      data: { ...node, icon: KIND_ICONS[node.kind] },
      classes: [node.external ? 'external' : '', node.incomingDown > 0 ? 'down' : ''].filter(Boolean).join(' '),
    }));
    const edges = graph.edges.map((edge) => ({
      data: { ...edge, turn: turns.get(edge.id) ?? '50%' },
      classes: STATE_CLASS[edge.state],
    }));
    return [...nodes, ...edges];
  }, [graph.nodes, graph.edges, turns]);

  // Solo se recalcula el layout cuando cambia la forma del grafo, no en cada
  // refresco de la query: reordenar el mapa bajo el raton es desorientador.
  const shape = useMemo(
    () =>
      [
        graph.nodes.map((n) => n.id).join('|'),
        graph.edges.map((e) => `${e.id}:${e.state}`).join('|'),
        options.direction,
        String(options.groupLanes),
      ].join('#'),
    [graph.nodes, graph.edges, options.direction, options.groupLanes]
  );

  const heavy = graph.edges.length > HEAVY_GRAPH_EDGES;

  const minLen = useMemo(() => sinkAlignedMinLen(graph.nodes, graph.edges), [graph.nodes, graph.edges]);

  const runLayout = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }
    // Las cajas viejas fuera antes de calcular: no deben influir en el layout.
    cy.remove(`node.${CLASS_LANE}`);
    const real = cy.elements();
    if (real.length === 0) {
      return;
    }
    const base = dagreLayout(options.direction, heavy, minLen);
    if (!options.groupLanes) {
      real.layout(base).run();
      return;
    }
    // Con franjas, dagre coloca sin animar ni encuadrar; luego se separan las franjas
    // en bloque y se encuadra el resultado final. Animar para despues dar un salto
    // seria peor que no animar.
    const direction = options.direction;
    real
      .layout({
        ...base,
        animate: false,
        fit: false,
        stop: () => {
          separateLanes(cy, lanes, direction);
          cy.fit(undefined, 24);
        },
      } as cytoscape.LayoutOptions)
      .run();
  }, [options.direction, options.groupLanes, heavy, minLen, lanes]);

  const fit = useCallback(() => {
    cyRef.current?.fit(undefined, 24);
  }, []);

  // Monta cytoscape una sola vez; los datos se inyectan en el efecto siguiente.
  useEffect(() => {
    registerDagre();
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const cy = cytoscape({
      container,
      elements: [],
      style: buildStylesheet(theme),
      minZoom: 0.1,
      maxZoom: 4,
      // 0.2 obligaba a girar la rueda una eternidad para acercarse a un nodo.
      wheelSensitivity: 1,
      boxSelectionEnabled: false,
    });
    cyRef.current = cy;

    const toPanelPosition = (event: cytoscape.EventObject) => {
      const { x, y } = event.renderedPosition ?? { x: 0, y: 0 };
      return { x, y };
    };

    // Deja encendido `focus` y su vecindad, apaga el resto. Un solo recalculo
    // de estilo gracias a `batch`, que con 500 flechas importa.
    const focusOn = (focus: cytoscape.NodeSingular | cytoscape.EdgeSingular | null) => {
      cy.batch(() => {
        if (!focus) {
          cy.elements().removeClass(CLASS_FADED);
          return;
        }
        // De un nodo interesa su vecindad cerrada: el, sus flechas y el otro
        // extremo de cada una. De una flecha, ella y sus dos puntas.
        const lit = focus.isNode()
          ? (focus as cytoscape.NodeSingular).closedNeighborhood()
          : (focus as cytoscape.EdgeSingular).connectedNodes().union(focus);
        // Las cajas de franja no se apagan: son el marco, no parte del grafo.
        cy.elements().not(`.${CLASS_LANE}`).difference(lit).addClass(CLASS_FADED);
        lit.removeClass(CLASS_FADED);
      });
    };

    cy.on('mouseover', 'node', (event) => {
      const node = event.target.data();
      const { x, y } = toPanelPosition(event);
      focusOn(event.target);
      const hasLink = nodeLinkRef.current.trim() !== '';
      const filter = readFilterVariable(filterVariableRef.current);
      // Que hara el clic: filtrar, quitar el filtro, o nada (filtrado sin «All»).
      const clickAction = !filter
        ? null
        : !isFilteredBy(filter, node.label)
          ? 'filtrar por este nodo'
          : filter.includeAll
            ? 'quitar el filtro'
            : null;
      // Sin la mano no hay forma de saber que un nodo se puede pulsar.
      container.style.cursor = hasLink || clickAction ? 'pointer' : '';
      setTooltip({
        title: node.label,
        rows: [
          { label: 'Entrantes', value: String(node.incoming) },
          { label: 'Salientes', value: String(node.outgoing) },
          { label: 'Entrantes caídas', value: String(node.incomingDown) },
          // Desde mapper 0.5.0 `externo` significa de verdad "sale del cluster".
          // El namespace solo tiene sentido enseñarlo cuando esta dentro.
          ...(node.external
            ? [{ label: 'Externo', value: 'fuera del clúster' }]
            : node.namespace !== ''
              ? [{ label: 'Namespace', value: node.namespace }]
              : []),
          ...(clickAction ? [{ label: 'Clic', value: clickAction }] : []),
          ...(hasLink ? [{ label: 'Doble clic', value: 'abrir detalle' }] : []),
        ],
        x,
        y,
      });
    });

    cy.on('mouseover', 'edge', (event) => {
      const edge = event.target.data();
      const { x, y } = toPanelPosition(event);
      focusOn(event.target);
      const source = nodeLabelsRef.current.get(edge.source) ?? edge.source;
      const target = nodeLabelsRef.current.get(edge.target) ?? edge.target;
      const rows = [
        { label: 'Clave', value: edge.envKey },
        { label: 'Service', value: edge.dstSvc },
        { label: 'Dirección', value: edge.dstAddr },
      ].filter((row) => row.value !== '');
      setTooltip({
        title: `${source} → ${target}:${edge.port}`,
        rows,
        x,
        y,
      });
    });

    cy.on('mouseout', 'node, edge', () => {
      container.style.cursor = '';
      setTooltip(null);
      focusOn(null);
    });
    cy.on('tap', () => {
      setTooltip(null);
      focusOn(null);
    });

    // Clic filtra, doble clic abre el enlace. Ver `graph/taps.ts` para por que el
    // clic espera un momento antes de filtrar.
    const taps = createTapClassifier<{ node: GraphNode; newTab: boolean }>(
      {
        single: ({ node }) => applyFilter(filterVariableRef.current, node),
        double: ({ node, newTab }) =>
          openNodeLink(nodeLinkRef.current, node, replaceVariablesRef.current, newTab),
        hasDouble: () => nodeLinkRef.current.trim() !== '',
      },
      { set: (callback, ms) => window.setTimeout(callback, ms), clear: (handle) => window.clearTimeout(handle as number) }
    );

    // `tap` y no `click`: cytoscape lo distingue de un arrastre, asi que mover un
    // nodo nunca filtra ni te saca del dashboard.
    cy.on('tap', 'node', (event) => {
      const node = event.target.data() as GraphNode;
      const pointer = event.originalEvent as MouseEvent | undefined;
      const newTab = Boolean(pointer && (pointer.ctrlKey || pointer.metaKey));
      taps.tap(node.id, { node, newTab });
    });

    // Al soltar un nodo arrastrado, las cajas se reajustan para seguir abarcandolo.
    cy.on('dragfree', 'node', () => {
      if (groupLanesRef.current) {
        drawLaneBoxes(cy, lanesRef.current, directionRef.current);
      }
    });

    // Por debajo del umbral las etiquetas de puerto son ruido ilegible (§3).
    // Un solo recalculo por gesto gracias a `batch`.
    let labelsHidden = false;
    cy.on('zoom', () => {
      const shouldHide = cy.zoom() < PORT_LABEL_ZOOM_THRESHOLD;
      if (shouldHide !== labelsHidden) {
        labelsHidden = shouldHide;
        cy.batch(() => {
          cy.edges().toggleClass(CLASS_NO_LABEL, shouldHide);
        });
      }
    });

    return () => {
      taps.cancel();
      cy.destroy();
      cyRef.current = null;
    };
    // El tema se aplica en su propio efecto para no recrear el grafo al
    // cambiar de claro a oscuro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    cyRef.current?.style(buildStylesheet(theme, options.direction));
  }, [theme, options.direction]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }
    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });
    setTooltip(null);
    runLayout();
    // `elements` cambia en cada refresco aunque el grafo sea el mismo; el que
    // manda es `shape`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  // Marca el nodo por el que esta filtrado el dashboard. Va despues del efecto que
  // recrea los elementos, porque al recrearlos se pierden las clases.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }
    const filtered = activeFilter(readFilterVariable(options.filterVariable));
    cy.batch(() => {
      cy.nodes(`:not(.${CLASS_LANE})`).forEach((node) => {
        node.toggleClass(CLASS_FILTERED, filtered.has(node.data('label')));
      });
    });
  }, [elements, options.filterVariable]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }
    cy.resize();
    cy.fit(undefined, 24);
  }, [width, height]);

  const isEmpty = graph.nodes.length === 0;

  // El lienzo se renderiza siempre, tambien cuando no hay datos: si se quitara
  // del arbol, cytoscape no llegaria a montarse nunca y el panel se quedaria en
  // blanco al llegar la primera respuesta.
  return (
    <div className={styles.wrapper} style={{ width, height }}>
      {!isEmpty && <Toolbar onFit={fit} onRelayout={runLayout} />}
      <div ref={containerRef} className={styles.canvas} data-testid="servicemap-canvas" />
      {isEmpty && (
        <div className={styles.empty} data-testid="servicemap-empty">
          <div>
            <p>
              Sin flechas para {replaceVariables('$cluster')} / {replaceVariables('$servicio')}
            </p>
          </div>
        </div>
      )}
      {tooltip && <Tooltip content={tooltip} panelWidth={width} panelHeight={height} />}
      {graph.warnings.length > 0 && (
        <div className={styles.warning}>
          <Alert severity="warning" title="Datos incompletos">
            {graph.warnings.join(' ')}
          </Alert>
        </div>
      )}
    </div>
  );
};
