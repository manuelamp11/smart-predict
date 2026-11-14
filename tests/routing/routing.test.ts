import { RoutingService } from '../../src/modules/routing/routing.service';
import { NoAvailableStaffException } from '../../src/modules/routing/routing.exception';
import { CRITICAL_ALERT_L1 } from '../../src/modules/routing/routing.model';
import type { Crew, RoutingAlert } from '../../src/modules/routing/routing.model';
import { describe, expect, it, jest } from '@jest/globals';

// Helpers: crean datos válidos por defecto; cada test cambia solo lo que le interesa.
const crew = (overrides: Partial<Crew> = {}): Crew => ({
  id: 'C1',
  x: 0,
  y: 0,
  quadrant: 'Q1',
  status: 'AVAILABLE',
  ...overrides,
});

const alert = (overrides: Partial<RoutingAlert> = {}): RoutingAlert => ({
  x: 0,
  y: 0,
  quadrant: 'Q1',
  severity: CRITICAL_ALERT_L1,
  ...overrides,
});

// Escalador y notificador falsos para comprobar si se llamaron, sin imprimir en consola.
function setup() {
  const escalate = jest.fn();
  const notify = jest.fn();
  const service = new RoutingService({ escalate }, { notify });
  return { service, escalate, notify };
}

describe('RoutingService', () => {
  describe('calculateDistance', () => {
    it('calcula la distancia euclidiana', () => {
      const { service } = setup();
      expect(service.calculateDistance(0, 0, 3, 4)).toBe(5);
    });

    it('lanza RangeError con coordenadas no finitas', () => {
      const { service } = setup();
      expect(() => service.calculateDistance(NaN, 0, 1, 1)).toThrow(RangeError);
      expect(() => service.calculateDistance(0, Infinity, 1, 1)).toThrow(RangeError);
    });
  });

  describe('dispatchForAlert', () => {
    it('ignora alertas que no son CRITICAL_ALERT_L1', () => {
      const { service, escalate, notify } = setup();

      const result = service.dispatchForAlert([crew()], alert({ severity: 'LOW' }));

      expect(result).toBeNull();
      expect(notify).not.toHaveBeenCalled();
      expect(escalate).not.toHaveBeenCalled();
    });

    it('asigna la cuadrilla disponible más cercana y le envía el push', () => {
      const { service, escalate, notify } = setup();
      const crews = [crew({ id: 'LEJOS', x: 10 }), crew({ id: 'CERCA', x: 3, y: 4 })];

      const result = service.dispatchForAlert(crews, alert());

      expect(result).toEqual({ crewId: 'CERCA', distance: 5 });
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith({
        crewId: 'CERCA',
        severity: CRITICAL_ALERT_L1,
        quadrant: 'Q1',
        alertLocation: { x: 0, y: 0 },
        distance: 5,
      });
      expect(escalate).not.toHaveBeenCalled();
    });

    // MC/DC de isEligible: cada test cambia UNA sola condición.
    it('descarta una cuadrilla BUSY aunque esté más cerca', () => {
      const { service } = setup();
      const crews = [crew({ id: 'OCUPADA', x: 1, status: 'BUSY' }), crew({ id: 'LIBRE', x: 5 })];

      expect(service.dispatchForAlert(crews, alert())?.crewId).toBe('LIBRE');
    });

    it('descarta una cuadrilla de otro cuadrante aunque esté más cerca', () => {
      const { service } = setup();
      const crews = [crew({ id: 'OTRO', x: 1, quadrant: 'Q2' }), crew({ id: 'MISMO', x: 5 })];

      expect(service.dispatchForAlert(crews, alert())?.crewId).toBe('MISMO');
    });

    it('en empate de distancia gana la primera de la lista', () => {
      const { service } = setup();
      const crews = [crew({ id: 'A', x: 5 }), crew({ id: 'B', x: -5 })];

      expect(service.dispatchForAlert(crews, alert())?.crewId).toBe('A');
    });

    it('sin cuadrillas elegibles escala al CCO y lanza NoAvailableStaffException', () => {
      const { service, escalate, notify } = setup();
      const crews = [crew({ status: 'BUSY' }), crew({ quadrant: 'Q2' })];

      expect(() => service.dispatchForAlert(crews, alert({ x: 2, y: 3 }))).toThrow(
        NoAvailableStaffException,
      );
      expect(escalate).toHaveBeenCalledTimes(1);
      expect(escalate).toHaveBeenCalledWith({
        reason: 'NO_AVAILABLE_STAFF',
        severity: CRITICAL_ALERT_L1,
        quadrant: 'Q1',
        alertLocation: { x: 2, y: 3 },
      });
      expect(notify).not.toHaveBeenCalled();
    });

    it('con la lista vacía también escala al CCO', () => {
      const { service, escalate } = setup();

      expect(() => service.dispatchForAlert([], alert())).toThrow(NoAvailableStaffException);
      expect(escalate).toHaveBeenCalledTimes(1);
    });
  });

  describe('findNearestCrew', () => {
    it('lanza NoAvailableStaffException sin escalar al CCO', () => {
      const { service, escalate } = setup();

      expect(() => service.findNearestCrew([], alert())).toThrow(NoAvailableStaffException);
      expect(escalate).not.toHaveBeenCalled();
    });
  });
});