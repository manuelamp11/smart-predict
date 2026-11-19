import type { TelemetryPayload, ValidationResult } from '../telemetry/telemetry.model';
import { MalformedPacketException, TELEMETRY_TOPIC } from './mqtt.model';
import type { Logger, MqttClientLike } from './mqtt.model';

/** Only the part of TelemetryService the subscriber needs. */
export interface TelemetryIngestor {
  ingest(payload: TelemetryPayload): ValidationResult;
}

/**
 * Listens to sensores/+/telemetria and forwards every valid reading to the
 * telemetry service. A bad message is logged and discarded; it never stops
 * the subscriber.
 */
export class TelemetrySubscriber {
  constructor(
    private readonly client: MqttClientLike,
    private readonly telemetryService: TelemetryIngestor,
    private readonly logger: Logger = console,
  ) {}

  start(): void {
    this.client.on('connect', () => this.subscribe());
    this.client.on('message', (topic: string, payload: Buffer) => this.handleMessage(topic, payload));
    this.client.on('reconnect', () => this.logger.warn('[MQTT] Reintentando conexión con el broker...'));
    this.client.on('offline', () => this.logger.warn('[MQTT] Conexión con el broker perdida'));
    this.client.on('error', (error: Error) => this.logger.error('[MQTT] Error del cliente', error));
  }

  stop(): void {
    this.client.end();
  }

  /** Processes one MQTT message. Never throws, so one bad frame cannot stop the subscriber. */
  handleMessage(topic: string, raw: Buffer | string): void {
    try {
      const payload = this.parse(topic, raw);
      const result = this.telemetryService.ingest(payload);

      if (!result.valid) {
        this.logger.warn(`[MQTT] Telemetría de ${payload.deviceId} rechazada`, result.errors);
      }
    } catch (error) {
      if (error instanceof MalformedPacketException) {
        this.logger.error(`[MQTT] ${error.name}: ${error.message}`);
        return;
      }
      this.logger.error('[MQTT] Error inesperado procesando el mensaje', error);
    }
  }

  private subscribe(): void {
    this.client.subscribe(TELEMETRY_TOPIC, { qos: 1 }, (error) => {
      if (error) {
        this.logger.error(`[MQTT] No se pudo suscribir a ${TELEMETRY_TOPIC}`, error);
        return;
      }
      this.logger.info(`[MQTT] Suscrito a ${TELEMETRY_TOPIC}`);
    });
  }

  private parse(topic: string, raw: Buffer | string): TelemetryPayload {
    const topicDeviceId = this.extractDeviceId(topic);

    let data: unknown;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      throw new MalformedPacketException(topic, 'el contenido no es JSON válido');
    }

    if (!isTelemetryPayload(data)) {
      throw new MalformedPacketException(topic, 'faltan campos o tienen un tipo incorrecto');
    }

    if (data.deviceId !== topicDeviceId) {
      throw new MalformedPacketException(
        topic,
        `el deviceId "${data.deviceId}" no coincide con el del tópico "${topicDeviceId}"`,
      );
    }

    return data;
  }

  /** sensores/{id}/telemetria -> {id} */
  private extractDeviceId(topic: string): string {
    const [root, deviceId, leaf, ...rest] = topic.split('/');

    if (root !== 'sensores' || leaf !== 'telemetria' || !deviceId || rest.length > 0) {
      throw new MalformedPacketException(topic, 'el tópico no sigue el formato sensores/{id}/telemetria');
    }

    return deviceId;
  }
}

function isTelemetryPayload(value: unknown): value is TelemetryPayload {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;
  const metrics = candidate.metrics as Record<string, unknown> | null | undefined;

  return (
    typeof candidate.deviceId === 'string' &&
    typeof candidate.timestamp === 'string' &&
    typeof metrics === 'object' &&
    metrics !== null &&
    typeof metrics.temperature === 'number' &&
    typeof metrics.vibration === 'number' &&
    typeof metrics.pressure === 'number'
  );
}