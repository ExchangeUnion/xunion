import { sha256 } from '@ethersproject/solidity';
import assert from 'assert';
import http from 'http';
import { combineLatest, defer, from, fromEvent, interval, Observable, of, Subscription, throwError, timer } from 'rxjs';
import { catchError, distinctUntilChanged, filter, mergeMap, mergeMapTo, pluck, take, timeout } from 'rxjs/operators';
import { SwapClientType, SwapRole, SwapState } from '../constants/enums';
import { CurrencyInstance } from '../db/types';
import Logger from '../Logger';
import swapErrors from '../swaps/errors';
import SwapClient, {
  ChannelBalance,
  ClientStatus,
  PaymentState,
  PaymentStatus,
  SwapClientInfo,
  WalletBalance,
  WithdrawArguments,
} from '../swaps/SwapClient';
import { CloseChannelParams, OpenChannelParams, SwapCapacities, SwapDeal } from '../swaps/types';
import { XudError } from '../types';
import { UnitConverter } from '../utils/UnitConverter';
import { parseResponseBody } from '../utils/utils';
import errors, { errorCodes } from './errors';
import { EthProvider, getEthprovider } from './ethprovider';
import {
  ConnextBlockNumberResponse,
  ConnextChannelBalanceResponse,
  ConnextChannelDetails,
  ConnextChannelResponse,
  ConnextClientConfig,
  ConnextConfig,
  ConnextConfigResponse,
  ConnextErrorResponse,
  ConnextInfo,
  ConnextTransfer,
  ConnextTransferRequest,
  ConnextTransferResponse,
  ConnextWithdrawResponse,
  EthproviderGasPriceResponse,
  ExpectedIncomingTransfer,
  GetBlockByNumberResponse,
  ProvidePreimageEvent,
  TransferReceivedEvent,
} from './types';

interface ConnextClient {
  on(event: 'preimage', listener: (preimageRequest: ProvidePreimageEvent) => void): void;
  on(event: 'transferReceived', listener: (transferReceivedRequest: TransferReceivedEvent) => void): void;
  on(event: 'htlcAccepted', listener: (rHash: string, units: bigint, currency: string) => void): this;
  on(event: 'connectionVerified', listener: (swapClientInfo: SwapClientInfo) => void): this;
  on(event: 'depositConfirmed', listener: (hash: string) => void): this;
  once(event: 'initialized', listener: () => void): this;
  emit(event: 'htlcAccepted', rHash: string, units: bigint, currency: string): boolean;
  emit(event: 'connectionVerified', swapClientInfo: SwapClientInfo): boolean;
  emit(event: 'initialized'): boolean;
  emit(event: 'preimage', preimageRequest: ProvidePreimageEvent): void;
  emit(event: 'transferReceived', transferReceivedRequest: TransferReceivedEvent): void;
  emit(event: 'depositConfirmed', hash: string): void;
}

const getRouterNodeIdentifier = (network: string): string => {
  switch (network) {
    case 'regtest':
    case 'simnet':
      // public key of our simnet router node
      return 'vector5yw6vEx4VJPWMC4Vf48WSfY4bzgfJxAt4EGGFGT1o1mmQnRz35';
    case 'testnet':
      // public key of our testnet router node
      return 'vector5ZGTZ1izRvvM73c5Rt1cMK34SdPVGLccMdc72v2B2HBmcTXRiD';
    case 'mainnet':
      throw new Error('mainnet router node has not been created, yet');
    default:
      throw errors.NOT_FOUND;
  }
};

/**
 * Waits for the preimage event from SwapClient for a specified hash
 * @param client the swap client instance to listen events from
 * @param expectedHash the expected hash of the payment
 * @param errorTimeout optional maximum duration of time to wait for the preimage
 */
const waitForPreimageByHash = (client: SwapClient, expectedHash: string, errorTimeout = 89000): Promise<string> => {
  // create an observable that emits values when a preimage
  // event is triggered on the client
  const preimage$: Observable<ProvidePreimageEvent> = fromEvent(client, 'preimage');
  const expectedPreimageReceived$ = preimage$.pipe(
    // filter out events that do not match our expected hash
    filter((preimageEvent) => preimageEvent.rHash === expectedHash),
    // map the ProvidePreimageEvent object to a string as the consumer is
    // only interested in the value of the preimage
    pluck('preimage'),
    // complete the observable and clean up all the listeners
    // once we receive 1 event that matches our conditions
    take(1),
    // emit an error if the observable does not emit any values
    // for the specified duration
    timeout(errorTimeout),
  );
  // convert the observable to a promise that resolves on complete
  // and rejects on error
  return expectedPreimageReceived$.toPromise();
};

const transferReceived = (
  client: SwapClient,
  expectedTransfer: ExpectedIncomingTransfer,
): Observable<[ExpectedIncomingTransfer, TransferReceivedEvent]> => {
  const transferReceived$: Observable<TransferReceivedEvent> = fromEvent(client, 'transferReceived');
  return combineLatest(of(expectedTransfer), transferReceived$).pipe(
    // filter out events that do not match our expected hash
    filter(([expectedTransfer, receivedTransfer]) => expectedTransfer.rHash === receivedTransfer.rHash),
    take(1),
  );
};

const CHAIN_IDENTIFIERS: { [key: string]: number } = {
  regtest: 1337,
  simnet: 1337,
  // Rinkeby
  testnet: 4,
  mainnet: 1,
};

const AVERAGE_ETH_BLOCK_TIME_SECONDS = 15;
const ONE_SECOND_IN_MS = 1000;

/**
 * A class representing a client to interact with connext.
 */
class ConnextClient extends SwapClient {
  public get minutesPerBlock() {
    return 0.25; // 15 seconds per block target
  }

  public get label() {
    return 'Connext';
  }
  public readonly type = SwapClientType.Connext;
  public readonly finalLock = 200;
  public address?: string;
  /** A map of currency symbols to token addresses. */
  public tokenAddresses = new Map<string, string>();
  /** Public identifier for Connext */
  public publicIdentifier: string | undefined;
  /** On-chain deposit address */
  public signerAddress: string | undefined;
  private ethProvider: EthProvider | undefined;
  /** The set of hashes for outgoing transfers. */
  private outgoingTransferHashes = new Set<string>();
  private port: number;
  private host: string;
  private webhookport: number;
  private webhookhost: string;
  private unitConverter: UnitConverter;
  private network: string;
  private seed: string | undefined;
  private readonly CHANNEL_ON_CHAIN_DISPUTE_TIMEOUT = (60 * 60 * 24 * 14).toString(); // 14 days
  /** A map of currencies to promises representing balance requests. */
  private getBalancePromises = new Map<string, Promise<ConnextChannelBalanceResponse>>();
  /** A map of currencies to promises representing collateral requests. */
  private requestCollateralPromises = new Map<string, Promise<any>>();
  private outboundAmounts = new Map<string, number>();
  private inboundAmounts = new Map<string, number>();
  private _reconcileDepositSubscriptions: Subscription[] = [];

  /** Channel multisig address */
  private channelAddress: string | undefined;

  private pendingRequests = new Set<http.ClientRequest>();
  private criticalRequestPaths = ['/hashlock-resolve', '/hashlock-transfer'];

  /** The minimum incremental quantity that we may use for collateral requests. */
  private static MIN_COLLATERAL_REQUEST_SIZES: {
    [key: string]: number | undefined;
  } = {
    ETH: 0.1 * 10 ** 8,
    USDT: 100 * 10 ** 8,
    DAI: 100 * 10 ** 8,
  };

  /**
   * Creates a connext client.
   */
  constructor({
    config,
    logger,
    unitConverter,
    currencyInstances,
    network,
  }: {
    unitConverter: UnitConverter;
    config: ConnextClientConfig;
    currencyInstances: CurrencyInstance[];
    logger: Logger;
    network: string;
  }) {
    super(logger, config.disable);

    this.port = config.port;
    this.host = config.host;
    this.webhookhost = config.webhookhost;
    this.webhookport = config.webhookport;
    this.unitConverter = unitConverter;
    this.setTokenAddresses(currencyInstances);
    this.network = network;
  }

  public initSpecific = async () => {};

  // TODO: Ideally, this would be set in the constructor.
  // Related issue: https://github.com/ExchangeUnion/xud/issues/1494
  public setSeed = (seed: string) => {
    this.seed = seed;
    this.ethProvider = getEthprovider(this.host, this.port, this.network, CHAIN_IDENTIFIERS[this.network], this.seed);
  };

  public initConnextClient = async (seedMnemonic: string) => {
    const res = await this.sendRequest('/connect', 'POST', { mnemonic: seedMnemonic });
    return parseResponseBody<ConnextConfigResponse>(res);
  };

  private subscribeIncomingTransfer = async () => {
    await this.sendRequest('/event/subscribe', 'POST', {
      publicIdentifier: this.publicIdentifier,
      events: { CONDITIONAL_TRANSFER_CREATED: `http://${this.webhookhost}:${this.webhookport}/incoming-transfer` },
    });
  };

  private subscribePreimage = async () => {
    await this.sendRequest('/event/subscribe', 'POST', {
      publicIdentifier: this.publicIdentifier,
      events: { CONDITIONAL_TRANSFER_RESOLVED: `http://${this.webhookhost}:${this.webhookport}/preimage` },
    });
  };

  /**
   * Associate connext with currencies that have a token address
   */
  private setTokenAddresses = (currencyInstances: CurrencyInstance[]) => {
    currencyInstances.forEach((currency) => {
      if (currency.tokenAddress && currency.swapClient === SwapClientType.Connext) {
        this.tokenAddresses.set(currency.id, currency.tokenAddress);
      }
    });
  };

  /**
   * Checks whether we have a pending collateral request for the currency and,
   * if one doesn't exist, starts a new request for the specified amount. Then
   * calls channelBalance to refresh the inbound capacity for the currency.
   */
  private requestCollateralInBackground = (currency: string, units: bigint) => {
    // first check whether we already have a pending collateral request for this currency
    // if not start a new request, and when it completes call channelBalance to refresh our inbound capacity
    const requestCollateralPromise =
      this.requestCollateralPromises.get(currency) ??
      this.sendRequest('/request-collateral', 'POST', {
        channelAddress: this.channelAddress,
        assetId: this.tokenAddresses.get(currency),
        amount: units.toString(),
        publicIdentifier: this.publicIdentifier,
      })
        .then(() => {
          this.requestCollateralPromises.delete(currency);
          this.logger.debug(`completed collateral request of ${units} ${currency} units`);
          return this.channelBalance(currency);
        })
        .catch((err) => {
          this.requestCollateralPromises.delete(currency);
          this.logger.error(err);
        });
    this.requestCollateralPromises.set(currency, requestCollateralPromise);
  };

  /**
   * Checks whether there is sufficient inbound capacity to receive the specified amount
   * and throws an error if there isn't, otherwise does nothing.
   */
  public checkInboundCapacity = (inboundAmount: number, currency: string) => {
    const inboundCapacity = this.inboundAmounts.get(currency) || 0;
    if (inboundCapacity < inboundAmount) {
      // we do not have enough inbound capacity to receive the specified inbound amount so we must request collateral
      this.logger.debug(
        `collateral of ${inboundCapacity} for ${currency} is insufficient for order amount ${inboundAmount}`,
      );

      // we want to make a request for the current collateral plus the greater of any
      // minimum request size for the currency or the capacity shortage + 5% buffer
      const quantityToRequest =
        inboundCapacity +
        Math.max(inboundAmount * 1.05 - inboundCapacity, ConnextClient.MIN_COLLATERAL_REQUEST_SIZES[currency] ?? 0);
      const unitsToRequest = this.unitConverter.amountToUnits({
        currency,
        amount: quantityToRequest,
      });
      this.requestCollateralInBackground(currency, unitsToRequest);

      throw errors.INSUFFICIENT_COLLATERAL;
    }
  };

  public setReservedInboundAmount = (reservedInboundAmount: number, currency: string) => {
    const inboundCapacity = this.inboundAmounts.get(currency) || 0;
    if (inboundCapacity < reservedInboundAmount) {
      // we do not have enough inbound capacity to fill all open orders, so we will request more
      this.logger.debug(
        `collateral of ${inboundCapacity} for ${currency} is insufficient for reserved order amount of ${reservedInboundAmount}`,
      );

      // we want to make a request for the current collateral plus the greater of any
      // minimum request size for the currency or the capacity shortage + 3% buffer
      const quantityToRequest =
        inboundCapacity +
        Math.max(
          reservedInboundAmount * 1.03 - inboundCapacity,
          ConnextClient.MIN_COLLATERAL_REQUEST_SIZES[currency] ?? 0,
        );
      const unitsToRequest = this.unitConverter.amountToUnits({
        currency,
        amount: quantityToRequest,
      });

      // we don't await this request - instead we allow for "lazy collateralization" to complete since
      // we don't expect all orders to be filled at once, we can be patient
      this.requestCollateralInBackground(currency, unitsToRequest);
    }
  };

  protected updateCapacity = async () => {
    try {
      const channelBalancePromises = [];
      for (const currency of this.tokenAddresses.keys()) {
        channelBalancePromises.push(this.channelBalance(currency));
      }
      await Promise.all(channelBalancePromises);
    } catch (e) {
      this.logger.error('failed to update total outbound capacity', e);
    }
  };

  protected getTokenAddress(currency: string): string {
    const tokenAdress = this.tokenAddresses.get(currency);
    if (!tokenAdress) {
      throw errors.NOT_FOUND;
    }
    return tokenAdress;
  }

  protected getCurrencyByTokenaddress(tokenAddress: string): string {
    let currency;
    for (const [key, value] of this.tokenAddresses.entries()) {
      if (value === tokenAddress) {
        currency = key;
      }
    }
    if (!currency) {
      throw errors.CURRENCY_NOT_FOUND_BY_TOKENADDRESS(tokenAddress);
    }
    return currency;
  }

  protected verifyConnection = async () => {
    this.logger.info('trying to verify connection to connext');
    try {
      if (!this.seed) {
        throw errors.MISSING_SEED;
      }
      await this.createNode(this.seed);
      const config = await this.getClientConfig();
      const { publicIdentifier, signerAddress } = config;
      this.publicIdentifier = publicIdentifier;
      this.signerAddress = signerAddress;
      const channel = await this.getChannel();
      this.channelAddress = channel;
      await this.subscribeIncomingTransfer();
      await this.subscribePreimage();
      this.emit('connectionVerified', { newIdentifier: publicIdentifier });
      this.setStatus(ClientStatus.ConnectionVerified);
      this.reconcileDeposit();
    } catch (err) {
      this.logger.error(
        `could not verify connection to connext, retrying in ${ConnextClient.RECONNECT_INTERVAL} ms`,
        err,
      );
      await this.disconnect();
    }
  };

  private reconcileDeposit = () => {
    this._reconcileDepositSubscriptions.forEach((subscription) => subscription.unsubscribe());
    const getBalance$ = (assetId: string, pollInterval: number) => {
      return interval(pollInterval).pipe(
        mergeMap(() => from(this.getBalanceForAddress(assetId, this.channelAddress))),
        // only emit new balance events when the balance changes
        distinctUntilChanged(),
      );
    };
    const reconcileForAsset = (assetId: string, balance$: ReturnType<typeof getBalance$>) => {
      return (
        balance$
          // when balance changes
          .pipe(
            mergeMap(() => {
              if (this.status === ClientStatus.ConnectionVerified) {
                // create new commitment transaction
                return from(
                  this.sendRequest('/deposit', 'POST', {
                    channelAddress: this.channelAddress,
                    publicIdentifier: this.publicIdentifier,
                    assetId,
                  }),
                );
              }
              return throwError('stopping deposit calls because client is no longer connected');
            }),
          )
      );
    };
    this.tokenAddresses.forEach((assetId) => {
      const subscription = reconcileForAsset(assetId, getBalance$(assetId, 30000)).subscribe({
        next: () => {
          this.logger.trace(`deposit successfully reconciled for ${this.getCurrencyByTokenaddress(assetId)}`);
        },
        error: (e) => {
          this.logger.trace(
            `stopped ${this.getCurrencyByTokenaddress(assetId)} deposit calls because: ${JSON.stringify(e)}`,
          );
        },
      });
      this._reconcileDepositSubscriptions.push(subscription);
    });
  };

  public sendSmallestAmount = async () => {
    throw new Error('Connext.sendSmallestAmount is not implemented');
  };

  private getExpiry = async (locktime: number): Promise<string> => {
    const blockHeight = await this.getHeight();
    const currentBlock = await this.getBlockByNumber(blockHeight);
    const currentTimeStamp = parseInt(currentBlock.result.timestamp, 16);
    const locktimeMilliseconds = AVERAGE_ETH_BLOCK_TIME_SECONDS * locktime * ONE_SECOND_IN_MS;
    const expiry = currentTimeStamp + locktimeMilliseconds;
    return expiry.toString();
  };

  private deriveRoutingId = (lockHash: string, assetId: string): string => {
    return sha256(['address', 'bytes32'], [assetId, `0x${lockHash}`]);
  };

  public sendPayment = async (deal: SwapDeal): Promise<string> => {
    assert(deal.state === SwapState.Active);
    assert(deal.destination);
    assert(this.channelAddress, 'cannot send transfer without channel address');
    assert(this.publicIdentifier, 'cannot send transfer with channel address');
    let amount: string;
    let tokenAddress: string;
    try {
      let secret;
      if (deal.role === SwapRole.Maker) {
        // we are the maker paying the taker
        amount = deal.takerUnits.toString();
        tokenAddress = this.tokenAddresses.get(deal.takerCurrency)!;
        const expiry = await this.getExpiry(this.finalLock);
        const executeTransfer = this.executeHashLockTransfer({
          amount,
          type: 'HashlockTransfer',
          assetId: tokenAddress,
          details: {
            expiry,
            lockHash: `0x${deal.rHash}`,
          },
          recipient: deal.destination,
          meta: { routingId: this.deriveRoutingId(deal.rHash, tokenAddress) },
          channelAddress: this.channelAddress,
          publicIdentifier: this.publicIdentifier,
        });
        // @ts-ignore
        const [executeTransferResponse, preimage] = await Promise.all([
          executeTransfer,
          waitForPreimageByHash(this, deal.rHash),
        ]);
        this.logger.debug(`received preimage ${preimage} for payment with hash ${deal.rHash}`);
        secret = preimage;
      } else {
        // we are the taker paying the maker
        amount = deal.makerUnits.toString();
        tokenAddress = this.tokenAddresses.get(deal.makerCurrency)!;
        secret = deal.rPreimage!;
        assert(deal.makerCltvDelta, 'cannot send transfer without deal.makerCltvDelta');
        const expiry = await this.getExpiry(deal.makerCltvDelta);
        const executeTransfer = this.executeHashLockTransfer({
          amount,
          type: 'HashlockTransfer',
          assetId: tokenAddress,
          details: {
            expiry,
            lockHash: `0x${deal.rHash}`,
          },
          recipient: deal.destination,
          meta: { routingId: this.deriveRoutingId(deal.rHash, tokenAddress) },
          channelAddress: this.channelAddress,
          publicIdentifier: this.publicIdentifier,
        });
        await executeTransfer;
      }
      return secret;
    } catch (err) {
      switch (err.code) {
        case 'ECONNRESET':
        case errorCodes.UNEXPECTED:
        case errorCodes.TIMEOUT:
        case errorCodes.SERVER_ERROR:
        case errorCodes.INVALID_TOKEN_PAYMENT_RESPONSE:
        default:
          throw swapErrors.UNKNOWN_PAYMENT_ERROR(err.message);
      }
    }
  };

  public addInvoice = async ({
    rHash: expectedHash,
    units: expectedUnits,
    expiry: expectedTimelock,
    currency: expectedCurrency,
  }: {
    rHash: string;
    units: bigint;
    expiry?: number;
    currency?: string;
  }) => {
    if (!expectedCurrency) {
      throw errors.CURRENCY_MISSING;
    }
    if (!expectedTimelock) {
      throw errors.EXPIRY_MISSING;
    }
    const expectedTokenAddress = this.getTokenAddress(expectedCurrency);
    const expectedIncomingTransfer: ExpectedIncomingTransfer = {
      rHash: expectedHash,
      units: expectedUnits,
      expiry: expectedTimelock,
      tokenAddress: expectedTokenAddress,
      routingId: this.deriveRoutingId(expectedHash, expectedTokenAddress),
    };
    transferReceived(this, expectedIncomingTransfer).subscribe(
      async ([expectedIncomingTransfer, transferReceivedRequest]) => {
        const { tokenAddress, units, expiry, rHash, routingId } = transferReceivedRequest;
        const {
          units: expectedUnits,
          expiry: expectedTimelock,
          tokenAddress: expectedTokenAddress,
        } = expectedIncomingTransfer;
        const currency = this.getCurrencyByTokenaddress(tokenAddress);
        const blockHeight = await this.getHeight();
        const block = await this.getBlockByNumber(blockHeight);
        const currentTime = parseInt(block.result.timestamp, 16);
        // The timelock can be up to 10 blocks less than the agreed upon value
        const TIMELOCK_BUFFER = 10;
        // We calculate the timelock from current timestamp to the expiry
        const TIME_DIFF_IN_MS = expiry - currentTime;
        const timelock = TIME_DIFF_IN_MS / ONE_SECOND_IN_MS / AVERAGE_ETH_BLOCK_TIME_SECONDS;

        if (
          tokenAddress === expectedTokenAddress &&
          units === expectedUnits &&
          timelock >= expectedTimelock - TIMELOCK_BUFFER
        ) {
          this.logger.debug(
            `accepting incoming transfer with rHash: ${rHash}, units: ${units}, timelock ${timelock.toFixed(
              0,
            )}, currency ${currency}, and routingId ${routingId}`,
          );
          this.emit('htlcAccepted', rHash, units, currency);
        } else {
          if (tokenAddress !== expectedTokenAddress) {
            this.logger.warn(
              `incoming transfer for rHash ${rHash} with token address ${tokenAddress} does not match expected ${expectedTokenAddress}`,
            );
          }
          if (units !== expectedUnits) {
            this.logger.warn(
              `incoming transfer for rHash ${rHash} with value ${units} does not match expected ${expectedUnits}`,
            );
          }
          if (timelock >= expectedTimelock) {
            this.logger.warn(
              `incoming transfer for rHash ${rHash} with time lock ${timelock} is not greater than or equal to ${
                expectedTimelock - TIMELOCK_BUFFER
              }`,
            );
          }
        }
      },
    );

    return undefined;
  };

  private getTransferByRoutingId = async (routingId: string): Promise<ConnextTransfer> => {
    const res = await this.sendRequest(`/${this.publicIdentifier}/transfers/routing-id/${routingId}`, 'GET');
    const transfers = await parseResponseBody<ConnextTransfer[]>(res);
    if (transfers.length !== 1) {
      throw new Error(`could not find transfer by routing id ${routingId}`);
    }
    return transfers[0];
  };

  /**
   * Resolves a HashLock Transfer on the Connext network.
   */
  public settleInvoice = async (rHash: string, rPreimage: string, currency: string) => {
    this.logger.debug(`settling ${currency} invoice for ${rHash} with preimage ${rPreimage}`);
    const assetId = this.getTokenAddress(currency);
    const routingId = this.deriveRoutingId(rHash, assetId);
    const lockHash = `0x${rHash}`;
    const pendingTransfer = await this.getTransferByRoutingId(routingId);
    const { transferId } = pendingTransfer;
    await this.sendRequest('/transfers/resolve', 'POST', {
      transferId,
      routingId,
      conditionType: 'HashlockTransfer',
      details: { lockHash },
      transferResolver: { preImage: `0x${rPreimage}` },
      publicIdentifier: this.publicIdentifier,
      channelAddress: this.channelAddress,
    });
  };

  public removeInvoice = async (rHash: string) => {
    try {
      const assetId = this.getTokenAddress('ETH'); // TODO: make it work for multi currency
      const transfer = await this.getHashLockStatus(rHash, assetId);
      await this.sendRequest('/transfers/resolve', 'POST', {
        transferId: transfer.transferId,
        conditionType: 'HashlockTransfer',
        details: { lockHash: transfer.transferState.lockHash },
        transferResolver: { preImage: '0x0000000000000000000000000000000000000000000000000000000000000000' },
        publicIdentifier: this.publicIdentifier,
        channelAddress: this.channelAddress,
        routingId: transfer.meta.routingId,
      });
      this.logger.debug(`canceled transfer with rHash ${rHash}`);
    } catch (e) {
      if (e === errors.NOT_FOUND) {
        this.logger.debug(`canceled transfer with rHash ${rHash}`);
        return;
      }
      throw e;
    }
  };

  private async getHashLockStatus(lockHash: string, assetId: string) {
    const res = await this.sendRequest(
      `/${this.publicIdentifier}/channels/${this.channelAddress}/transfers/routing-id/${this.deriveRoutingId(
        lockHash,
        assetId,
      )}`,
      'GET',
    );
    const transferStatusResponse = await parseResponseBody<ConnextTransfer>(res);
    return transferStatusResponse;
  }

  public lookupPayment = async (rHash: string, currency: string): Promise<PaymentStatus> => {
    try {
      const assetId = this.getTokenAddress(currency);
      const transferStatusResponse = await this.getHashLockStatus(rHash, assetId);
      const currentBlockHeight = await this.getHeight();
      const expiry = parseInt(transferStatusResponse.transferState.expiry, 10);

      const getStatusFromStatusResponse = (currentHeight: number, transfer: ConnextTransfer): string => {
        const preimage = transfer.transferResolver?.preImage;
        const HASH_ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';
        if (preimage && preimage === HASH_ZERO) {
          return 'FAILED';
        }
        if (preimage) {
          return 'COMPLETED';
        }
        if (expiry > 0 && currentHeight >= expiry) {
          return 'EXPIRED';
        }
        return 'PENDING';
      };
      const transferStatus = getStatusFromStatusResponse(currentBlockHeight, transferStatusResponse);

      this.logger.trace(`hashlock status for connext transfer with hash ${rHash} is ${transferStatus}`);
      switch (transferStatus) {
        case 'PENDING':
          return { state: PaymentState.Pending };
        case 'COMPLETED':
          assert(
            transferStatusResponse.transferResolver?.preImage,
            'Cannot mark payment as COMPLETED without preimage',
          );
          return {
            state: PaymentState.Succeeded,
            preimage: transferStatusResponse.transferResolver.preImage.slice(2),
          };
        case 'EXPIRED': {
          const expiredTransferUnlocked$ = defer(() =>
            from(
              // when the connext transfer (HTLC) expires the funds are not automatically returned to the channel balance
              // in order to unlock the funds we'll need to settle the invoice without a preimage
              this.settleInvoice(rHash, '', currency),
            ),
          ).pipe(
            catchError((e, caught) => {
              const RETRY_INTERVAL = 30000;
              this.logger.error(
                `failed to unlock an expired connext transfer with rHash: ${rHash} - retrying in ${RETRY_INTERVAL}ms`,
                e,
              );
              return timer(RETRY_INTERVAL).pipe(mergeMapTo(caught));
            }),
            take(1),
          );
          expiredTransferUnlocked$.subscribe({
            complete: () => {
              this.logger.debug(`successfully unlocked an expired connext transfer with rHash: ${rHash}`);
            },
          });
          // TODO: user funds can remain locked if the above code fails and xud is restarted. In that case the transfer
          // is marked as failed and it will not attempt to unlock again.
          return { state: PaymentState.Failed };
        }
        case 'FAILED':
          return { state: PaymentState.Failed };
        default:
          return { state: PaymentState.Pending };
      }
    } catch (err) {
      if (err.code === errorCodes.NOT_FOUND) {
        this.logger.trace(`hashlock status for connext transfer with hash ${rHash} not found`);
        return { state: PaymentState.Failed };
      }
      this.logger.error(`could not lookup connext transfer for ${rHash}`, err);
      return { state: PaymentState.Pending }; // return pending if we hit an error
    }
  };

  public getRoute = async () => {
    /** A placeholder route value that assumes a fixed lock time of 100 for Connext. */
    const currentHeight = await this.getHeight();
    return { getTotalTimeLock: () => currentHeight + 101 };
  };

  public canRouteToNode = async () => {
    return true;
  };

  private getBlockByNumber = async (blockNumber: number) => {
    const res = await this.sendRequest(`/ethprovider/${CHAIN_IDENTIFIERS[this.network]}`, 'POST', {
      method: 'eth_getBlockByNumber',
      params: [`0x${blockNumber.toString(16)}`, false],
    });
    const block = await parseResponseBody<GetBlockByNumberResponse>(res);
    return block;
  };

  public getHeight = async () => {
    const res = await this.sendRequest(`/ethprovider/${CHAIN_IDENTIFIERS[this.network]}`, 'POST', {
      method: 'eth_blockNumber',
      params: [],
    });
    const blockNumberResponse = await parseResponseBody<ConnextBlockNumberResponse>(res);
    return parseInt(blockNumberResponse.result, 16);
  };

  /*
   * Returns the current price per gas in gwei.
   * This is a median based on the value used in recent blocks.
   */
  private getGasPrice = async () => {
    const res = await this.sendRequest(`/ethprovider/${CHAIN_IDENTIFIERS[this.network]}`, 'POST', {
      method: 'eth_gasPrice',
      params: [],
    });
    const gasPriceresponse = await parseResponseBody<EthproviderGasPriceResponse>(res);
    const weiGasPrice = parseInt(gasPriceresponse.result, 16);
    const gweiGasPrice = (weiGasPrice / 10 ** 9).toLocaleString('fullwide', { useGrouping: false });
    return gweiGasPrice;
  };

  /**
   * Returns the on-chain balance for a given assetId and address.
   * Address defaults to signer address.
   */
  private getBalanceForAddress = async (assetId: string, address?: string) => {
    assert(this.ethProvider, 'Cannot get balance without ethProvider');
    if (assetId === this.tokenAddresses.get('ETH')) {
      const ethBalance$ = address ? this.ethProvider.getEthBalanceByAddress(address) : this.ethProvider.getEthBalance();
      return BigInt(await ethBalance$.toPromise());
    } else {
      const contract = this.ethProvider.getContract(assetId);
      const erc20balance$ = address
        ? this.ethProvider.getERC20BalanceByAddress(address, contract)
        : this.ethProvider.getERC20Balance(contract);
      return BigInt(await erc20balance$.toPromise());
    }
  };

  public getInfo = async (): Promise<ConnextInfo> => {
    let address: string | undefined;
    let version: string | undefined;
    let status: string;
    if (this.isDisabled()) {
      status = errors.CONNEXT_IS_DISABLED.message;
    } else if (this.isConnected()) {
      status = 'Ready';
      version = 'TODO: Not exposed, yet';
      address = this.channelAddress || 'Waiting for channel';
    } else {
      status = ClientStatus[this.status];
    }

    return { status, address, version };
  };

  /**
   * Creates connext node
   */
  private createNode = async (mnemonic: string): Promise<void> => {
    await this.sendRequest('/node', 'POST', {
      mnemonic,
      index: 0,
    });
  };

  /**
   * Gets the configuration of Connext client.
   */
  private getClientConfig = async (): Promise<ConnextConfig> => {
    const res = await this.sendRequest('/config', 'GET');
    const clientConfig = await parseResponseBody<ConnextConfigResponse>(res);
    return clientConfig[0];
  };

  private getChannel = async (): Promise<string> => {
    const res = await this.sendRequest(`/${this.publicIdentifier}/channels`, 'GET');
    const channel = await parseResponseBody<ConnextChannelResponse>(res);
    if (channel.length === 0) {
      await this.sendRequest('/setup', 'POST', {
        counterpartyIdentifier: getRouterNodeIdentifier(this.network),
        publicIdentifier: this.publicIdentifier,
        chainId: CHAIN_IDENTIFIERS[this.network],
        timeout: this.CHANNEL_ON_CHAIN_DISPUTE_TIMEOUT,
      });
      return this.getChannel();
    }
    return channel[0];
  };

  public channelBalance = async (currency?: string): Promise<ChannelBalance> => {
    if (!currency) {
      return { balance: 0, pendingOpenBalance: 0, inactiveBalance: 0 };
    }

    const { freeBalanceOffChain, nodeFreeBalanceOffChain } = await this.getBalance(currency);

    const freeBalanceAmount = this.unitConverter.unitsToAmount({
      currency,
      units: BigInt(freeBalanceOffChain),
    });

    const nodeFreeBalanceAmount = this.unitConverter.unitsToAmount({
      currency,
      units: BigInt(nodeFreeBalanceOffChain),
    });

    this.outboundAmounts.set(currency, freeBalanceAmount);
    if (nodeFreeBalanceAmount !== this.inboundAmounts.get(currency)) {
      this.inboundAmounts.set(currency, nodeFreeBalanceAmount);
      this.logger.debug(`new inbound capacity (collateral) for ${currency} of ${nodeFreeBalanceAmount}`);
    }

    return {
      balance: freeBalanceAmount,
      inactiveBalance: 0,
      pendingOpenBalance: 0,
    };
  };

  public swapCapacities = async (currency: string): Promise<SwapCapacities> => {
    await this.channelBalance(currency); // refreshes the balances
    const outboundAmount = this.outboundAmounts.get(currency) ?? 0;
    const inboundAmount = this.inboundAmounts.get(currency) ?? 0;
    return {
      maxOutboundChannelCapacity: outboundAmount,
      maxInboundChannelCapacity: inboundAmount,
      totalOutboundCapacity: outboundAmount,
      totalInboundCapacity: inboundAmount,
    };
  };

  /**
   * Returns the balances available in wallet for a specified currency.
   */
  public walletBalance = async (currency?: string): Promise<WalletBalance> => {
    if (!currency) {
      return {
        totalBalance: 0,
        confirmedBalance: 0,
        unconfirmedBalance: 0,
      };
    }

    const { freeBalanceOnChain } = await this.getBalance(currency);

    const confirmedBalanceAmount = this.unitConverter.unitsToAmount({
      currency,
      units: BigInt(freeBalanceOnChain),
    });

    return {
      totalBalance: confirmedBalanceAmount,
      confirmedBalance: confirmedBalanceAmount,
      unconfirmedBalance: 0,
    };
  };

  private getBalance = (currency: string): Promise<ConnextChannelBalanceResponse> => {
    // check if we already have a balance request that we are waiting a response for
    // it's not helpful to have simultaneous requests for the current balance, as they
    // should return the same info.
    let getBalancePromise = this.getBalancePromises.get(currency);
    if (!getBalancePromise) {
      // if not make a new balance request and store the promise that's waiting for a response
      const tokenAddress = this.getTokenAddress(currency);
      getBalancePromise = Promise.all([
        this.sendRequest(`/${this.publicIdentifier}/channels/${this.channelAddress}`, 'GET'),
        this.getBalanceForAddress(tokenAddress),
      ])
        .then(async ([channelDetailsRes, onChainBalance]) => {
          const channelDetails = await parseResponseBody<ConnextChannelDetails>(channelDetailsRes);
          const assetIdIndex = channelDetails.assetIds.indexOf(tokenAddress);
          if (assetIdIndex === -1) {
            const response = ({
              freeBalanceOffChain: 0,
              nodeFreeBalanceOffChain: 0,
              freeBalanceOnChain: onChainBalance,
            } as unknown) as ConnextChannelBalanceResponse;
            return response;
          } else {
            const inboundBalance = channelDetails.balances[assetIdIndex].amount[0];
            const balance = channelDetails.balances[assetIdIndex].amount[1];
            const response = ({
              freeBalanceOffChain: balance,
              nodeFreeBalanceOffChain: inboundBalance,
              freeBalanceOnChain: onChainBalance,
            } as unknown) as ConnextChannelBalanceResponse;
            return response;
          }
        })
        .finally(() => {
          this.getBalancePromises.delete(currency); // clear the stored promise
        });
      this.getBalancePromises.set(currency, getBalancePromise);
    }
    return getBalancePromise;
  };

  // Returns on-chain deposit address
  public walletDeposit = async () => {
    if (this.signerAddress) {
      return this.signerAddress;
    }
    throw new Error('Could not get signer address');
  };

  // Returns channel deposit address
  public deposit = async () => {
    if (this.channelAddress) {
      return this.channelAddress;
    }
    throw new Error('Could not get channel address');
  };

  public openChannel = async (_params: OpenChannelParams) => {
    throw new Error(
      `Open channel command is disabled for Connext currencies. Please send funds directly to the channel address ${this.channelAddress} in order to open a channel.`,
    );
  };

  public closeChannel = async ({ units, currency, destination }: CloseChannelParams): Promise<string[]> => {
    if (!currency) {
      throw errors.CURRENCY_MISSING;
    }
    if (!destination) {
      throw errors.WITHDRAW_ADDRESS_MISSING;
    }
    const { freeBalanceOffChain } = await this.getBalance(currency);
    const availableUnits = Number(freeBalanceOffChain);
    if (units && availableUnits < units) {
      throw errors.INSUFFICIENT_BALANCE;
    }
    const amount = units || freeBalanceOffChain;

    if (Number(amount) === 0) {
      return []; // there is nothing to withdraw and no tx to return
    }

    const gasPriceGwei = await this.getGasPrice();
    const withdrawResponse = await this.sendRequest('/withdraw', 'POST', {
      publicIdentifier: this.publicIdentifier,
      channelAddress: this.channelAddress,
      amount: amount.toString(),
      assetId: this.tokenAddresses.get(currency),
      recipient: destination,
      fee: gasPriceGwei,
    });

    const { transferId } = await parseResponseBody<ConnextWithdrawResponse>(withdrawResponse);
    return [transferId];
  };

  /**
   * Create a HashLock Transfer on the Connext network.
   * @param targetAddress recipient of the payment
   * @param tokenAddress contract address of the token
   * @param amount
   * @param lockHash
   */
  private executeHashLockTransfer = async (payload: ConnextTransferRequest): Promise<ConnextTransferResponse> => {
    const { lockHash } = payload.details;
    this.logger.debug(`sending payment of ${payload.amount} with hash ${lockHash} to ${payload.recipient}`);
    this.outgoingTransferHashes.add(lockHash);
    const res = await this.sendRequest('/transfers/create', 'POST', payload);
    const transferResponse = await parseResponseBody<ConnextTransferResponse>(res);
    return transferResponse;
  };

  // Withdraw on-chain funds
  public withdraw = async ({ all, currency, amount, destination, fee }: WithdrawArguments): Promise<string> => {
    assert(this.ethProvider, 'cannot send transaction without ethProvider');

    if (fee) {
      // TODO: allow overwriting gas price
      throw Error('setting fee for Ethereum withdrawals is not supported yet');
    }

    let unitsStr: string;

    const { freeBalanceOnChain } = await this.getBalance(currency);

    if (all) {
      if (currency === 'ETH') {
        // TODO: query Ether balance, subtract gas price times 21000 (gas usage of transferring Ether), and set that as amount
        throw new Error('withdrawing all ETH is not supported yet');
      }
      unitsStr = freeBalanceOnChain;
    } else if (amount) {
      const units = this.unitConverter.amountToUnits({
        currency,
        amount,
      });
      if (Number(freeBalanceOnChain) < units) {
        throw errors.INSUFFICIENT_BALANCE;
      }
      unitsStr = units.toString();
    } else {
      throw new Error('either all must be true or amount must be non-zero');
    }

    const sendTransaction$ = this.ethProvider.onChainTransfer(this.getTokenAddress(currency), destination, unitsStr);
    const transaction = await sendTransaction$.toPromise();
    this.logger.info(`on-chain transfer sent, transaction hash: ${transaction.hash}`);
    return transaction.hash;
  };

  /** Connext client specific cleanup. */
  protected disconnect = async () => {
    this._reconcileDepositSubscriptions.forEach((subscription) => subscription.unsubscribe());
    this.setStatus(ClientStatus.Disconnected);

    for (const req of this.pendingRequests) {
      if (this.criticalRequestPaths.includes(req.path)) {
        this.logger.warn(`critical request is pending: ${req.path}`);
      } else {
        this.logger.info(`aborting pending request: ${req.path}`);
        req.destroy();
      }
    }
  };

  /**
   * Sends a request to the Connext REST API.
   * @param endpoint the URL endpoint
   * @param method an HTTP request method
   * @param payload the request payload
   */
  private sendRequest = (endpoint: string, method: string, payload?: object): Promise<http.IncomingMessage> => {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        method,
        hostname: this.host,
        port: this.port,
        path: `${endpoint}`,
      };

      let payloadStr: string | undefined;
      if (payload) {
        payloadStr = JSON.stringify(payload);
        options.headers = {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadStr),
        };
      }

      this.logger.trace(`sending request to ${endpoint}${payloadStr ? `: ${payloadStr}` : ''}`);

      let req: http.ClientRequest;
      // eslint-disable-next-line prefer-const
      req = http.request(options, async (res) => {
        this.pendingRequests.delete(req);

        let err: XudError | undefined;
        let body;
        switch (res.statusCode) {
          case 200:
          case 201:
          case 204:
            resolve(res);
            break;
          case 400:
            body = await parseResponseBody<ConnextErrorResponse>(res);
            this.logger.error(`400 status error: ${JSON.stringify(body)}`);
            reject(body);
            break;
          case 402:
            err = errors.INSUFFICIENT_BALANCE;
            break;
          case 404:
            err = errors.NOT_FOUND;
            break;
          case 408:
            err = errors.TIMEOUT;
            break;
          case 409:
            body = await parseResponseBody<ConnextErrorResponse>(res);
            this.logger.error(`409 status error: ${JSON.stringify(body)}`);
            reject(body);
            break;
          case 500:
            err = errors.SERVER_ERROR(res.statusCode, res.statusMessage);
            break;
          default:
            err = errors.UNEXPECTED(res.statusCode!, res.statusMessage);
            break;
        }
        if (err) {
          this.logger.error(`received ${res.statusCode} response from ${endpoint}: ${err.message}`);
          reject(err);
        }
      });

      req.on('error', async (err: any) => {
        this.pendingRequests.delete(req);
        if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
          await this.disconnect();
        }
        this.logger.error(err);
        reject(err);
      });

      if (payloadStr) {
        req.write(payloadStr);
      }

      req.end();
      this.pendingRequests.add(req);
    });
  };
}

export default ConnextClient;
