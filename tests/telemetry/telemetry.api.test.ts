import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { app } from '../../src/server';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

let counter = 0;
const uniqueId = (tag: string): string => `api-${tag}-${process.pid}-${Date.now()}-${counter++}`;

type Metrics = Record<string, unknown>;

const validMetrics = (over: Metrics = {}): Metrics => ({
  temperature: 25,
  vibration: 10,
  pressure: 100,
  ...over,
});

const reading = (deviceId: string, over: Metrics = {}, extra: Record<string, unknown> = {}) => ({
  deviceId,
  timestamp: '2026-10-13T10:00:00Z',
  metrics: validMetrics(over),
  ...extra,
});

const post = (body: unknown) =>
  fetch(`${baseUrl}/api/v1/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const postRaw = (raw: string) =>
  fetch(`${baseUrl}/api/v1/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  });

const get = (deviceId: string) => fetch(`${baseUrl}/api/v1/telemetry/${encodeURIComponent(deviceId)}`);

const expectErrorBody = async (res: Response, status: number) => {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type') ?? '').toContain('application/json');
  const body = await res.json();
  expect(Array.isArray(body.errors)).toBe(true);
  expect(body.errors.length).toBeGreaterThanOrEqual(1);
  for (const e of body.errors) {
    expect(typeof e.field).toBe('string');
    expect(typeof e.message).toBe('string');
    expect(e.message.length).toBeGreaterThan(0);
  }
  return body.errors as { field: string; message: string }[];
};

const expectNothingStored = async (deviceId: string) => {
  const res = await get(deviceId);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
};

describe('CA-1: POST /api/v1/telemetry acepta lecturas válidas con 201', () => {
  it('CA-1: responde 201 con ingestId UUID no vacío', async () => {
    const res = await post(reading(uniqueId('ok')));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.ingestId).toBe('string');
    expect(body.ingestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('CA-1: dos POST producen ingestId distintos', async () => {
    const id = uniqueId('ids');
    const a = await (await post(reading(id))).json();
    const b = await (await post(reading(id))).json();
    expect(a.ingestId).toBeTruthy();
    expect(b.ingestId).toBeTruthy();
    expect(a.ingestId).not.toBe(b.ingestId);
  });

  it.each([
    ['presión 0', { pressure: 0 }],
    ['presión 500', { pressure: 500 }],
    ['temperatura -50', { temperature: -50 }],
    ['temperatura 150', { temperature: 150 }],
    ['vibración 0', { vibration: 0 }],
    ['vibración 100', { vibration: 100 }],
  ])('CA-1: acepta valor límite %s con 201', async (_n, m) => {
    const res = await post(reading(uniqueId('lim'), m));
    expect(res.status).toBe(201);
    expect((await res.json()).ingestId).toBeTruthy();
  });

  it('CA-1: la lectura aceptada queda disponible en el GET', async () => {
    const id = uniqueId('stored');
    const payload = reading(id, { pressure: 123 });
    expect((await post(payload)).status).toBe(201);
    const list = await (await get(id)).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject(payload);
  });

  it('CA-1: la ingesta v1 no registra el dispositivo en /api/sensors', async () => {
    const id = uniqueId('nosensor');
    expect((await post(reading(id, { pressure: 400 }))).status).toBe(201);
    const body = await (await fetch(`${baseUrl}/api/sensors`)).json();
    const ids = (body.sensors as { id: string }[]).map((s) => s.id);
    expect(ids).not.toContain(id);
    const alertIds = (body.alerts as { deviceId: string }[]).map((a) => a.deviceId);
    expect(alertIds).not.toContain(id);
  });
});

describe('CA-2: 400 por campos faltantes o JSON inválido', () => {
  it('CA-2: JSON roto responde 400 con cuerpo JSON de errores', async () => {
    const res = await postRaw('{"deviceId": "x", ');
    await expectErrorBody(res, 400);
  });

  it('CA-2: cuerpo vacío responde 400', async () => {
    const res = await postRaw('');
    await expectErrorBody(res, 400);
  });

  it('CA-2: objeto vacío {} responde 400', async () => {
    await expectErrorBody(await post({}), 400);
  });

  it('CA-2: sin deviceId responde 400 y el error menciona deviceId', async () => {
    const { deviceId: _d, ...rest } = reading('x');
    const errors = await expectErrorBody(await post(rest), 400);
    expect(errors.some((e) => e.field === 'deviceId')).toBe(true);
  });

  it('CA-2: deviceId vacío responde 400', async () => {
    const errors = await expectErrorBody(await post(reading('')), 400);
    expect(errors.some((e) => e.field === 'deviceId')).toBe(true);
  });

  it('CA-2: sin metrics responde 400 y el error menciona metrics', async () => {
    const errors = await expectErrorBody(
      await post({ deviceId: uniqueId('nometrics'), timestamp: '2026-10-13T10:00:00Z' }),
      400,
    );
    expect(errors.some((e) => e.field.startsWith('metrics'))).toBe(true);
  });

  it('CA-2: sin timestamp responde 400', async () => {
    const { timestamp: _t, ...rest } = reading(uniqueId('nots'));
    const errors = await expectErrorBody(await post(rest), 400);
    expect(errors.some((e) => e.field === 'timestamp')).toBe(true);
  });

  it('CA-2: timestamp inválido responde 400 y no se almacena', async () => {
    const id = uniqueId('badts');
    const errors = await expectErrorBody(await post(reading(id, {}, { timestamp: 'no-es-fecha' })), 400);
    expect(errors.some((e) => e.field === 'timestamp')).toBe(true);
    await expectNothingStored(id);
  });

  it.each(['pressure', 'temperature', 'vibration'])(
    'CA-2: métrica %s ausente responde 400, sin valor por defecto, y no se almacena',
    async (metric) => {
      const id = uniqueId(`miss-${metric}`);
      const metrics = validMetrics();
      delete metrics[metric];
      const errors = await expectErrorBody(await post({ ...reading(id), metrics }), 400);
      expect(errors.some((e) => e.field.includes(metric))).toBe(true);
      await expectNothingStored(id);
    },
  );

  it('CA-2: métrica como string responde 400 y no se almacena', async () => {
    const id = uniqueId('strmetric');
    const errors = await expectErrorBody(await post(reading(id, { pressure: '100' })), 400);
    expect(errors.some((e) => e.field.includes('pressure'))).toBe(true);
    await expectNothingStored(id);
  });

  it('CA-2: JSON válido pero no objeto (arreglo) responde 400', async () => {
    await expectErrorBody(await post([1, 2, 3]), 400);
  });

  it('CA-2: errores de formato y de rango a la vez responden 400, no 422', async () => {
    const id = uniqueId('mixed');
    const res = await post(reading(id, { pressure: 9999, temperature: 'caliente' }));
    await expectErrorBody(res, 400);
    await expectNothingStored(id);
  });
});

describe('CA-3: 422 por valores fuera del rango físico', () => {
  it.each([
    ['presión 500.1', { pressure: 500.1 }, 'pressure'],
    ['presión 501', { pressure: 501 }, 'pressure'],
    ['presión -0.1', { pressure: -0.1 }, 'pressure'],
    ['temperatura 150.1', { temperature: 150.1 }, 'temperature'],
    ['temperatura -50.1', { temperature: -50.1 }, 'temperature'],
    ['vibración 100.1', { vibration: 100.1 }, 'vibration'],
    ['vibración -0.1', { vibration: -0.1 }, 'vibration'],
  ])('CA-3: %s responde 422 con error del campo y no se almacena', async (_n, m, field) => {
    const id = uniqueId('oor');
    const errors = await expectErrorBody(await post(reading(id, m)), 422);
    expect(errors.some((e) => e.field.includes(field))).toBe(true);
    await expectNothingStored(id);
  });

  it('CA-3: presión 500 exacta sigue siendo 201 (justo en el límite)', async () => {
    expect((await post(reading(uniqueId('edge'), { pressure: 500 }))).status).toBe(201);
  });

  it('CA-3: varios campos fuera de rango producen un solo 422 con todos los errores', async () => {
    const id = uniqueId('multi');
    const errors = await expectErrorBody(
      await post(reading(id, { pressure: 999, temperature: 999, vibration: 999 })),
      422,
    );
    const fields = errors.map((e) => e.field).join('|');
    expect(fields).toContain('pressure');
    expect(fields).toContain('temperature');
    expect(fields).toContain('vibration');
    expect(errors.length).toBeGreaterThanOrEqual(3);
    await expectNothingStored(id);
  });
});

describe('CA-4: GET /api/v1/telemetry/{deviceId}', () => {
  it('CA-4: dispositivo sin lecturas responde 200 y lista vacía (no 404)', async () => {
    const res = await get(uniqueId('empty'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('CA-4: responde un arreglo plano con las lecturas en orden de llegada', async () => {
    const id = uniqueId('order');
    const pressures = [10, 20, 30];
    for (const [i, p] of pressures.entries()) {
      const r = await post(reading(id, { pressure: p }, { timestamp: `2026-10-13T10:0${i}:00Z` }));
      expect(r.status).toBe(201);
    }
    const res = await get(id);
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.map((r: { metrics: { pressure: number } }) => r.metrics.pressure)).toEqual(pressures);
    for (const r of list) expect(r.deviceId).toBe(id);
  });

  it('CA-4: solo trae las lecturas de ese dispositivo', async () => {
    const a = uniqueId('iso-a');
    const b = uniqueId('iso-b');
    await post(reading(a, { pressure: 11 }));
    await post(reading(b, { pressure: 22 }));
    await post(reading(b, { pressure: 33 }));
    const la = await (await get(a)).json();
    const lb = await (await get(b)).json();
    expect(la).toHaveLength(1);
    expect(lb).toHaveLength(2);
    expect(la.every((r: { deviceId: string }) => r.deviceId === a)).toBe(true);
    expect(lb.every((r: { deviceId: string }) => r.deviceId === b)).toBe(true);
  });

  it('CA-4: deviceId codificado en la URL se decodifica', async () => {
    const id = `${uniqueId('enc')} con espacio/y barra`;
    expect((await post(reading(id))).status).toBe(201);
    const list = await (await get(id)).json();
    expect(list).toHaveLength(1);
    expect(list[0].deviceId).toBe(id);
  });
});
