import { SwapRole, SwapPhase, SwapState, SwapFailureReason } from '../constants/enums';

export type SwapDeal = {
  /** Our role in the swap. */
  role: SwapRole;
  /** The most updated deal phase */
  phase: SwapPhase;
  /**
   * The most updated deal state. State works together with phase to indicate where the
   * deal is in its life cycle and if the deal is active, errored, or completed.
   */
  state: SwapState;
  /** The reason for being in the current state. */
  errorMessage?: string;
  failureReason?: SwapFailureReason;
  /** The xud node pub key of the counterparty to this swap deal. */
  peerPubKey: string;
  /** The global order id in the XU network for the maker order being executed. */
  orderId: string;
  /** Whether the maker order is a buy order. */
  isBuy: boolean;
  /** The local id of the own order involved in the swap. */
  localId: string;
  /** The quantity of the order to execute as proposed by the taker. */
  proposedQuantity: number;
  /** The quantity of the order to execute as accepted by the maker. */
  quantity?: number;
  /** The trading pair for the swap. The pairId together with the orderId are needed to find the maker order in the order book. */
  pairId: string;
  /** The amount the taker is expecting to receive denominated in satoshis. */
  takerAmount: number;
  /** The number of the smallest base units of the currency (like satoshis or wei) the maker is expecting to receive. */
  takerUnits: bigint;
  /** The currency the taker is expecting to receive. */
  takerCurrency: string;
  /** Taker's lnd pubkey on the taker currency's network. */
  takerPubKey?: string;
  /** The CLTV delta from the current height that should be used to set the timelock for the final hop when sending to taker. */
  takerCltvDelta: number;
  /** The amount the maker is expecting to receive denominated in satoshis. */
  makerAmount: number;
  /** The number of the smallest base units of the currency (like satoshis or wei) the maker is expecting to receive. */
  makerUnits: bigint;
  /** The currency the maker is expecting to receive. */
  makerCurrency: string;
  /** The CLTV delta from the current height that should be used to set the timelock for the final hop when sending to maker. */
  makerCltvDelta?: number;
  /** The price of the order that's being executed. */
  price: number;
  /** The hex-encoded hash of the preimage. */
  rHash: string;
  /** The hex-encoded preimage. */
  rPreimage?: string;
  /** The maximum time lock from the maker to the taker in blocks. */
  takerMaxTimeLock?: number;
  /** The identifier for the payment channel network node we should pay to complete the swap.  */
  destination?: string;
  /** The time when we created this swap deal locally. */
  createTime: number;
  /** The time when we began executing the swap for an accepted deal. */
  executeTime?: number;
  /** The time when the swap either completed successfully or failed. */
  completeTime?: number;
  /** The payment request from the counterparty. */
  payReq?: string;
};

/** The result of a successful swap. */
export type SwapSuccess = Pick<
  SwapDeal,
  'orderId' | 'localId' | 'pairId' | 'rHash' | 'peerPubKey' | 'price' | 'rPreimage' | 'role'
> & {
  /** The amount received denominated in satoshis. */
  amountReceived: number;
  /** The amount sent denominated in satoshis. */
  amountSent: number;
  /** The ticker symbol of the currency received. */
  currencyReceived: string;
  /** The ticker symbol of the currency sent. */
  currencySent: string;
  /** The quantity that was swapped. */
  quantity: number;
};

/** A swap that has been accepted. */
export type SwapAccepted = Pick<SwapDeal, 'orderId' | 'localId' | 'pairId' | 'rHash' | 'peerPubKey' | 'price'> & {
  amountReceiving: number;
  amountSending: number;
  currencyReceiving: string;
  currencySending: string;
  /** The quantity that was accepted. */
  quantity: number;
};

export type SwapFailure = Pick<SwapDeal, 'orderId' | 'pairId' | 'quantity' | 'peerPubKey'> & {
  /** The quantity that was attempted and failed for the swap. */
  quantity: number;
  failureReason: SwapFailureReason;
};

export type Route = {
  getTotalTimeLock: Function;
};

/** Tracks the state of a pending swap of 1 satoshi for 1 satoshi of a specified currency. */
export type SanitySwap = Pick<SwapDeal, 'rHash' | 'rPreimage' | 'peerPubKey'> & {
  /** The currency for the swap. */
  currency: string;
};

export type SwapCapacities = {
  /** Max outbound capacity for a distinct channel denominated in satoshis. */
  maxOutboundChannelCapacity: number;
  /** Max inbound capacity for a distinct channel denominated in satoshis. */
  maxInboundChannelCapacity: number;
  /** The total outbound capacity. */
  totalOutboundCapacity: number;
  /** The total inbound capacity. */
  totalInboundCapacity: number;
};

export type TradingLimits = {
  /** Maximum outbound limit for a sell order denominated in satoshis. */
  maxSell: number;
  /** Maximum inbound limit for a buy order denominated in satoshis. */
  maxBuy: number;
  /**  The outbound amount reserved for open sell orders. */
  reservedSell: number;
  /**  The inbound amount reserved for open buy orders. */
  reservedBuy: number;
};

export type ResolveRequest = {
  /** The amount of the incoming payment pending resolution, in the smallest units supported by the token. */
  units: bigint;
  rHash: string;
  tokenAddress: string;
  /** The number of blocks before the incoming payment expires. */
  expiration: number;
  chainHeight: number;
};

export type CloseChannelParams = {
  /** The remote node with which to close channels.. */
  remoteIdentifier?: string;
  /**
   * The amount to extract from the channel, if applicable. If 0 or unspecified,
   * the entire off-chain balance for the specified currency will be extracted.
   */
  units?: bigint;
  currency?: string;
  /**
   * The on-chain address to send funds extracted from the channel. If unspecified
   * the funds return to the default wallet for the client closing the channel.
   */
  destination?: string;
  force?: boolean;
  /** The fee in sat per byte. */
  fee?: number;
};

export type OpenChannelParams = {
  /** The remote node with which to open the channel. */
  remoteIdentifier?: string;
  /** The size of the channel. */
  units: bigint;
  currency?: string;
  /** Uris with which to connect to the remote node. */
  uris?: string[];
  /** The balance to assign to the remote node. */
  pushUnits?: bigint;
  /** The fee in sat per byte. */
  fee?: number;
};
