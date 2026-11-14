export class NoAvailableStaffException extends Error {
  constructor() {
    super('No hay cuadrillas disponibles');
    this.name = 'NoAvailableStaffException';
  }
}

 