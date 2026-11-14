export type UserRole = 'SUPERVISOR_CCO' | 'OPERADOR_CCO' | 'TECNICO_CAMPO';

export type WorkOrderStatus =
  | 'PENDIENTE'
  | 'ASIGNADA'
  | 'EN_INTERVENCION'
  | 'EN_AUDITORIA'
  | 'CERRADA_CONFORME'
  | 'CERRADA_FORZADA';

export interface AuditReading {
  pressure: number;
  timestamp: string | Date;
  minute?: string | undefined;
}

export interface ForcedClosureDetails {
  userRole: UserRole;
  justification: string;
  closedAt: Date;
}

export interface WorkOrder {
  id: string;
  deviceId: string;
  assignedCrewId?: string | undefined;
  status: WorkOrderStatus;
  auditStartTime?: Date | undefined;
  readings: AuditReading[];
  auditMessage?: string | undefined;
  forcedClosureDetails?: ForcedClosureDetails | undefined;
}

export interface AuditResult {
  success: boolean;
  status: WorkOrderStatus;
  message?: string | undefined;
  readingsCount: number;
}
