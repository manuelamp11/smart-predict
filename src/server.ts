import express, { Request, Response } from 'express';
import path from 'path';
import { TelemetryService } from './modules/telemetry/telemetry.service';
import { AnomalyService } from './modules/anomaly/anomaly.service';
import { RoutingService, ConsoleCcoEscalator, ConsoleCrewNotifier } from './modules/routing/routing.service';
import { Crew, CRITICAL_ALERT_L1 as ROUTING_CRITICAL_ALERT } from './modules/routing/routing.model';
import { ClosureValidationService } from './modules/closure/closure.service';
import { UserRole } from './modules/closure/closure.model';
import { AnomalyResult } from './modules/anomaly/anomaly.model';

export const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Estado y servicios en memoria
const telemetryService = new TelemetryService();
const activeAlerts: AnomalyResult[] = [];

const anomalyNotifier = {
  notify(result: AnomalyResult): void {
    activeAlerts.unshift(result);
    if (activeAlerts.length > 50) activeAlerts.pop();

    // Si es crítico, realizar despacho y generar orden de trabajo
    if (result.severity === 'CRITICAL_ALERT_L1') {
      try {
        routingService.dispatchForAlert(crews, {
          x: 12,
          y: 15,
          quadrant: 'Q1',
          severity: ROUTING_CRITICAL_ALERT,
        });
      } catch {
        // En caso de que no haya cuadrillas disponibles
      }

      // Crear o actualizar la orden de trabajo para el sensor
      const otId = `OT-${result.deviceId.replace('dev-', '').replace('sensor-', '')}`;
      if (!closureService.getWorkOrder(otId)) {
        closureService.createWorkOrder(otId, result.deviceId, 'Cuadrilla Alpha (Q1)');
      }
    }
  },
};

const anomalyService = new AnomalyService(anomalyNotifier);
const routingService = new RoutingService(new ConsoleCcoEscalator(), new ConsoleCrewNotifier());
export const closureService = new ClosureValidationService();

// Cuadrillas iniciales
export const crews: Crew[] = [
  { id: 'cuadrilla-1', x: 10, y: 12, quadrant: 'Q1', status: 'AVAILABLE' },
  { id: 'cuadrilla-2', x: 45, y: 50, quadrant: 'Q2', status: 'AVAILABLE' },
];

// Usuarios para autenticación (HU-012 / SCRUM-58)
const USERS: Record<string, { role: UserRole; name: string; pass: string }> = {
  operador: { role: 'OPERADOR_CCO', name: 'Carlos Operador', pass: 'operador123' },
  supervisor: { role: 'SUPERVISOR_CCO', name: 'Laura Supervisora', pass: 'supervisor123' },
  tecnico: { role: 'TECNICO_CAMPO', name: 'Marcos Técnico', pass: 'tecnico123' },
};

// Sensores monitoreados
interface SensorState {
  id: string;
  name: string;
  quadrant: string;
  pressure: number;
  temperature: number;
  vibration: number;
  severity: 'NORMAL' | 'WARNING_L2' | 'CRITICAL_ALERT_L1' | 'SIN_SEÑAL';
  lastSeen: string;
}

const sensorsState = new Map<string, SensorState>([
  [
    'sensor-101',
    {
      id: 'sensor-101',
      name: 'Válvula Principal Norte',
      quadrant: 'Q1',
      pressure: 40.0,
      temperature: 25.0,
      vibration: 5.0,
      severity: 'NORMAL',
      lastSeen: new Date().toISOString(),
    },
  ],
  [
    'sensor-102',
    {
      id: 'sensor-102',
      name: 'Estación de Bombeo Sur',
      quadrant: 'Q2',
      pressure: 40.0,
      temperature: 24.5,
      vibration: 4.8,
      severity: 'NORMAL',
      lastSeen: new Date().toISOString(),
    },
  ],
  [
    'sensor-103',
    {
      id: 'sensor-103',
      name: 'Troncal Este Distribución',
      quadrant: 'Q1',
      pressure: 40.0,
      temperature: 26.0,
      vibration: 6.2,
      severity: 'NORMAL',
      lastSeen: new Date().toISOString(),
    },
  ],
]);

// Inicializar orden de trabajo inicial para sensor-101
closureService.createWorkOrder('OT-101', 'sensor-101', 'Cuadrilla Alpha (Q1)');

// Helper para extraer string seguro de req.params
function getParam(req: Request, name: string): string {
  const val = req.params[name];
  return typeof val === 'string' ? val : '';
}

// ---------------- API ENDPOINTS ----------------

// Autenticación (HU-012)
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body || {};

  if (!username || typeof username !== 'string' || username.trim() === '') {
    res.status(400).json({ error: 'El usuario es obligatorio' });
    return;
  }

  const user = USERS[username.trim().toLowerCase()];
  if (!user || user.pass !== password) {
    res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    return;
  }

  res.json({
    success: true,
    user: {
      username: username.trim().toLowerCase(),
      name: user.name,
      role: user.role,
    },
  });
});

// Telemetría / Ingesta (HU-001, HU-002, CPF-05, CPF-11, CPF-13)
app.post('/api/telemetry', (req: Request, res: Response) => {
  const { deviceId, metrics, timestamp } = req.body || {};
  const effectiveDeviceId = typeof deviceId === 'string' ? deviceId : 'sensor-101';
  const effectiveTimestamp = typeof timestamp === 'string' ? timestamp : new Date().toISOString();

  const payload = {
    deviceId: effectiveDeviceId,
    timestamp: effectiveTimestamp,
    metrics: {
      temperature: typeof metrics?.temperature === 'number' ? metrics.temperature : 25.0,
      vibration: typeof metrics?.vibration === 'number' ? metrics.vibration : 5.0,
      pressure: Number(metrics?.pressure ?? 40.0),
    },
  };

  const validation = telemetryService.ingest(payload);
  if (!validation.valid) {
    res.status(400).json({ error: 'Telemetría inválida', details: validation.errors });
    return;
  }

  const anomaly = anomalyService.analyze(payload);

  // Actualizar el estado del sensor
  const currentSensor = sensorsState.get(effectiveDeviceId) || {
    id: effectiveDeviceId,
    name: `Sensor ${effectiveDeviceId}`,
    quadrant: 'Q1',
    pressure: payload.metrics.pressure,
    temperature: payload.metrics.temperature,
    vibration: payload.metrics.vibration,
    severity: anomaly.severity,
    lastSeen: effectiveTimestamp,
  };

  currentSensor.pressure = payload.metrics.pressure;
  currentSensor.temperature = payload.metrics.temperature;
  currentSensor.vibration = payload.metrics.vibration;
  currentSensor.severity = anomaly.severity;
  currentSensor.lastSeen = effectiveTimestamp;
  sensorsState.set(effectiveDeviceId, currentSensor);

  res.json({
    success: true,
    telemetry: payload,
    anomaly,
    sensor: currentSensor,
  });
});

// Obtener estado de sensores y resumen CCO (HU-009)
app.get('/api/sensors', (_req: Request, res: Response) => {
  const list = Array.from(sensorsState.values());
  const summary = {
    total: list.length,
    normal: list.filter((s) => s.severity === 'NORMAL').length,
    warning: list.filter((s) => s.severity === 'WARNING_L2').length,
    critical: list.filter((s) => s.severity === 'CRITICAL_ALERT_L1').length,
    lostSignal: list.filter((s) => s.severity === 'SIN_SEÑAL').length,
  };

  res.json({ sensors: list, summary, alerts: activeAlerts });
});

// Disparo manual del Watchdog para simular SIN_SEÑAL (HU-009 / SCRUM-62)
app.post('/api/watchdog/trigger', (req: Request, res: Response) => {
  const targetId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : 'sensor-101';
  const sensor = sensorsState.get(targetId);

  if (sensor) {
    sensor.severity = 'SIN_SEÑAL';
    sensor.lastSeen = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    activeAlerts.unshift({
      deviceId: targetId,
      timestamp: new Date().toISOString(),
      pressure: sensor.pressure,
      deviation: 0,
      severity: 'SIN_SEÑAL',
      consecutiveHighReadings: 0,
    });
  }

  res.json({ success: true, message: `Sensor ${targetId} marcado como SIN_SEÑAL` });
});

// Órdenes de trabajo (HU-010 / SCRUM-50)
app.get('/api/work-orders', (_req: Request, res: Response) => {
  res.json({ workOrders: closureService.getAllWorkOrders() });
});

app.get('/api/work-orders/:id', (req: Request, res: Response) => {
  const id = getParam(req, 'id');
  const order = closureService.getWorkOrder(id);
  if (!order) {
    res.status(404).json({ error: 'Orden no encontrada' });
    return;
  }
  res.json({ order });
});

// Confirmar llegada de cuadrilla (HU-010)
app.post('/api/work-orders/:id/arrival', (req: Request, res: Response) => {
  const id = getParam(req, 'id');
  try {
    const order = closureService.confirmArrival(id);
    res.json({ success: true, order });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al confirmar llegada';
    res.status(400).json({ error: message });
  }
});

// Iniciar auditoría de estabilización (HU-010 / HU-011)
app.post('/api/work-orders/:id/start-audit', (req: Request, res: Response) => {
  const id = getParam(req, 'id');
  try {
    const order = closureService.startAudit(id);
    res.json({ success: true, order });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al iniciar auditoría';
    res.status(400).json({ error: message });
  }
});

// Simulación de estabilización de 15 min completa (HU-011 / CPF-21)
app.post('/api/work-orders/:id/simulate-stabilization', (req: Request, res: Response) => {
  const orderId = getParam(req, 'id');
  const order = closureService.getWorkOrder(orderId);
  if (!order) {
    res.status(404).json({ error: 'Orden no encontrada' });
    return;
  }

  // Si no estaba en auditoría, inicializarla
  if (order.status !== 'EN_AUDITORIA') {
    closureService.startAudit(orderId);
  }

  // Inyectar 30 lecturas dentro de la banda nominal (36-44 PSI)
  order.readings = [];
  for (let i = 1; i <= 30; i++) {
    const min = Math.floor(i / 2);
    const sec = (i % 2) * 30 === 0 ? '00' : '30';
    order.readings.push({
      pressure: 40.0 + ((i % 5) - 2) * 0.5,
      timestamp: new Date().toISOString(),
      minute: `${min}:${sec}`,
    });
  }

  const result = closureService.completeAudit(orderId);
  res.json({ success: true, result, order });
});

// Simulación de pico de inestabilidad 62 PSI al min 13:45 (HU-011 / CPF-22)
app.post('/api/work-orders/:id/simulate-spike', (req: Request, res: Response) => {
  const orderId = getParam(req, 'id');
  const order = closureService.getWorkOrder(orderId);
  if (!order) {
    res.status(404).json({ error: 'Orden no encontrada' });
    return;
  }

  if (order.status !== 'EN_AUDITORIA') {
    closureService.startAudit(orderId);
  }

  // Lecturas previas estables
  order.readings = [
    { pressure: 40.2, timestamp: new Date().toISOString(), minute: '05:00' },
    { pressure: 41.0, timestamp: new Date().toISOString(), minute: '10:00' },
  ];

  // Inyectar el pico de inestabilidad
  const result = closureService.recordReading(orderId, 62.0, '13:45');
  res.json({ success: true, result, order });
});

// Cierre forzado con RBAC y justificación (HU-011 / CPF-23, CPF-25)
app.post('/api/work-orders/:id/force-close', (req: Request, res: Response) => {
  const orderId = getParam(req, 'id');
  const { userRole, justification } = req.body || {};

  if (userRole !== 'SUPERVISOR_CCO') {
    res.status(403).json({ error: 'No tiene permisos para esta acción' });
    return;
  }

  if (!justification || typeof justification !== 'string' || justification.trim() === '') {
    res.status(400).json({ error: 'La justificación técnica es obligatoria' });
    return;
  }

  try {
    const order = closureService.forceClose(orderId, userRole, justification);
    res.json({ success: true, order });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al forzar cierre';
    res.status(400).json({ error: message });
  }
});

// Reset del estado para pruebas automáticas
app.post('/api/reset', (_req: Request, res: Response) => {
  sensorsState.set('sensor-101', {
    id: 'sensor-101',
    name: 'Válvula Principal Norte',
    quadrant: 'Q1',
    pressure: 40.0,
    temperature: 25.0,
    vibration: 5.0,
    severity: 'NORMAL',
    lastSeen: new Date().toISOString(),
  });
  activeAlerts.length = 0;
  const ot = closureService.createWorkOrder('OT-101', 'sensor-101', 'Cuadrilla Alpha (Q1)');
  ot.status = 'ASIGNADA';
  ot.readings = [];
  delete ot.auditMessage;
  delete ot.forcedClosureDetails;
  res.json({ success: true });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Smart Predict Server] Corriendo en http://localhost:${PORT}`);
  });
}
