import { css } from '@emotion/css';
import type { GrafanaTheme2, PanelProps } from '@grafana/data';
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
import { CLASS_FADED, CLASS_NO_LABEL, KIND_ICONS, buildStylesheet } from '../graph/style';
import { ProbeState, ServiceMapOptions } from '../types';
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
      ].join('#'),
    [graph.nodes, graph.edges, options.direction]
  );

  const heavy = graph.edges.length > HEAVY_GRAPH_EDGES;

  const minLen = useMemo(() => sinkAlignedMinLen(graph.nodes, graph.edges), [graph.nodes, graph.edges]);

  const runLayout = useCallback(() => {
    const cy = cyRef.current;
    if (!cy || cy.elements().length === 0) {
      return;
    }
    cy.layout(dagreLayout(options.direction, heavy, minLen)).run();
  }, [options.direction, heavy, minLen]);

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
        cy.elements().difference(lit).addClass(CLASS_FADED);
        lit.removeClass(CLASS_FADED);
      });
    };

    cy.on('mouseover', 'node', (event) => {
      const node = event.target.data();
      const { x, y } = toPanelPosition(event);
      focusOn(event.target);
      setTooltip({
        title: node.label,
        rows: [
          { label: 'Entrantes', value: String(node.incoming) },
          { label: 'Salientes', value: String(node.outgoing) },
          { label: 'Entrantes caidas', value: String(node.incomingDown) },
          // `externo` significa "no es un Service del namespace de quien llama",
          // no "esta fuera del cluster". Decirlo tal cual evita que el borde
          // discontinuo se lea como algo que no es.
          ...(node.external ? [{ label: 'Alcance', value: 'fuera del namespace de origen' }] : []),
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
        { label: 'Direccion', value: edge.dstAddr },
      ].filter((row) => row.value !== '');
      setTooltip({
        title: `${source} → ${target}:${edge.port}`,
        rows,
        x,
        y,
      });
    });

    cy.on('mouseout', 'node, edge', () => {
      setTooltip(null);
      focusOn(null);
    });
    cy.on('tap', () => {
      setTooltip(null);
      focusOn(null);
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
