import {
  ClosureValidationService,
  MAX_NOMINAL_PRESSURE,
  MIN_NOMINAL_PRESSURE,
  NOMINAL_PRESSURE,
} from '../src/modules/closure/closure.service';

describe('Módulo de Cierre Auditado — HU-004 (SCRUM-8, SCRUM-18, SCRUM-19, SCRUM-20)', () => {
  let service: ClosureValidationService;

  beforeEach(() => {
    service = new ClosureValidationService();
  });

  describe('RN004 / SCRUM-18: Ventana de estabilización de 15 minutos continuos', () => {
    it('valida que el rango nominal de presión esté entre 36 y 44 PSI con base 40 PSI', () => {
      expect(NOMINAL_PRESSURE).toBe(40.0);
      expect(MIN_NOMINAL_PRESSURE).toBe(36.0);
      expect(MAX_NOMINAL_PRESSURE).toBe(44.0);

      expect(service.isPressureNominal(40.0)).toBe(true);
      expect(service.isPressureNominal(36.0)).toBe(true);
      expect(service.isPressureNominal(44.0)).toBe(true);
      expect(service.isPressureNominal(35.9)).toBe(false);
      expect(service.isPressureNominal(44.1)).toBe(false);
    });

    it('completa exitosamente el cierre auditado tras 15 minutos continuos de lecturas en rango nominal', () => {
      const orderId = 'OT-2001';
      service.createWorkOrder(orderId, 'sensor-101');
      service.confirmArrival(orderId);
      service.startAudit(orderId);

      // Simular 30 muestras en 15 minutos (cada 30s) todas en rango (38 a 42 PSI)
      const samples = Array.from({ length: 30 }, (_, i) => ({
        pressure: 39.5 + (i % 3) * 0.5,
        minute: `${Math.floor(i / 2)}:${(i % 2) * 30 === 0 ? '00' : '30'}`,
      }));

      for (const sample of samples) {
        const result = service.recordReading(orderId, sample.pressure, sample.minute);
        expect(result.success).toBe(true);
      }

      const finalAudit = service.completeAudit(orderId);
      expect(finalAudit.success).toBe(true);
      expect(finalAudit.status).toBe('CERRADA_CONFORME');

      const order = service.getWorkOrder(orderId);
      expect(order?.status).toBe('CERRADA_CONFORME');
      expect(order?.readings.length).toBe(30);
    });

    it('rechaza por inestabilidad si ocurre un pico de presión (< 36 o > 44 PSI), aborta y retorna a EN_INTERVENCION con mensaje exacto', () => {
      const orderId = 'OT-2002';
      service.createWorkOrder(orderId, 'sensor-102');
      service.confirmArrival(orderId);
      service.startAudit(orderId);

      // Lecturas normales iniciales
      service.recordReading(orderId, 40.2, '05:00');
      service.recordReading(orderId, 41.0, '10:00');

      // Pico de inestabilidad a los 13:45 minutos con 62 PSI
      const failureResult = service.recordReading(orderId, 62.0, '13:45');

      expect(failureResult.success).toBe(false);
      expect(failureResult.status).toBe('EN_INTERVENCION');
      expect(failureResult.message).toBe('Inestabilidad detectada: 62 PSI a los 13:45');

      const order = service.getWorkOrder(orderId);
      expect(order?.status).toBe('EN_INTERVENCION');
      expect(order?.auditMessage).toBe('Inestabilidad detectada: 62 PSI a los 13:45');
    });

    it('rechaza también por caída de presión por debajo del umbral mínimo (< 36 PSI)', () => {
      const orderId = 'OT-2003';
      service.createWorkOrder(orderId, 'sensor-103');
      service.startAudit(orderId);

      const failureResult = service.recordReading(orderId, 32.5, '08:20');

      expect(failureResult.success).toBe(false);
      expect(failureResult.status).toBe('EN_INTERVENCION');
      expect(failureResult.message).toBe('Inestabilidad detectada: 32.5 PSI a los 08:20');
    });
  });

  describe('RN004 / SCRUM-19: Cierre forzado con control de acceso RBAC y justificación', () => {
    it('permite el cierre forzado exclusivamente al rol SUPERVISOR_CCO con justificación técnica válida', () => {
      const orderId = 'OT-3001';
      service.createWorkOrder(orderId, 'sensor-301');
      service.confirmArrival(orderId);

      const updatedOrder = service.forceClose(
        orderId,
        'SUPERVISOR_CCO',
        'Válvula de alivio secundaria reemplazada y calibrada bajo autorización de ingeniería.',
      );

      expect(updatedOrder.status).toBe('CERRADA_FORZADA');
      expect(updatedOrder.forcedClosureDetails).toBeDefined();
      expect(updatedOrder.forcedClosureDetails?.userRole).toBe('SUPERVISOR_CCO');
      expect(updatedOrder.forcedClosureDetails?.justification).toContain(
        'Válvula de alivio secundaria',
      );
    });

    it('bloquea el cierre forzado para el rol TECNICO_CAMPO con mensaje "No tiene permisos para esta acción"', () => {
      const orderId = 'OT-3002';
      service.createWorkOrder(orderId, 'sensor-302');

      expect(() => {
        service.forceClose(orderId, 'TECNICO_CAMPO', 'Justificación de técnico');
      }).toThrow('No tiene permisos para esta acción');

      const order = service.getWorkOrder(orderId);
      expect(order?.status).not.toBe('CERRADA_FORZADA');
    });

    it('bloquea el cierre forzado para el rol OPERADOR_CCO con mensaje "No tiene permisos para esta acción"', () => {
      const orderId = 'OT-3003';
      service.createWorkOrder(orderId, 'sensor-303');

      expect(() => {
        service.forceClose(orderId, 'OPERADOR_CCO', 'Justificación de operador');
      }).toThrow('No tiene permisos para esta acción');
    });

    it('rechaza el cierre forzado si la justificación técnica está vacía o compuesta solo por espacios', () => {
      const orderId = 'OT-3004';
      service.createWorkOrder(orderId, 'sensor-304');

      expect(() => {
        service.forceClose(orderId, 'SUPERVISOR_CCO', '');
      }).toThrow('La justificación técnica es obligatoria');

      expect(() => {
        service.forceClose(orderId, 'SUPERVISOR_CCO', '    ');
      }).toThrow('La justificación técnica es obligatoria');
    });
  });
});

