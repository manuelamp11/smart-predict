import { TelemetryService } from '../../src/modules/telemetry/telemetry.service';

const make = (metrics: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  deviceId: 'dev-strict',
  timestamp: '2026-10-13T10:00:00Z',
  metrics: { temperature: 25, vibration: 10, pressure: 100, ...metrics },
  ...over,
});

describe('TelemetryService.ingestStrict', () => {
  let service: TelemetryService;
  beforeEach(() => {
    service = new TelemetryService();
  });

  it('CA-1: lectura válida es ACCEPTED con ingestId UUID y queda almacenada', () => {
    const out = service.ingestStrict(make());
    expect(out.status).toBe('ACCEPTED');
    if (out.status !== 'ACCEPTED') return;
    expect(out.ingestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(service.getByDevice('dev-strict')).toHaveLength(1);
  });

  it('CA-1: dos ingestas devuelven ingestId distintos', () => {
    const a = service.ingestStrict(make());
    const b = service.ingestStrict(make());
    expect(a.status === 'ACCEPTED' && b.status === 'ACCEPTED').toBe(true);
    if (a.status === 'ACCEPTED' && b.status === 'ACCEPTED') {
      expect(a.ingestId).not.toBe(b.ingestId);
    }
  });

  it.each([
    [{ pressure: 0 }],
    [{ pressure: 500 }],
    [{ temperature: -50 }],
    [{ temperature: 150 }],
    [{ vibration: 0 }],
    [{ vibration: 100 }],
  ])('CA-1: acepta valores límite %j', (m) => {
    expect(service.ingestStrict(make(m)).status).toBe('ACCEPTED');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'hola'],
    ['número', 42],
    ['arreglo', []],
    ['objeto vacío', {}],
  ])('CA-2: entrada %s es INVALID_FORMAT con al menos un error y no lanza', (_n, input) => {
    const out = service.ingestStrict(input);
    expect(out.status).toBe('INVALID_FORMAT');
    if (out.status === 'INVALID_FORMAT') {
      expect(out.errors.length).toBeGreaterThanOrEqual(1);
      expect(typeof out.errors[0].field).toBe('string');
      expect(typeof out.errors[0].message).toBe('string');
    }
    expect(service.getAll()).toHaveLength(0);
  });

  it.each([
    ['deviceId ausente', { ...make(), deviceId: undefined }, 'deviceId'],
    ['deviceId vacío', make({}, { deviceId: '  ' }), 'deviceId'],
    ['timestamp ausente', make({}, { timestamp: undefined }), 'timestamp'],
    ['timestamp inválido', make({}, { timestamp: 'nada' }), 'timestamp'],
    ['metrics ausente', make({}, { metrics: undefined }), 'metrics'],
    ['pressure ausente', make({ pressure: undefined }), 'pressure'],
    ['temperature string', make({ temperature: '25' }), 'temperature'],
    ['vibration NaN', make({ vibration: NaN }), 'vibration'],
  ])('CA-2: %s es INVALID_FORMAT señalando el campo y no se almacena', (_n, input, field) => {
    const out = service.ingestStrict(input);
    expect(out.status).toBe('INVALID_FORMAT');
    if (out.status === 'INVALID_FORMAT') {
      expect(out.errors.some((e) => e.field.includes(field))).toBe(true);
    }
    expect(service.getAll()).toHaveLength(0);
  });

  it('CA-2: no inventa valores por defecto para métricas ausentes', () => {
    const out = service.ingestStrict({ deviceId: 'd', timestamp: '2026-10-13T10:00:00Z', metrics: {} });
    expect(out.status).toBe('INVALID_FORMAT');
    expect(service.getAll()).toHaveLength(0);
  });

  it.each([
    [{ pressure: 500.1 }, 'pressure'],
    [{ pressure: -0.1 }, 'pressure'],
    [{ temperature: 150.1 }, 'temperature'],
    [{ temperature: -50.1 }, 'temperature'],
    [{ vibration: 100.1 }, 'vibration'],
    [{ vibration: -0.1 }, 'vibration'],
  ])('CA-3: %j es OUT_OF_RANGE señalando el campo y no se almacena', (m, field) => {
    const out = service.ingestStrict(make(m));
    expect(out.status).toBe('OUT_OF_RANGE');
    if (out.status === 'OUT_OF_RANGE') {
      expect(out.errors.some((e) => e.field.includes(field))).toBe(true);
    }
    expect(service.getAll()).toHaveLength(0);
  });

  it('CA-3: varios campos fuera de rango dan un solo OUT_OF_RANGE con todos los errores', () => {
    const out = service.ingestStrict(make({ pressure: 999, temperature: 999, vibration: 999 }));
    expect(out.status).toBe('OUT_OF_RANGE');
    if (out.status === 'OUT_OF_RANGE') {
      expect(out.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('CA-2/CA-3: formato y rango a la vez resulta INVALID_FORMAT', () => {
    const out = service.ingestStrict(make({ pressure: 9999, temperature: 'x' }));
    expect(out.status).toBe('INVALID_FORMAT');
    expect(service.getAll()).toHaveLength(0);
  });

  it('CA-4: getByDevice devuelve solo las lecturas del dispositivo en orden de llegada', () => {
    service.ingestStrict(make({ pressure: 1 }, { deviceId: 'a' }));
    service.ingestStrict(make({ pressure: 2 }, { deviceId: 'b' }));
    service.ingestStrict(make({ pressure: 3 }, { deviceId: 'a' }));
    expect(service.getByDevice('a').map((r) => r.metrics.pressure)).toEqual([1, 3]);
    expect(service.getByDevice('zzz')).toEqual([]);
  });
});
