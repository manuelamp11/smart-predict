import { AnomalyService } from '../../src/modules/anomaly/anomaly.service';
import type { Notifier } from '../../src/modules/anomaly/anomaly.model';
import type { TelemetryPayload } from '../../src/modules/telemetry/telemetry.model';

const makePayload = (deviceId: string, pressure: number, timestamp = '2026-10-15T10:00:00Z'): TelemetryPayload => ({
  deviceId,
  timestamp,
  metrics: { temperature: 25, vibration: 10, pressure },
});

const makeNotifier = (): Notifier => ({ notify: jest.fn() });

describe('AnomalyService', () => {
  let notifier: Notifier;
  let service: AnomalyService;

  beforeEach(() => {
    notifier = makeNotifier();
    service = new AnomalyService(notifier);
  });

  describe('clasificación por desviación', () => {
    it.each([36, 40, 44])('clasifica %d PSI como NORMAL', (pressure) => {
      const result = service.analyze(makePayload('dev-1', pressure));
      expect(result.severity).toBe('NORMAL');
    });

    it.each([44.01, 52, 28])('clasifica %d PSI como WARNING_L2', (pressure) => {
      const result = service.analyze(makePayload('dev-1', pressure));
      expect(result.severity).toBe('WARNING_L2');
    });

    it('calcula la desviación como porcentaje absoluto respecto al umbral nominal', () => {
      expect(service.analyze(makePayload('dev-1', 44)).deviation).toBeCloseTo(10);
      expect(service.analyze(makePayload('dev-1', 52)).deviation).toBeCloseTo(30);
    });
  });

  describe('racha de 3 ciclos para alerta crítica', () => {
    it('clasifica como CRITICAL_ALERT_L1 al tercer ciclo consecutivo > 30%', () => {
      service.analyze(makePayload('dev-1', 60));
      service.analyze(makePayload('dev-1', 60));
      const third = service.analyze(makePayload('dev-1', 60));
      expect(third.severity).toBe('CRITICAL_ALERT_L1');
      expect(third.consecutiveHighReadings).toBe(3);
    });

    it.each([52.01, 27.99])('%d PSI cuenta para la racha (fuera del rango WARNING)', (pressure) => {
      service.analyze(makePayload('dev-1', pressure));
      service.analyze(makePayload('dev-1', pressure));
      const third = service.analyze(makePayload('dev-1', pressure));
      expect(third.severity).toBe('CRITICAL_ALERT_L1');
    });

    it('no llega a CRITICAL si una lectura normal interrumpe la racha', () => {
      service.analyze(makePayload('dev-1', 60));
      service.analyze(makePayload('dev-1', 60));
      service.analyze(makePayload('dev-1', 40));
      service.analyze(makePayload('dev-1', 60));
      const fifth = service.analyze(makePayload('dev-1', 60));
      expect(fifth.severity).not.toBe('CRITICAL_ALERT_L1');
      expect(fifth.consecutiveHighReadings).toBe(2);
    });

    it('cada dispositivo lleva su propia racha', () => {
      service.analyze(makePayload('dev-1', 60));
      service.analyze(makePayload('dev-1', 60));
      const devTwoFirst = service.analyze(makePayload('dev-2', 60));
      expect(devTwoFirst.severity).not.toBe('CRITICAL_ALERT_L1');
      expect(devTwoFirst.consecutiveHighReadings).toBe(1);
    });
  });

  describe('notificación', () => {
    it('notifica en WARNING_L2', () => {
      service.analyze(makePayload('dev-1', 52));
      expect(notifier.notify).toHaveBeenCalledTimes(1);
    });

    it('notifica en CRITICAL_ALERT_L1', () => {
      service.analyze(makePayload('dev-1', 60));
      service.analyze(makePayload('dev-1', 60));
      service.analyze(makePayload('dev-1', 60));
      expect(notifier.notify).toHaveBeenCalledTimes(3);
    });

    it('no notifica en NORMAL', () => {
      service.analyze(makePayload('dev-1', 40));
      expect(notifier.notify).not.toHaveBeenCalled();
    });
  });

  describe('watchdog', () => {
    const lastReading = '2026-10-15T10:00:00Z';

    it('a los 10 minutos exactos no se considera SIN_SEÑAL', () => {
      service.analyze(makePayload('dev-1', 40, lastReading));
      const now = new Date('2026-10-15T10:10:00Z');
      expect(service.checkWatchdog(now)).not.toContain('dev-1');
    });

    it('a los 10 minutos y 1 segundo se considera SIN_SEÑAL', () => {
      service.analyze(makePayload('dev-1', 40, lastReading));
      const now = new Date('2026-10-15T10:10:01Z');
      expect(service.checkWatchdog(now)).toContain('dev-1');
    });

    it('un dispositivo que vuelve a reportar sale de SIN_SEÑAL', () => {
      service.analyze(makePayload('dev-1', 40, lastReading));
      expect(service.checkWatchdog(new Date('2026-10-15T10:10:01Z'))).toContain('dev-1');

      service.analyze(makePayload('dev-1', 40, '2026-10-15T10:10:01Z'));
      expect(service.checkWatchdog(new Date('2026-10-15T10:11:00Z'))).not.toContain('dev-1');
    });
  });
});
