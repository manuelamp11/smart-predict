import { TelemetryService } from '../../src/modules/telemetry/telemetry.service';
import type { TelemetryPayload } from '../../src/modules/telemetry/telemetry.model';

const make = (metrics: Partial<TelemetryPayload['metrics']> = {}): TelemetryPayload => ({
  deviceId: 'dev-1',
  timestamp: '2026-10-13T10:00:00Z',
  metrics: { temperature: 25, vibration: 10, pressure: 100, ...metrics },
});

describe('TelemetryService', () => {
  let service: TelemetryService;
  beforeEach(() => {
    service = new TelemetryService();
  });

  describe('casos válidos', () => {
    it('acepta y guarda un payload válido', () => {
      const r = service.ingest(make());
      expect(r).toEqual({ valid: true, errors: [] });
      expect(service.getAll()).toHaveLength(1);
      expect(service.getByDevice('dev-1')).toHaveLength(1);
      expect(service.getByDevice('otro')).toHaveLength(0);
    });

    it.each([
      [{ temperature: -50 }],
      [{ temperature: 150 }],
      [{ vibration: 0 }],
      [{ vibration: 100 }],
      [{ pressure: 0 }],
      [{ pressure: 500 }],
    ])('acepta valores límite %j', (m) => {
      expect(service.validate(make(m)).valid).toBe(true);
    });
  });

  describe('fuera de rango operacional', () => {
    it.each([
      [{ temperature: -50.1 }, 'temperature'],
      [{ temperature: 150.1 }, 'temperature'],
      [{ vibration: -1 }, 'vibration'],
      [{ vibration: 100.5 }, 'vibration'],
      [{ pressure: -0.1 }, 'pressure'],
      [{ pressure: 501 }, 'pressure'],
    ])('rechaza %j', (m, field) => {
      const r = service.ingest(make(m));
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain(field);
      expect(service.getAll()).toHaveLength(0);
    });

    it('reporta múltiples errores', () => {
      const r = service.validate(make({ temperature: 999, vibration: 999, pressure: 999 }));
      expect(r.errors).toHaveLength(3);
    });
  });

  describe('datos malformados', () => {
    it('rechaza deviceId vacío', () => {
      const r = service.validate({ ...make(), deviceId: ' ' });
      expect(r.valid).toBe(false);
    });

    it('rechaza timestamp inválido', () => {
      const r = service.validate({ ...make(), timestamp: 'no-fecha' });
      expect(r.errors).toContain('timestamp inválido');
    });

    it('rechaza métricas no numéricas', () => {
      const r = service.validate(make({ temperature: NaN }));
      expect(r.errors).toContain('temperature debe ser un número');
    });

    it('rechaza payload sin metrics', () => {
      const r = service.validate({ deviceId: 'd', timestamp: '2026-10-13T10:00:00Z' } as unknown as TelemetryPayload);
      expect(r.valid).toBe(false);
      expect(r.errors).toContain('metrics es requerido');
    });

    it('rechaza payload nulo', () => {
      const r = service.validate(null as unknown as TelemetryPayload);
      expect(r.valid).toBe(false);
    });
  });
});
