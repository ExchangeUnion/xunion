import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon, { SinonSandbox } from 'sinon';
import { SwapClientType, SwapFailureReason } from '../../lib/constants/enums';
import DB from '../../lib/db/DB';
import Logger, { Level } from '../../lib/Logger';
import Peer from '../../lib/p2p/Peer';
import Pool from '../../lib/p2p/Pool';
import SwapClient from '../../lib/swaps/SwapClient';
import SwapClientManager from '../../lib/swaps/SwapClientManager';
import Swaps from '../../lib/swaps/Swaps';
import { UnitConverter } from '../../lib/utils/UnitConverter';
import { getValidDeal, waitForSpy } from '../utils';

chai.use(chaiAsPromised);

const validMakerOrder = () => {
  return {
    price: 0.008,
    quantity: 1000000,
    initialQuantity: 1000000,
    pairId: 'LTC/BTC',
    isBuy: false,
    peerPubKey: '029706a877a39d9f22e1ecd1042b058bd5798b9fd79fcf8c8ced8c1f13a4aff055',
    id: 'b76158b1-e34c-11e8-92c2-9fa16c9aa9d1',
    createdAt: 1541677927103,
  };
};

const validTakerOrder = () => {
  return {
    pairId: 'LTC/BTC',
    price: 0.008,
    quantity: 1000000,
    initialQuantity: 1000000,
    hold: 0,
    isBuy: true,
    localId: 'bd1d6500-e34c-11e8-bedb-9ffbf8c8cc23',
    id: 'bd1d6501-e34c-11e8-bedb-9ffbf8c8cc23',
    createdAt: 1541677936464,
  };
};

const validSwapSuccess = () => {
  return {
    orderId: '760d5291-e43e-11e8-bd56-e5c08173fa7d',
    localId: '76c61b40-e43e-11e8-a3b5-853f31e7d8e6',
    pairId: 'LTC/BTC',
    quantity: 1000,
    amountReceived: 1000,
    amountSent: 8,
    currencyReceived: 'LTC',
    currencySent: 'BTC',
    rHash: 'd94c22a73d2741ed5cdcf3714f9ab3c8664793b03a54c74a08877726007d67c2',
    rPreimage: 'eab3fe55ce502b702bca13cbb9f1e4239502911d4c8823b73708c4a4433ed87a',
    price: 0.008,
    peerPubKey: '020c9a0fb8dac5b91756fb21509aefc4e95b585510c4de6e6311f18348a4723cdd',
    role: 0,
  };
};

const currencies = [
  { id: 'LTC', swapClient: SwapClientType.Lnd, decimalPlaces: 8 },
  { id: 'BTC', swapClient: SwapClientType.Lnd, decimalPlaces: 8 },
];

describe('Swaps.Integration', () => {
  const loggers = Logger.createLoggers(Level.Warn);
  let db: DB;
  let pool: Pool;
  let swaps: Swaps;
  let swapClientManager: any;
  let peer: Peer;
  let sandbox: SinonSandbox;
  let getRouteResponse;

  before(async () => {
    db = new DB(loggers.db);
    await db.init();
  });

  after(async () => {
    await db.close();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // peer
    peer = sandbox.createStubInstance(Peer) as any;
    peer.sendPacket = async () => {};
    peer.getIdentifier = () => '1234567890';
    // pool
    pool = sandbox.createStubInstance(Pool) as any;
    pool.addReputationEvent = () => Promise.resolve();
    pool.getPeer = () => peer;
    pool.tryGetPeer = () => peer;
    // getRoute response
    getRouteResponse = () => {
      return Promise.resolve({ getTotalTimeLock: () => 1 });
    };
    swapClientManager = sandbox.createStubInstance(SwapClientManager) as any;
    swapClientManager['swapClients'] = new Map<string, SwapClient>();
    const btcSwapClient = sandbox.createStubInstance(SwapClient) as any;
    btcSwapClient['addInvoice'] = async () => {};
    btcSwapClient['removeInvoice'] = async () => {};
    btcSwapClient.getRoute = getRouteResponse;
    btcSwapClient.isConnected = () => true;
    swapClientManager['swapClients'].set('BTC', btcSwapClient);
    const ltcSwapClient = sandbox.createStubInstance(SwapClient) as any;
    ltcSwapClient['addInvoice'] = async () => {};
    ltcSwapClient['removeInvoice'] = async () => {};
    ltcSwapClient.isConnected = () => true;
    ltcSwapClient.getRoute = getRouteResponse;
    swapClientManager['swapClients'].set('LTC', ltcSwapClient);
    swapClientManager.get = (currency: string) => {
      const client = swaps.swapClientManager['swapClients'].get(currency);
      if (!client) {
        throw new Error('unknown swap client');
      }
      return client;
    };
    swaps = new Swaps({
      pool,
      swapClientManager,
      unitConverter: new UnitConverter(currencies),
      logger: loggers.swaps,
      models: db.models,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('executeSwap', () => {
    it('will resolve valid maker and taker order upon swap paid', async () => {
      const swapListenersAdded = sandbox.spy(swaps, 'on');
      const addDealSpy = sandbox.spy(swaps, 'addDeal');
      const swapListenersRemoved = sandbox.spy(swaps, 'removeListener');
      const swapSuccess = validSwapSuccess();
      expect(swaps.executeSwap(validMakerOrder(), validTakerOrder())).to.eventually.equal(swapSuccess);
      await waitForSpy(swapListenersAdded);
      expect(addDealSpy.calledOnce).to.equal(true);
      swapSuccess.rHash = addDealSpy.args[0][0].rHash;
      swaps.emit('swap.paid', swapSuccess);
      await waitForSpy(swapListenersRemoved, 'calledTwice');
    });

    it('will reject valid maker and taker order upon swap failed', async () => {
      const swapListenersAdded = sandbox.spy(swaps, 'on');
      const addDealSpy = sandbox.spy(swaps, 'addDeal');
      const swapListenersRemoved = sandbox.spy(swaps, 'removeListener');
      const swapDeal = getValidDeal();
      expect(swaps.executeSwap(validMakerOrder(), validTakerOrder())).to.eventually.be.rejected;
      await waitForSpy(swapListenersAdded);
      expect(addDealSpy.calledOnce).to.equal(true);
      swapDeal.rHash = addDealSpy.args[0][0].rHash;
      swaps.emit('swap.failed', swapDeal);
      await waitForSpy(swapListenersRemoved, 'calledTwice');
    });

    it('will reject orders with invalid pair', async () => {
      const INVALID_PAIR_ID = 'ABC/BTC';
      const invalidMakerOrder = {
        ...validMakerOrder(),
        pairId: INVALID_PAIR_ID,
      };
      expect(swaps.executeSwap(invalidMakerOrder, validTakerOrder())).to.eventually.be.rejected.and.equal(
        SwapFailureReason.InvalidOrders,
      );
      const invalidTakerOrder = {
        ...validTakerOrder(),
        pairId: INVALID_PAIR_ID,
      };
      expect(swaps.executeSwap(validMakerOrder(), invalidTakerOrder)).to.eventually.be.rejected.and.equal(
        SwapFailureReason.InvalidOrders,
      );
    });

    it('will reject if unable to retrieve routes', async () => {
      const noRoutesFound = () => {
        return Promise.resolve(undefined);
      };
      let btcSwapClient = swapClientManager.get('BTC');
      btcSwapClient!.getRoute = noRoutesFound;
      swapClientManager['swapClients'].set('BTC', btcSwapClient!);
      let ltcSwapClient = swapClientManager.get('LTC');
      ltcSwapClient!.getRoute = noRoutesFound;
      swapClientManager['swapClients'].set('LTC', ltcSwapClient!);
      expect(swaps.executeSwap(validMakerOrder(), validTakerOrder())).to.eventually.be.rejected.and.equal(
        SwapFailureReason.NoRouteFound,
      );
      const rejectsWithUnknownError = () => {
        return Promise.reject('UNKNOWN');
      };
      btcSwapClient = swapClientManager.get('BTC');
      btcSwapClient!.getRoute = rejectsWithUnknownError;
      swapClientManager['swapClients'].set('BTC', btcSwapClient!);
      ltcSwapClient = swapClientManager.get('LTC');
      ltcSwapClient!.getRoute = rejectsWithUnknownError;
      swapClientManager['swapClients'].set('LTC', ltcSwapClient!);
      expect(swaps.executeSwap(validMakerOrder(), validTakerOrder())).to.eventually.be.rejected.and.equal(
        SwapFailureReason.UnexpectedClientError,
      );
    });
  });
});
