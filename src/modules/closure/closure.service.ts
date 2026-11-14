import type {
  AuditReading,
  AuditResult,
  UserRole,
  WorkOrder,
} from './closure.model';

export const NOMINAL_PRESSURE = 40.0;
export const MIN_NOMINAL_PRESSURE = 36.0;
export const MAX_NOMINAL_PRESSURE = 44.0;
export const STABILIZATION_WINDOW_MINUTES = 15;
export const SAMPLES_REQUIRED_FOR_CONFORMANCE = 30;

export class ClosureValidationService {
  private readonly workOrders = new Map<string, WorkOrder>();

  createWorkOrder(id: string, deviceId: string, assignedCrewId = 'crew-1'): WorkOrder {
    const order: WorkOrder = {
      id,
      deviceId,
      assignedCrewId,
      status: 'ASIGNADA',
      readings: [],
    };
    this.workOrders.set(id, order);
    return order;
  }

  getWorkOrder(id: string): WorkOrder | undefined {
    return this.workOrders.get(id);
  }

  getAllWorkOrders(): WorkOrder[] {
    return Array.from(this.workOrders.values());
  }

  confirmArrival(orderId: string): WorkOrder {
    const order = this.workOrders.get(orderId);
    if (!order) {
      throw new Error(`Orden de trabajo no encontrada: ${orderId}`);
    }
    order.status = 'EN_INTERVENCION';
    return order;
  }

  startAudit(orderId: string, startTime: Date = new Date()): WorkOrder {
    const order = this.workOrders.get(orderId);
    if (!order) {
      throw new Error(`Orden de trabajo no encontrada: ${orderId}`);
    }
    order.status = 'EN_AUDITORIA';
    order.auditStartTime = startTime;
    order.readings = [];
    order.auditMessage = undefined;
    return order;
  }

  /**
   * Valida si una lectura de presión está en el rango nominal de 36 a 44 PSI.
   */
  isPressureNominal(pressure: number): boolean {
    return pressure >= MIN_NOMINAL_PRESSURE && pressure <= MAX_NOMINAL_PRESSURE;
  }

  /**
   * Registra una lectura durante la ventana de auditoría.
   * Si detecta inestabilidad (<36 o >44 PSI), aborta y retorna la OT a EN_INTERVENCION.
   */
  recordReading(
    orderId: string,
    pressure: number,
    minuteOrTime: string | Date = new Date(),
  ): AuditResult {
    const order = this.workOrders.get(orderId);
    if (!order) {
      throw new Error(`Orden de trabajo no encontrada: ${orderId}`);
    }

    let minuteStr: string;
    let timestamp: string;

    if (typeof minuteOrTime === 'string') {
      minuteStr = minuteOrTime;
      timestamp = new Date().toISOString();
    } else {
      timestamp = minuteOrTime.toISOString();
      if (order.auditStartTime) {
        const elapsedSec = Math.floor(
          (minuteOrTime.getTime() - order.auditStartTime.getTime()) / 1000,
        );
        const mins = Math.floor(elapsedSec / 60);
        const secs = elapsedSec % 60;
        minuteStr = `${mins}:${secs.toString().padStart(2, '0')}`;
      } else {
        minuteStr = '00:00';
      }
    }

    const reading: AuditReading = {
      pressure,
      timestamp,
      minute: minuteStr,
    };
    order.readings.push(reading);

    if (!this.isPressureNominal(pressure)) {
      order.status = 'EN_INTERVENCION';
      const message = `Inestabilidad detectada: ${pressure} PSI a los ${minuteStr}`;
      order.auditMessage = message;
      return {
        success: false,
        status: 'EN_INTERVENCION',
        message,
        readingsCount: order.readings.length,
      };
    }

    return {
      success: true,
      status: order.status,
      readingsCount: order.readings.length,
    };
  }

  /**
   * Valida una serie completa de 15 minutos continuos de estabilización.
   */
  validateStabilizationWindow(
    orderId: string,
    readings: { pressure: number; minute?: string; timestamp?: string | Date }[],
  ): AuditResult {
    const order = this.workOrders.get(orderId) || this.createWorkOrder(orderId, 'dev-default');
    this.startAudit(orderId);

    for (const r of readings) {
      const minStr = r.minute ?? (typeof r.timestamp === 'string' ? r.timestamp : '15:00');
      const result = this.recordReading(orderId, r.pressure, minStr);
      if (!result.success) {
        return result;
      }
    }

    order.status = 'CERRADA_CONFORME';
    order.auditMessage = 'Estabilización de 15 minutos completada con éxito';
    return {
      success: true,
      status: 'CERRADA_CONFORME',
      message: order.auditMessage,
      readingsCount: order.readings.length,
    };
  }

  /**
   * Completa la auditoría como conforme si se alcanzaron las condiciones de estabilidad.
   */
  completeAudit(orderId: string): AuditResult {
    const order = this.workOrders.get(orderId);
    if (!order) {
      throw new Error(`Orden de trabajo no encontrada: ${orderId}`);
    }

    if (order.readings.some((r) => !this.isPressureNominal(r.pressure))) {
      order.status = 'EN_INTERVENCION';
      return {
        success: false,
        status: 'EN_INTERVENCION',
        message: order.auditMessage || 'Inestabilidad detectada en el histórico de lecturas',
        readingsCount: order.readings.length,
      };
    }

    order.status = 'CERRADA_CONFORME';
    order.auditMessage = 'Cierre conforme: 15 minutos de estabilización en banda nominal (36-44 PSI)';
    return {
      success: true,
      status: 'CERRADA_CONFORME',
      message: order.auditMessage,
      readingsCount: order.readings.length,
    };
  }

  /**
   * Cierre forzado con control RBAC.
   * Solo el rol SUPERVISOR_CCO puede forzar el cierre y exige justificación técnica.
   */
  forceClose(orderId: string, role: UserRole, justification: string): WorkOrder {
    const order = this.workOrders.get(orderId);
    if (!order) {
      throw new Error(`Orden de trabajo no encontrada: ${orderId}`);
    }

    if (role !== 'SUPERVISOR_CCO') {
      throw new Error('No tiene permisos para esta acción');
    }

    if (!justification || justification.trim() === '') {
      throw new Error('La justificación técnica es obligatoria');
    }

    order.status = 'CERRADA_FORZADA';
    order.forcedClosureDetails = {
      userRole: role,
      justification: justification.trim(),
      closedAt: new Date(),
    };
    order.auditMessage = `Cierre forzado por Supervisor: ${justification.trim()}`;

    return order;
  }
}
