import { AnomalyService } from '../../src/modules/anomaly/anomaly.service';
import type { TelemetryPayload } from '../../src/modules/telemetry/telemetry.model';

const makePayload = (deviceId: string, pressure: number, timestamp = '2026-10-15T10:00:00Z'): TelemetryPayload => ({
  deviceId,
  timestamp,
  metrics: { temperature: 25, vibration: 10, pressure },
});

describe('AnomalyService', () => {
  let service: AnomalyService;

  beforeEach(() => {
    service = new AnomalyService();
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
});
