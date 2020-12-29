import assert from 'assert';
import poissonQuantile from 'distributions-poisson-quantile';
import { EventEmitter } from 'events';
import { ReputationEvent, SwapFailureReason, SwapPhase, SwapRole, SwapState } from '../constants/enums';
import { Models } from '../db/DB';
import { SwapDealInstance } from '../db/types';
import Logger from '../Logger';
import { OwnOrder, PeerOrder } from '../orderbook/types';
import { PacketType } from '../p2p/packets';
import * as packets from '../p2p/packets/types';
import Peer from '../p2p/Peer';
import Pool from '../p2p/Pool';
import { generatePreimageAndHash } from '../utils/cryptoUtils';
import { UnitConverter } from '../utils/UnitConverter';
import { setTimeoutPromise } from '../utils/utils';
import { MAX_PAYMENT_TIME } from './consts';
import errors, { errorCodes } from './errors';
import SwapClient, { PaymentState } from './SwapClient';
import SwapClientManager from './SwapClientManager';
import SwapRecovery from './SwapRecovery';
import SwapRepository from './SwapRepository';
import { ResolveRequest, Route, SanitySwap, SwapAccepted, SwapDeal, SwapSuccess } from './types';

export type OrderToAccept = Pick<SwapDeal, 'quantity' | 'price' | 'localId' | 'isBuy'> & {
  quantity: number;
};

interface Swaps {
  on(event: 'swap.accepted', listener: (swapSuccess: SwapAccepted) => void): this;
  on(event: 'swap.paid', listener: (swapSuccess: SwapSuccess) => void): this;
  on(event: 'swap.failed', listener: (deal: SwapDeal) => void): this;
  on(event: 'swap.recovered', listener: (recoveredSwap: SwapDealInstance) => void): this;
  emit(event: 'swap.accepted', swapSuccess: SwapAccepted): boolean;
  emit(event: 'swap.paid', swapSuccess: SwapSuccess): boolean;
  emit(event: 'swap.failed', deal: SwapDeal): boolean;
  emit(event: 'swap.recovered', recoveredSwap: SwapDealInstance): boolean;
}

class Swaps extends EventEmitter {
  public swapClientManager: SwapClientManager;
  /** A map between payment hashes and pending sanity swaps. */
  private sanitySwaps = new Map<string, SanitySwap>();
  private logger: Logger;
  private models: Models;
  private pool: Pool;
  private strict: boolean;
  /** A map between payment hashes and swap deals. */
  private deals = new Map<string, SwapDeal>();
  private swapRecovery: SwapRecovery;
  /** A map between payment hashes and timeouts for swaps. */
  private timeouts = new Map<string, number>();
  private usedHashes = new Set<string>();
  private repository: SwapRepository;
  private unitConverter: UnitConverter;

  /** The maximum time in milliseconds we will wait for a swap to be accepted before failing it. */
  private static readonly SWAP_ACCEPT_TIMEOUT = 10000;
  /** The maximum time in milliseconds we will wait for a swap to be completed before failing it. */
  private static readonly SWAP_COMPLETE_TIMEOUT = MAX_PAYMENT_TIME;
  /**
   * Additional time that the maker will wait for a swap to be completed before considering it timed
   * out. This exists because the maker starts timing sooner and ends timing later than the taker.
   * The maker starts timing as soon as it sends its SwapAccepted packet, but taker starts upon
   * receiving that packet some short time later. Furthermore, the taker stops the timer as soon as
   * it reveals the preimage and settles its incoming payment, whereas the maker doesn't stop until
   * it receives the preimage.
   */
  private static readonly SWAP_COMPLETE_MAKER_BUFFER = 5000;
  /**
   * The time threshold in milliseconds after which we consider a counterparty abusive if they
   * settle payment for a timed out swap.
   */
  private static readonly SWAP_ABUSE_TIME_LIMIT = 60000;
  /** The maximum time in milliseconds we will wait to receive an expected sanity swap init packet. */
  private static readonly SANITY_SWAP_INIT_TIMEOUT = 3000;
  /** The maximum time in milliseconds we will wait for a swap to be completed before failing it. */
  private static readonly SANITY_SWAP_COMPLETE_TIMEOUT = 10000;

  constructor({
    logger,
    models,
    pool,
    swapClientManager,
    unitConverter,
    strict = true,
  }: {
    logger: Logger;
    models: Models;
    pool: Pool;
    swapClientManager: SwapClientManager;
    unitConverter: UnitConverter;
    strict?: boolean;
  }) {
    super();

    this.logger = logger;
    this.models = models;
    this.pool = pool;
    this.swapClientManager = swapClientManager;
    this.unitConverter = unitConverter;
    this.strict = strict;
    this.swapRecovery = new SwapRecovery(swapClientManager, logger.createSubLogger('RECOVERY'));
    this.repository = new SwapRepository(this.models);
    this.bind();
  }

  /**
   * Checks if a swap request is valid. This is a shallow check that only detects critical
   * inconsistencies and verifies only whether the request can possibly lead to a successful swap.
   * @returns `true` if the request is valid, otherwise `false`
   */
  public static validateSwapRequest = ({ proposedQuantity, rHash }: packets.SwapRequestPacketBody) => {
    // proposed quantity must be a positive number
    // rHash must be exactly 64 characters
    return proposedQuantity > 0 && rHash.length === 64;
  };

  /**
   * Calculates the minimum expected lock delta for the final hop of the first leg to ensure a
   * very high probability that it won't expire before the second leg payment. We use a Poisson
   * distribution to model the possible block times of two independent chains, first calculating
   * a probabilistic upper bound for the lock time in minuntes of the second leg then a
   * probabilistic lower bound for the number of blocks for the lock time extended to the final
   * hop of the first leg.
   * @param secondLegLockDuration The lock duration (aka time lock or cltv delta) of the second
   * leg (maker to taker) denominated in blocks of that chain.
   * @returns A number of blocks for the chain of the first leg that is highly likely to take
   * more time in minutes than the provided second leg lock duration.
   */
  private static calculateLockBuffer = (
    secondLegLockDuration: number,
    secondLegMinutesPerBlock: number,
    firstLegMinutesPerBlock: number,
  ) => {
    /** A probabilistic upper bound for the time it will take for the second leg route time lock to expire. */
    const secondLegLockMinutes = poissonQuantile(0.9999, { lambda: secondLegLockDuration }) * secondLegMinutesPerBlock;
    const firstLegLockBuffer = poissonQuantile(0.9999, { lambda: secondLegLockMinutes / firstLegMinutesPerBlock });

    return firstLegLockBuffer;
  };

  /**
   * Calculates the currencies and amounts of subunits/satoshis each side of a swap should receive.
   * @param quantity The quantity being swapped
   * @param price The price for the swap
   * @param isBuy Whether the maker order in the swap is a buy
   * @returns An object with the calculated maker and taker values.
   */
  private calculateMakerTakerAmounts = (quantity: number, price: number, isBuy: boolean, pairId: string) => {
    const {
      inboundCurrency,
      inboundAmount,
      inboundUnits,
      outboundCurrency,
      outboundAmount,
      outboundUnits,
    } = this.unitConverter.calculateInboundOutboundAmounts(quantity, price, isBuy, pairId);
    return {
      makerCurrency: inboundCurrency,
      makerAmount: inboundAmount,
      makerUnits: inboundUnits,
      takerCurrency: outboundCurrency,
      takerAmount: outboundAmount,
      takerUnits: outboundUnits,
    };
  };

  public init = async () => {
    // update pool with current lnd & connext pubkeys
    this.swapClientManager.getLndClientsMap().forEach(({ pubKey, chain, currency, uris }) => {
      if (pubKey && chain) {
        this.pool.updateLndState({
          currency,
          pubKey,
          chain,
          uris,
        });
      }
    });
    if (this.swapClientManager.connextClient) {
      this.pool.updateConnextState(
        this.swapClientManager.connextClient.tokenAddresses,
        this.swapClientManager.connextClient.publicIdentifier,
      );
    }

    this.swapRecovery.beginTimer();
    const swapDealInstances = await this.repository.getSwapDeals();
    swapDealInstances.forEach((deal: SwapDealInstance) => {
      this.usedHashes.add(deal.rHash);

      if (deal.state === SwapState.Active) {
        this.swapRecovery.recoverDeal(deal).catch(this.logger.error);
      }
    });
  };

  private bind() {
    this.pool.on('packet.sanitySwapInit', async (packet, peer) => {
      const { currency, rHash } = packet.body!;
      const sanitySwap: SanitySwap = {
        currency,
        rHash,
        peerPubKey: peer.nodePubKey!,
      };
      this.sanitySwaps.set(rHash, sanitySwap);
      const swapClient = this.swapClientManager.get(currency)!;
      try {
        await swapClient.addInvoice({ rHash, units: 1n });
      } catch (err) {
        this.logger.error('could not add invoice for sanity swap', err);
        return;
      }
      await peer.sendPacket(new packets.SanitySwapAckPacket(undefined, packet.header.id));

      // set timeout limit for sanity swap to complete, fail it if it stalls
      await setTimeoutPromise(Swaps.SANITY_SWAP_COMPLETE_TIMEOUT);
      if (this.sanitySwaps.delete(rHash)) {
        // if we're here, it means the sanity swap has not completed within the time limit
        swapClient.removeInvoice(rHash).catch(this.logger.error);
      }
    });
    this.pool.on('packet.swapAccepted', this.handleSwapAccepted);
    this.pool.on('packet.swapFailed', this.handleSwapFailed);

    this.swapClientManager.on('htlcAccepted', this.handleHtlcAccepted);
    this.swapClientManager.on('lndUpdate', this.pool.updateLndState);
    this.swapClientManager.on('connextUpdate', this.pool.updateConnextState);

    this.swapRecovery.on('recovered', (recoveredSwap) => {
      this.emit('swap.recovered', recoveredSwap);
    });
  }

  /**
   * Checks if there are connected swap clients for both currencies in a given trading pair.
   * @returns `undefined` if both currencies are active, otherwise the ticker symbol for an inactive currency.
   */
  public checkInactiveCurrencyClients = (pairId: string): string | undefined => {
    // TODO: these checks are happening on a per-swap basis, it would be more efficient to
    // check up front and disable currencies for inactive swap clients when we detect they
    // become disconnected, then re-enable once they reconnect.
    const [baseCurrency, quoteCurrency] = pairId.split('/');
    const baseCurrencyClient = this.swapClientManager.get(baseCurrency);
    if (baseCurrencyClient === undefined || !baseCurrencyClient.isConnected()) {
      return baseCurrency;
    }
    const quoteCurrencyClient = this.swapClientManager.get(quoteCurrency);
    if (quoteCurrencyClient === undefined || !quoteCurrencyClient.isConnected()) {
      return quoteCurrency;
    }
    return undefined;
  };

  /**
   * Sends a swap failed packet to the counterparty peer in a swap with details about the error
   * that caused the failure. Sets reqId if packet is a response to a request.
   */
  private sendErrorToPeer = async ({
    peer,
    rHash,
    failureReason = SwapFailureReason.UnknownError,
    errorMessage,
    reqId,
  }: {
    peer: Peer;
    rHash: string;
    failureReason?: SwapFailureReason;
    errorMessage?: string;
    reqId?: string;
  }) => {
    const errorBody: packets.SwapFailedPacketBody = {
      rHash,
      failureReason,
      errorMessage,
    };
    this.logger.debug(
      `Sending ${SwapFailureReason[errorBody.failureReason]} error to peer: ${JSON.stringify(errorBody)}`,
    );
    await peer.sendPacket(new packets.SwapFailedPacket(errorBody, reqId));
  };

  /**
   * Saves deal to database and deletes it from memory if it is no longer active.
   * @param deal The deal to persist.
   */
  private persistDeal = async (deal: SwapDeal) => {
    await this.repository.saveSwapDeal(deal);
    if (deal.state !== SwapState.Active) {
      this.deals.delete(deal.rHash);
    }
  };

  public getPendingSwapHashes = () => {
    return this.swapRecovery.getPendingSwapHashes();
  };

  /**
   * Gets a deal by its rHash value.
   * @param rHash The rHash value of the deal to get.
   * @returns A deal if one is found, otherwise undefined.
   */
  public getDeal = (rHash: string): SwapDeal | undefined => {
    return this.deals.get(rHash);
  };

  public addDeal = (deal: SwapDeal) => {
    this.deals.set(deal.rHash, deal);
    this.usedHashes.add(deal.rHash);
    this.logger.debug(
      `New deal: ${JSON.stringify({
        ...deal,
        makerUnits: deal.makerUnits.toString(),
        takerUnits: deal.takerUnits.toString(),
      })}`,
    );
  };

  /**
   * Checks if a swap for two given orders can be executed by ensuring both swap clients are active
   * and if there exists a route to the maker.
   * @param maker maker order
   * @param taker taker order
   * @returns `void` if the swap can be executed, throws a [[SwapFailureReason]] otherwise
   */
  private verifyExecution = async (maker: PeerOrder, taker: OwnOrder): Promise<void> => {
    if (maker.pairId !== taker.pairId) {
      throw SwapFailureReason.InvalidOrders;
    }
    if (this.checkInactiveCurrencyClients(maker.pairId)) {
      throw SwapFailureReason.SwapClientNotSetup;
    }

    const { makerCurrency, makerUnits } = this.calculateMakerTakerAmounts(
      taker.quantity,
      maker.price,
      maker.isBuy,
      maker.pairId,
    );

    const swapClient = this.swapClientManager.get(makerCurrency)!;

    const peer = this.pool.getPeer(maker.peerPubKey);
    const destination = peer.getIdentifier(swapClient.type, makerCurrency);
    if (!destination) {
      throw SwapFailureReason.SwapClientNotSetup;
    }

    let route: Route | undefined;
    try {
      route = await swapClient.getRoute(makerUnits, destination, makerCurrency);
    } catch (err) {
      if (err === errors.INSUFFICIENT_BALANCE) {
        throw SwapFailureReason.InsufficientBalance;
      }
      throw SwapFailureReason.UnexpectedClientError;
    }

    if (!route) {
      throw SwapFailureReason.NoRouteFound;
    }
  };

  /**
   * A promise wrapper for a swap procedure
   * @param maker the remote maker order we are filling
   * @param taker our local taker order
   * @returns A promise that resolves to a [[SwapSuccess]] once the swap is completed, throws a [[SwapFailureReason]] if it fails
   */
  public executeSwap = async (maker: PeerOrder, taker: OwnOrder): Promise<SwapSuccess> => {
    await this.verifyExecution(maker, taker);
    const rHash = await this.beginSwap(maker, taker);

    return new Promise<SwapSuccess>((resolve, reject) => {
      const cleanup = () => {
        this.removeListener('swap.paid', onPaid);
        this.removeListener('swap.failed', onFailed);
      };
      const onPaid = (swapSuccess: SwapSuccess) => {
        if (swapSuccess.rHash === rHash) {
          cleanup();
          resolve(swapSuccess);
        }
      };
      const onFailed = (deal: SwapDeal) => {
        if (deal.rHash === rHash) {
          cleanup();
          reject(deal.failureReason!);
        }
      };
      this.on('swap.paid', onPaid);
      this.on('swap.failed', onFailed);
    });
  };

  /**
   * Executes a sanity swap with a peer for a specified currency.
   * @returns `true` if the swap succeeds, otherwise `false`
   */
  public executeSanitySwap = async (currency: string, peer: Peer) => {
    const { rPreimage, rHash } = await generatePreimageAndHash();
    const peerPubKey = peer.nodePubKey!;
    const swapClient = this.swapClientManager.get(currency);
    if (!swapClient) {
      return false;
    }

    const destination = peer.getIdentifier(swapClient.type, currency);
    if (!destination) {
      return false;
    }

    const sanitySwap: SanitySwap = {
      rHash,
      rPreimage,
      currency,
      peerPubKey,
    };
    this.sanitySwaps.set(rHash, sanitySwap);

    const sanitySwapInitPacket = new packets.SanitySwapInitPacket({
      currency,
      rHash,
    });

    try {
      await Promise.all([
        swapClient.addInvoice({ rHash, units: 1n }),
        peer.sendPacket(sanitySwapInitPacket),
        peer.wait(sanitySwapInitPacket.header.id, PacketType.SanitySwapAck, Swaps.SANITY_SWAP_INIT_TIMEOUT),
      ]);
    } catch (err) {
      this.logger.warn(`sanity swap could not be initiated for ${currency} using rHash ${rHash}: ${err.message}`);
      swapClient.removeInvoice(rHash).catch(this.logger.error);
      return false;
    }

    try {
      await swapClient.sendSmallestAmount(rHash, destination, currency);
      this.logger.debug(
        `performed successful sanity swap with peer ${peerPubKey} for ${currency} using rHash ${rHash}`,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `got payment error during sanity swap with ${peerPubKey} for ${currency} using rHash ${rHash}: ${err.message}`,
      );
      swapClient.removeInvoice(rHash).catch(this.logger.error);
      return false;
    }
  };

  /**
   * Begins a swap to fill an order by sending a [[SwapRequestPacket]] to the maker.
   * @param maker The remote maker order we are filling
   * @param taker Our local taker order
   * @returns The rHash for the swap, or a [[SwapFailureReason]] if the swap could not be initiated
   */
  private beginSwap = async (maker: PeerOrder, taker: OwnOrder): Promise<string> => {
    const peer = this.pool.getPeer(maker.peerPubKey);

    const quantity = Math.min(maker.quantity, taker.quantity);
    const {
      makerCurrency,
      makerAmount,
      makerUnits,
      takerCurrency,
      takerAmount,
      takerUnits,
    } = this.calculateMakerTakerAmounts(quantity, maker.price, maker.isBuy, maker.pairId);
    const clientType = this.swapClientManager.get(makerCurrency)!.type;
    const destination = peer.getIdentifier(clientType, makerCurrency)!;

    const takerSwapClient = this.swapClientManager.get(takerCurrency)!;
    const takerCltvDelta = takerSwapClient.finalLock;

    const { rPreimage, rHash } = await generatePreimageAndHash();
    // TODO: once we can specify PaymentAddr on lnd invoices, we can move the add
    // invoice step back to after the swap has been accepted
    const payReq = await takerSwapClient.addInvoice({
      rHash,
      units: takerUnits,
      expiry: takerCltvDelta,
      currency: takerCurrency,
    });

    const swapRequestBody: packets.SwapRequestPacketBody = {
      takerCltvDelta,
      rHash,
      payReq,
      orderId: maker.id,
      pairId: maker.pairId,
      proposedQuantity: taker.quantity,
    };

    const deal: SwapDeal = {
      rHash,
      orderId: maker.id,
      pairId: maker.pairId,
      proposedQuantity: taker.quantity,
      takerCltvDelta,
      rPreimage,
      takerCurrency,
      makerCurrency,
      takerAmount,
      makerAmount,
      takerUnits,
      makerUnits,
      destination,
      peerPubKey: peer.nodePubKey!,
      localId: taker.localId,
      price: maker.price,
      isBuy: maker.isBuy,
      phase: SwapPhase.SwapCreated,
      state: SwapState.Active,
      role: SwapRole.Taker,
      createTime: Date.now(),
    };

    this.addDeal(deal);

    // Make sure we are connected to both swap clients
    const inactiveCurrency = this.checkInactiveCurrencyClients(deal.pairId);
    if (inactiveCurrency) {
      await this.failDeal({
        deal,
        failureReason: SwapFailureReason.SwapClientNotSetup,
        failedCurrency: inactiveCurrency,
      });
      throw SwapFailureReason.SwapClientNotSetup;
    }
    await peer.sendPacket(new packets.SwapRequestPacket(swapRequestBody));

    await this.setDealPhase(deal, SwapPhase.SwapRequested);
    return deal.rHash;
  };

  /**
   * Accepts a proposed deal for a specified amount if a route and CLTV delta could be determined
   * for the swap. Stores the deal in the local collection of deals.
   * @returns A promise resolving to `true` if the deal was accepted, `false` otherwise.
   */
  public acceptDeal = async (
    orderToAccept: OrderToAccept,
    requestPacket: packets.SwapRequestPacket,
    peer: Peer,
  ): Promise<boolean> => {
    // TODO: max cltv to limit routes
    // TODO: consider the time gap between taking the routes and using them.
    this.logger.debug(`trying to accept deal: ${JSON.stringify(orderToAccept)} from xudPubKey: ${peer.nodePubKey}`);

    const { rHash, proposedQuantity, pairId, takerCltvDelta, orderId, payReq } = requestPacket.body!;
    const reqId = requestPacket.header.id;
    if (this.usedHashes.has(rHash)) {
      await this.sendErrorToPeer({
        peer,
        rHash,
        reqId,
        failureReason: SwapFailureReason.PaymentHashReuse,
      });
      return false;
    }

    const { quantity, price, isBuy } = orderToAccept;

    const {
      makerCurrency,
      makerAmount,
      makerUnits,
      takerCurrency,
      takerAmount,
      takerUnits,
    } = this.calculateMakerTakerAmounts(quantity, price, isBuy, pairId);

    const makerSwapClient = this.swapClientManager.get(makerCurrency)!;
    if (!makerSwapClient) {
      await this.sendErrorToPeer({
        peer,
        rHash,
        reqId,
        failureReason: SwapFailureReason.SwapClientNotSetup,
        errorMessage: 'Unsupported maker currency',
      });
      return false;
    }

    const takerSwapClient = this.swapClientManager.get(takerCurrency);
    if (!takerSwapClient) {
      await this.sendErrorToPeer({
        peer,
        rHash,
        reqId,
        failureReason: SwapFailureReason.SwapClientNotSetup,
        errorMessage: 'Unsupported taker currency',
      });
      return false;
    }

    // Make sure we are connected to swap clients for both currencies
    const inactiveCurrency = this.checkInactiveCurrencyClients(pairId);
    if (inactiveCurrency) {
      await this.sendErrorToPeer({
        peer,
        rHash,
        reqId,
        failureReason: SwapFailureReason.SwapClientNotSetup,
        errorMessage: `${inactiveCurrency} is inactive`,
      });
      return false;
    }

    const takerIdentifier = peer.getIdentifier(takerSwapClient.type, takerCurrency)!;
    const deal: SwapDeal = {
      rHash,
      pairId,
      proposedQuantity,
      orderId,
      price,
      isBuy,
      quantity,
      makerAmount,
      takerAmount,
      makerCurrency,
      takerCurrency,
      makerUnits,
      takerUnits,
      takerCltvDelta,
      payReq,
      takerPubKey: takerIdentifier,
      destination: takerIdentifier,
      peerPubKey: peer.nodePubKey!,
      localId: orderToAccept.localId,
      phase: SwapPhase.SwapCreated,
      state: SwapState.Active,
      role: SwapRole.Maker,
      createTime: Date.now(),
    };

    // add the deal. Going forward we can "record" errors related to this deal.
    this.addDeal(deal);

    let makerToTakerRoute: Route | undefined;
    try {
      makerToTakerRoute = await takerSwapClient.getRoute(
        takerUnits,
        takerIdentifier,
        deal.takerCurrency,
        deal.takerCltvDelta,
      );
    } catch (err) {
      await this.failDeal({
        deal,
        peer,
        reqId,
        failureReason:
          err === errors.INSUFFICIENT_BALANCE
            ? SwapFailureReason.InsufficientBalance
            : SwapFailureReason.UnexpectedClientError,
        errorMessage: err.message,
        failedCurrency: deal.takerCurrency,
      });
      return false;
    }

    if (!makerToTakerRoute) {
      await this.failDeal({
        deal,
        peer,
        reqId,
        failureReason: SwapFailureReason.NoRouteFound,
        errorMessage: 'Unable to find route to destination',
        failedCurrency: deal.takerCurrency,
      });
      return false;
    }

    let height: number;
    try {
      height = await takerSwapClient.getHeight();
    } catch (err) {
      await this.failDeal({
        deal,
        peer,
        reqId,
        failureReason: SwapFailureReason.UnexpectedClientError,
        errorMessage: `Unable to fetch block height: ${err.message}`,
        failedCurrency: takerCurrency,
      });
      return false;
    }

    if (height) {
      this.logger.debug(`got ${takerCurrency} block height of ${height}`);

      const routeTotalTimeLock = makerToTakerRoute.getTotalTimeLock();
      const routeLockDuration = routeTotalTimeLock - height;
      const routeLockHours = Math.round((routeLockDuration * takerSwapClient.minutesPerBlock) / 60);
      this.logger.debug(
        `found route to taker with total lock duration of ${routeLockDuration} ${takerCurrency} blocks (~${routeLockHours}h)`,
      );
      // Add an additional buffer equal to our final lock to allow for more possible routes.
      deal.takerMaxTimeLock = routeLockDuration + takerSwapClient.finalLock;

      // Here we calculate the minimum lock delta we will expect as maker on the final hop to us on
      // the first leg of the swap. This should ensure a very high probability that the final hop
      // of the payment to us won't expire before our payment to the taker with time leftover to
      // satisfy our finalLock/cltvDelta requirement for the incoming payment swap client.
      const lockBuffer = Swaps.calculateLockBuffer(
        deal.takerMaxTimeLock,
        takerSwapClient.minutesPerBlock,
        makerSwapClient.minutesPerBlock,
      );
      const lockBufferHours = Math.round((lockBuffer * makerSwapClient.minutesPerBlock) / 60);
      this.logger.debug(
        `calculated lock buffer for first leg: ${lockBuffer} ${makerCurrency} blocks (~${lockBufferHours}h)`,
      );

      deal.makerCltvDelta = lockBuffer + makerSwapClient.finalLock;
      const makerCltvDeltaHours = Math.round((deal.makerCltvDelta * makerSwapClient.minutesPerBlock) / 60);
      this.logger.debug(
        `lock delta for final hop to maker: ${deal.makerCltvDelta} ${makerCurrency} blocks (~${makerCltvDeltaHours}h)`,
      );
    }

    if (!deal.makerCltvDelta) {
      await this.failDeal({
        deal,
        peer,
        reqId,
        failedCurrency: makerCurrency,
        failureReason: SwapFailureReason.UnexpectedClientError,
        errorMessage: 'Could not calculate makerCltvDelta.',
      });
      return false;
    }

    let makerPayReq: string | undefined;
    try {
      makerPayReq = await makerSwapClient.addInvoice({
        rHash: deal.rHash,
        units: deal.makerUnits,
        expiry: deal.makerCltvDelta,
        currency: deal.makerCurrency,
      });
    } catch (err) {
      await this.failDeal({
        deal,
        peer,
        reqId,
        failedCurrency: makerCurrency,
        failureReason: SwapFailureReason.UnexpectedClientError,
        errorMessage: `could not add invoice for while accepting deal: ${err.message}`,
      });
      return false;
    }

    // persist the swap deal to the database after we've added an invoice for it
    const newPhasePromise = this.setDealPhase(deal, SwapPhase.SwapAccepted);

    const responseBody: packets.SwapAcceptedPacketBody = {
      rHash,
      makerCltvDelta: deal.makerCltvDelta || 1,
      quantity: proposedQuantity,
      payReq: makerPayReq,
    };

    this.emit('swap.accepted', {
      ...deal,
      currencySending: deal.takerCurrency,
      currencyReceiving: deal.makerCurrency,
      amountSending: deal.takerAmount,
      amountReceiving: deal.makerAmount,
      quantity: deal.quantity!,
    });

    this.logger.debug(`sending swap accepted packet: ${JSON.stringify(responseBody)} to peer: ${peer.nodePubKey}`);
    const sendSwapAcceptedPromise = peer.sendPacket(
      new packets.SwapAcceptedPacket(responseBody, requestPacket.header.id),
    );
    try {
      await Promise.all([newPhasePromise, sendSwapAcceptedPromise]);
    } catch (e) {
      this.logger.trace(`failed to accept deal because: ${JSON.stringify(e)}`);
      await this.failDeal({
        deal,
        peer,
        reqId,
        failureReason: SwapFailureReason.UnknownError,
        errorMessage: 'Unable to accept deal',
        failedCurrency: deal.takerCurrency,
      });
      return false;
    }
    return true;
  };

  private handleHtlcAccepted = async (swapClient: SwapClient, rHash: string, units: bigint, currency: string) => {
    let rPreimage: string;

    const deal = this.getDeal(rHash);
    if (deal?.state === SwapState.Error) {
      // we double check here to ensure that we don't attempt to resolve a hash
      // and/or send payment for a stale deal that has already failed but
      // eventually gets an incoming htlc accepted
      this.logger.warn(`htlc accepted for failed deal ${rHash}`);
      return;
    }

    try {
      rPreimage = await this.resolveHash(rHash, units, currency);
    } catch (err) {
      this.logger.error(`could not resolve hash for deal ${rHash}`, err);
      return;
    }

    if (!deal) {
      // if there's no deal associated with this hash, we treat it as a sanity swap
      // and attempt to settle our incoming payment
      await swapClient.settleInvoice(rHash, rPreimage, currency).catch(this.logger.error);
    } else if (deal.state === SwapState.Active) {
      // we check that the deal is still active before we try to settle the invoice
      try {
        await swapClient.settleInvoice(rHash, rPreimage, currency);
      } catch (err) {
        this.logger.error(`could not settle invoice for deal ${rHash}`, err);
        if (deal.role === SwapRole.Maker) {
          // if we are the maker, we must be able to settle the invoice otherwise we lose funds
          // we will continuously retry settling the invoice until it succeeds
          // TODO: determine when we are permanently unable (due to htlc expiration or unknown invoice hash) to
          // settle an invoice and fail the deal, rather than endlessly retrying settle invoice calls
          this.logger.alert(
            `incoming ${currency} payment with hash ${rHash} could not be settled with preimage ${rPreimage}, this is not expected and funds may be at risk`,
          );

          const settleRetryPromise = new Promise<void>((resolve) => {
            const settleRetryTimer = setInterval(async () => {
              try {
                await swapClient.settleInvoice(rHash, rPreimage, currency);
                this.logger.info(`successfully settled invoice for deal ${rHash} on retry`);
                resolve();
                clearInterval(settleRetryTimer);
              } catch (settleInvoiceErr) {
                this.logger.error(`could not settle invoice for deal ${rHash}`, settleInvoiceErr);
              }
            }, SwapRecovery.PENDING_SWAP_RECHECK_INTERVAL);
          });
          await settleRetryPromise;
        } else {
          // if we are the taker, funds are not at risk and we may simply fail the deal
          await this.failDeal({
            deal,
            failureReason: SwapFailureReason.UnexpectedClientError,
            errorMessage: err.message,
          });
          return;
        }
      }

      // if we succeeded in settling our incoming payment we update the deal phase & state
      await this.setDealPhase(deal, SwapPhase.PaymentReceived);
    }
  };

  /**
   * Handles a response from a peer to confirm a swap deal and updates the deal. If the deal is
   * accepted, initiates the swap.
   */
  private handleSwapAccepted = async (responsePacket: packets.SwapAcceptedPacket, peer: Peer) => {
    assert(responsePacket.body, 'SwapAcceptedPacket does not contain a body');
    const { quantity, rHash, makerCltvDelta, payReq } = responsePacket.body;
    const deal = this.getDeal(rHash);
    if (!deal) {
      this.logger.warn(`received swap accepted for unrecognized deal: ${rHash}`);
      // TODO: penalize peer
      return;
    }
    if (deal.phase !== SwapPhase.SwapRequested) {
      this.logger.warn(`received swap accepted for deal that is not in SwapRequested phase: ${rHash}`);
      // TODO: penalize peer
      return;
    }

    if (deal.state === SwapState.Error) {
      // this swap deal may have already failed, either due to a DealTimedOut
      // error while we were waiting for the swap to be accepted, or some
      // other unexpected error or issue
      this.logger.warn(`received swap accepted for deal that has already failed: ${rHash}`);
      return;
    }

    // clear the timer waiting for acceptance of our swap offer, and set a new timer waiting for
    // the swap to be completed
    clearTimeout(this.timeouts.get(rHash));
    this.timeouts.delete(rHash);

    // update deal with maker's cltv delta
    deal.makerCltvDelta = makerCltvDelta;

    deal.payReq = payReq;

    if (quantity) {
      deal.quantity = quantity; // set the accepted quantity for the deal
      if (quantity <= 0) {
        await this.failDeal({
          deal,
          peer,
          failureReason: SwapFailureReason.InvalidSwapPacketReceived,
          errorMessage: 'accepted quantity must be a positive number',
        });
        // TODO: penalize peer
        return;
      } else if (quantity > deal.proposedQuantity) {
        await this.failDeal({
          deal,
          peer,
          failureReason: SwapFailureReason.InvalidSwapPacketReceived,
          errorMessage: 'accepted quantity should not be greater than proposed quantity',
        });
        // TODO: penalize peer
        return;
      } else if (quantity < deal.proposedQuantity) {
        const { makerAmount, takerAmount } = this.calculateMakerTakerAmounts(
          quantity,
          deal.price,
          deal.isBuy,
          deal.pairId,
        );
        deal.takerAmount = takerAmount;
        deal.makerAmount = makerAmount;
      }
    }

    const makerSwapClient = this.swapClientManager.get(deal.makerCurrency);
    const takerSwapClient = this.swapClientManager.get(deal.takerCurrency);
    if (!makerSwapClient || !takerSwapClient) {
      // We checked that we had a swap client for both currencies involved during the peer handshake. Still...
      return;
    }

    // TODO: re-enable add invoice *after* swap accepted once we are able to specify the
    // PaymentAddr to lnd upon invoice creation
    /*
    try {
      await takerSwapClient.addInvoice({
        rHash: deal.rHash,
        units: deal.takerUnits,
        expiry: deal.takerCltvDelta,
        currency: deal.takerCurrency,
      });
    } catch (err) {
      await this.failDeal({
        deal,
        peer,
        failedCurrency: deal.takerCurrency,
        failureReason: SwapFailureReason.UnexpectedClientError,
        errorMessage: err.message,
      });
      return;
    }
*/

    // persist the deal to the database before we attempt to send
    await this.setDealPhase(deal, SwapPhase.SendingPayment);

    try {
      await makerSwapClient.sendPayment(deal);
    } catch (err) {
      // first we must handle the edge case where the maker has paid us but failed to claim our payment
      // in this case, we've already marked the swap as having been paid and completed
      if (deal.state === SwapState.Completed) {
        this.logger.warn(`maker was unable to claim payment for ${deal.rHash} but has already paid us`);
        return;
      }

      if (err.code === errorCodes.PAYMENT_REJECTED) {
        // if the maker rejected our payment, the swap failed due to an error on their side
        // and we don't need to send them a SwapFailedPacket
        await this.failDeal({
          deal,
          failureReason: SwapFailureReason.PaymentRejected,
          errorMessage: err.message,
        });
      } else {
        await this.failDeal({
          deal,
          peer,
          failedCurrency: deal.makerCurrency,
          failureReason: SwapFailureReason.SendPaymentFailure,
          errorMessage: err.message,
        });
      }
    }
  };

  /**
   * Verifies that the resolve request is valid. Checks the received amount vs
   * the expected amount.
   * @returns `true` if the resolve request is valid, `false` otherwise
   */
  private validateResolveRequest = (deal: SwapDeal, resolveRequest: ResolveRequest) => {
    const { units, tokenAddress, expiration, chainHeight } = resolveRequest;
    const peer = this.pool.getPeer(deal.peerPubKey);
    let expectedUnits: bigint;
    let expectedTokenAddress: string | undefined;
    let expectedCurrency: string;
    let source: string;
    let destination: string;
    switch (deal.role) {
      case SwapRole.Maker: {
        expectedUnits = deal.makerUnits;
        expectedCurrency = deal.makerCurrency;
        expectedTokenAddress = this.swapClientManager.connextClient?.tokenAddresses.get(deal.makerCurrency);
        source = 'Taker';
        destination = 'Maker';
        const lockExpirationDelta = expiration - chainHeight;
        // We relax the validation by LOCK_EXPIRATION_SLIPPAGE blocks because
        // new blocks could be mined during the time it takes from taker's
        // payment to reach the maker for validation.
        // This usually happens in simulated environments with fast mining enabled.
        const LOCK_EXPIRATION_SLIPPAGE = 3;
        if (deal.makerCltvDelta! - LOCK_EXPIRATION_SLIPPAGE > lockExpirationDelta) {
          this.logger.error(`
            lockExpirationDelta of ${lockExpirationDelta} does not meet
            makerCltvDelta ${deal.makerCltvDelta!} - LOCK_EXPIRATION_SLIPPAGE ${LOCK_EXPIRATION_SLIPPAGE}
            = ${deal.makerCltvDelta! - LOCK_EXPIRATION_SLIPPAGE} minimum
          `);
          this.failDeal({
            deal,
            peer,
            failureReason: SwapFailureReason.InvalidResolveRequest,
            failedCurrency: deal.makerCurrency,
            errorMessage: 'Insufficient CLTV received on first leg',
          }).catch(this.logger.error);
          return false;
        }
        break;
      }
      case SwapRole.Taker:
        expectedUnits = deal.takerUnits;
        expectedCurrency = deal.takerCurrency;
        expectedTokenAddress = this.swapClientManager.connextClient?.tokenAddresses.get(deal.takerCurrency);
        source = 'Maker';
        destination = 'Taker';
        break;
      default:
        // this case should never happen, something is very wrong if so.
        this.failDeal({
          deal,
          peer,
          failureReason: SwapFailureReason.UnknownError,
          errorMessage: 'Unknown role detected for swap deal',
        }).catch(this.logger.error);
        return false;
    }

    if (!expectedTokenAddress || tokenAddress.toLowerCase() !== expectedTokenAddress.toLowerCase()) {
      this.logger.error(`received token address ${tokenAddress}, expected ${expectedTokenAddress}`);
      this.failDeal({
        deal,
        peer,
        failedCurrency: expectedCurrency,
        failureReason: SwapFailureReason.InvalidResolveRequest,
        errorMessage: `Token address ${tokenAddress} did not match ${expectedTokenAddress}`,
      }).catch(this.logger.error);
      return false;
    }

    if (units < expectedUnits) {
      this.logger.error(`received ${units}, expected ${expectedUnits}`);
      this.failDeal({
        deal,
        peer,
        failedCurrency: expectedCurrency,
        failureReason: SwapFailureReason.InvalidResolveRequest,
        errorMessage: `Amount sent from ${source} to ${destination} is too small`,
      }).catch(this.logger.error);
      return false;
    }

    return true;
  };

  /** Attempts to resolve the preimage for the payment hash of a pending sanity swap. */
  private resolveSanitySwap = async (rHash: string, htlcCurrency?: string) => {
    const sanitySwap = this.sanitySwaps.get(rHash);

    if (sanitySwap) {
      assert(
        htlcCurrency === undefined || htlcCurrency === sanitySwap.currency,
        'incoming htlc does not match sanity swap currency',
      );
      const { currency, peerPubKey, rPreimage } = sanitySwap;
      this.sanitySwaps.delete(rHash); // we don't need to track sanity swaps that we've already attempted to resolve, delete to prevent a memory leak

      if (rPreimage) {
        // we initiated this sanity swap and can release the preimage immediately
        return rPreimage;
      } else {
        // we need to get the preimage by making a payment
        const swapClient = this.swapClientManager.get(currency);
        if (!swapClient) {
          throw new Error('unsupported currency');
        }

        const peer = this.pool.getPeer(peerPubKey);
        const destination = peer.getIdentifier(swapClient.type, currency)!;

        try {
          const preimage = await swapClient.sendSmallestAmount(rHash, destination, currency);
          this.logger.debug(
            `performed successful sanity swap with peer ${peerPubKey} for ${currency} using rHash ${rHash}`,
          );
          return preimage;
        } catch (err) {
          this.logger.warn(
            `got payment error during sanity swap with ${peerPubKey} for ${currency} using rHash ${rHash}: ${err.message}`,
          );
          swapClient.removeInvoice(rHash).catch(this.logger.error);
          throw err;
        }
      }
    } else {
      throw errors.PAYMENT_HASH_NOT_FOUND(rHash);
    }
  };

  /**
   * Resolves the hash for an incoming HTLC to its preimage.
   * @param rHash the payment hash to resolve
   * @param units the amount in base units of the currency
   * @param htlcCurrency the currency of the HTLC
   * @returns the preimage for the provided payment hash
   */
  public resolveHash = async (rHash: string, units: bigint, htlcCurrency?: string): Promise<string> => {
    const deal = this.getDeal(rHash);

    if (!deal) {
      if (units === 1n) {
        // if we don't have a deal for this hash, but the amount is exactly 1 unit, try to resolve it as a sanity swap
        return this.resolveSanitySwap(rHash, htlcCurrency);
      } else {
        throw errors.PAYMENT_HASH_NOT_FOUND(rHash);
      }
    }

    const peer = this.pool.getPeer(deal.peerPubKey);

    if (deal.role === SwapRole.Maker) {
      // As the maker, we need to forward the payment to the other chain
      assert(
        htlcCurrency === undefined || htlcCurrency === deal.makerCurrency,
        'incoming htlc does not match expected deal currency',
      );

      this.logger.debug('Executing maker code to resolve hash');

      const swapClient = this.swapClientManager.get(deal.takerCurrency)!;

      // we update the phase persist the deal to the database before we attempt to send payment
      await this.setDealPhase(deal, SwapPhase.SendingPayment);

      // check to make sure we did not fail the deal for any reason. if we failed
      // the deal then we may not be able to claim our payment even if we resolve the hash
      assert(deal.state !== SwapState.Error, `cannot send payment for failed swap ${deal.rHash}`);

      try {
        deal.rPreimage = await swapClient.sendPayment(deal);
      } catch (err) {
        this.logger.debug(`sendPayment in resolveHash for swap ${deal.rHash} failed due to ${err.message}`);

        // the send payment call failed but we first double check its final status, so
        // we only fail the deal when we know our payment won't go through. otherwise
        // we extract the preimage if the payment went through in spite of the error
        // or we fail the deal and go to SwapRecovery if it's still pending
        const paymentStatus = await swapClient.lookupPayment(rHash, deal.takerCurrency, deal.destination);
        if (paymentStatus.state === PaymentState.Succeeded && paymentStatus.preimage) {
          // just kidding, turns out the payment actually went through and we have the preimage!
          // so we can continue with the swap
          this.logger.debug(
            `payment for swap ${deal.rHash} succeeded despite sendPayment error, preimage is ${paymentStatus.preimage}`,
          );
          deal.rPreimage = paymentStatus.preimage;
        } else if (paymentStatus.state === PaymentState.Failed) {
          // we've confirmed the payment has failed for good, so we can fail the deal
          switch (err.code) {
            case errorCodes.FINAL_PAYMENT_ERROR:
              await this.failDeal({
                deal,
                peer,
                failedCurrency: deal.takerCurrency,
                failureReason: SwapFailureReason.SendPaymentFailure,
                errorMessage: err.message,
              });
              break;
            case errorCodes.PAYMENT_REJECTED:
              await this.failDeal({
                deal,
                failureReason: SwapFailureReason.PaymentRejected,
                errorMessage: err.message,
              });
              break;
            default:
              await this.failDeal({
                deal,
                peer,
                failedCurrency: deal.takerCurrency,
                failureReason: SwapFailureReason.UnknownError,
                errorMessage: err.message,
              });
              break;
          }
          throw err;
        } else {
          // the payment is in limbo, and could eventually go through. we need to make
          // sure that the taker doesn't claim our payment without us having a chance
          // to claim ours. we will monitor the outcome here.
          this.logger.info(
            `started monitoring pending payment for swap ${deal.rHash}, will check every ${
              SwapRecovery.PENDING_SWAP_RECHECK_INTERVAL / 1000
            } seconds`,
          );
          const pendingPaymentPromise = new Promise<string>((resolve, reject) => {
            const recheckTimer = setInterval(async () => {
              this.logger.trace(`checking pending payment status for swap ${deal.rHash}`);
              const newPaymentStatus = await swapClient.lookupPayment(rHash, deal.takerCurrency, deal.destination);
              this.logger.trace(`payment for swap ${deal.rHash} is in ${PaymentState[newPaymentStatus.state]} status}`);
              if (newPaymentStatus.state === PaymentState.Succeeded && newPaymentStatus.preimage) {
                // the payment went through, we resolve the promise to the resolved preimage
                resolve(newPaymentStatus.preimage);
                clearInterval(recheckTimer);
              } else if (newPaymentStatus.state === PaymentState.Failed) {
                // the payment finally failed, so we can fail the deal
                await this.failDeal({
                  deal,
                  peer,
                  failedCurrency: deal.takerCurrency,
                  failureReason: SwapFailureReason.SendPaymentFailure,
                  errorMessage: err.message,
                });
                reject(err);
                clearInterval(recheckTimer);
              }
            }, SwapRecovery.PENDING_SWAP_RECHECK_INTERVAL);
          });

          deal.rPreimage = await pendingPaymentPromise;
        }
      }

      // we update the deal phase but we don't wait for the updated deal to be persisted
      // to the database because we don't want to delay claiming the incoming payment
      // using the preimage we've just resolved
      this.setDealPhase(deal, SwapPhase.PreimageResolved).catch(this.logger.error);
      return deal.rPreimage;
    } else {
      // If we are here we are the taker
      assert(deal.rPreimage, 'preimage must be known if we are the taker');
      assert(
        htlcCurrency === undefined || htlcCurrency === deal.takerCurrency,
        'incoming htlc does not match expected deal currency',
      );
      this.logger.debug('Executing taker code to resolve hash');

      return deal.rPreimage;
    }
  };

  public handleResolveRequest = async (resolveRequest: ResolveRequest): Promise<string> => {
    const { units, rHash } = resolveRequest;

    this.logger.debug(`handleResolveRequest starting with hash ${rHash}`);

    const deal = this.getDeal(rHash);

    if (deal) {
      if (!this.validateResolveRequest(deal, resolveRequest)) {
        throw errors.INVALID_RESOLVE_REQUEST(rHash, deal.errorMessage || '');
      }
    } else if (this.getPendingSwapHashes().includes(rHash)) {
      throw errors.PAYMENT_PENDING(rHash);
    } else {
      const dealInstance = await this.repository.getSwapDeal(rHash);
      if (dealInstance && dealInstance.rPreimage) {
        return dealInstance.rPreimage;
      }
      throw errors.PAYMENT_HASH_NOT_FOUND(rHash);
    }

    try {
      const preimage = await this.resolveHash(rHash, units);

      // we treat responding to a resolve request as having received payment and persist the state
      await this.setDealPhase(deal, SwapPhase.PaymentReceived);

      this.logger.debug(`handleResolveRequest returning preimage ${preimage} for hash ${rHash}`);
      return preimage;
    } catch (err) {
      this.logger.error(`could not resolve hash for deal ${rHash}`, err);
      throw err;
    }
  };

  private handleSwapTimeout = async (rHash: string, reason: SwapFailureReason) => {
    const deal = this.getDeal(rHash)!;
    const peer = this.pool.tryGetPeer(deal.peerPubKey);

    if (
      deal.role === SwapRole.Taker ||
      deal.phase === SwapPhase.SwapAccepted ||
      deal.phase === SwapPhase.SwapRequested
    ) {
      // if we are the taker, we control the preimage and can decisively fail the deal and swap
      // also, if we haven't yet started sending payment then we can simply call off the deal
      await this.failDeal({
        deal,
        peer,
        failureReason: reason,
      });
    } else {
      // if we are the maker, and we've begun sending payment, then the fate of this swap is up to
      // the taker and we can't consider it failed until the taker cancels its incoming htlc/payment
      // we do, however, want to ensure that the taker doesn't complete a swap that should have timed
      // out, as this indicates dishonest behavior and possible exploitation of a free option

      this.logger.verbose(
        `swap with hash ${rHash} has timed out during payments and should be failed by the counterparty`,
      );
      if (peer) {
        // we tell the peer (taker) that this deal should be failed, in case they're using longer
        // timeouts than we are and won't fail it on their own
        await this.sendErrorToPeer({
          peer,
          rHash,
          failureReason: reason,
        });
      }
      this.timeouts.delete(rHash);
    }
  };

  /**
   * Fails a deal and optionally sends a SwapFailurePacket to a peer, if provided.
   */
  private failDeal = async ({
    deal,
    failureReason,
    failedCurrency,
    errorMessage,
    peer,
    reqId,
  }: {
    deal: SwapDeal;
    failureReason: SwapFailureReason;
    /** The currency that was responsible for the failure. */
    failedCurrency?: string;
    /** Details of what caused the deal to fail/error. */
    errorMessage?: string;
    /** The peer we should send a SwapFailedPacket to, if not specified then no packet is sent. */
    peer?: Peer;
    /** An optional reqId in case the SwapFailedPacket is in response to a swap request. */
    reqId?: string;
  }) => {
    if (deal.state === SwapState.Completed) {
      this.logger.error(`Can not fail completed deal ${deal.rHash}`);
      return;
    }

    // If we are already in error state and got another error report we
    // aggregate all error reasons by concatenation
    if (deal.state === SwapState.Error) {
      if (errorMessage) {
        deal.errorMessage = deal.errorMessage ? `${deal.errorMessage}; ${errorMessage}` : errorMessage;
        if (failedCurrency) {
          deal.errorMessage += ` (${failedCurrency})`;
        }
      }
      this.logger.trace(`new deal error message for ${deal.rHash}: + ${deal.errorMessage}`);
      return;
    }

    let logMessage = `deal ${deal.rHash} failed in state ${SwapState[deal.state]} & phase ${
      SwapPhase[deal.phase]
    } due to ${SwapFailureReason[failureReason]}`;
    if (failedCurrency) {
      logMessage += ` (${failedCurrency})`;
    }
    if (errorMessage) {
      logMessage += `: ${errorMessage}`;
    }
    this.logger.debug(logMessage);

    switch (failureReason) {
      case SwapFailureReason.SwapTimedOut:
      case SwapFailureReason.DealTimedOut:
        // additional penalty as timeouts cause costly delays and possibly stuck HTLC outputs
        void this.pool.addReputationEvent(deal.peerPubKey, ReputationEvent.SwapTimeout);
      /* falls through */
      case SwapFailureReason.SendPaymentFailure:
      case SwapFailureReason.NoRouteFound:
        // something is wrong with swaps for this currency with this peer
        if (failedCurrency && this.strict) {
          // only deactivate currencies due to failed swaps in strict mode
          try {
            this.pool.getPeer(deal.peerPubKey).deactivateCurrency(failedCurrency);
          } catch (err) {
            this.logger.debug(`could not disable currency ${failedCurrency} for peer ${deal.peerPubKey}`);
          }
        }
        void this.pool.addReputationEvent(deal.peerPubKey, ReputationEvent.SwapFailure);
        break;
      case SwapFailureReason.InvalidResolveRequest:
      case SwapFailureReason.InvalidSwapPacketReceived:
      case SwapFailureReason.PaymentHashReuse:
        // peer misbehaving, penalize the peer
        void this.pool.addReputationEvent(deal.peerPubKey, ReputationEvent.SwapMisbehavior);
        break;
      case SwapFailureReason.UnknownError:
        this.logger.warn(`swap failed due to unknown error: ${errorMessage}`);
        break;
      default:
        // do nothing, the swap failed for an innocuous reason
        break;
    }

    deal.state = SwapState.Error;
    deal.completeTime = Date.now();
    deal.failureReason = failureReason;
    deal.errorMessage = errorMessage;

    if (deal.phase !== SwapPhase.SwapCreated && deal.phase !== SwapPhase.SwapRequested) {
      // persist the deal failure if it had been accepted
      this.persistDeal(deal).catch(this.logger.error);
    }

    clearTimeout(this.timeouts.get(deal.rHash));
    this.timeouts.delete(deal.rHash);

    if (deal.role === SwapRole.Maker) {
      // if we are the maker and we have accepted a swap deal or were sending a payment that
      // has since failed then we should cancel the invoice for our incoming payment this
      // will cancel any incoming HTLCs rather than letting them expire and force close channels
      if (deal.phase === SwapPhase.SwapAccepted || deal.phase === SwapPhase.SendingPayment) {
        const swapClient = this.swapClientManager.get(deal.makerCurrency)!;
        swapClient.removeInvoice(deal.rHash).catch(this.logger.error); // we don't need to await the remove invoice call
      }
      // TODO: go back to only canceling invoice on SendingPayment phase as taker
      // once we resume adding invoice *after* swap deal is accepted
      // } else if (deal.phase === SwapPhase.SendingPayment) {
    } else {
      const swapClient = this.swapClientManager.get(deal.takerCurrency)!;
      swapClient.removeInvoice(deal.rHash).catch(this.logger.error); // we don't need to await the remove invoice call
    }

    this.logger.trace(`emitting swap.failed event for ${deal.rHash}`);
    this.emit('swap.failed', deal);

    if (peer) {
      await this.sendErrorToPeer({
        peer,
        failureReason,
        errorMessage,
        reqId,
        rHash: deal.rHash,
      });
    }
  };

  /**
   * Updates the phase of a swap deal and handles logic directly related to that phase change,
   * including persisting the deal state to the database.
   */
  private setDealPhase = async (deal: SwapDeal, newPhase: SwapPhase) => {
    const { rHash } = deal;
    assert(deal.state === SwapState.Active, `deal ${rHash} is not Active. Can not change deal phase`);

    const succeedSwap = (wasMaker: boolean) => {
      // the maker will have cleared the timer in the PreimageResolved phase
      clearTimeout(this.timeouts.get(deal.rHash));
      this.timeouts.delete(deal.rHash);

      const swapSuccess = {
        orderId: deal.orderId,
        localId: deal.localId,
        pairId: deal.pairId,
        quantity: deal.quantity!,
        amountReceived: wasMaker ? deal.makerAmount : deal.takerAmount,
        amountSent: wasMaker ? deal.takerAmount : deal.makerAmount,
        currencyReceived: wasMaker ? deal.makerCurrency : deal.takerCurrency,
        currencySent: wasMaker ? deal.takerCurrency : deal.makerCurrency,
        rHash: deal.rHash,
        rPreimage: deal.rPreimage,
        price: deal.price,
        peerPubKey: deal.peerPubKey,
        role: deal.role,
      };
      this.logger.info(
        `Successfully executed swap ${deal.rHash} with peer ${deal.peerPubKey} (${this.pool.getNodeAlias(
          deal.peerPubKey,
        )})`,
      );
      this.emit('swap.paid', swapSuccess);
    };

    switch (newPhase) {
      case SwapPhase.SwapCreated:
        assert(false, 'can not set deal phase to SwapCreated.');
        break;
      case SwapPhase.SwapRequested:
        assert(deal.role === SwapRole.Taker, 'SwapRequested can only be set by the taker');
        assert(deal.phase === SwapPhase.SwapCreated, 'SwapRequested can be only be set after SwapCreated');
        this.timeouts.set(
          rHash,
          setTimeout(this.handleSwapTimeout, Swaps.SWAP_ACCEPT_TIMEOUT, rHash, SwapFailureReason.DealTimedOut),
        );
        this.logger.debug(
          `Requesting deal: ${JSON.stringify({
            ...deal,
            makerUnits: deal.makerUnits.toString(),
            takerUnits: deal.takerUnits.toString(),
          })}`,
        );
        break;
      case SwapPhase.SwapAccepted:
        assert(deal.role === SwapRole.Maker, 'SwapAccepted can only be set by the maker');
        assert(deal.phase === SwapPhase.SwapCreated, 'SwapAccepted can be only be set after SwapCreated');

        if (deal.role === SwapRole.Maker) {
          // the maker begins execution of the swap upon accepting the deal
          this.timeouts.set(
            rHash,
            setTimeout(
              this.handleSwapTimeout,
              Swaps.SWAP_COMPLETE_TIMEOUT + Swaps.SWAP_COMPLETE_MAKER_BUFFER,
              rHash,
              SwapFailureReason.SwapTimedOut,
            ),
          );
        }
        this.logger.debug(`Setting SwapAccepted phase for deal ${rHash}`);
        break;
      case SwapPhase.SendingPayment:
        assert(
          (deal.role === SwapRole.Taker && deal.phase === SwapPhase.SwapRequested) ||
            (deal.role === SwapRole.Maker && deal.phase === SwapPhase.SwapAccepted),
          'SendingPayment can only be set after SwapRequested (taker) or SwapAccepted (maker)',
        );

        if (deal.role === SwapRole.Taker) {
          // the taker begins execution of the swap upon sending payment
          deal.executeTime = Date.now();
          this.timeouts.set(
            rHash,
            setTimeout(this.handleSwapTimeout, Swaps.SWAP_COMPLETE_TIMEOUT, rHash, SwapFailureReason.SwapTimedOut),
          );
        }

        this.logger.debug(`Setting SendingPayment phase for deal ${rHash}`);
        break;
      case SwapPhase.PreimageResolved: {
        assert(deal.role === SwapRole.Maker, 'PreimageResolved can only be set by the maker');
        assert(deal.phase === SwapPhase.SendingPayment, 'PreimageResolved can only be set after SendingPayment');

        // we treat the swap as having succeeded once we have resolved the preimage as the maker
        succeedSwap(true);

        /** The number of milliseconds elapsed since we started execting this swap. */
        const elapsedMilliseconds = Date.now() - deal.executeTime!;

        // we check that the taker did not release the preimage after the swap has timed out
        // if so, they are misbehaving by completing a swap too late and possibly exploiting
        // us with the free option problem
        if (elapsedMilliseconds > Swaps.SWAP_COMPLETE_TIMEOUT + Swaps.SWAP_ABUSE_TIME_LIMIT) {
          this.logger.warn(
            `taker accepted payment for ${rHash} after ${elapsedMilliseconds} ms, exceeding abuse threshold of ${
              Swaps.SWAP_COMPLETE_TIMEOUT + Swaps.SWAP_COMPLETE_MAKER_BUFFER
            } ms`,
          );
          this.pool.addReputationEvent(deal.takerPubKey!, ReputationEvent.SwapAbuse).catch(this.logger.error);
        } else if (elapsedMilliseconds > Swaps.SWAP_COMPLETE_TIMEOUT + Swaps.SWAP_COMPLETE_MAKER_BUFFER) {
          this.logger.warn(
            `taker accepted payment for ${rHash} after ${elapsedMilliseconds} ms, exceeding swap timeout of ${
              Swaps.SWAP_COMPLETE_TIMEOUT + Swaps.SWAP_COMPLETE_MAKER_BUFFER
            } ms`,
          );
          this.pool.addReputationEvent(deal.takerPubKey!, ReputationEvent.SwapDelay).catch(this.logger.error);
        }

        this.logger.debug(`Setting PreimageResolved phase for deal ${rHash}`);
        break;
      }
      case SwapPhase.PaymentReceived:
        assert(
          deal.phase === SwapPhase.SendingPayment || deal.phase === SwapPhase.PreimageResolved,
          'PaymentReceived can be only be set after SendingPayment or PreimageResolved',
        );
        deal.completeTime = Date.now();
        deal.state = SwapState.Completed;

        if (deal.role === SwapRole.Taker) {
          // we mark the swap as succeeded upon receiving payment when we are the taker
          succeedSwap(false);
        }

        this.logger.debug(`Setting PaymentReceived phase for deal ${deal.rHash} - preimage is ${deal.rPreimage}`);
        break;
      default:
        assert.fail('unknown deal phase');
        break;
    }

    deal.phase = newPhase;

    if (deal.phase !== SwapPhase.SwapRequested) {
      // once a deal is accepted, we persist its state to the database on every phase update
      await this.persistDeal(deal);
    }
  };

  private handleSwapFailed = async (packet: packets.SwapFailedPacket) => {
    const { rHash, errorMessage, failureReason } = packet.body!;
    const deal = this.getDeal(rHash);

    // TODO: penalize for unexpected swap failed packets
    if (!deal) {
      const dealInstance = await this.repository.getSwapDeal(rHash);
      if (dealInstance) {
        if (dealInstance.state === SwapState.Error && dealInstance.failureReason === SwapFailureReason.RemoteError) {
          const errorMessageWithReason = `${SwapFailureReason[failureReason]} - ${errorMessage}`;
          // update the error message for this saved deal to include the reason it failed
          dealInstance.errorMessage = dealInstance.errorMessage
            ? `${dealInstance.errorMessage}; ${errorMessageWithReason}`
            : errorMessageWithReason;
          await dealInstance.save();
        } else {
          this.logger.warn(`received unexpected swap failed packet for deal with payment hash ${rHash}`);
        }
      } else {
        this.logger.warn(`received swap failed packet for unknown deal with payment hash ${rHash}`);
      }
      return;
    }

    if (
      deal.phase === SwapPhase.PreimageResolved ||
      deal.phase === SwapPhase.PaymentReceived ||
      (deal.role === SwapRole.Maker && deal.phase === SwapPhase.SendingPayment)
    ) {
      // we don't want to fail a deal if any one of its payments is already completed
      // or if we are the maker sending a payment that may be claimed by taker
      this.logger.warn(
        `received swap failed packet for deal in phase ${SwapPhase[deal.phase]} with payment hash ${rHash}`,
      );
      return;
    }

    await this.failDeal({
      deal,
      failureReason,
      errorMessage,
    });
  };

  public close = () => {
    this.swapClientManager.removeAllListeners();
    this.swapRecovery.removeAllListeners();
    this.swapRecovery.stopTimer();
  };
}

export default Swaps;
