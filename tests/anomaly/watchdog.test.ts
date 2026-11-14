import {
  AnomalyService,
  WATCHDOG_INTERVAL_MS,
  WATCHDOG_TIMEOUT_MS,
} from '../../src/modules/anomaly/anomaly.service';
import type { Notifier } from '../../src/modules/anomaly/anomaly.model';
import type { TelemetryPayload } from '../../src/modules/telemetry/telemetry.model';

const T0 = new Date('2026-10-15T10:00:00Z');
const at = (ms: number): Date => new Date(T0.getTime() + ms);

const makePayload = (deviceId: string, pressure: number, timestamp: Date = T0): TelemetryPayload => ({
  deviceId,
  timestamp: timestamp.toISOString(),
  metrics: { temperature: 25, vibration: 10, pressure },
});

const makeNotifier = (): Notifier => ({ notify: jest.fn() });

describe('Watchdog de señal (SCRUM-25)', () => {
  let notifier: Notifier;
  let service: AnomalyService;

  beforeEach(() => {
    notifier = makeNotifier();
    service = new AnomalyService(notifier);
  });

  afterEach(() => {
    service.stopWatchdog();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('CA-1: ejecución periódica cada 60 segundos', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('CA-1: el intervalo configurado es de 60 000 ms', () => {
      expect(WATCHDOG_INTERVAL_MS).toBe(60_000);
    });

    it('CA-1: a los 59 s el watchdog aún no se ejecutó', () => {
      const spy = jest.spyOn(service, 'runWatchdogCycle');
      service.startWatchdog(() => at(0));
      jest.advanceTimersByTime(WATCHDOG_INTERVAL_MS - 1000);
      expect(spy).not.toHaveBeenCalled();
    });

    it('CA-1: a los 60 s el watchdog se ejecuta exactamente una vez', () => {
      const spy = jest.spyOn(service, 'runWatchdogCycle');
      service.startWatchdog(() => at(0));
      jest.advanceTimersByTime(WATCHDOG_INTERVAL_MS);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('CA-1: a los 180 s el watchdog se ejecutó tres veces', () => {
      const spy = jest.spyOn(service, 'runWatchdogCycle');
      service.startWatchdog(() => at(0));
      jest.advanceTimersByTime(3 * WATCHDOG_INTERVAL_MS);
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it('CA-1: cada ciclo evalúa con la hora que entrega getNow', () => {
      const spy = jest.spyOn(service, 'runWatchdogCycle');
      const getNow = jest.fn(() => at(12345));
      service.startWatchdog(getNow);
      jest.advanceTimersByTime(WATCHDOG_INTERVAL_MS);
      expect(spy).toHaveBeenCalledWith(at(12345));
    });

    it('CA-1: stopWatchdog detiene las ejecuciones posteriores', () => {
      const spy = jest.spyOn(service, 'runWatchdogCycle');
      service.startWatchdog(() => at(0));
      jest.advanceTimersByTime(WATCHDOG_INTERVAL_MS);
      expect(spy).toHaveBeenCalledTimes(1);

      service.stopWatchdog();
      jest.advanceTimersByTime(5 * WATCHDOG_INTERVAL_MS);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('CA-1: llamar startWatchdog dos veces no duplica el temporizador', () => {
      const spy = jest.spyOn(service, 'runWatchdogCycle');
      service.startWatchdog(() => at(0));
      service.startWatchdog(() => at(0));
      jest.advanceTimersByTime(2 * WATCHDOG_INTERVAL_MS);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('CA-1: sin intervención manual, un sensor sin señal se notifica al correr el temporizador', () => {
      service.analyze(makePayload('dev-1', 40, T0));
      (notifier.notify as jest.Mock).mockClear();
      service.startWatchdog(() => at(WATCHDOG_TIMEOUT_MS + 1000));
      jest.advanceTimersByTime(WATCHDOG_INTERVAL_MS);
      expect(notifier.notify).toHaveBeenCalledTimes(1);
      expect(service.isSignalLost('dev-1')).toBe(true);
    });
  });

  describe('CA-2: sensor sin lecturas por más de 10 minutos pasa a SIN_SEÑAL', () => {
    it('CA-2: a exactamente 10 min (600 000 ms) NO pasa a SIN_SEÑAL ni notifica', () => {
      service.analyze(makePayload('dev-1', 40, T0));
      const results = service.runWatchdogCycle(at(600_000));
      expect(results).toEqual([]);
      expect(service.isSignalLost('dev-1')).toBe(false);
      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('CA-2: a 10 min + 1 ms SÍ pasa a SIN_SEÑAL', () => {
      service.analyze(makePayload('dev-1', 40, T0));
      const results = service.runWatchdogCycle(at(600_001));
      expect(results).toHaveLength(1);
      expect(results[0].deviceId).toBe('dev-1');
      expect(results[0].severity).toBe('SIN_SEÑAL');
      expect(service.isSignalLost('dev-1')).toBe(true);
    });

    it('CA-2: a 10 min + 1 s SÍ pasa a SIN_SEÑAL y notifica al operador', () => {
      service.analyze(makePayload('dev-1', 40, T0));
      const results = service.runWatchdogCycle(at(601_000));
      expect(notifier.notify).toHaveBeenCalledTimes(1);
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'dev-1', severity: 'SIN_SEÑAL' }),
      );
      expect(results[0].severity).toBe('SIN_SEÑAL');
    });

    it('CA-2: un sensor con menos de 10 min sin lecturas no se altera', () => {
      service.analyze(makePayload('dev-1', 40, T0));
      expect(service.runWatchdogCycle(at(599_999))).toEqual([]);
      expect(service.isSignalLost('dev-1')).toBe(false);
    });

    it('CA-2: un sensor aún no visto no genera resultados ni notificaciones', () => {
      expect(service.runWatchdogCycle(at(24 * 60 * 60 * 1000))).toEqual([]);
      expect(service.isSignalLost('desconocido')).toBe(false);
      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('CA-2: varios sensores se evalúan de forma independiente', () => {
      service.analyze(makePayload('dev-viejo', 40, T0));
      service.analyze(makePayload('dev-limite', 40, at(1000)));
      service.analyze(makePayload('dev-reciente', 40, at(300_000)));

      const results = service.runWatchdogCycle(at(601_000));

      expect(results.map((r) => r.deviceId)).toEqual(['dev-viejo']);
      expect(service.isSignalLost('dev-viejo')).toBe(true);
      expect(service.isSignalLost('dev-limite')).toBe(false);
      expect(service.isSignalLost('dev-reciente')).toBe(false);
      expect(notifier.notify).toHaveBeenCalledTimes(1);
    });

    it('CA-2: dos sensores que superan el límite se notifican cada uno', () => {
      service.analyze(makePayload('dev-1', 40, T0));
      service.analyze(makePayload('dev-2', 40, T0));
      const results = service.runWatchdogCycle(at(601_000));
      expect(results.map((r) => r.deviceId).sort()).toEqual(['dev-1', 'dev-2']);
      expect(notifier.notify).toHaveBeenCalledTimes(2);
    });
  });

  describe('CA-3: la notificación se emite una sola vez por evento', () => {
    it('CA-3: ciclos repetidos con el sensor sin reportar notifican una sola vez', () => {
      service.analyze(makePayload('dev-1', 40, T0));
      for (let i = 0; i < 5; i++) {
        service.runWatchdogCycle(at(601_000 + i * WATCHDOG_INTERVAL_MS));
      }
      expect(notifier.notify).toHaveBeenCalledTimes(1);
      expect(service.isSignalLost('dev-1')).toBe(true);
    });

    it('CA-3: los ciclos posteriores no devuelven de nuevo al sensor ya en SIN_SEÑAL', () => {
      service.analyze(makePayload('dev-1', 40, T0));
      expect(service.runWatchdogCycle(at(601_000))).toHaveLength(1);
      expect(service.runWatchdogCycle(at(661_000))).toEqual([]);
      expect(service.runWatchdogCycle(at(721_000))).toEqual([]);
    });

    it('CA-3: con el temporizador activo, varios minutos sin reportar notifican una sola vez', () => {
      jest.useFakeTimers();
      service.analyze(makePayload('dev-1', 40, T0));
      let nowMs = 601_000;
      service.startWatchdog(() => at((nowMs += WATCHDOG_INTERVAL_MS)));
      jest.advanceTimersByTime(5 * WATCHDOG_INTERVAL_MS);
      expect(notifier.notify).toHaveBeenCalledTimes(1);
    });

    it('CA-3: un sensor nuevo que cae en SIN_SEÑAL después sí se notifica, sin repetir al primero', () => {
      service.analyze(makePayload('dev-1', 40, T0));
      service.analyze(makePayload('dev-2', 40, at(300_000)));
      service.runWatchdogCycle(at(601_000));
      expect(notifier.notify).toHaveBeenCalledTimes(1);

      service.runWatchdogCycle(at(901_000));
      expect(notifier.notify).toHaveBeenCalledTimes(2);
      expect(notifier.notify).toHaveBeenLastCalledWith(
        expect.objectContaining({ deviceId: 'dev-2', severity: 'SIN_SEÑAL' }),
      );
    });
  });

  describe('CA-4: recuperación cuando el sensor vuelve a reportar', () => {
    const lose = (deviceId = 'dev-1') => {
      service.analyze(makePayload(deviceId, 40, T0));
      service.runWatchdogCycle(at(601_000));
      (notifier.notify as jest.Mock).mockClear();
    };

    it('CA-4: con lectura NORMAL sale de SIN_SEÑAL y se clasifica NORMAL', () => {
      lose();
      expect(service.isSignalLost('dev-1')).toBe(true);

      const result = service.analyze(makePayload('dev-1', 40, at(610_000)));

      expect(result.severity).toBe('NORMAL');
      expect(service.isSignalLost('dev-1')).toBe(false);
      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('CA-4: con lectura WARNING_L2 sale de SIN_SEÑAL y se clasifica WARNING_L2', () => {
      lose();

      const result = service.analyze(makePayload('dev-1', 52, at(610_000)));

      expect(result.severity).toBe('WARNING_L2');
      expect(service.isSignalLost('dev-1')).toBe(false);
    });

    it('CA-4: tras recuperarse, los ciclos del watchdog no lo reportan mientras siga reportando', () => {
      lose();
      service.analyze(makePayload('dev-1', 40, at(610_000)));
      expect(service.runWatchdogCycle(at(670_000))).toEqual([]);
      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('CA-4: si vuelve a quedar sin señal tras recuperarse es un evento nuevo y se notifica de nuevo', () => {
      lose();
      service.analyze(makePayload('dev-1', 40, at(610_000)));

      const results = service.runWatchdogCycle(at(610_000 + 601_000));

      expect(results).toHaveLength(1);
      expect(results[0].severity).toBe('SIN_SEÑAL');
      expect(service.isSignalLost('dev-1')).toBe(true);
      expect(notifier.notify).toHaveBeenCalledTimes(1);
    });

    it('CA-4: la recuperación de un sensor no afecta a otro que sigue sin señal', () => {
      service.analyze(makePayload('dev-1', 40, T0));
      service.analyze(makePayload('dev-2', 40, T0));
      service.runWatchdogCycle(at(601_000));

      service.analyze(makePayload('dev-1', 40, at(610_000)));

      expect(service.isSignalLost('dev-1')).toBe(false);
      expect(service.isSignalLost('dev-2')).toBe(true);
    });
  });
});
