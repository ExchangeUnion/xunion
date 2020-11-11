import assert from 'assert';
import { EventEmitter } from 'events';
import Config from '../Config';
import ConnextClient from '../connextclient/ConnextClient';
import { SwapClientType } from '../constants/enums';
import { Models } from '../db/DB';
import lndErrors from '../lndclient/errors';
import LndClient from '../lndclient/LndClient';
import { LndInfo } from '../lndclient/types';
import { Level, Loggers } from '../Logger';
import NodeKey from '../nodekey/NodeKey';
import { Currency, OwnLimitOrder } from '../orderbook/types';
import Peer from '../p2p/Peer';
import { UnitConverter } from '../utils/UnitConverter';
import errors from './errors';
import SwapClient, { ClientStatus } from './SwapClient';
import { TradingLimits } from './types';

export function isConnextClient(swapClient: SwapClient): swapClient is ConnextClient {
  return (swapClient.type === SwapClientType.Connext);
}

export function isLndClient(swapClient: SwapClient): swapClient is LndClient {
  return (swapClient.type === SwapClientType.Lnd);
}

type LndUpdate = {
  currency: string,
  pubKey: string,
  chain?: string,
  uris?: string[],
};

interface SwapClientManager {
  on(event: 'lndUpdate', listener: (lndUpdate: LndUpdate) => void): this;
  on(event: 'connextUpdate', listener: (tokenAddresses: Map<string, string>, pubKey?: string) => void): this;
  on(event: 'htlcAccepted', listener: (swapClient: SwapClient, rHash: string, amount: number, currency: string) => void): this;
  emit(event: 'lndUpdate', lndUpdate: LndUpdate): boolean;
  emit(event: 'connextUpdate', tokenAddresses: Map<string, string>, pubKey?: string): boolean;
  emit(event: 'htlcAccepted', swapClient: SwapClient, rHash: string, amount: number, currency: string): boolean;
}

class SwapClientManager extends EventEmitter {
  /** A map between currencies and all enabled swap clients */
  public swapClients = new Map<string, SwapClient>();
  public connextClient?: ConnextClient;
  public misconfiguredClients = new Set<SwapClient>();
  private walletPassword?: string;

  /** A map of supported currency tickers to the inbound amount that is reserved by existing orders. */
  private inboundReservedAmounts = new Map<string, number>();
  /** A map of supported currency tickers to the outbound amount that is reserved by existing orders. */
  private outboundReservedAmounts = new Map<string, number>();

  constructor(
    private config: Config,
    private loggers: Loggers,
    private unitConverter: UnitConverter,
  ) {
    super();
  }

  /**
   * Starts all swap clients, binds event listeners
   * and waits for the swap clients to initialize.
   * @returns A promise that resolves upon successful initialization, rejects otherwise.
   */
  public init = async (models: Models): Promise<void> => {
    const initPromises = [];
    // setup configured LND clients and initialize them
    for (const currency in this.config.lnd) {
      const lndConfig = this.config.lnd[currency]!;
      if (!lndConfig.disable) {
        const lndClient = new LndClient({
          currency,
          config: lndConfig,
          logger: this.loggers.lnd.createSubLogger(currency),
        });
        this.swapClients.set(currency, lndClient);
        initPromises.push(lndClient.init());
      }
    }

    if (!this.config.connext.disable) {
      // setup Connext
      const currencyInstances = await models.Currency.findAll();
      this.connextClient = new ConnextClient({
        currencyInstances,
        unitConverter: this.unitConverter,
        config: this.config.connext,
        logger: this.loggers.connext,
      });
    }

    // bind event listeners before all swap clients have initialized
    this.bind();

    await Promise.all(initPromises);

    this.swapClients.forEach((swapClient, currency) => {
      if (swapClient.isDisabled()) {
        // delete any swap clients that are disabled
        this.swapClients.delete(currency);
      } else if (swapClient.isMisconfigured()) {
        // track misconfigured swap clients separately
        this.swapClients.delete(currency);
        this.misconfiguredClients.add(swapClient);
      }
    });

    if (this.connextClient) {
      if (this.connextClient.isMisconfigured()) {
        this.misconfiguredClients.add(this.connextClient);
      } else if (!this.connextClient.isDisabled()) {
        // associate swap clients with currencies managed by connext client
        for (const currency of this.connextClient.tokenAddresses.keys()) {
          this.swapClients.set(currency, this.connextClient);
        }
      }
    }
  }

  /**
   * Initializes Connext client with a seed
   * @returns true if Connext
   */
  public initConnext = async (seed: string) => {
    try {
      if (!this.config.connext.disable && this.connextClient) {
        this.connextClient.setSeed(seed);
        await this.connextClient.init();
        return true;
      }
    } catch (err) {
      this.loggers.connext.error('could not initialize connext', err);
    }
    return false;
  }

  /**
   * Checks to make sure all enabled lnd instances are available and waits
   * up to a short time for them to become available in case they are not.
   * Throws an error if any lnd clients remain unreachable.
   */
  public waitForLnd = async () => {
    const lndAvailablePromises: Promise<void>[] = [];
    for (const lndClient of this.lndClients.values()) {
      lndAvailablePromises.push(new Promise<void>((resolve, reject) => {
        if (lndClient.isDisconnected() || lndClient.isNotInitialized()) {
          const onAvailable = () => {
            clearTimeout(timer);
            lndClient.removeListener('locked', onAvailable);
            lndClient.removeListener('connectionVerified', onAvailable);
            resolve();
          };
          lndClient.on('connectionVerified', onAvailable);
          lndClient.on('locked', onAvailable);
          const timer = setTimeout(() => {
            lndClient.removeListener('connectionVerified', onAvailable);
            lndClient.removeListener('locked', onAvailable);
            reject(lndClient.currency);
          }, SwapClient.RECONNECT_INTERVAL);
        } else {
          resolve();
        }
      }));
    }

    try {
      await Promise.all(lndAvailablePromises);
    } catch (currency) {
      throw lndErrors.UNAVAILABLE(currency, ClientStatus.Disconnected);
    }
  }

  public tradingLimits = async (currency: string): Promise<TradingLimits> => {
    const swapClient = this.get(currency);
    if (swapClient) {
      const swapCapacities = await swapClient.swapCapacities(currency);
      const reservedOutbound = this.outboundReservedAmounts.get(currency) ?? 0;
      const reservedInbound = this.inboundReservedAmounts.get(currency) ?? 0;
      const availableOutboundCapacity = Math.max(0, swapCapacities.totalOutboundCapacity - reservedOutbound);
      const availableInboundCapacity = Math.max(0, swapCapacities.totalInboundCapacity - reservedInbound);

      return {
        reservedSell: reservedOutbound,
        reservedBuy: reservedInbound,
        maxSell: Math.min(swapCapacities.maxOutboundChannelCapacity, availableOutboundCapacity),
        maxBuy: Math.min(swapCapacities.maxInboundChannelCapacity, availableInboundCapacity),
      };
    } else {
      throw errors.SWAP_CLIENT_NOT_FOUND(currency);
    }
  }

  /**
   * Checks whether a given order with would exceed our inbound or outbound swap
   * capacities when taking into consideration reserved amounts for standing
   * orders, throws an exception if so and returns otherwise.
   */
  public checkSwapCapacities = async ({ quantity, price, isBuy, pairId }: OwnLimitOrder) => {
    const { outboundCurrency, inboundCurrency, outboundAmount, inboundAmount } =
      UnitConverter.calculateInboundOutboundAmounts(quantity, price, isBuy, pairId);

    // check if clients exists
    const outboundSwapClient = this.get(outboundCurrency);
    const inboundSwapClient = this.get(inboundCurrency);
    if (!outboundSwapClient) {
      throw errors.SWAP_CLIENT_NOT_FOUND(outboundCurrency);
    }
    if (!inboundSwapClient) {
      throw errors.SWAP_CLIENT_NOT_FOUND(inboundCurrency);
    }

    const outboundCapacities = await outboundSwapClient.swapCapacities(outboundCurrency);

    // check if sufficient outbound channel capacity exists
    const reservedOutbound = this.outboundReservedAmounts.get(outboundCurrency) ?? 0;
    const availableOutboundCapacity = outboundCapacities.totalOutboundCapacity - reservedOutbound;
    if (outboundAmount > availableOutboundCapacity) {
      throw errors.INSUFFICIENT_OUTBOUND_CAPACITY(outboundCurrency, outboundAmount, availableOutboundCapacity);
    }

    // check if sufficient inbound channel capacity exists
    if (isConnextClient(inboundSwapClient)) {
      // connext has the unique ability to dynamically request additional inbound capacity aka collateral
      // we handle it differently and allow "lazy collateralization" if the total inbound capacity would
      // be exceeded when including the reserved inbound amounts, we only reject if this order alone would
      // exceed our inbound capacity
      inboundSwapClient.checkInboundCapacity(inboundAmount, inboundCurrency);
    } else {
      const inboundCapacities = await inboundSwapClient.swapCapacities(inboundCurrency);
      const reservedInbound = this.inboundReservedAmounts.get(inboundCurrency) ?? 0;
      const availableInboundCapacity = inboundCapacities.totalInboundCapacity - reservedInbound;
      if (inboundAmount > availableInboundCapacity) {
        throw errors.INSUFFICIENT_INBOUND_CAPACITY(outboundCurrency, outboundAmount, availableOutboundCapacity);
      }
    }
  }

  public getOutboundReservedAmount = (currency: string) => {
    return this.outboundReservedAmounts.get(currency);
  }

  public getInboundReservedAmount = (currency: string) => {
    return this.inboundReservedAmounts.get(currency);
  }

  public addOutboundReservedAmount = (currency: string, amount: number) => {
    const outboundReservedAmount = this.outboundReservedAmounts.get(currency);
    const newOutboundReservedAmount = (outboundReservedAmount ?? 0) + amount;
    this.outboundReservedAmounts.set(currency, newOutboundReservedAmount);
  }

  public addInboundReservedAmount = (currency: string, amount: number) => {
    const inboundReservedAmount = this.inboundReservedAmounts.get(currency);
    const newInboundReservedAmount = (inboundReservedAmount ?? 0) + amount;
    this.inboundReservedAmounts.set(currency, newInboundReservedAmount);

    this.swapClients.get(currency)?.setReservedInboundAmount(newInboundReservedAmount, currency);
  }

  public subtractOutboundReservedAmount = (currency: string, amount: number) => {
    const outboundReservedAmount = this.outboundReservedAmounts.get(currency);
    assert(outboundReservedAmount && outboundReservedAmount >= amount);
    this.outboundReservedAmounts.set(currency, outboundReservedAmount - amount);
  }

  public subtractInboundReservedAmount = (currency: string, amount: number) => {
    const inboundReservedAmount = this.inboundReservedAmounts.get(currency);
    assert(inboundReservedAmount && inboundReservedAmount >= amount);
    this.inboundReservedAmounts.set(currency, inboundReservedAmount - amount);
  }

  public setLogLevel = (level: Level) => {
    for (const client of this.swapClients.values()) {
      client.logger.setLogLevel(level);
    }
  }

  /**
   * Initializes wallets with seed and password.
   */
  public initWallets = async ({ walletPassword, seedMnemonic, restore, lndBackups, nodeKey }: {
    walletPassword: string,
    seedMnemonic: string[],
    restore?: boolean,
    lndBackups?: Map<string, Uint8Array>,
    nodeKey: NodeKey,
  }) => {
    this.walletPassword = walletPassword;

    // loop through swap clients to initialize locked lnd clients
    const initWalletPromises: Promise<any>[] = [];
    const initializedLndWallets: string[] = [];
    let initializedConnext = false;

    for (const swapClient of this.swapClients.values()) {
      if (isLndClient(swapClient)) {
        if (swapClient.isWaitingUnlock()) {
          const initWalletPromise = swapClient.initWallet(
            walletPassword,
            seedMnemonic,
            restore,
            lndBackups ? lndBackups.get(swapClient.currency) : undefined,
          ).then(() => {
            initializedLndWallets.push(swapClient.currency);
          }).catch((err) => {
            swapClient.logger.error('could not initialize lnd wallet', err.message);
            throw errors.SWAP_CLIENT_WALLET_NOT_CREATED(`could not initialize lnd-${swapClient.currency}: ${err.message}`);
          });
          initWalletPromises.push(initWalletPromise);
        }
      } else if (isConnextClient(swapClient)) {
        initializedConnext = await this.initConnext(
          nodeKey.childSeed(SwapClientType.Connext),
        );
      }
    }

    await Promise.all(initWalletPromises);

    return {
      initializedLndWallets,
      initializedConnext,
    };
  }

  /**
   * Unlocks wallets with a password.
   * @returns an array of currencies for each lnd client that was unlocked
   */
  public unlockWallets = async ({ walletPassword, nodeKey }: {
    walletPassword: string,
    nodeKey: NodeKey,
    connextSeed: string,
  }) => {
    this.walletPassword = walletPassword;

    // loop through swap clients to find locked lnd clients
    const unlockWalletPromises: Promise<any>[] = [];
    const unlockedLndClients: string[] = [];
    const lockedLndClients: string[] = [];
    let connextReady = false;

    for (const lndClient of this.lndClients.values()) {
      if (lndClient.isWaitingUnlock()) {
        const unlockWalletPromise = lndClient.unlockWallet(walletPassword).then(() => {
          unlockedLndClients.push(lndClient.currency);
        }).catch((err) => {
          lockedLndClients.push(lndClient.currency);
          lndClient.logger.debug(`could not unlock wallet: ${err.message}`);
        });
        unlockWalletPromises.push(unlockWalletPromise);
      } else if (lndClient.isConnected()) {
        // if the swap client is already unlocked, we add it to the list
        unlockedLndClients.push(lndClient.currency);
      } else if (lndClient.isDisconnected() || lndClient.isMisconfigured() || lndClient.isNotInitialized()) {
        // if the swap client is not connected, we treat it as locked since lnd will likely be locked when it comes online
        lockedLndClients.push(lndClient.currency);
      }
    }

    if (this.connextClient) {
      await this.initConnext(
        nodeKey.childSeed(SwapClientType.Connext),
      );
      if (this.connextClient.isConnected()) {
        connextReady = true;
      }
    }

    await Promise.all(unlockWalletPromises);

    return { unlockedLndClients, lockedLndClients, connextReady };
  }

  /**
   * Gets a swap client instance.
   * @param currency a currency that the swap client is linked to.
   * @returns swap client instance upon success, undefined otherwise.
   */
  public get = (currency: string): SwapClient | undefined => {
    return this.swapClients.get(currency);
  }

  /**
   * Returns whether the swap client manager has a client for a given currency.
   * @param currency the currency that the swap client is linked to.
   * @returns `true` if a swap client exists, false otherwise.
   */
  public has = (currency: string): boolean => {
    return this.swapClients.has(currency);
  }

  /** Gets the type of swap client for a given currency. */
  public getType = (currency: string) => {
    return this.swapClients.get(currency)?.type;
  }
  /**
   * Returns whether the swap client for a specified currency is connected.
   * @returns `true` if a swap client exists and is connected, otherwise `false`
   */
  public isConnected = (currency: string) => {
    const swapClient = this.swapClients.get(currency);
    return swapClient !== undefined && swapClient.isConnected();
  }

  /**
   * Adds a new swap client and currency association.
   * @param currency a currency that should be linked with a swap client.
   * @returns Nothing upon success, throws otherwise.
   */
  public add = async (currency: Currency) => {
    if (currency.tokenAddress) {
      if (currency.swapClient === SwapClientType.Connext) {
        if (!this.connextClient) {
          throw errors.SWAP_CLIENT_NOT_CONFIGURED(currency.id);
        }
        this.swapClients.set(currency.id, this.connextClient);
        this.connextClient.tokenAddresses.set(currency.id, currency.tokenAddress);
        this.emit('connextUpdate', this.connextClient.tokenAddresses);
      }
    } else if (currency.swapClient === SwapClientType.Lnd) {
      // in case of lnd we check if the configuration includes swap client
      // for the specified currency
      const config = this.config.lnd[currency.id];
      if (!config) {
        throw errors.SWAP_CLIENT_NOT_CONFIGURED(currency.id);
      }
    }
  }

  /**
   * Removes a new swap client and currency association.
   * @param currency a currency that should be unlinked from a swap client.
   * @returns Nothing upon success, throws otherwise.
   */
  public remove = (currency: string): void => {
    const swapClient = this.get(currency);
    this.swapClients.delete(currency);
    if (swapClient && isConnextClient(swapClient)) {
      this.connextClient?.tokenAddresses.delete(currency);
    }
  }

  /**
   * Gets a map of all lnd clients.
   * @returns A map of currencies to lnd clients.
   */
  public get lndClients() {
    const lndClients: Map<string, LndClient> = new Map();
    this.swapClients.forEach((swapClient, currency) => {
      if (isLndClient(swapClient)) {
        lndClients.set(currency, swapClient);
      }
    });
    return lndClients;
  }

  /**
   * Gets all lnd clients' info.
   * @returns A promise that resolves to an object containing lnd
   * clients' info, throws otherwise.
   */
  public getLndClientsInfo = async () => {
    const lndInfos = new Map<string, LndInfo>();
    // TODO: consider maintaining this list of pubkeys
    // (similar to how we're maintaining the list of connext currencies)
    // rather than determining it dynamically when needed. The benefits
    // would be slightly improved performance.
    const getInfoPromises: Promise<void>[] = [];
    for (const [currency, swapClient] of this.swapClients.entries()) {
      if (isLndClient(swapClient) && !swapClient.isDisabled()) {
        getInfoPromises.push(swapClient.getLndInfo().then((lndInfo) => {
          lndInfos.set(currency, lndInfo);
        }));
      }
    }
    await Promise.all(getInfoPromises);
    return lndInfos;
  }

  /**
   * Closes all swap client instances gracefully.
   * @returns Nothing upon success, throws otherwise.
   */
  public close = (): void => {
    let connextClosed = false;
    for (const swapClient of this.swapClients.values()) {
      swapClient.close();
      if (isConnextClient(swapClient)) {
        connextClosed = true;
      }
    }
    for (const swapClient of this.misconfiguredClients) {
      swapClient.close();
      if (isConnextClient(swapClient)) {
        connextClosed = true;
      }
    }

    // we make sure to close connext client because it
    // might not be associated with any currency
    if (this.connextClient && !this.connextClient.isDisabled() && !connextClosed) {
      this.connextClient.close();
    }
  }

  public deposit = async (currency: string) => {
    const swapClient = this.get(currency);
    if (!swapClient) {
      throw errors.SWAP_CLIENT_NOT_FOUND(currency);
    }

    const address = await swapClient.deposit();
    return address;
  }

  public withdraw = async ({ currency, amount, destination, all, fee }: {
    currency: string,
    destination: string,
    amount?: number,
    all?: boolean,
    fee?: number,
  }) => {
    const swapClient = this.get(currency);
    if (!swapClient) {
      throw errors.SWAP_CLIENT_NOT_FOUND(currency);
    }

    return await swapClient.withdraw({ currency, amount, destination, all, fee });
  }

  /**
   * Closes a payment channel.
   * @param remoteIdentifier the identifier for the remote side of the channel.
   * @param currency a currency for the payment channel.
   * @param amount the amount to extract from the channel. If 0 or unspecified,
   * the entire off-chain balance for the specified currency will be extracted.
   * @returns Nothing upon success, throws otherwise.
   */
  public closeChannel = async (
    { remoteIdentifier, currency, force, destination, amount, fee }:
    { remoteIdentifier?: string, currency: string, force: boolean, destination?: string, amount?: number, fee?: number },
  ): Promise<string[]> => {
    const swapClient = this.get(currency);
    if (!swapClient) {
      throw errors.SWAP_CLIENT_NOT_FOUND(currency);
    }
    const units = amount ? this.unitConverter.amountToUnits({
      amount,
      currency,
    }) : undefined;

    return swapClient.closeChannel({
      remoteIdentifier,
      currency,
      force,
      destination,
      units,
      fee,
    });
  }

  /**
   * Opens a payment channel.
   * @param remoteIdentifier the identifier for the remote side of the channel.
   * @param currency a currency for the payment channel.
   * @param amount the size of the payment channel local balance
   * @returns Nothing upon success, throws otherwise.
   */
  public openChannel = async (
    { remoteIdentifier, amount, currency, pushAmount = 0, fee = 0, uris }:
    { remoteIdentifier?: string, amount: number, currency: string, pushAmount?: number, fee?: number, uris?: string[] },
  ): Promise<string> => {
    const swapClient = this.get(currency);
    if (!swapClient) {
      throw errors.SWAP_CLIENT_NOT_FOUND(currency);
    }
    const units = this.unitConverter.amountToUnits({
      amount,
      currency,
    });
    const pushUnits = this.unitConverter.amountToUnits({
      currency,
      amount: pushAmount,
    });

    return swapClient.openChannel({
      remoteIdentifier,
      currency,
      units,
      uris,
      pushUnits,
      fee,
    });
  }

  /**
   * Checks whether it is possible to route a payment to a peer for a given currency. This does not
   * guarantee or test that a payment can be routed successfully, only determiens whether it is
   * possible to do so currently given the state of the specified currency's network and graph.
   */
  public canRouteToPeer = async (peer: Peer, currency: string) => {
    const swapClient = this.get(currency);
    if (!swapClient) {
      return false;
    }
    const destination = peer.getIdentifier(swapClient.type, currency);
    if (!destination) {
      return false;
    }

    let canRoute: boolean;
    try {
      canRoute = await swapClient.canRouteToNode(destination, currency);
    } catch {
      canRoute = false; // if swap client calls are failing, we infer that we can't route payments
    }
    return canRoute;
  }

  private bind = () => {
    for (const [currency, swapClient] of this.swapClients.entries()) {
      if (isLndClient(swapClient)) {
        swapClient.on('connectionVerified', ({ newIdentifier, newUris }) => {
          if (newIdentifier) {
            this.emit('lndUpdate', {
              currency,
              uris: newUris,
              pubKey: newIdentifier,
              chain: swapClient.chain,
            });
          }
        });
        // lnd clients emit htlcAccepted evented we must handle
        swapClient.on('htlcAccepted', (rHash, amount) => {
          this.emit('htlcAccepted', swapClient, rHash, amount, currency);
        });
        swapClient.on('locked', () => {
          if (this.walletPassword) {
            swapClient.unlockWallet(this.walletPassword).catch(swapClient.logger.error);
          }
          // TODO(connext): unlock ConnextClient when it's implemented
        });
      }
    }
    // we handle connext separately because we don't want to attach
    // duplicate listeners in case connext client is associated with
    // multiple currencies
    if (this.connextClient && !this.connextClient.isDisabled() && !this.connextClient.isMisconfigured()) {
      this.connextClient.on('htlcAccepted', (rHash, amount, currency) => {
        this.emit('htlcAccepted', this.connextClient!, rHash, amount, currency);
      });
      this.connextClient.on('connectionVerified', (swapClientInfo) => {
        const { newIdentifier } = swapClientInfo;
        if (newIdentifier) {
          this.emit(
            'connextUpdate',
            this.connextClient!.tokenAddresses,
            newIdentifier,
          );
        }
      });
    }
  }

}

export default SwapClientManager;
