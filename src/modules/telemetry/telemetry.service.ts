import { randomUUID } from 'crypto';
import type { IngestOutcome, TelemetryPayload, ValidationIssue, ValidationResult } from './telemetry.model';

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

  /**
   * Ingesta estricta: sin valores por defecto, no lanza y no almacena lecturas inválidas.
   * Si hay errores de formato y de rango, prevalece INVALID_FORMAT.
   */
  ingestStrict(input: unknown): IngestOutcome {
    const formatErrors: ValidationIssue[] = [];
    const rangeErrors: ValidationIssue[] = [];

    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return {
        status: 'INVALID_FORMAT',
        errors: [{ field: 'body', message: 'el cuerpo debe ser un objeto JSON' }],
      };
    }
    const body = input as Record<string, unknown>;

    if (typeof body.deviceId !== 'string' || body.deviceId.trim() === '') {
      formatErrors.push({ field: 'deviceId', message: 'deviceId es requerido' });
    }
    if (typeof body.timestamp !== 'string' || Number.isNaN(Date.parse(body.timestamp))) {
      formatErrors.push({ field: 'timestamp', message: 'timestamp inválido' });
    }

    const metrics = body.metrics;
    if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) {
      formatErrors.push({ field: 'metrics', message: 'metrics es requerido' });
    } else {
      const values = metrics as Record<string, unknown>;
      for (const key of Object.keys(OPERATIONAL_RANGES) as (keyof typeof OPERATIONAL_RANGES)[]) {
        const value = values[key];
        const { min, max, unit } = OPERATIONAL_RANGES[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          formatErrors.push({ field: `metrics.${key}`, message: `${key} debe ser un número` });
        } else if (value < min || value > max) {
          rangeErrors.push({
            field: `metrics.${key}`,
            message: `${key} fuera de rango operacional (${min} a ${max} ${unit})`,
          });
        }
      }
    }

    if (formatErrors.length > 0) return { status: 'INVALID_FORMAT', errors: formatErrors };
    if (rangeErrors.length > 0) return { status: 'OUT_OF_RANGE', errors: rangeErrors };

    const payload = input as TelemetryPayload;
    this.store.push({ ...payload, metrics: { ...payload.metrics } });
    return { status: 'ACCEPTED', ingestId: randomUUID() };
  }

  getAll(): TelemetryPayload[] {
    return [...this.store];
  }

  getByDevice(deviceId: string): TelemetryPayload[] {
    return this.store.filter((p) => p.deviceId === deviceId);
  }
}
