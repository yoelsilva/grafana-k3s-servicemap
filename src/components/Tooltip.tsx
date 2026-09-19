import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import React from 'react';

export interface TooltipContent {
  title: string;
  rows: Array<{ label: string; value: string }>;
  /** Posicion dentro del panel, en px. */
  x: number;
  y: number;
}

interface Props {
  content: TooltipContent;
  /** Tamano del panel, para no salirse por el borde derecho o inferior. */
  panelWidth: number;
  panelHeight: number;
}

const OFFSET = 12;
const ESTIMATED_WIDTH = 280;
const ESTIMATED_LINE_HEIGHT = 18;

const getStyles = (theme: GrafanaTheme2) => ({
  tooltip: css({
    position: 'absolute',
    zIndex: theme.zIndex.tooltip,
    pointerEvents: 'none',
    maxWidth: ESTIMATED_WIDTH,
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    boxShadow: theme.shadows.z2,
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  title: css({
    fontWeight: theme.typography.fontWeightMedium,
    marginBottom: theme.spacing(0.5),
    wordBreak: 'break-all',
  }),
  row: css({
    display: 'flex',
    gap: theme.spacing(1),
    lineHeight: 1.5,
  }),
  label: css({
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
  }),
  value: css({
    wordBreak: 'break-all',
  }),
});

export const Tooltip: React.FC<Props> = ({ content, panelWidth, panelHeight }) => {
  const styles = useStyles2(getStyles);

  const estimatedHeight = (content.rows.length + 1) * ESTIMATED_LINE_HEIGHT + 16;
  const flipX = content.x + OFFSET + ESTIMATED_WIDTH > panelWidth;
  const flipY = content.y + OFFSET + estimatedHeight > panelHeight;

  const style: React.CSSProperties = {
    left: flipX ? undefined : content.x + OFFSET,
    right: flipX ? Math.max(0, panelWidth - content.x + OFFSET) : undefined,
    top: flipY ? undefined : content.y + OFFSET,
    bottom: flipY ? Math.max(0, panelHeight - content.y + OFFSET) : undefined,
  };

  return (
    <div className={styles.tooltip} style={style} data-testid="servicemap-tooltip">
      <div className={styles.title}>{content.title}</div>
      {content.rows.map((row) => (
        <div key={row.label} className={styles.row}>
          <span className={styles.label}>{row.label}</span>
          <span className={styles.value}>{row.value}</span>
        </div>
      ))}
    </div>
  );
};
