import { expect, test } from '@grafana/plugin-e2e';

test('dibuja el mapa con los datos de desarrollo', async ({ gotoPanelEditPage, readProvisionedDashboard, page }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  await expect(page.getByTestId('servicemap-canvas')).toBeVisible();
  await expect(page.getByTestId('servicemap-empty')).toBeHidden();
  // cytoscape pinta sobre canvas, asi que lo comprobable desde fuera es que el
  // lienzo exista y que la barra de herramientas este viva.
  await expect(page.getByTestId('servicemap-fit')).toBeVisible();
  await expect(panelEditPage.panel.locator).not.toContainText('No data');
});

test('sin datos avisa en vez de quedarse en blanco', async ({ panelEditPage, readProvisionedDataSource, page }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await panelEditPage.datasource.set(ds.name);
  await panelEditPage.setVisualization('Mapa de dependencias');

  await expect(page.getByTestId('servicemap-empty')).toContainText('Sin flechas para');
});

test('el editor ofrece cambiar la direccion del layout', async ({ gotoPanelEditPage, readProvisionedDashboard }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  const options = panelEditPage.getCustomOptions('Mapa de dependencias');
  const direction = options.getRadioGroup('Direccion del layout');

  await direction.check('Arriba → abajo');
  await expect(direction.locator).toBeVisible();
});
