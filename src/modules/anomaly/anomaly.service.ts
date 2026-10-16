import type { TelemetryPayload } from '../telemetry/telemetry.model';
import type { AnomalyResult, Notifier, Severity } from './anomaly.model';

export const NOMINAL_PRESSURE = 40.0;
export const NORMAL_MAX_DEVIATION = 10.0;
export const WARNING_MAX_DEVIATION = 30.0;
export const CRITICAL_CONSECUTIVE_CYCLES = 3;
export const WATCHDOG_TIMEOUT_MS = 10 * 60 * 1000;

interface DeviceState {
  highStreak: number;
  lastSeen: Date;
}

export class AnomalyService {
  private readonly devices = new Map<string, DeviceState>();

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
    this.devices.set(deviceId, { highStreak: streak, lastSeen: new Date(payload.timestamp) });

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
}
