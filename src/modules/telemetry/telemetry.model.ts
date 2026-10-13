export interface TelemetryMetrics {
  /** Temperatura en °C (-50 a 150) */
  temperature: number;
  /** Vibración en mm/s (0 a 100) */
  vibration: number;
  /** Presión en PSI (0 a 500) */
  pressure: number;
}

export interface TelemetryPayload {
  deviceId: string;
  /** Marca de tiempo ISO 8601 */
  timestamp: string;
  metrics: TelemetryMetrics;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
