import assert from 'assert';
import crypto from 'crypto';
import { promises as fs, watch } from 'fs';
import grpc, { ChannelCredentials, ClientReadableStream } from 'grpc';
import path from 'path';
import { SwapClientType, SwapRole, SwapState } from '../constants/enums';
import Logger from '../Logger';
import { InvoicesClient } from '../proto/lndinvoices_grpc_pb';
import * as lndinvoices from '../proto/lndinvoices_pb';
import { RouterClient } from '../proto/lndrouter_grpc_pb';
import * as lndrouter from '../proto/lndrouter_pb';
import { LightningClient } from '../proto/lndrpc_grpc_pb';
import * as lndrpc from '../proto/lndrpc_pb';
import { WalletUnlockerClient } from '../proto/lndwalletunlocker_grpc_pb';
import * as lndwalletunlocker from '../proto/lndwalletunlocker_pb';
import { BASE_MAX_CLIENT_WAIT_TIME, MAX_FEE_RATIO, MAX_PAYMENT_TIME } from '../swaps/consts';
import swapErrors from '../swaps/errors';
import SwapClient, {
  ChannelBalance,
  ClientStatus,
  PaymentState,
  SwapClientInfo,
  WithdrawArguments,
} from '../swaps/SwapClient';
import { CloseChannelParams, OpenChannelParams, SwapCapacities, SwapDeal } from '../swaps/types';
import { deriveChild } from '../utils/seedutil';
import { base64ToHex, hexToUint8Array } from '../utils/utils';
import errors from './errors';
import { Chain, ChannelCount, ClientMethods, LndClientConfig, LndInfo } from './types';

interface LndClient {
  on(event: 'connectionVerified', listener: (swapClientInfo: SwapClientInfo) => void): this;
  on(event: 'htlcAccepted', listener: (rHash: string, units: bigint) => void): this;
  on(event: 'channelBackup', listener: (channelBackup: Uint8Array) => void): this;
  on(event: 'channelBackupEnd', listener: () => void): this;
  on(event: 'locked', listener: () => void): this;

  once(event: 'initialized', listener: () => void): this;

  emit(event: 'connectionVerified', swapClientInfo: SwapClientInfo): boolean;
  emit(event: 'htlcAccepted', rHash: string, units: bigint): boolean;
  emit(event: 'channelBackup', channelBackup: Uint8Array): boolean;
  emit(event: 'channelBackupEnd'): boolean;
  emit(event: 'locked'): boolean;
  emit(event: 'initialized'): boolean;
}

type ChannelCapacities = {
  totalOutboundAmount: number;
  totalInboundAmount: number;
  balance: number;
  inactiveBalance: number;
  pendingOpenBalance: number;
};

const GRPC_CLIENT_OPTIONS = {
  'grpc.ssl_target_name_override': 'localhost',
  'grpc.default_authority': 'localhost',
};
const LND_FAILURE_REASON_REVERSE_LOOKUP = {
  0: 'NONE',
  1: 'TIMEOUT',
  2: 'NO_ROUTE',
  3: 'ERROR',
  4: 'INCORRECT_PAYMENT_DETAILS',
  5: 'INSUFFICIENT_BALANCE',
};

/** A class representing a client to interact with lnd. */
class LndClient extends SwapClient {
  public readonly type = SwapClientType.Lnd;
  public readonly finalLock: number;
  public config: LndClientConfig;
  public currency: string;
  public walletPassword?: string;
  private lightning?: LightningClient;
  private walletUnlocker?: WalletUnlockerClient;
  /** The maximum time to wait for a client to be ready for making grpc calls, can be used for exponential backoff. */
  private maxClientWaitTime = BASE_MAX_CLIENT_WAIT_TIME;
  private invoices?: InvoicesClient;
  private router?: RouterClient;
  /** The path to the lnd admin macaroon, will be undefined if `nomacaroons` is enabled */
  private macaroonpath?: string;
  private meta = new grpc.Metadata();
  private uri!: string;
  private credentials!: ChannelCredentials;
  /** The identity pub key for this lnd instance. */
  private identityPubKey?: string;
  /** List of client's public listening uris that are advertised to the network */
  private urisList?: string[];
  /** The identifier for the chain this lnd instance is using in the format [chain]-[network] like "bitcoin-testnet" */
  private chainIdentifier?: string;
  private channelBackupSubscription?: ClientReadableStream<lndrpc.ChanBackupSnapshot>;
  private invoiceSubscriptions = new Map<string, ClientReadableStream<lndrpc.Invoice>>();
  private initRetryTimeout?: NodeJS.Timeout;
  private totalOutboundAmount = 0;
  private totalInboundAmount = 0;
  private refreshChannelCapacitiesPromise?: Promise<ChannelCapacities>;

  private initWalletResolve?: (value: boolean) => void;
  private watchMacaroonResolve?: (value: boolean) => void;

  private static MINUTES_PER_BLOCK_BY_CURRENCY: { [key: string]: number } = {
    BTC: 10,
    LTC: 2.5,
  };
  private static MAX_PARTS = 5;

  /**
   * Creates an lnd client.
   */
  constructor({ config, logger, currency }: { config: LndClientConfig; logger: Logger; currency: string }) {
    super(logger, config.disable);
    this.config = config;
    this.currency = currency;
    this.finalLock = config.cltvdelta;
  }

  private waitForClientReady = (client: grpc.Client) => {
    return new Promise((resolve, reject) => {
      client.waitForReady(Date.now() + this.maxClientWaitTime, (err) => {
        if (err) {
          if (err.message === 'Failed to connect before the deadline') {
            this.maxClientWaitTime *= 10; // exponentially backoff the max wait time if we reach the deadline
            resolve();
          }
          reject(err);
        } else {
          this.maxClientWaitTime = BASE_MAX_CLIENT_WAIT_TIME; // reset our max wait time
          resolve();
        }
      });
    });
  };

  public get minutesPerBlock() {
    return LndClient.MINUTES_PER_BLOCK_BY_CURRENCY[this.currency];
  }

  public get label() {
    return `LND-${this.currency}`;
  }

  /**
   * Initializes the client for calls to lnd and verifies that we can connect to it.
   * @param awaitingCreate whether xud is waiting for its node key to be created
   */
  public initSpecific = async () => {
    const { certpath, macaroonpath, nomacaroons, host, port } = this.config;

    let lndCert: Buffer | undefined;
    try {
      lndCert = await fs.readFile(certpath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // if we have not created the lnd wallet yet and the tls.cert file can
        // not be found, we will briefly wait for the cert to be created in
        // case lnd has not been run before and is being started in parallel
        // with xud
        const certDir = path.join(certpath, '..');
        const CERT_TIMEOUT = 3000;

        lndCert = await new Promise((resolve) => {
          this.logger.debug(`watching ${certDir} for tls.cert to be created`);
          const timeout = setTimeout(() => {
            fsWatcher.close();
            resolve(undefined);
          }, CERT_TIMEOUT);
          const fsWatcher = watch(certDir, (event, filename) => {
            if (event === 'change' && filename === 'tls.cert') {
              this.logger.debug('tls.cert was created');
              fsWatcher.close();
              clearTimeout(timeout);
              fs.readFile(certpath)
                .then(resolve)
                .catch((readFileErr) => {
                  this.logger.error(readFileErr);
                  resolve(undefined);
                });
            }
          });
        });
      }
    }
    if (lndCert) {
      this.logger.debug(`loaded tls cert from ${certpath}`);
      this.credentials = grpc.credentials.createSsl(lndCert);
    } else {
      this.logger.error(`could not load tls cert from ${certpath}, is lnd installed?`);
      this.setStatus(ClientStatus.Misconfigured);
      this.initRetryTimeout = setTimeout(this.init, LndClient.RECONNECT_INTERVAL);
      return;
    }

    if (!nomacaroons) {
      this.macaroonpath = macaroonpath;
      try {
        await this.loadMacaroon();
      } catch (err) {
        this.logger.info(`could not load macaroon at ${macaroonpath}, this is normal before creating a new wallet`);
      }
    } else {
      this.logger.info('macaroons are disabled');
    }

    this.uri = `${host}:${port}`;
    if (this.initRetryTimeout) {
      clearTimeout(this.initRetryTimeout);
      this.initRetryTimeout = undefined;
    }
  };

  public get pubKey() {
    return this.identityPubKey;
  }

  public get uris() {
    return this.urisList;
  }

  public get chain() {
    return this.chainIdentifier;
  }

  public setReservedInboundAmount = (_reservedInboundAmount: number) => {
    // not currently used for lnd
  };

  /** Lnd specific procedure to mark the client as locked. */
  private lock = () => {
    if (!this.walletUnlocker) {
      this.walletUnlocker = new WalletUnlockerClient(this.uri, this.credentials, GRPC_CLIENT_OPTIONS);
    }
    if (this.lightning) {
      this.lightning.close();
      this.lightning = undefined;
    }

    if (!this.isWaitingUnlock()) {
      this.setStatus(ClientStatus.WaitingUnlock);
    }

    this.emit('locked');
  };

  /** Lnd specific procedure to mark the client as unlocked. */
  private setUnlocked = () => {
    // we should close and unreference the wallet unlocker service when we set the status to Unlocked
    if (this.walletUnlocker) {
      this.walletUnlocker.close();
      this.walletUnlocker = undefined;
    }

    if (this.isWaitingUnlock()) {
      this.setStatus(ClientStatus.Unlocked);
    } else {
      // we should not be calling this method we were in the WaitingUnlock status
      this.logger.warn(`tried to set client status to WaitingUnlock from status ${this.status}`);
    }
  };

  protected updateCapacity = async () => {
    await this.swapCapacities().catch(async (err) => {
      this.logger.error('failed to update swap amount capacities', err);
    });
  };

  private unaryCall = <T, U>(methodName: Exclude<keyof LightningClient, ClientMethods>, params: T): Promise<U> => {
    return new Promise((resolve, reject) => {
      if (this.hasNoInvoiceSupport()) {
        reject(errors.NO_HOLD_INVOICE_SUPPORT);
        return;
      }
      if (!this.isOperational()) {
        reject(errors.DISABLED);
        return;
      }
      if (!this.lightning) {
        reject(errors.UNAVAILABLE(this.currency, this.status));
        return;
      }
      (this.lightning[methodName] as Function)(params, this.meta, (err: grpc.ServiceError, response: U) => {
        if (err) {
          if (err.code === grpc.status.UNAVAILABLE) {
            this.disconnect();
          } else if (err.code === grpc.status.UNIMPLEMENTED) {
            this.lock();
          }
          this.logger.trace(`error on ${methodName}: ${err.message}`);
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
  };

  private loadMacaroon = async () => {
    if (this.macaroonpath) {
      const adminMacaroon = await fs.readFile(this.macaroonpath);
      this.meta.add('macaroon', adminMacaroon.toString('hex'));
      this.logger.debug(`loaded macaroon from ${this.macaroonpath}`);
    }
  };

  private unaryInvoiceCall = <T, U>(
    methodName: Exclude<keyof InvoicesClient, ClientMethods>,
    params: T,
  ): Promise<U> => {
    return new Promise((resolve, reject) => {
      if (!this.isOperational()) {
        reject(errors.DISABLED);
        return;
      }
      if (!this.invoices) {
        reject(errors.UNAVAILABLE(this.currency, this.status));
        return;
      }
      (this.invoices[methodName] as Function)(params, this.meta, (err: grpc.ServiceError, response: U) => {
        if (err) {
          if (err.code === grpc.status.UNAVAILABLE) {
            this.disconnect();
          } else if (err.code === grpc.status.UNIMPLEMENTED) {
            this.lock();
          }
          this.logger.trace(`error on ${methodName}: ${err.message}`);
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
  };

  private unaryWalletUnlockerCall = <T, U>(
    methodName: Exclude<keyof WalletUnlockerClient, ClientMethods>,
    params: T,
  ): Promise<U> => {
    return new Promise((resolve, reject) => {
      if (!this.isOperational()) {
        reject(errors.DISABLED);
        return;
      }
      if (!this.walletUnlocker) {
        reject(errors.UNAVAILABLE(this.currency, this.status));
        return;
      }
      (this.walletUnlocker[methodName] as Function)(params, this.meta, (err: grpc.ServiceError, response: U) => {
        if (err) {
          if (err.code === grpc.status.UNAVAILABLE) {
            this.disconnect();
          }
          if (err.code === grpc.status.UNIMPLEMENTED) {
            this.logger.debug(`lnd already unlocked before ${methodName} call`);
            resolve();
          } else {
            this.logger.debug(`error on ${methodName}: ${err.message}`);
            reject(err);
          }
        } else {
          resolve(response);
        }
      });
    });
  };

  public getLndInfo = async (): Promise<LndInfo> => {
    let channels: ChannelCount | undefined;
    let chains: Chain[] | undefined;
    let blockheight: number | undefined;
    let uris: string[] | undefined;
    let version: string | undefined;
    let alias: string | undefined;
    let status = 'Ready';
    if (this.hasNoInvoiceSupport()) {
      status = errors.NO_HOLD_INVOICE_SUPPORT(this.currency).message;
    } else if (!this.isOperational()) {
      status = errors.DISABLED(this.currency).message;
    } else if (this.isDisconnected()) {
      status = errors.UNAVAILABLE(this.currency, this.status).message;
    } else {
      try {
        const getInfoResponse = await this.getInfo();
        const closedChannelsResponse = await this.getClosedChannels();
        channels = {
          active: getInfoResponse.getNumActiveChannels(),
          inactive: getInfoResponse.getNumInactiveChannels(),
          pending: getInfoResponse.getNumPendingChannels(),
          closed: closedChannelsResponse.getChannelsList().length,
        };
        chains = getInfoResponse.getChainsList().map((value) => value.toObject());
        blockheight = getInfoResponse.getBlockHeight();
        uris = getInfoResponse.getUrisList();
        version = getInfoResponse.getVersion();
        alias = getInfoResponse.getAlias();

        if (this.isOutOfSync()) {
          status = errors.UNAVAILABLE(this.currency, this.status).message;
        } else if (channels.active <= 0) {
          status = errors.NO_ACTIVE_CHANNELS(this.currency).message;
        }
      } catch (err) {
        this.logger.error('getinfo error', err);
        status = err.message;
      }
    }

    return {
      status,
      channels,
      chains,
      blockheight,
      uris,
      version,
      alias,
    };
  };

  /**
   * Waits for the lnd wallet to be initialized and for its macaroons to be created then attempts
   * to verify the connection to lnd.
   */
  private awaitWalletInit = async () => {
    /**
     * Whether the lnd wallet has been created via an InitWallet call,
     * `false` if we close the client before the lnd wallet is created.
     */
    let isWalletInitialized: boolean;
    if (this.status === ClientStatus.Initialized) {
      // we are waiting for the lnd wallet to be initialized by xud and for the lnd macaroons to be created
      this.logger.info('waiting for wallet to be initialized...');
      this.walletUnlocker = new WalletUnlockerClient(this.uri, this.credentials);
      await this.waitForClientReady(this.walletUnlocker);
      this.lock();

      isWalletInitialized = await new Promise<boolean>((resolve) => {
        this.initWalletResolve = resolve;
      });
    } else if (this.status === ClientStatus.Unlocked) {
      // the lnd wallet has been created but its macaroons have not been written to the file system yet
      isWalletInitialized = true;
    } else {
      assert.fail('awaitWalletInit should not be called from a status besides Initialized or Unlocked');
    }

    if (isWalletInitialized) {
      // admin.macaroon will not necessarily be created by the time lnd responds to a successful
      // InitWallet call, so we watch the folder that we expect it to be in for it to be created
      await this.watchThenLoadMacaroon();

      // once we've loaded the macaroon we can attempt to verify the conneciton
      this.verifyConnection().catch(this.logger.error);
    }
  };

  protected verifyConnection = async () => {
    if (!this.isOperational()) {
      throw errors.DISABLED;
    }
    if (this.isWaitingUnlock()) {
      return; // temporary workaround to prevent unexplained lnd crashes after unlock
    }

    if (this.macaroonpath && this.meta.get('macaroon').length === 0) {
      // we have not loaded the macaroon yet - it is not created until the lnd wallet is initialized
      if (!this.isWaitingUnlock() && !this.initWalletResolve) {
        // check that we are not already waiting for wallet init & unlock
        this.awaitWalletInit().catch(this.logger.error);
      }
      return;
    }

    this.logger.info(`trying to verify connection to lnd at ${this.uri}`);
    this.lightning = new LightningClient(this.uri, this.credentials, GRPC_CLIENT_OPTIONS);

    try {
      await this.waitForClientReady(this.lightning);

      const getInfoResponse = await this.getInfo();
      if (getInfoResponse.getSyncedToChain()) {
        // check if the lnd pub key value is different from the one we had previously.
        let newPubKey: string | undefined;
        let newUris: string[] = [];
        if (this.identityPubKey !== getInfoResponse.getIdentityPubkey()) {
          newPubKey = getInfoResponse.getIdentityPubkey();
          this.logger.debug(`pubkey is ${newPubKey}`);
          this.identityPubKey = newPubKey;
          newUris = getInfoResponse.getUrisList();
          if (newUris.length) {
            this.logger.debug(`uris are ${newUris}`);
          } else {
            this.logger.debug('no uris advertised');
          }
          this.urisList = newUris;
        }

        // check if the chain this lnd instance uses has changed
        const chain = getInfoResponse.getChainsList()[0];
        const chainIdentifier = `${chain.getChain()}-${chain.getNetwork()}`;
        if (!this.chainIdentifier) {
          this.chainIdentifier = chainIdentifier;
          this.logger.debug(`chain is ${chainIdentifier}`);
        } else if (this.chainIdentifier !== chainIdentifier) {
          // we switched chains for this lnd client while xud was running which is not supported
          this.logger.error(`chain switched from ${this.chainIdentifier} to ${chainIdentifier}`);
          this.setStatus(ClientStatus.Misconfigured);
        }

        if (this.walletUnlocker) {
          // WalletUnlocker service is disabled when the main Lightning service is available
          this.walletUnlocker.close();
          this.walletUnlocker = undefined;
        }

        this.invoices = new InvoicesClient(this.uri, this.credentials);
        this.router = new RouterClient(this.uri, this.credentials);
        try {
          const randomHash = crypto.randomBytes(32).toString('hex');
          this.logger.debug(`checking hold invoice support with hash: ${randomHash}`);

          await this.addInvoice({ rHash: randomHash, units: 1n });
          await this.removeInvoice(randomHash);
        } catch (err) {
          if (err.code !== grpc.status.UNAVAILABLE) {
            // mark the client as not having hold invoice support if the invoice calls failed due to
            // reasons other than generic grpc connectivity errors
            this.logger.error('could not add hold invoice', err);
            this.setStatus(ClientStatus.NoHoldInvoiceSupport);
          }
          throw err; // we don't want to proceed with marking the client as connected, regardless of the error
        }

        await this.setConnected(newPubKey, newUris);
      } else {
        this.setStatus(ClientStatus.OutOfSync);
        this.logger.warn(`lnd is out of sync with chain, retrying in ${LndClient.RECONNECT_INTERVAL} ms`);
      }
    } catch (err) {
      const errStr = typeof err === 'string' ? err : JSON.stringify(err);
      this.logger.error(
        `could not verify connection at ${this.uri}, error: ${errStr}, retrying in ${LndClient.RECONNECT_INTERVAL} ms`,
      );
    }
  };

  /**
   * Returns general information concerning the lightning node including it’s identity pubkey, alias, the chains it
   * is connected to, and information concerning the number of open+pending channels.
   */
  public getInfo = (): Promise<lndrpc.GetInfoResponse> => {
    return this.unaryCall<lndrpc.GetInfoRequest, lndrpc.GetInfoResponse>('getInfo', new lndrpc.GetInfoRequest());
  };

  /**
   * Returns closed channels that this node was a participant in.
   */
  public getClosedChannels = (): Promise<lndrpc.ClosedChannelsResponse> => {
    return this.unaryCall<lndrpc.ClosedChannelsRequest, lndrpc.ClosedChannelsResponse>(
      'closedChannels',
      new lndrpc.ClosedChannelsRequest(),
    );
  };

  public walletDeposit = async () => {
    const depositAddress = await this.newAddress();
    return depositAddress;
  };

  public deposit = async () => {
    throw new Error(
      'Depositing directly to channel is not supported. Please use a lightning service provider such as Boltz to create a channel with 1 transaction or deposit to the on-chain wallet first.',
    );
  };

  public withdraw = async ({ amount, destination, all = false, fee }: WithdrawArguments) => {
    const request = new lndrpc.SendCoinsRequest();
    request.setAddr(destination);
    if (fee) {
      request.setSatPerByte(fee);
    }
    if (all) {
      request.setSendAll(all);
    } else if (amount) {
      request.setAmount(amount);
    }
    const withdrawResponse = await this.unaryCall<lndrpc.SendCoinsRequest, lndrpc.SendCoinsResponse>(
      'sendCoins',
      request,
    );
    return withdrawResponse.getTxid();
  };

  public sendSmallestAmount = async (rHash: string, destination: string): Promise<string> => {
    // TODO: as of lnd 0.12.0, this won't work as PaymentAddr will be required and the only way to specify it will be with the pay req
    const request = this.buildSendRequest({
      rHash,
      destination,
      amount: 1,
      // In case of sanity swaps we don't know the
      // takerCltvDelta or the makerCltvDelta. Using our
      // client's default.
      finalCltvDelta: this.finalLock,
    });
    const preimage = await this.sendPaymentV2(request);
    return preimage;
  };

  public sendPayment = async (deal: SwapDeal): Promise<string> => {
    assert(deal.state === SwapState.Active);
    assert(deal.destination, 'swap deal as taker must have a destination');
    let amount: number;
    let finalCltvDelta: number;
    let cltvLimit: number | undefined;

    if (deal.role === SwapRole.Taker) {
      // we are the taker paying the maker
      assert(deal.makerCltvDelta, 'swap deal must have a makerCltvDelta');
      amount = deal.makerAmount;

      // Using the agreed upon makerCltvDelta. Maker won't accept
      // our payment if we provide a smaller value.
      finalCltvDelta = deal.makerCltvDelta;
    } else {
      // we are the maker paying the taker
      assert(deal.takerCltvDelta, 'swap deal as maker must have a takerCltvDelta');
      amount = deal.takerAmount;
      finalCltvDelta = deal.takerCltvDelta;

      // Enforcing the maximum duration/length of the payment by specifying
      // the cltvLimit. We add 3 blocks to offset the block padding set by lnd.
      cltvLimit = deal.takerMaxTimeLock! + 3;
    }
    const request = this.buildSendRequest({
      amount,
      finalCltvDelta,
      cltvLimit,
      destination: deal.destination,
      rHash: deal.rHash,
      payReq: deal.payReq,
    });
    this.logger.debug(`sending payment of ${amount} with hash ${deal.rHash}`);
    const preimage = await this.sendPaymentV2(request);
    return preimage;
  };

  /**
   * Sends a payment through the Lightning Network.
   * @returns the preimage in hex format
   */
  private sendPaymentV2 = (request: lndrouter.SendPaymentRequest): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      if (!this.router) {
        reject(swapErrors.FINAL_PAYMENT_ERROR(errors.UNAVAILABLE(this.currency, this.status).message));
        return;
      }
      if (!this.isConnected()) {
        reject(swapErrors.FINAL_PAYMENT_ERROR(errors.UNAVAILABLE(this.currency, this.status).message));
        return;
      }

      this.logger.trace(`sending payment with request: ${JSON.stringify(request.toObject())}`);

      const call = this.router.sendPaymentV2(request, this.meta);

      call.on('data', (response: lndrpc.Payment) => {
        switch (response.getStatus()) {
          case lndrpc.Payment.PaymentStatus.FAILED:
            switch (response.getFailureReason()) {
              case lndrpc.PaymentFailureReason.FAILURE_REASON_TIMEOUT:
              case lndrpc.PaymentFailureReason.FAILURE_REASON_NO_ROUTE:
              case lndrpc.PaymentFailureReason.FAILURE_REASON_ERROR:
              case lndrpc.PaymentFailureReason.FAILURE_REASON_INSUFFICIENT_BALANCE:
                reject(swapErrors.FINAL_PAYMENT_ERROR(LND_FAILURE_REASON_REVERSE_LOOKUP[response.getFailureReason()]));
                break;
              case lndrpc.PaymentFailureReason.FAILURE_REASON_INCORRECT_PAYMENT_DETAILS:
                reject(swapErrors.PAYMENT_REJECTED);
                break;
              default:
                reject(swapErrors.UNKNOWN_PAYMENT_ERROR(response.getFailureReason().toString()));
                break;
            }
            break;
          case lndrpc.Payment.PaymentStatus.SUCCEEDED:
            resolve(response.getPaymentPreimage());
            break;
          default:
            // in-flight status, we'll wait for a final status update event
            break;
        }
      });

      call.on('end', () => {
        call.removeAllListeners();
      });
      call.on('error', (err) => {
        call.removeAllListeners();
        this.logger.error('error event from sendPaymentV2', err);

        if (typeof err.message === 'string' && err.message.includes('chain backend is still syncing')) {
          reject(swapErrors.FINAL_PAYMENT_ERROR(err.message));
        } else {
          reject(swapErrors.UNKNOWN_PAYMENT_ERROR(JSON.stringify(err)));
        }
      });
    });
  };

  /**
   * Builds a lndrpc.SendRequest
   */
  private buildSendRequest = ({
    rHash,
    destination,
    amount,
    finalCltvDelta,
    cltvLimit,
    payReq,
  }: {
    rHash: string;
    destination: string;
    amount: number;
    finalCltvDelta: number;
    cltvLimit?: number;
    payReq?: string;
  }): lndrouter.SendPaymentRequest => {
    const request = new lndrouter.SendPaymentRequest();
    if (payReq) {
      request.setPaymentRequest(payReq);
      request.setMaxParts(LndClient.MAX_PARTS);
    } else {
      // TODO: as of lnd 0.12.0, this won't work as PaymentAddr will be required and the only way to specify it will be with the pay req
      request.setPaymentHash(Buffer.from(rHash, 'hex'));
      request.setDest(Buffer.from(destination, 'hex'));
      request.setAmt(amount);
      request.setFinalCltvDelta(finalCltvDelta);
      request.setMaxParts(1);
    }

    if (cltvLimit) {
      // cltvLimit is used to enforce the maximum
      // duration/length of the payment.
      request.setCltvLimit(cltvLimit);
    }

    request.setTimeoutSeconds(MAX_PAYMENT_TIME / 1000);

    const fee = Math.floor(MAX_FEE_RATIO * amount);
    request.setFeeLimitSat(fee);

    return request;
  };

  /**
   * Gets a new address for the internal lnd wallet.
   */
  private newAddress = async (addressType = lndrpc.AddressType.WITNESS_PUBKEY_HASH) => {
    const request = new lndrpc.NewAddressRequest();
    request.setType(addressType);
    const newAddressResponse = await this.unaryCall<lndrpc.NewAddressRequest, lndrpc.NewAddressResponse>(
      'newAddress',
      request,
    );
    return newAddressResponse.getAddress();
  };

  /**
   * Returns the total of unspent outputs for the internal lnd wallet.
   */
  public walletBalance = async (): Promise<lndrpc.WalletBalanceResponse.AsObject> => {
    const walletBalanceResponse = await this.unaryCall<lndrpc.WalletBalanceRequest, lndrpc.WalletBalanceResponse>(
      'walletBalance',
      new lndrpc.WalletBalanceRequest(),
    );
    return walletBalanceResponse.toObject();
  };

  /**
   * Updates and returns all capacities & balances related to channels including
   * active, inactive, and pending balances. Sets trading limits for this client accordingly.
   */
  private refreshChannelCapacities = async (): Promise<ChannelCapacities> => {
    // if we already have a pending refresh capacities call, then we reuse that one
    // rather than have multiple or duplicate requests to lnd for channel balance
    // info in parallel
    if (this.refreshChannelCapacitiesPromise) {
      return this.refreshChannelCapacitiesPromise;
    }
    this.updateCapacityTimer?.refresh();

    this.refreshChannelCapacitiesPromise = Promise.all([this.listChannels(), this.pendingChannels()])
      .then(([channels, pendingChannels]) => {
        let balance = 0;
        let inactiveBalance = 0;
        let totalOutboundAmount = 0;
        let totalInboundAmount = 0;
        channels.toObject().channelsList.forEach((channel) => {
          if (channel.active) {
            balance += channel.localBalance;
            const outbound = Math.max(0, channel.localBalance - channel.localChanReserveSat);
            totalOutboundAmount += outbound;

            const inbound = Math.max(0, channel.remoteBalance - channel.remoteChanReserveSat);
            totalInboundAmount += inbound;
          } else {
            inactiveBalance += channel.localBalance;
          }
        });

        if (this.totalOutboundAmount !== totalOutboundAmount) {
          this.totalOutboundAmount = totalOutboundAmount;
          this.logger.debug(`new channel total outbound capacity: ${totalOutboundAmount}`);
        }

        if (this.totalInboundAmount !== totalInboundAmount) {
          this.totalInboundAmount = totalInboundAmount;
          this.logger.debug(`new channel total inbound capacity: ${totalInboundAmount}`);
        }

        const pendingOpenBalance = pendingChannels
          .toObject()
          .pendingOpenChannelsList.reduce(
            (sum, pendingChannel) => sum + (pendingChannel.channel?.localBalance ?? 0),
            0,
          );

        return {
          totalOutboundAmount,
          totalInboundAmount,
          balance,
          inactiveBalance,
          pendingOpenBalance,
        };
      })
      .finally(() => {
        this.refreshChannelCapacitiesPromise = undefined;
      });

    return this.refreshChannelCapacitiesPromise;
  };

  public channelBalance = async (): Promise<ChannelBalance> => {
    const { balance, inactiveBalance, pendingOpenBalance } = await this.refreshChannelCapacities();
    return { balance, inactiveBalance, pendingOpenBalance };
  };

  public swapCapacities = async (): Promise<SwapCapacities> => {
    const { totalInboundAmount, totalOutboundAmount } = await this.refreshChannelCapacities(); // get fresh balances
    return {
      maxOutboundChannelCapacity: totalOutboundAmount,
      maxInboundChannelCapacity: totalInboundAmount,
      totalOutboundCapacity: totalOutboundAmount,
      totalInboundCapacity: totalInboundAmount,
    };
  };

  public getHeight = async () => {
    const info = await this.getInfo();
    return info.getBlockHeight();
  };

  /**
   * Connects to another lnd node.
   */
  public connectPeer = (pubkey: string, address: string): Promise<lndrpc.ConnectPeerResponse> => {
    const request = new lndrpc.ConnectPeerRequest();
    const lightningAddress = new lndrpc.LightningAddress();
    lightningAddress.setHost(address);
    lightningAddress.setPubkey(pubkey);
    request.setAddr(lightningAddress);
    return this.unaryCall<lndrpc.ConnectPeerRequest, lndrpc.ConnectPeerResponse>('connectPeer', request);
  };

  /**
   * Opens a channel given peerPubKey and amount.
   */
  public openChannel = async ({
    remoteIdentifier,
    units,
    uris,
    pushUnits = 0n,
    fee = 0,
  }: OpenChannelParams): Promise<string> => {
    if (!remoteIdentifier) {
      // TODO: better handling for for unrecognized peers & force closing channels
      throw new Error('peer not connected to swap client');
    }
    if (uris) {
      await this.connectPeerAddresses(uris);
    }

    const openResponse = await this.openChannelSync(remoteIdentifier, Number(units), Number(pushUnits), fee);
    return openResponse.hasFundingTxidStr()
      ? openResponse.getFundingTxidStr()
      : base64ToHex(openResponse.getFundingTxidBytes_asB64());
  };

  /**
   * Tries to connect to a given list of a peer's uris in sequential order.
   * @returns `true` when successful, otherwise `false`.
   */
  private connectPeerAddresses = async (peerListeningUris: string[]): Promise<boolean> => {
    const splitListeningUris = peerListeningUris.map((uri) => {
      const splitUri = uri.split('@');
      return {
        peerPubKey: splitUri[0],
        address: splitUri[1],
      };
    });
    for (const uri of splitListeningUris) {
      const { peerPubKey, address } = uri;
      try {
        await this.connectPeer(peerPubKey, address);
        return true;
      } catch (e) {
        if (e.message && e.message.includes('already connected')) {
          return true;
        }
        this.logger.trace(`connectPeer to ${uri} failed: ${e}`);
      }
    }
    return false;
  };

  /**
   * Opens a channel with a connected lnd node.
   */
  private openChannelSync = (
    nodePubkeyString: string,
    localFundingAmount: number,
    pushSat = 0,
    fee = 0,
  ): Promise<lndrpc.ChannelPoint> => {
    const request = new lndrpc.OpenChannelRequest();
    request.setNodePubkeyString(nodePubkeyString);
    request.setLocalFundingAmount(localFundingAmount);
    request.setPushSat(pushSat);
    request.setSatPerByte(fee);
    return this.unaryCall<lndrpc.OpenChannelRequest, lndrpc.ChannelPoint>('openChannelSync', request);
  };

  /**
   * Lists all open channels for this node.
   */
  public listChannels = (): Promise<lndrpc.ListChannelsResponse> => {
    return this.unaryCall<lndrpc.ListChannelsRequest, lndrpc.ListChannelsResponse>(
      'listChannels',
      new lndrpc.ListChannelsRequest(),
    );
  };

  /**
   * Lists all pending channels for this node.
   */
  private pendingChannels = (): Promise<lndrpc.PendingChannelsResponse> => {
    return this.unaryCall<lndrpc.PendingChannelsRequest, lndrpc.PendingChannelsResponse>(
      'pendingChannels',
      new lndrpc.PendingChannelsRequest(),
    );
  };

  public getRoute = async (units: bigint, destination: string, _currency: string, finalLock = this.finalLock) => {
    await this.refreshChannelCapacities();
    if (this.totalOutboundAmount < units) {
      // if we don't have enough balance for this payment, we don't even try to find a route
      throw swapErrors.INSUFFICIENT_BALANCE;
    }

    const request = new lndrpc.QueryRoutesRequest();
    // lnd does not currently support a way to find route(s) using multi path payments
    // since we attempt to use up to multi path payments, we only check if there's any route
    // that can support at least one part of the payment, as well as a check above to ensure
    // we have sufficient balance across all channels to make the payment. This is opposed
    // to attempting to replicate lnd's multi path payment route finding logic here, which
    // would be complex and potentially slow/expensive or even impossible given that we don't
    // have access to the lnd internal database and graph.
    const minPartSize = Number(units) / LndClient.MAX_PARTS;
    request.setAmt(minPartSize);
    request.setFinalCltvDelta(finalLock);
    request.setPubKey(destination);
    const fee = new lndrpc.FeeLimit();
    fee.setFixed(Math.floor(MAX_FEE_RATIO * request.getAmt()));
    request.setFeeLimit(fee);

    let route: lndrpc.Route | undefined;

    try {
      // QueryRoutes no longer returns more than one route
      [route] = (await this.queryRoutes(request)).getRoutesList();
    } catch (err) {
      if (typeof err.message === 'string' && err.message.includes('insufficient local balance')) {
        throw swapErrors.INSUFFICIENT_BALANCE;
      }

      if (
        typeof err.message !== 'string' ||
        (!err.message.includes('unable to find a path to destination') && !err.message.includes('target not found'))
      ) {
        this.logger.error(
          `error calling queryRoutes to ${destination}, amount ${minPartSize}, finalCltvDelta ${finalLock}`,
          err,
        );
        throw err;
      }
    }

    if (route) {
      this.logger.debug(
        `found a route to ${destination} for ${minPartSize} units with finalCltvDelta ${finalLock}: ${route}`,
      );
    } else {
      this.logger.debug(
        `could not find a route to ${destination} for ${minPartSize} units with finalCltvDelta ${finalLock}`,
      );
    }
    return route;
  };

  public canRouteToNode = async (_destination: string) => {
    // lnd doesn't currently have a way to see if any route exists, regardless of balance
    // for example, if we have a direct channel to peer but no balance in the channel and
    // no other routes, QueryRoutes will return nothing as of lnd v0.8.1.
    // For now we err on the side of leniency and assume a route may exist.
    return true;
  };

  /**
   * Lists all routes to destination.
   */
  private queryRoutes = (request: lndrpc.QueryRoutesRequest): Promise<lndrpc.QueryRoutesResponse> => {
    return this.unaryCall<lndrpc.QueryRoutesRequest, lndrpc.QueryRoutesResponse>('queryRoutes', request);
  };

  public initWallet = async (
    walletPassword: string,
    seedMnemonic: string[],
    restore = false,
    backup?: Uint8Array,
  ): Promise<lndwalletunlocker.InitWalletResponse.AsObject> => {
    this.walletPassword = walletPassword;
    const request = new lndwalletunlocker.InitWalletRequest();

    // from the master seed/mnemonic we derive a child mnemonic for this specific client
    const childMnemonic = await deriveChild(seedMnemonic, this.label);
    request.setCipherSeedMnemonicList(childMnemonic);

    request.setWalletPassword(Uint8Array.from(Buffer.from(walletPassword, 'utf8')));
    if (restore) {
      request.setRecoveryWindow(2500);
    }
    if (backup && backup.byteLength) {
      const snapshot = new lndrpc.ChanBackupSnapshot();
      const multiChanBackup = new lndrpc.MultiChanBackup();
      multiChanBackup.setMultiChanBackup(backup);
      snapshot.setMultiChanBackup(multiChanBackup);
      request.setChannelBackups(snapshot);
    }
    const initWalletResponse = await this.unaryWalletUnlockerCall<
      lndwalletunlocker.InitWalletRequest,
      lndwalletunlocker.InitWalletResponse
    >('initWallet', request);
    if (this.initWalletResolve) {
      this.initWalletResolve(true);
    }
    this.setUnlocked();

    this.logger.info('wallet initialized');
    return initWalletResponse.toObject();
  };

  public unlockWallet = async (walletPassword: string): Promise<void> => {
    this.walletPassword = walletPassword;
    const request = new lndwalletunlocker.UnlockWalletRequest();
    request.setWalletPassword(Uint8Array.from(Buffer.from(walletPassword, 'utf8')));
    await this.unaryWalletUnlockerCall<lndwalletunlocker.UnlockWalletRequest, lndwalletunlocker.UnlockWalletResponse>(
      'unlockWallet',
      request,
    );
    this.setUnlocked();
    this.logger.info('wallet unlocked');
  };

  /**
   * Watches for a change in the admin.macaroon file at the configured path,
   * then loads the macaroon.
   */
  private watchThenLoadMacaroon = async () => {
    const watchMacaroonPromise = new Promise<boolean>((resolve) => {
      this.watchMacaroonResolve = resolve;
    });
    const macaroonDir = path.join(this.macaroonpath!, '..');
    const fsWatcher = watch(macaroonDir, (event, filename) => {
      if (event === 'change' && filename === 'admin.macaroon') {
        this.logger.debug('admin.macaroon was created');
        if (this.watchMacaroonResolve) {
          this.watchMacaroonResolve(true);
        }
      }
    });
    this.logger.debug(`watching ${macaroonDir} for admin.macaroon to be created`);
    const macaroonCreated = await watchMacaroonPromise;
    fsWatcher.close();
    this.watchMacaroonResolve = undefined;

    if (macaroonCreated) {
      try {
        await this.loadMacaroon();
      } catch (err) {
        this.logger.error(`could not load macaroon from ${this.macaroonpath}`);
        this.setStatus(ClientStatus.Disabled);
      }
    }
  };

  public changePassword = async (oldPassword: string, newPassword: string) => {
    this.walletPassword = newPassword;
    const request = new lndwalletunlocker.ChangePasswordRequest();
    request.setCurrentPassword(Uint8Array.from(Buffer.from(oldPassword, 'utf8')));
    request.setNewPassword(Uint8Array.from(Buffer.from(newPassword, 'utf8')));
    await this.unaryWalletUnlockerCall<
      lndwalletunlocker.ChangePasswordResponse,
      lndwalletunlocker.ChangePasswordRequest
    >('changePassword', request);

    // the macaroons change every time lnd changes its password, so we must remove the old one and reload the new one
    this.meta.remove('macaroon');
    // admin.macaroon will not necessarily be created by the time lnd responds to a successful
    // ChangePassword call, so we watch the folder that we expect it to be in for it to be created
    await this.watchThenLoadMacaroon();

    this.setUnlocked();
    this.logger.info('password changed & wallet unlocked');
  };

  public addInvoice = async ({
    rHash,
    units,
    expiry = this.finalLock,
  }: {
    rHash: string;
    units: bigint;
    expiry?: number;
  }) => {
    const addHoldInvoiceRequest = new lndinvoices.AddHoldInvoiceRequest();
    addHoldInvoiceRequest.setHash(hexToUint8Array(rHash));
    addHoldInvoiceRequest.setValue(Number(units));
    addHoldInvoiceRequest.setCltvExpiry(expiry);
    const response = await this.addHoldInvoice(addHoldInvoiceRequest);
    this.logger.debug(`added invoice of ${units} for ${rHash} with cltvExpiry ${expiry}`);
    this.subscribeSingleInvoice(rHash);

    return response.getPaymentRequest();
  };

  public settleInvoice = async (rHash: string, rPreimage: string) => {
    this.logger.debug(`settling invoice for ${rHash} with preimage ${rPreimage}`);
    const settleInvoiceRequest = new lndinvoices.SettleInvoiceMsg();
    settleInvoiceRequest.setPreimage(hexToUint8Array(rPreimage));
    await this.settleInvoiceLnd(settleInvoiceRequest);

    const invoiceSubscription = this.invoiceSubscriptions.get(rHash);
    if (invoiceSubscription) {
      invoiceSubscription.cancel();
    }
  };

  public removeInvoice = async (rHash: string) => {
    const invoiceSubscription = this.invoiceSubscriptions.get(rHash);
    if (invoiceSubscription) {
      const cancelInvoiceRequest = new lndinvoices.CancelInvoiceMsg();
      cancelInvoiceRequest.setPaymentHash(hexToUint8Array(rHash));
      try {
        await this.cancelInvoice(cancelInvoiceRequest);
        this.logger.debug(`canceled invoice for ${rHash}`);
      } catch (err) {
        // handle errors due to attempting to remove an invoice that doesn't exist
        if (err.message === 'unable to locate invoice') {
          this.logger.debug(`attempted to cancel non-existent invoice for ${rHash}`);
        } else if (err.message === 'invoice already canceled') {
          this.logger.debug(`attempted to cancel already canceled invoice for ${rHash}`);
        } else {
          throw err;
        }
      }
      invoiceSubscription.cancel();
    }
  };

  public lookupPayment = async (rHash: string) => {
    try {
      const payments = await this.listPayments(true);
      for (const payment of payments.getPaymentsList()) {
        if (payment.getPaymentHash() === rHash) {
          switch (payment.getStatus()) {
            case lndrpc.Payment.PaymentStatus.SUCCEEDED: {
              const preimage = payment.getPaymentPreimage();
              return { preimage, state: PaymentState.Succeeded };
            }
            default:
              this.logger.warn(`unexpected payment state for payment with hash ${rHash}`);
            /* falls through */
            case lndrpc.Payment.PaymentStatus.IN_FLIGHT:
              return { state: PaymentState.Pending };
            case lndrpc.Payment.PaymentStatus.FAILED:
              return { state: PaymentState.Failed };
          }
        }
      }
    } catch (err) {
      this.logger.error(`could not lookup payment for ${rHash}`, err);
      return { state: PaymentState.Pending };
    }

    // if no payment is found, we assume that the payment was never attempted by lnd
    return { state: PaymentState.Failed };
  };

  private listPayments = (includeIncomplete?: boolean): Promise<lndrpc.ListPaymentsResponse> => {
    const request = new lndrpc.ListPaymentsRequest();
    if (includeIncomplete) {
      request.setIncludeIncomplete(includeIncomplete);
    }
    return this.unaryCall<lndrpc.ListPaymentsRequest, lndrpc.ListPaymentsResponse>('listPayments', request);
  };

  public restoreChannelBackup = (multiChannelBackup: Uint8Array) => {
    const request = new lndrpc.RestoreChanBackupRequest();
    request.setMultiChanBackup(multiChannelBackup);
    return this.unaryCall<lndrpc.RestoreChanBackupRequest, lndrpc.RestoreBackupResponse>(
      'restoreChannelBackups',
      request,
    );
  };

  public exportAllChannelBackup = async () => {
    const request = new lndrpc.ChanBackupExportRequest();
    const response = await this.unaryCall<lndrpc.ChanBackupExportRequest, lndrpc.ChanBackupSnapshot>(
      'exportAllChannelBackups',
      request,
    );

    return response.getMultiChanBackup()!.getMultiChanBackup_asU8();
  };

  private addHoldInvoice = (request: lndinvoices.AddHoldInvoiceRequest): Promise<lndinvoices.AddHoldInvoiceResp> => {
    return this.unaryInvoiceCall<lndinvoices.AddHoldInvoiceRequest, lndinvoices.AddHoldInvoiceResp>(
      'addHoldInvoice',
      request,
    );
  };

  private cancelInvoice = (request: lndinvoices.CancelInvoiceMsg): Promise<lndinvoices.CancelInvoiceResp> => {
    return this.unaryInvoiceCall<lndinvoices.CancelInvoiceMsg, lndinvoices.CancelInvoiceResp>('cancelInvoice', request);
  };

  private settleInvoiceLnd = (request: lndinvoices.SettleInvoiceMsg): Promise<lndinvoices.SettleInvoiceResp> => {
    return this.unaryInvoiceCall<lndinvoices.SettleInvoiceMsg, lndinvoices.SettleInvoiceResp>('settleInvoice', request);
  };

  private subscribeSingleInvoice = (rHash: string) => {
    if (!this.invoices) {
      throw errors.UNAVAILABLE(this.currency, this.status);
    }
    const request = new lndinvoices.SubscribeSingleInvoiceRequest();
    request.setRHash(hexToUint8Array(rHash));
    const invoiceSubscription = this.invoices.subscribeSingleInvoice(request, this.meta);
    const deleteInvoiceSubscription = () => {
      invoiceSubscription.removeAllListeners();
      this.invoiceSubscriptions.delete(rHash);
      this.logger.debug(`deleted invoice subscription for ${rHash}`);
    };
    invoiceSubscription
      .on('data', (invoice: lndrpc.Invoice) => {
        if (invoice.getState() === lndrpc.Invoice.InvoiceState.ACCEPTED) {
          // we have accepted an htlc for this invoice
          this.logger.debug(`accepted htlc for invoice ${rHash}`);
          this.emit('htlcAccepted', rHash, BigInt(invoice.getValue()));
        }
      })
      .on('end', deleteInvoiceSubscription)
      .on('error', deleteInvoiceSubscription);
    this.invoiceSubscriptions.set(rHash, invoiceSubscription);
  };

  /**
   * Subscribes to channel backups
   */
  public subscribeChannelBackups = () => {
    if (!this.lightning) {
      throw errors.UNAVAILABLE(this.currency, this.status);
    }

    if (this.channelBackupSubscription) {
      return;
    }

    this.channelBackupSubscription = this.lightning
      .subscribeChannelBackups(new lndrpc.ChannelBackupSubscription(), this.meta)
      .on('data', (backupSnapshot: lndrpc.ChanBackupSnapshot) => {
        const multiBackup = backupSnapshot.getMultiChanBackup()!;
        this.emit('channelBackup', multiBackup.getMultiChanBackup_asU8());
      })
      .on('end', this.disconnect)
      .on('error', this.disconnect);
  };

  /**
   * Closes any payment channels with a specified node.
   */
  public closeChannel = async ({ remoteIdentifier, force = false, fee = 0 }: CloseChannelParams) => {
    if (remoteIdentifier === undefined) {
      throw swapErrors.REMOTE_IDENTIFIER_MISSING;
    }
    const channels = (await this.listChannels()).getChannelsList();
    const closePromises: Promise<string>[] = [];
    channels.forEach((channel) => {
      if (channel.getRemotePubkey() === remoteIdentifier) {
        const [fundingTxId, outputIndex] = channel.getChannelPoint().split(':');
        const closePromise = this.closeChannelSync(fundingTxId, Number(outputIndex), force, fee);
        closePromises.push(closePromise);
      }
    });

    return Promise.all(closePromises);
  };

  /** A synchronous helper method for the closeChannel call */
  public closeChannelSync = (fundingTxId: string, outputIndex: number, force: boolean, fee = 0): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      if (!this.lightning) {
        throw errors.UNAVAILABLE(this.currency, this.status);
      }

      // TODO: set delivery_address parameter after upgrading to 0.10+ lnd API proto definition
      const request = new lndrpc.CloseChannelRequest();
      const channelPoint = new lndrpc.ChannelPoint();
      channelPoint.setFundingTxidStr(fundingTxId);
      channelPoint.setOutputIndex(outputIndex);
      request.setChannelPoint(channelPoint);
      request.setForce(force);
      request.setSatPerByte(fee);

      this.lightning
        .closeChannel(request, this.meta)
        .on('data', (message: lndrpc.CloseStatusUpdate) => {
          if (message.hasClosePending()) {
            const txId = base64ToHex(message.getClosePending()!.getTxid_asB64());
            if (txId) {
              this.logger.info(`channel closed with tx id ${txId}`);
              resolve(txId);
            }
          }
        })
        .on('end', () => {
          this.logger.debug('closeChannel ended');
          // we should receeive a channel close update above before the end event
          // if we don't, assume the call has failed and reject
          // if we have already resolved the promise this line will do nothing
          reject('channel close ended unexpectedly');
        })
        .on('status', (status: grpc.StatusObject) => {
          this.logger.debug(`closeChannel status: ${status.code} ${status.details}`);
          if (status.code !== grpc.status.OK) {
            reject(status.details);
          }
        })
        .on('error', (err: any) => {
          this.logger.error(`closeChannel error: ${err}`);
          reject(err);
        });
    });
  };

  /** Lnd specific procedure to disconnect from the server. */
  protected disconnect = () => {
    if (this.isOperational()) {
      this.setStatus(ClientStatus.Disconnected);
    }

    if (this.channelBackupSubscription) {
      // we emit channelBackupEnd event after all the disconnect related
      // cleanup has been completed
      this.channelBackupSubscription.cancel();
      this.channelBackupSubscription = undefined;
      this.emit('channelBackupEnd');
    }
    if (this.lightning) {
      this.lightning.close();
      this.lightning = undefined;
    }
    if (this.invoices) {
      this.invoices.close();
      this.invoices = undefined;
    }
    if (this.router) {
      this.router.close();
      this.router = undefined;
    }
    if (this.initWalletResolve) {
      this.initWalletResolve(false);
      this.initWalletResolve = undefined;
    }
    if (this.watchMacaroonResolve) {
      this.watchMacaroonResolve(false);
      this.watchMacaroonResolve = undefined;
    }
    if (this.initRetryTimeout) {
      clearTimeout(this.initRetryTimeout);
      this.initRetryTimeout = undefined;
    }
  };
}

export default LndClient;
