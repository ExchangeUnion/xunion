import uuidv1 from 'uuid/v1';
import { EventEmitter } from 'events';
import OrderBookRepository from './OrderBookRepository';
import MatchingEngine from './MatchingEngine';
import MatchesProcessor from './MatchesProcessor';
import errors from './errors';
import Pool from '../p2p/Pool';
import Peer from '../p2p/Peer';
import { orders, matchingEngine, db } from '../types';
import Logger from '../Logger';
import LndClient from '../lndclient/LndClient';
import { ms } from '../utils/utils';
import { Models } from '../db/DB';
import { OrderIdentifier } from '../types/orders';

type OrdersMap = Map<String, Orders>;

type Orders = {
  buyOrders: Map<String, orders.StampedOrder>;
  sellOrders: Map<String, orders.StampedOrder>;
};

interface OrderBook {
  on(event: 'peerOrder.incoming', listener: (order: orders.StampedPeerOrder) => void);
  on(event: 'peerOrder.invalidation', listener: (order: orders.OrderIdentifier) => void);
  emit(event: 'peerOrder.incoming', order: orders.StampedPeerOrder);
  emit(event: 'peerOrder.invalidation', order: orders.OrderIdentifier);
}

type OrderArrays = {
  buyOrders: orders.StampedOrder[],
  sellOrders: orders.StampedOrder[],
};

class OrderBook extends EventEmitter {
  public pairs: db.PairInstance[] = [];
  public matchingEngines: { [ pairId: string ]: MatchingEngine } = {};

  private logger: Logger = Logger.orderbook;
  private repository: OrderBookRepository;
  private matchesProcessor = new MatchesProcessor();

  private ownOrders: OrdersMap = new Map<String, Orders>();
  private peerOrders: OrdersMap = new Map<String, Orders>();

  /**
   * A map between an order's local id and global id
   */
  private localIdMap: Map<String, String> = new Map<String, String>();

  constructor(models: Models, private pool?: Pool, private lndClient?: LndClient) {
    super();

    this.repository = new OrderBookRepository(models);
    if (pool) {
      pool.on('packet.order', this.addPeerOrder);
      pool.on('packet.orderInvalidation', order => this.removePeerOrder(order.orderId, order.pairId, order.quantity));
      pool.on('packet.getOrders', this.sendOrders);
      pool.on('peer.close', this.removePeerOrders);
    }
  }

  public init = async () => {
    const pairs = await this.repository.getPairs();

    pairs.forEach((pair) => {
      this.matchingEngines[pair.id] = new MatchingEngine(pair.id);
      this.ownOrders[pair.id] = this.initOrders();
      this.peerOrders[pair.id] = this.initOrders();
    });

    this.pairs = pairs;
  }

  private initOrders = (): Orders => {
    return {
      buyOrders: new Map <String, orders.StampedOrder>(),
      sellOrders: new Map <String, orders.StampedOrder>(),
    };
  }

  /**
   * Returns the list of available trading pairs.
   */
  public getPairs = (): Promise<db.PairInstance[]> => {
    return this.repository.getPairs();
  }

  /**
   * Returns lists of buy and sell orders of peers
   */
  public getPeerOrders = (pairId: string, maxResults: number): OrderArrays => {
    return this.getOrders(maxResults, this.peerOrders[pairId]);
  }

  /*
  * Returns lists of the node's own buy and sell orders
  */
  public getOwnOrders = (pairId: string, maxResults: number): OrderArrays => {
    return this.getOrders(maxResults, this.ownOrders[pairId]);
  }

  private getOrders = (maxResults: number, orders: Orders): OrderArrays => {
    if (maxResults > 0) {
      return {
        buyOrders: Object.values(orders.buyOrders).slice(0, maxResults),
        sellOrders: Object.values(orders.sellOrders).slice(0, maxResults),
      };
    } else {
      return {
        buyOrders: Object.values(orders.buyOrders),
        sellOrders: Object.values(orders.sellOrders),
      };
    }
  }

  public addLimitOrder = (order: orders.OwnOrder): matchingEngine.MatchingResult => {
    return this.addOwnOrder(order);
  }

  public addMarketOrder = (order: orders.OwnMarketOrder): matchingEngine.MatchingResult => {
    const price = order.quantity > 0 ? Number.MAX_VALUE : 0;
    return this.addOwnOrder({ ...order, price }, true);
  }

  public removeOwnOrderByLocalId = (pairId: string, localId: string): { removed: boolean, globalId: string } => {
    const id = this.localIdMap[localId];

    if (id === undefined) {
      return { removed: false, globalId: id };
    } else {
      delete this.localIdMap[localId];
      return {
        removed: this.removeOwnOrder(pairId, id),
        globalId: id,
      };
    }
  }

  private removeOwnOrder = (pairId: string, orderId: string): boolean => {
    const matchingEngine = this.matchingEngines[pairId];
    if (!matchingEngine) {
      this.logger.warn(`Invalid pairId: ${pairId}`);
      return false;
    }

    if (matchingEngine.removeOwnOrder(orderId)) {
      this.logger.debug(`order removed: ${JSON.stringify(orderId)}`);
      return this.removeOrder(this.ownOrders, orderId, pairId);
    } else {
      return false;
    }
  }

  private removePeerOrder = (orderId: string, pairId: string, decreasedQuantity?: number): boolean => {
    const matchingEngine = this.matchingEngines[pairId];
    const ordersMap = this.peerOrders[pairId];
    if (!matchingEngine || !ordersMap) {
      this.logger.warn(`Invalid pairId: ${pairId}`);
      return false;
    }

    const order = ordersMap[orderId];

    if (order) {
      if (matchingEngine.removePeerOrder(orderId, decreasedQuantity)) {
        let result;

        if (!decreasedQuantity || decreasedQuantity === 0) {
          result = this.removeOrder(this.peerOrders, orderId, pairId);
        } else {
          result = this.updateOrderQuantity(order, decreasedQuantity);
        }

        if (result) {
          this.emit('peerOrder.invalidation', { orderId, pairId, quantity: decreasedQuantity });
          return true;
        }
      }
    }

    this.logger.warn(`Invalid orderId: ${orderId}`);
    return false;
  }

  private addOwnOrder = (order: orders.OwnOrder, discardRemaining: boolean = false): matchingEngine.MatchingResult => {
    if (this.localIdMap[order.localId]) {
      throw errors.DUPLICATE_ORDER(order.localId);
    }

    const matchingEngine = this.matchingEngines[order.pairId];
    if (!matchingEngine) {
      throw errors.INVALID_PAIR_ID(order.pairId);
    }

    const stampedOrder: orders.StampedOwnOrder = { ...order, id: uuidv1(), createdAt: ms() };
    const matchingResult = matchingEngine.matchOrAddOwnOrder(stampedOrder, discardRemaining);
    const { matches, remainingOrder } = matchingResult;

    if (matches.length > 0) {
      matches.forEach(({ maker, taker }) => {
        this.handleMatch({ maker, taker });
        this.updateOrderQuantity(maker, maker.quantity);
      });
    }
    if (remainingOrder && !discardRemaining) {
      this.broadcastOrder(remainingOrder);
      this.addOrder(this.ownOrders, remainingOrder);
      this.logger.debug(`order added: ${JSON.stringify(remainingOrder)}`);
    }

    return matchingResult;
  }

  private addPeerOrder = (order: orders.PeerOrder) => {
    const matchingEngine = this.matchingEngines[order.pairId];
    if (!matchingEngine) {
      this.logger.debug(`incoming peer order invalid pairId: ${order.pairId}`);
      return;
    }

    const stampedOrder: orders.StampedPeerOrder = { ...order, createdAt: ms() };
    this.emit('peerOrder.incoming', stampedOrder);
    matchingEngine.addPeerOrder(stampedOrder);
    this.addOrder(this.peerOrders, stampedOrder);
    this.logger.debug(`order added: ${JSON.stringify(stampedOrder)}`);
  }

  private removePeerOrders = async (peer: Peer): Promise<void> => {
    this.pairs.forEach((pair) => {
      const orders = this.matchingEngines[pair.id].removePeerOrders(peer.id);

      orders.forEach((order) => {
        this.removeOrder(this.peerOrders, order.id, order.pairId);
        this.emit('peerOrder.invalidation', {
          orderId: order.id,
          pairId: order.pairId,
        });
      });
    });
  }

  private updateOrderQuantity = (order: orders.StampedOrder, decreasedQuantity: number): boolean => {
    const isOwnOrder = orders.isOwnOrder(order);
    const orderMap = this.getOrderMap(isOwnOrder ? this.ownOrders : this.peerOrders, order);

    const orderInstance = orderMap[order.id];

    if (!orderInstance) {
      return false;
    }

    orderInstance.quantity = orderInstance.quantity - decreasedQuantity;
    if (orderInstance.quantity === 0) {
      if (isOwnOrder) {
        const { localId } = order as orders.StampedOwnOrder;
        delete this.localIdMap[localId];
      }
      delete orderMap[order.id];
    }

    return true;
  }

  private addOrder = (type: OrdersMap, order: orders.StampedOrder) => {
    if (this.isOwnOrdersMap(type)) {
      const { localId } = order as orders.StampedOwnOrder;
      this.localIdMap[localId] = order.id;
    }

    this.getOrderMap(type, order)[order.id] = order;
  }

  private removeOrder = (type: OrdersMap, orderId: string, pairId: string): boolean => {
    const orders = type[pairId];

    if (orders.buyOrders[orderId]) {
      delete orders.buyOrders[orderId];
      return true;
    } else if (orders.sellOrders[orderId]) {
      delete orders.sellOrders[orderId];
      return true;
    }

    return false;
  }

  private getOrderMap = (type: OrdersMap, order: orders.StampedOrder): OrdersMap => {
    const orders = type[order.pairId];
    if (order.quantity > 0) {
      return orders.buyOrders;
    } else {
      return orders.sellOrders;
    }
  }

  private isOwnOrdersMap = (type: OrdersMap) => {
    return type === this.ownOrders;
  }

  private sendOrders = async (peer: Peer, reqId: string) => {
    // TODO: just send supported pairs
    const pairs = await this.getPairs();

    const promises: Promise<orders.OutgoingOrder | void>[] = [];
    for (const { id } of pairs) {
      const orders = await this.getOwnOrders(id, 0);
      orders['buyOrders'].forEach(order => promises.push(this.createOutgoingOrder(order as orders.StampedOwnOrder)));
      orders['sellOrders'].forEach(order => promises.push(this.createOutgoingOrder(order as orders.StampedOwnOrder)));
    }
    await Promise.all(promises).then((outgoingOrders) => {
      peer.sendOrders(outgoingOrders as orders.OutgoingOrder[], reqId);
    });
  }

  private broadcastOrder = async (order: orders.StampedOwnOrder): Promise<void> => {
    if (this.pool) {
      const outgoingOrder = await this.createOutgoingOrder(order);
      if (outgoingOrder) {
        this.pool.broadcastOrder(outgoingOrder);
      }
    }
  }

  private createOutgoingOrder = async (order: orders.StampedOwnOrder): Promise<orders.OutgoingOrder | void> => {
    const invoice = await this.createInvoice(order);

    if (!invoice) return;

    const { createdAt, localId, ...outgoingOrder } = { ...order, invoice };
    return outgoingOrder;
  }

  private handleMatch = ({ maker, taker }): void => {
    this.logger.debug(`order match: ${JSON.stringify({ maker, taker })}`);
    if (this.pool) {
      if (orders.isOwnOrder(maker)) {
        this.pool.broadcastOrderInvalidation({
          orderId: maker.id,
          pairId: maker.pairId,
          quantity: maker.quantity,
        });
      }
    }
    this.matchesProcessor.add({ maker, taker });
  }

  public createInvoice = async (order: orders.StampedOwnOrder): Promise<string|void> => {
    if (!this.lndClient) {
      return;
    }

    if (this.lndClient.isDisabled()) {
      return 'dummyInvoice'; // temporarily testing invoices while lnd is not available
    } else {
      // temporary simple invoices until swaps are operational
      const invoice = await this.lndClient.addInvoice(order.price * Math.abs(order.quantity));
      return invoice.paymentRequest;
    }
  }
}

export default OrderBook;
export { Orders, OrderArrays };
