import type { TelemetryPayload } from '../telemetry/telemetry.model';
import type { AnomalyResult, Severity } from './anomaly.model';

export const NOMINAL_PRESSURE = 40.0;
export const NORMAL_MAX_DEVIATION = 10.0;
export const WARNING_MAX_DEVIATION = 30.0;

export class AnomalyService {
  /** Desviación absoluta respecto al umbral nominal, en porcentaje. */
  calculateDeviation(pressure: number): number {
    return (Math.abs(pressure - NOMINAL_PRESSURE) * 100) / NOMINAL_PRESSURE;
  }

  private classify(deviation: number): Severity {
    if (deviation <= NORMAL_MAX_DEVIATION) {
      return 'NORMAL';
    }
    if (deviation <= WARNING_MAX_DEVIATION) {
      return 'WARNING_L2';
    }
    // TODO(supuesto pendiente de confirmar): hasta completar 3 lecturas
    // consecutivas con desviación > 30%, se clasifica como WARNING_L2.
    // La racha de 3 ciclos para CRITICAL_ALERT_L1 se agrega en la siguiente parte.
    return 'WARNING_L2';
  }

  analyze(payload: TelemetryPayload): AnomalyResult {
    const pressure = payload.metrics.pressure;
    const deviation = this.calculateDeviation(pressure);
    const severity = this.classify(deviation);

    return {
      deviceId: payload.deviceId,
      timestamp: payload.timestamp,
      pressure,
      deviation,
      severity,
      consecutiveHighReadings: 0,
    };
  }
}
