import type { TelemetryPayload } from '../telemetry/telemetry.model';
import type { AnomalyResult, Notifier, Severity } from './anomaly.model';

export const NOMINAL_PRESSURE = 40.0;
export const NORMAL_MAX_DEVIATION = 10.0;
export const WARNING_MAX_DEVIATION = 30.0;
export const CRITICAL_CONSECUTIVE_CYCLES = 3;
export const WATCHDOG_TIMEOUT_MS = 10 * 60 * 1000;

export const WATCHDOG_INTERVAL_MS = 60_000;

interface DeviceState {
  highStreak: number;
  lastSeen: Date;
  lastPressure: number;
  lastDeviation: number;
  signalLost: boolean;
}

export class AnomalyService {
  private readonly devices = new Map<string, DeviceState>();
  private watchdogTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly notifier: Notifier) {}

  /** Desviación absoluta respecto al umbral nominal, en porcentaje. */
  calculateDeviation(pressure: number): number {
    return (Math.abs(pressure - NOMINAL_PRESSURE) * 100) / NOMINAL_PRESSURE;
  }

  private classify(deviation: number, streak: number): Severity {
    if (deviation <= NORMAL_MAX_DEVIATION) {
      return 'NORMAL';
    }
    if (deviation > WARNING_MAX_DEVIATION && streak >= CRITICAL_CONSECUTIVE_CYCLES) {
      return 'CRITICAL_ALERT_L1';
    }
    // TODO(supuesto pendiente de confirmar): hasta completar 3 lecturas
    // consecutivas con desviación > 30%, se clasifica como WARNING_L2.
    return 'WARNING_L2';
  }

  analyze(payload: TelemetryPayload): AnomalyResult {
    const { deviceId } = payload;
    const pressure = payload.metrics.pressure;
    const deviation = this.calculateDeviation(pressure);

    const previousState = this.devices.get(deviceId);
    const previousStreak = previousState ? previousState.highStreak : 0;
    const streak = deviation > WARNING_MAX_DEVIATION ? previousStreak + 1 : 0;
    this.devices.set(deviceId, {
      highStreak: streak,
      lastSeen: new Date(payload.timestamp),
      lastPressure: pressure,
      lastDeviation: deviation,
      signalLost: false,
    });

    const severity = this.classify(deviation, streak);
    const result: AnomalyResult = {
      deviceId,
      timestamp: payload.timestamp,
      pressure,
      deviation,
      severity,
      consecutiveHighReadings: streak,
    };

    if (severity === 'WARNING_L2' || severity === 'CRITICAL_ALERT_L1') {
      this.notifier.notify(result);
    }

    return result;
  }

  /** Devuelve los deviceId que no han reportado en más de 10 minutos respecto a `now`. */
  checkWatchdog(now: Date): string[] {
    const silentDevices: string[] = [];
    for (const [deviceId, state] of this.devices) {
      const elapsedMs = now.getTime() - state.lastSeen.getTime();
      if (elapsedMs > WATCHDOG_TIMEOUT_MS) {
        silentDevices.push(deviceId);
      }
    }
    return silentDevices;
  }

  /** Marca como SIN_SEÑAL y notifica una sola vez a los sensores recién vencidos. */
  runWatchdogCycle(now: Date): AnomalyResult[] {
    const results: AnomalyResult[] = [];
    for (const deviceId of this.checkWatchdog(now)) {
      const state = this.devices.get(deviceId);
      if (!state || state.signalLost) {
        continue;
      }
      state.signalLost = true;
      const result: AnomalyResult = {
        deviceId,
        timestamp: now.toISOString(),
        pressure: state.lastPressure,
        deviation: state.lastDeviation,
        severity: 'SIN_SEÑAL',
        consecutiveHighReadings: state.highStreak,
      };
      this.notifier.notify(result);
      results.push(result);
    }
    return results;
  }

  startWatchdog(getNow: () => Date = () => new Date()): void {
    if (this.watchdogTimer !== undefined) {
      return;
    }
    this.watchdogTimer = setInterval(() => {
      this.runWatchdogCycle(getNow());
    }, WATCHDOG_INTERVAL_MS);
    this.watchdogTimer.unref?.();
  }

  stopWatchdog(): void {
    if (this.watchdogTimer !== undefined) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }
  }

  isSignalLost(deviceId: string): boolean {
    return this.devices.get(deviceId)?.signalLost ?? false;
  }
}
