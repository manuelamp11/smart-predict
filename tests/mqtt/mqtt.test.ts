import { EventEmitter } from 'events';

import { MalformedPacketException, TELEMETRY_TOPIC } from '../../src/modules/mqtt/mqtt.model';
import { TelemetrySubscriber } from '../../src/modules/mqtt/mqtt.subscriber';
import { TelemetryService } from '../../src/modules/telemetry/telemetry.service';

// Cliente MQTT falso: emite eventos como el real, sin necesitar un broker.
class FakeMqttClient extends EventEmitter {
  subscribe = jest.fn();
  end = jest.fn();
}

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  deviceId: 'S1',
  timestamp: '2026-11-19T10:00:00.000Z',
  metrics: { temperature: 25, vibration: 10, pressure: 100 },
  ...overrides,
});

const toBuffer = (value: unknown) => Buffer.from(JSON.stringify(value));

function setup() {
  const client = new FakeMqttClient();
  const telemetryService = new TelemetryService();
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const subscriber = new TelemetrySubscriber(client, telemetryService, logger);
  subscriber.start();
  return { client, telemetryService, logger, subscriber };
}

describe('TelemetrySubscriber', () => {
  describe('suscripción (criterio 1)', () => {
    it('al conectar se suscribe a sensores/+/telemetria', () => {
      const { client } = setup();

      client.emit('connect');

      expect(client.subscribe).toHaveBeenCalledWith(TELEMETRY_TOPIC, { qos: 1 }, expect.any(Function));
    });

    it('registra un error si el broker rechaza la suscripción', () => {
      const { client, logger } = setup();
      client.emit('connect');

      const callback = client.subscribe.mock.calls[0][2];
      callback(new Error('not authorized'));

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('No se pudo suscribir'), expect.any(Error));
    });
  });

  describe('mensajes válidos (criterio 2)', () => {
    it('almacena la telemetría válida', () => {
      const { client, telemetryService } = setup();

      client.emit('message', 'sensores/S1/telemetria', toBuffer(validPayload()));

      expect(telemetryService.getByDevice('S1')).toHaveLength(1);
    });

    it('no almacena telemetría fuera de rango y lo registra como advertencia', () => {
      const { client, telemetryService, logger } = setup();
      const outOfRange = validPayload({ metrics: { temperature: 999, vibration: 10, pressure: 100 } });

      client.emit('message', 'sensores/S1/telemetria', toBuffer(outOfRange));

      expect(telemetryService.getByDevice('S1')).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('rechazada'), expect.any(Array));
    });
  });

  describe('tramas malformadas (criterio 3)', () => {
    it.each([
      ['JSON inválido', 'sensores/S1/telemetria', Buffer.from('{temperatura: 25')],
      ['faltan las métricas', 'sensores/S1/telemetria', toBuffer({ deviceId: 'S1', timestamp: 'x' })],
      ['métrica con tipo incorrecto', 'sensores/S1/telemetria', toBuffer(validPayload({ metrics: { temperature: '25', vibration: 10, pressure: 100 } }))],
      ['deviceId distinto al del tópico', 'sensores/S1/telemetria', toBuffer(validPayload({ deviceId: 'S2' }))],
      ['tópico con formato incorrecto', 'sensores/S1/otra-cosa', toBuffer(validPayload())],
    ])('descarta la trama y registra MalformedPacketException: %s', (_case, topic, raw) => {
      const { client, telemetryService, logger } = setup();

      client.emit('message', topic, raw);

      expect(telemetryService.getAll()).toHaveLength(0);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('MalformedPacketException'));
    });

    it('sigue procesando mensajes después de una trama malformada', () => {
      const { client, telemetryService } = setup();

      client.emit('message', 'sensores/S1/telemetria', Buffer.from('basura'));
      client.emit('message', 'sensores/S1/telemetria', toBuffer(validPayload()));

      expect(telemetryService.getByDevice('S1')).toHaveLength(1);
    });

    it('un error inesperado del servicio tampoco detiene el suscriptor', () => {
      const client = new FakeMqttClient();
      const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const failingService = { ingest: jest.fn(() => { throw new Error('fallo de almacenamiento'); }) };
      new TelemetrySubscriber(client, failingService, logger).start();

      expect(() => client.emit('message', 'sensores/S1/telemetria', toBuffer(validPayload()))).not.toThrow();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error inesperado'), expect.any(Error));
    });

    it('MalformedPacketException conserva el tópico y es instancia de Error', () => {
      const error = new MalformedPacketException('sensores/S1/telemetria', 'prueba');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(MalformedPacketException);
      expect(error.topic).toBe('sensores/S1/telemetria');
    });
  });

  describe('reconexión (criterio 4)', () => {
    it('registra cuando pierde la conexión y cuando reintenta', () => {
      const { client, logger } = setup();

      client.emit('offline');
      client.emit('reconnect');

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('perdida'));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Reintentando'));
    });

    it('vuelve a suscribirse al reconectar', () => {
      const { client } = setup();

      client.emit('connect');
      client.emit('connect');

      expect(client.subscribe).toHaveBeenCalledTimes(2);
    });

    it('stop() cierra la conexión con el broker', () => {
      const { client, subscriber } = setup();

      subscriber.stop();

      expect(client.end).toHaveBeenCalled();
    });
  });
});