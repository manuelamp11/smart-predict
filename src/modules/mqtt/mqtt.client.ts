import { connect } from 'mqtt';

import type { MqttClientLike } from './mqtt.model';

const DEFAULT_BROKER_URL = 'mqtt://localhost:1883';

/**
 * Crea el cliente real de mqtt.js. El parámetro `reconnectPeriod` hace que
 * la biblioteca intente reconectarse automáticamente cada 5 segundos cuando
 * se pierde la conexión con el broker (HU-006, criterio 4).
 */

export function createMqttClient(
  brokerUrl: string = process.env.MQTT_BROKER_URL ?? DEFAULT_BROKER_URL,
): MqttClientLike {
  return connect(brokerUrl, {
    clientId: `smart-predict-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });
}