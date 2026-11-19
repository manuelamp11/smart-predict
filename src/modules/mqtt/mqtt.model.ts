/** Suscripción con comodín para todos los sensores: sensores/{id}/telemetria (HU-006). */
export const TELEMETRY_TOPIC = 'sensores/+/telemetria';

/** Se lanza cuando un mensaje MQTT no puede convertirse en un TelemetryPayload. */
export class MalformedPacketException extends Error {
  constructor(
    public readonly topic: string,
    public readonly reason: string
  ) {
    super(`Trama mal formada en '${topic}': ${reason}`);
    this.name = 'MalformedPacketException';
    Object.setPrototypeOf(this, MalformedPacketException.prototype);
    }
  }

/** Interfaz mínima del cliente mqtt.js necesaria para el suscriptor (permite usar un cliente simulado en las pruebas). */
export interface MqttClientLike {
  subscribe(topic: string, options: { qos: 0 | 1 | 2 }, callback: (error: Error | null) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each MQTT event has different arguments
  on(event: string, listener: (...args: any[]) => void): unknown;
  end(force?: boolean): unknown;
}


export interface Logger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}