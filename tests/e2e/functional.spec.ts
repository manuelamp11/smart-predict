import { test, expect } from '@playwright/test';

test.describe('Suite de Pruebas Funcionales E2E — RTF4 / SCRUM-63', () => {
  test.beforeEach(async ({ page, request }) => {
    // Resetear el estado en memoria del servidor antes de cada prueba
    await request.post('/api/reset');
    await page.goto('/');
  });

  test('CPF-01: Login exitoso de OPERADOR_CCO y navegación a Consola CCO', async ({ page }) => {
    await page.fill('[data-testid="input-username"]', 'operador');
    await page.fill('[data-testid="input-password"]', 'operador123');
    await page.click('[data-testid="btn-login"]');

    await expect(page.locator('[data-testid="view-cco"]')).toBeVisible();
    await expect(page.locator('[data-testid="user-info"]')).toContainText('OPERADOR_CCO');
  });

  test('CPF-03: Validación de errores en credenciales (campo vacío y credenciales erróneas)', async ({ page }) => {
    // Caso 1: Campo de usuario vacío
    await page.click('[data-testid="btn-login"]');
    const errorBox = page.locator('[data-testid="login-error"]');
    await expect(errorBox).toBeVisible();
    await expect(errorBox).toHaveText('El usuario es obligatorio');

    // Caso 2: Credenciales incorrectas
    await page.fill('[data-testid="input-username"]', 'operador');
    await page.fill('[data-testid="input-password"]', 'clave-incorrecta');
    await page.click('[data-testid="btn-login"]');

    await expect(errorBox).toBeVisible();
    await expect(errorBox).toHaveText('Usuario o contraseña incorrectos');
  });

  test('CPF-05: Ingesta de lectura válida (41.2 PSI) y actualización reactiva en consola', async ({ page }) => {
    await page.fill('[data-testid="input-username"]', 'operador');
    await page.fill('[data-testid="input-password"]', 'operador123');
    await page.click('[data-testid="btn-login"]');

    await page.fill('[data-testid="input-manual-pressure"]', '41.2');
    await page.click('[data-testid="btn-send-manual-telemetry"]');

    const pressureIndicator = page.locator('[data-testid="sensor-pressure-sensor-101"]');
    await expect(pressureIndicator).toHaveText('41.2 PSI');

    const statusBadge = page.locator('[data-testid="sensor-status-sensor-101"]');
    await expect(statusBadge).toContainText('Normal');
  });

  test('CPF-11: Clasificación visual de Advertencia con lectura de 47 PSI (ámbar / texto / ícono)', async ({ page }) => {
    await page.fill('[data-testid="input-username"]', 'operador');
    await page.fill('[data-testid="input-password"]', 'operador123');
    await page.click('[data-testid="btn-login"]');

    await page.click('[data-testid="btn-sim-warning"]');

    const pressureIndicator = page.locator('[data-testid="sensor-pressure-sensor-101"]');
    await expect(pressureIndicator).toHaveText('47.0 PSI');

    const statusBadge = page.locator('[data-testid="sensor-status-sensor-101"]');
    await expect(statusBadge).toContainText('Advertencia');

    const card = page.locator('[data-testid="sensor-card-sensor-101"]');
    await expect(card).toHaveClass(/status-warning/);
  });

  test('CPF-13: Clasificación visual de Crítico tras 3 ciclos consecutivos de 60 PSI (rojo / pulso / contador)', async ({ page }) => {
    await page.fill('[data-testid="input-username"]', 'operador');
    await page.fill('[data-testid="input-password"]', 'operador123');
    await page.click('[data-testid="btn-login"]');

    await page.click('[data-testid="btn-sim-critical"]');

    const pressureIndicator = page.locator('[data-testid="sensor-pressure-sensor-101"]');
    await expect(pressureIndicator).toHaveText('60.0 PSI');

    const statusBadge = page.locator('[data-testid="sensor-status-sensor-101"]');
    await expect(statusBadge).toContainText('Crítico');

    const card = page.locator('[data-testid="sensor-card-sensor-101"]');
    await expect(card).toHaveClass(/status-critical/);

    const criticalCounter = page.locator('[data-testid="counter-critical"]');
    await expect(criticalCounter).toHaveText('1');
  });

  test('CPF-21: Cierre auditado conforme tras ventana de estabilización de 15 minutos (30/30 muestras)', async ({ page }) => {
    await page.fill('[data-testid="input-username"]', 'supervisor');
    await page.fill('[data-testid="input-password"]', 'supervisor123');
    await page.click('[data-testid="btn-login"]');

    await page.click('[data-testid="nav-audit"]');
    await expect(page.locator('[data-testid="view-audit"]')).toBeVisible();

    await page.click('[data-testid="btn-sim-stabilization"]');

    const otStatus = page.locator('[data-testid="audit-ot-status"]');
    await expect(otStatus).toHaveText('CERRADA_CONFORME');

    const samplesCount = page.locator('[data-testid="audit-samples-count"]');
    await expect(samplesCount).toContainText('30 / 30');

    const auditMessage = page.locator('[data-testid="audit-message"]');
    await expect(auditMessage).toContainText('Estabilización de 15 minutos completada con éxito');
  });

  test('CPF-22: Rechazo por inestabilidad al inyectar pico de 62 PSI y retorno a EN_INTERVENCION', async ({ page }) => {
    await page.fill('[data-testid="input-username"]', 'supervisor');
    await page.fill('[data-testid="input-password"]', 'supervisor123');
    await page.click('[data-testid="btn-login"]');

    await page.click('[data-testid="nav-audit"]');
    await expect(page.locator('[data-testid="view-audit"]')).toBeVisible();

    await page.click('[data-testid="btn-sim-spike"]');

    const otStatus = page.locator('[data-testid="audit-ot-status"]');
    await expect(otStatus).toHaveText('EN_INTERVENCION');

    const auditMessage = page.locator('[data-testid="audit-message"]');
    await expect(auditMessage).toHaveText('Inestabilidad detectada: 62 PSI a los 13:45');
  });

  test('CPF-23: Bloqueo de cierre forzado si la justificación técnica está vacía', async ({ page }) => {
    await page.fill('[data-testid="input-username"]', 'supervisor');
    await page.fill('[data-testid="input-password"]', 'supervisor123');
    await page.click('[data-testid="btn-login"]');

    await page.click('[data-testid="nav-audit"]');
    await page.fill('[data-testid="forced-closure-justification"]', '   ');
    await page.click('[data-testid="btn-force-close"]');

    const errorMsg = page.locator('[data-testid="forced-closure-error"]');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toHaveText('La justificación técnica es obligatoria');
  });

  test('CPF-25: Restricción de acceso por rol para TECNICO_CAMPO hacia la pantalla de cierre auditado', async ({ page }) => {
    await page.fill('[data-testid="input-username"]', 'tecnico');
    await page.fill('[data-testid="input-password"]', 'tecnico123');
    await page.click('[data-testid="btn-login"]');

    await expect(page.locator('[data-testid="view-mobile"]')).toBeVisible();

    // Intentar acceder a Cierre Auditado
    await page.click('[data-testid="nav-audit"]');

    const rbacBanner = page.locator('[data-testid="rbac-error"]');
    await expect(rbacBanner).toBeVisible();
    await expect(rbacBanner).toHaveText('No tiene permisos para esta acción');

    // La vista de auditoría no debe abrirse
    await expect(page.locator('[data-testid="view-audit"]')).not.toBeVisible();
  });
});
