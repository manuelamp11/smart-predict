import { CRITICAL_ALERT_L1 } from './routing.model';

import type {
  CcoEscalation,
  CcoEscalator,
  Crew,
  CrewDispatchNotification,
  CrewNotifier,
  DispatchResult,
  RoutingAlert,
} from './routing.model';
import { NoAvailableStaffException } from './routing.exception';

/** Default adapter: publishes staffing shortages to the CCO console. */
export class ConsoleCcoEscalator implements CcoEscalator {
  escalate(event: CcoEscalation): void {
    console.error('[CCO] No hay cuadrillas disponibles para atender la alerta', event);
  }
}

/** Default adapter: logs the push notification until a real provider is wired in. */
export class ConsoleCrewNotifier implements CrewNotifier {
  notify(notification: CrewDispatchNotification): void {
    console.log(`[PUSH] Orden de trabajo enviada a la cuadrilla ${notification.crewId}`, notification);
  }
}

export class RoutingService {
  constructor(
    private readonly ccoEscalator: CcoEscalator = new ConsoleCcoEscalator(),
    private readonly crewNotifier: CrewNotifier = new ConsoleCrewNotifier(),
  ) {}

  /** Calculates straight-line distance between two points in the same coordinate system. */
  calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
    if (![x1, y1, x2, y2].every(Number.isFinite)) {
      throw new RangeError('Las coordenadas deben ser números finitos');
    }

    return Math.hypot(x2 - x1, y2 - y1);
  }

  /**
   * Returns the nearest AVAILABLE crew in the alert's quadrant.
   * Input order breaks equal-distance ties.
   *
   * @throws {NoAvailableStaffException} If no crew is eligible.
   */
  findNearestCrew(crews: readonly Crew[], alert: RoutingAlert): DispatchResult {
    const nearest = this.selectNearestCrew(crews, alert);

    if (nearest === undefined) {
      throw new NoAvailableStaffException();
    }

    return nearest;
  }

  /**
   * Routes only CRITICAL_ALERT_L1 events. Other severities are ignored and
   * return null, so they cannot trigger an OT dispatch through this service.
   * When a crew is assigned, it receives a push notification (SP-08).
   *
   * @throws {NoAvailableStaffException} If no crew is eligible. The CCO is
   * notified before the exception is thrown.
   */
  dispatchForAlert(crews: readonly Crew[], alert: RoutingAlert): DispatchResult | null {
    if (alert.severity !== CRITICAL_ALERT_L1) return null;

    const nearest = this.selectNearestCrew(crews, alert);

    if (nearest !== undefined) {
      this.crewNotifier.notify({
        crewId: nearest.crewId,
        severity: CRITICAL_ALERT_L1,
        quadrant: alert.quadrant,
        alertLocation: { x: alert.x, y: alert.y },
        distance: nearest.distance,
      });

      return nearest;
    }

    this.ccoEscalator.escalate({
      reason: 'NO_AVAILABLE_STAFF',
      severity: CRITICAL_ALERT_L1,
      quadrant: alert.quadrant,
      alertLocation: { x: alert.x, y: alert.y },
    });

    throw new NoAvailableStaffException();
  }

  private selectNearestCrew(
    crews: readonly Crew[],
    alert: RoutingAlert,
  ): DispatchResult | undefined {
    let nearest: DispatchResult | undefined;

    for (const crew of crews) {
      if (!this.isEligible(crew, alert)) continue;

      const distance = this.calculateDistance(crew.x, crew.y, alert.x, alert.y);
      if (nearest === undefined || distance < nearest.distance) {
        nearest = { crewId: crew.id, distance };
      }
    }

    return nearest;
  }

  /** A crew is eligible when it is AVAILABLE and in the same quadrant as the alert. */
  private isEligible(crew: Crew, alert: RoutingAlert): boolean {
    return crew.status === 'AVAILABLE' && crew.quadrant === alert.quadrant;
  }
}