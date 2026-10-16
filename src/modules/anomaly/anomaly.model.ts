export type Severity = 'NORMAL' | 'WARNING_L2' | 'CRITICAL_ALERT_L1' | 'SIN_SEÑAL';

export interface AnomalyResult {
  deviceId: string;
  timestamp: string;
  pressure: number;
  /** Desviación absoluta respecto al umbral nominal, en porcentaje. */
  deviation: number;
  severity: Severity;
  /** Lecturas consecutivas con desviación > 30% para este dispositivo. */
  consecutiveHighReadings: number;
}

export interface Notifier {
  notify(result: AnomalyResult): void;
}
