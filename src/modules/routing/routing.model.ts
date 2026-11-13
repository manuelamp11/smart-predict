/**
 * Severity that triggers automatic OT dispatch (HU-003, RN002).
 * Must match exactly the severity emitted by the anomaly module (HU-002).
 */
export const CRITICAL_ALERT_L1 = 'CRITICAL_ALERTS_L1';

export type CrewStatus = 'AVAILABLE' | 'BUSY';

export interface AlertLocation {
  readonly x: number;
  readonly y: number;
}

export interface Crew {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly quadrant: string;
  readonly status: CrewStatus;
}

/** Alert enriched with severity and quadrant so dispatch can enforce HU-003. */
export interface RoutingAlert extends AlertLocation {
  readonly quadrant: string;
  readonly severity: string;
}

export interface DispatchResult {
  readonly crewId: string;
  readonly distance: number;
}

export interface CcoEscalation {
  readonly reason: 'NO_AVAILABLE_STAFF';
  readonly severity: typeof CRITICAL_ALERT_L1;
  readonly quadrant: string;
  readonly alertLocation: AlertLocation;
}

/** Port for notifying the CCO when no crew can attend an alert. */
export interface CcoEscalator {
  escalate(event: CcoEscalation): void;
}

export interface CrewDispatchNotification {
  readonly crewId: string;
  readonly severity: typeof CRITICAL_ALERT_L1;
  readonly quadrant: string;
  readonly alertLocation: AlertLocation;
  readonly distance: number;
}

/** Port for pushing dispatched work orders to the crew's mobile app. */
export interface CrewNotifier {
  notify(notification: CrewDispatchNotification): void;
}

export interface CrewDispatchNotification {
  readonly crewId: string;
  readonly severity: typeof CRITICAL_ALERT_L1;
  readonly quadrant: string;
  readonly alertLocation: AlertLocation;
  readonly distance: number;
}

/** Port for pushing dispatched work orders to the crew's mobile app. */
export interface CrewNotifier {
  notify(notification: CrewDispatchNotification): void;
}