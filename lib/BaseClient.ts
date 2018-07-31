import Logger, { ContextLogger } from './Logger';

enum ClientStatus {
  DISABLED,
  CONNECTION_VERIFIED,
}

abstract class BaseClient {
  protected logger: Logger;
  protected status!: ClientStatus;

  constructor(logger: ContextLogger) {
    this.logger = logger.global;
  }

  protected setStatus(val: ClientStatus): void {
    this.logger.info(`${this.constructor.name} status: ${ClientStatus[val]}`);
    this.status = val;
  }

  public isDisabled(): boolean {
    return this.status === ClientStatus.DISABLED;
  }
}

export default BaseClient;
export { ClientStatus };
