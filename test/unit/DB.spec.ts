import chai, { expect } from 'chai';
import uuidv1 from 'uuid/v1';
import DB from '../../lib/db/DB';
import OrderBookRepository from '../../lib/orderbook/OrderBookRepository';
import Logger, { Level } from '../../lib/Logger';
import { SwapClients, SwapRole, SwapState, SwapPhase } from '../../lib/types/enums';
import { ms } from '../../lib/utils/utils';
import SwapRepository from '../../lib/swaps/SwapRepository';
import chaiAsPromised = require('chai-as-promised');
import { OwnOrder } from '../../lib/types/orders';
import { SwapDeal } from '../../lib/swaps/types';
import P2PRepository from '../../lib/p2p/P2PRepository';

chai.use(chaiAsPromised);

const PAIR_ID = 'LTC/BTC';
const loggers = Logger.createLoggers(Level.Warn);

const price = 0.005;
const quantity = 0.1;
const peerPubKey = '03029c6a4d80c91da9e40529ec41c93b17cc9d7956b59c7d8334b0318d4a86aef8';
const rHash = '62c8bbef4587cff4286246e63044dc3e454b5693fb5ebd0171b7e58644bfafe2';
const orderId = uuidv1();

const order: OwnOrder = {
  price,
  quantity,
  isBuy: true,
  createdAt: ms(),
  initialQuantity: quantity,
  id: orderId,
  localId: uuidv1(),
  pairId: PAIR_ID,
  hold: 0,
};

const deal: SwapDeal = {
  quantity,
  price,
  peerPubKey,
  rHash,
  role: SwapRole.Maker,
  phase: SwapPhase.SwapCompleted,
  state: SwapState.Completed,
  orderId: order.id,
  localId: order.localId,
  isBuy: order.isBuy,
  proposedQuantity: quantity,
  pairId: PAIR_ID,
  takerCurrency: 'BTC',
  makerCurrency: 'LTC',
  takerAmount: 5000,
  makerAmount: 1000000,
  takerCltvDelta: 144,
  makerCltvDelta: 144,
  rPreimage: '60743C0B6BFA885E30F101705764F43F8EF7E613DD0F07AD5178C7D9B1682B9E',
  createTime: 1540716251106,
  executeTime: 1540717251106,
  completeTime: 1540718251106,
};

describe('Database', () => {
  const db = new DB(loggers.db);
  let orderBookRepo: OrderBookRepository;
  let p2pRepo: P2PRepository;
  let swapRepo: SwapRepository;

  before(async () => {
    await db.init();
    orderBookRepo = new OrderBookRepository(loggers.db, db.models);
    p2pRepo = new P2PRepository(db.models);
    swapRepo = new SwapRepository(db.models);
  });

  it('should add two currencies', async () => {
    const btcPromise = orderBookRepo.addCurrency({
      id: 'BTC',
      swapClient: SwapClients.Lnd,
      decimalPlaces: 8,
    });
    const ltcPromise = orderBookRepo.addCurrency({
      id: 'LTC',
      swapClient: SwapClients.Lnd,
      decimalPlaces: 8,
    });
    await Promise.all([btcPromise, ltcPromise]);
    await expect(orderBookRepo.getCurrencies()).to.eventually.have.lengthOf(2);
  });

  it('should add a trading pair', async () => {
    await orderBookRepo.addPair({
      baseCurrency: 'LTC',
      quoteCurrency: 'BTC',
    });
    await expect(orderBookRepo.getPairs()).to.eventually.have.lengthOf(1);
  });

  it('should add a node', async () => {
    await p2pRepo.addNode({
      nodePubKey: peerPubKey,
      addresses: [],
    });
  });

  it('should add an order', async () => {
    await orderBookRepo.addOrderIfNotExists(order);
    await expect(db.models.Order.count()).to.eventually.equal(1);
  });

  it('should not add the same order twice', async () => {
    await orderBookRepo.addOrderIfNotExists(order);
    await expect(db.models.Order.count()).to.eventually.equal(1);
  });

  it('should add a swap for the order', async () => {
    await swapRepo.addSwapDeal(deal);
    await expect(db.models.SwapDeal.count()).to.eventually.equal(1);
  });

  it('should get a swap along with the order for the swap', async () => {
    const swap = (await swapRepo.getSwapDeal(rHash))!;
    expect(swap.Order!.id).to.equal(orderId);
    const order = (await swap.getOrder())!;
    expect(order.id).to.equal(orderId);
  });

  it('should get a swap along with its peer node', async () => {
    const swap = (await swapRepo.getSwapDeal(rHash))!;
    expect(swap.peerPubKey).to.equal(peerPubKey);
    const node = (await swap.getNode())!;
    expect(node.nodePubKey).to.equal(peerPubKey);
  });

  it('should add market orders and have their price in db be null', async () => {
    const buyMarketOrder: OwnOrder = {
      quantity,
      price: Number.MAX_VALUE,
      isBuy: true,
      createdAt: ms(),
      initialQuantity: quantity,
      id: uuidv1(),
      localId: uuidv1(),
      pairId: PAIR_ID,
      hold: 0,
    };
    const sellMarketOrder: OwnOrder = {
      quantity,
      price: 0,
      isBuy: true,
      createdAt: ms(),
      initialQuantity: quantity,
      id: uuidv1(),
      localId: uuidv1(),
      pairId: PAIR_ID,
      hold: 0,
    };
    await orderBookRepo.addOrderIfNotExists(buyMarketOrder);
    await orderBookRepo.addOrderIfNotExists(sellMarketOrder);
    const buyOrder = (await db.models.Order.findById(buyMarketOrder.id))!;
    const sellOrder = (await db.models.Order.findById(sellMarketOrder.id))!;
    expect(buyOrder.id).to.equal(buyMarketOrder.id);
    expect(sellOrder.id).to.equal(sellMarketOrder.id);
    expect(buyOrder.price).to.be.null;
    expect(sellOrder.price).to.be.null;
  });

  after(async () => {
    await db.close();
  });
});
