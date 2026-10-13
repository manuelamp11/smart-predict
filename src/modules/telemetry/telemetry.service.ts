import type { TelemetryPayload, ValidationResult } from './telemetry.model';

export const OPERATIONAL_RANGES = {
  temperature: { min: -50, max: 150, unit: 'C' },
  vibration: { min: 0, max: 100, unit: 'mm/s' },
  pressure: { min: 0, max: 500, unit: 'PSI' },
} as const;

export class TelemetryService {
  private readonly store: TelemetryPayload[] = [];

  validate(payload: TelemetryPayload): ValidationResult {
    const errors: string[] = [];

    if (!payload || typeof payload.deviceId !== 'string' || payload.deviceId.trim() === '') {
      errors.push('deviceId es requerido');
    }
    if (!payload || !payload.timestamp || Number.isNaN(Date.parse(payload.timestamp))) {
      errors.push('timestamp inválido');
    }
    if (!payload || !payload.metrics) {
      errors.push('metrics es requerido');
      return { valid: false, errors };
    }

    for (const key of Object.keys(OPERATIONAL_RANGES) as (keyof typeof OPERATIONAL_RANGES)[]) {
      const value = payload.metrics[key];
      const { min, max, unit } = OPERATIONAL_RANGES[key];
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`${key} debe ser un número`);
      } else if (value < min || value > max) {
        errors.push(`${key} fuera de rango operacional (${min} a ${max} ${unit})`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** Valida y guarda el dato; si es inválido no se almacena. */
  ingest(payload: TelemetryPayload): ValidationResult {
    const result = this.validate(payload);
    if (result.valid) {
      this.store.push({ ...payload, metrics: { ...payload.metrics } });
    }
    return result;
  }

  getAll(): TelemetryPayload[] {
    return [...this.store];
  }

  getByDevice(deviceId: string): TelemetryPayload[] {
    return this.store.filter((p) => p.deviceId === deviceId);
  }
}
