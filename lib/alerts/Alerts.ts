import { EventEmitter } from 'events';
import { satsToCoinsStr } from '../cli/utils';
import { AlertType, ChannelSide } from '../constants/enums';
import Logger from '../Logger';
import SwapClientManager from '../swaps/SwapClientManager';
import { Alert, BalanceAlertEvent } from './types';

interface Alerts {
  on(event: 'alert', listener: (alert: Alert) => void): this;
  emit(event: 'alert', alert: Alert): boolean;
}

// TODO this class still requires a cleanup if alert is not being thrown anymore after a while
/**
 * This class works as a middleware for thrown alerts from xud's main flow. Each alert will be caught here
 * and re-thrown if last thrown time was before the minimum threshold that set in consts.ts
 */
class Alerts extends EventEmitter {
  /** The minimum time in miliseconds to be passed to rethrow a balance alert. */
  private static readonly MIN_BALANCE_ALERT_THRESHOLD_IN_MS = 10000;
  private alerts = new Map<string, number>();
  private logger: Logger;

  constructor({ swapClientManager, logger }: { swapClientManager: SwapClientManager; logger: Logger }) {
    super();
    this.logger = logger;
    this.listenLowTradingBalanceAlerts(swapClientManager);
  }

  private listenLowTradingBalanceAlerts(swapClientManager: SwapClientManager) {
    const lndClients = swapClientManager.getLndClientsMap().values();
    for (const lndClient of lndClients) {
      lndClient.on('lowTradingBalance', this.onLowTradingBalance);
    }
    swapClientManager.connextClient?.on('lowTradingBalance', this.onLowTradingBalance);
  }

  private onLowTradingBalance = (balanceAlertEvent: BalanceAlertEvent) => {
    // TODO don't use JSON.stringify instead find a way to define unique ids per alert and keep in the map to avoid memory issues
    const stringRepresentation = JSON.stringify(balanceAlertEvent);
    this.logger.trace(`received low trading balance alert ${stringRepresentation}`);
    if (this.alerts.get(stringRepresentation) === undefined || this.checkAlertThreshold(stringRepresentation)) {
      this.logger.trace(`triggering low balance alert ${stringRepresentation}`);

      const message = `${ChannelSide[balanceAlertEvent.side || 0]} trading balance (${satsToCoinsStr(
        balanceAlertEvent.sideBalance || 0,
      )} ${balanceAlertEvent.currency}) is lower than 10% of trading capacity (${satsToCoinsStr(
        balanceAlertEvent.totalBalance || 0,
      )} ${balanceAlertEvent.currency})`;

      const balanceAlert = {
        ...balanceAlertEvent,
        message,
        type: AlertType.LowTradingBalance,
        date: Date.now(),
      };

      this.alerts.set(stringRepresentation, balanceAlert.date);
      this.emit('alert', balanceAlert);
    }
  };

  private checkAlertThreshold(stringRepresentation: string) {
    const lastThrownTime = this.alerts.get(stringRepresentation) || 0;
    const passedTime = Date.now() - lastThrownTime;
    return passedTime > Alerts.MIN_BALANCE_ALERT_THRESHOLD_IN_MS;
  }
}

export default Alerts;
