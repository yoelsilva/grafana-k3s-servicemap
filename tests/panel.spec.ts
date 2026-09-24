import { expect, test } from '@grafana/plugin-e2e';

/**
 * Humo, no exhaustividad: la logica de verdad vive en `src/graph/build.ts` y la
 * cubren los tests de Jest. Aqui solo se comprueba que el panel se monta dentro
 * de Grafana y reacciona al editor.
 *
 * cytoscape pinta sobre <canvas>, asi que lo unico observable desde fuera es
 * que el lienzo exista y que la barra de herramientas este viva.
 */

test('dibuja el mapa con los datos de desarrollo', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  await expect(page.getByTestId('servicemap-canvas')).toBeVisible();
  await expect(page.getByTestId('servicemap-fit')).toBeVisible();
  await expect(page.getByTestId('servicemap-empty')).toBeHidden();
  await expect(panelEditPage.panel.locator).not.toContainText('No data');
});

test('sin filas avisa en vez de quedarse en blanco', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  // El panel 3 del dashboard de desarrollo usa el escenario `no_data_points`.
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '3' });

  await expect(page.getByTestId('servicemap-empty')).toContainText('Sin flechas para');
});

test('el editor cambia la direccion del layout sin romper el mapa', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  // El argumento es el nombre visible del plugin (`name` de plugin.json), no el
  // titulo del panel.
  const options = panelEditPage.getCustomOptions('grafana-k3s-servicemap');
  await options.getRadioGroup('Dirección del layout').check('Arriba → abajo');

  // Si el relayout reventara, el lienzo desapareceria o saltaria el error de panel.
  await expect(page.getByTestId('servicemap-canvas')).toBeVisible();
  await expect(page.getByTestId('servicemap-empty')).toBeHidden();
});

test('las franjas se pueden apagar sin romper el mapa', async ({ gotoPanelEditPage, readProvisionedDashboard, page }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  const options = panelEditPage.getCustomOptions('grafana-k3s-servicemap');
  const lanes = options.getSwitch('Separar en franjas');

  // Encendidas por defecto: es lo que pidio Yoel.
  await expect(lanes).toBeChecked();
  await lanes.uncheck();
  await expect(lanes).not.toBeChecked();
  await expect(page.getByTestId('servicemap-canvas')).toBeVisible();
  await expect(page.getByTestId('servicemap-empty')).toBeHidden();
});

test('el editor ofrece el enlace al hacer doble clic, vacio por defecto', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  // El panel 3 y no el 1: el 1 trae un enlace de ejemplo para probar el doble clic a
  // mano, y aqui lo que se comprueba es el valor por defecto.
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '3' });

  const options = panelEditPage.getCustomOptions('grafana-k3s-servicemap');
  const link = options.getTextInput('Enlace al hacer doble clic en un nodo');

  // Vacio a proposito: un enlace por defecto a un dashboard que no existe haria
  // que el primer clic de cualquiera acabara en un 404.
  await expect(link).toHaveValue('');

  await link.fill('/d/tipo-${nodo.tipo}');
  await expect(link).toHaveValue('/d/tipo-${nodo.tipo}');
  await expect(page.getByTestId('servicemap-canvas')).toBeVisible();
});

test('el editor trae la variable del filtro, servicio por defecto', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  const options = panelEditPage.getCustomOptions('grafana-k3s-servicemap');
  // Por defecto la del dashboard de referencia: asi funciona sin configurar nada.
  await expect(options.getTextInput('Variable que filtra el clic')).toHaveValue('servicio');
});
