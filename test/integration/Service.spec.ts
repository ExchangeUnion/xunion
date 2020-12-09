import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { OrderSide, Owner, SwapClientType } from '../../lib/constants/enums';
import p2pErrors from '../../lib/p2p/errors';
import Service from '../../lib/service/Service';
import Xud from '../../lib/Xud';
import { getTempDir } from '../utils';

chai.use(chaiAsPromised);

describe('API Service', () => {
  let xud: Xud;
  let service: Service;
  let orderId: string | undefined;

  const pairId = 'LTC/BTC';
  const placeOrderArgs = {
    pairId,
    orderId: '1',
    price: 1,
    quantity: 100,
    side: OrderSide.Buy,
    immediateOrCancel: false,
    replaceOrderId: '',
  };

  before(async () => {
    const config = {
      initdb: false,
      noencrypt: true,
      nosanityswaps: true,
      nobalancechecks: true,
      dbpath: ':memory:',
      loglevel: 'warn',
      logpath: '',
      xudir: getTempDir(true),
      p2p: {
        listen: false,
      },
      http: {
        disable: true,
      },
      rpc: {
        disable: true,
      },
      lnd: {
        LTC: {
          disable: true,
        },
        BTC: {
          disable: true,
        },
      },
      connext: {
        disable: true,
      },
    };

    xud = new Xud();
    await xud.start(config);
    service = xud.service;
  });

  it('should add two currencies', async () => {
    const addCurrencyPromises = [service.addCurrency({ currency: 'LTC', swapClient: SwapClientType.Lnd, decimalPlaces: 0 }),
      service.addCurrency({ currency: 'BTC', swapClient: SwapClientType.Lnd, decimalPlaces: 0 })];
    await expect(Promise.all(addCurrencyPromises)).to.be.fulfilled;
  });

  it('should add a trading pair', async () => {
    const addPairPromise = service.addPair({
      baseCurrency: 'LTC',
      quoteCurrency: 'BTC',
    });
    await expect(addPairPromise).to.be.fulfilled;
  });

  it('should list pairs', () => {
    const pairs = service.listPairs();
    expect(pairs).to.have.lengthOf(1);
    expect(pairs).to.include(pairId);
  });

  it('should place an order', async () => {
    const result = await service.placeOrder(placeOrderArgs);
    expect(result.remainingOrder).to.not.be.undefined;
    expect(result.remainingOrder!.pairId).to.equal(pairId);
    orderId = result.remainingOrder!.id;
  });

  it('should get orders', async () => {
    const args = {
      pairId,
      owner: Owner.Both,
      limit: 0,
      includeAliases: false,
    };
    const orders = service.listOrders(args);

    const pairOrders = orders.get(args.pairId);
    expect(pairOrders).to.not.be.undefined;

    expect(pairOrders!.buyArray).to.have.length(1);

    const order = pairOrders!.buyArray[0];
    expect(order.price).to.equal(placeOrderArgs.price);
    expect(order.quantity).to.equal(placeOrderArgs.quantity);
    expect(order.pairId).to.equal(placeOrderArgs.pairId);
    expect(order.side).to.equal(placeOrderArgs.side);
    expect(order.id).to.equal(orderId);
  });

  it('should remove an order', () => {
    const tp = xud['orderBook']!.tradingPairs.get('LTC/BTC')!;
    expect(tp.ownOrders.buyMap.has(orderId!)).to.be.true;
    const args = {
      orderId: '1',
    };
    service.removeOrder(args);
    expect(tp.ownOrders.buyMap.has(orderId!)).to.be.false;
  });

  it('should fail adding a currency with a ticker that is not 2 to 5 characters long', async () => {
    const tooLongAddCurrencyPromise = service.addCurrency({ currency: 'BITCOIN', swapClient: SwapClientType.Lnd, decimalPlaces: 0 });
    await expect(tooLongAddCurrencyPromise).to.be.rejectedWith('currency must consist of 2 to 5 upper case English letters or numbers');
  });

  it('should fail adding a currency with an invalid letter in its ticker', async () => {
    const invalidLetterAddCurrencyPromise = service.addCurrency({ currency: 'ÑEO', swapClient: SwapClientType.Lnd, decimalPlaces: 0 });
    await expect(invalidLetterAddCurrencyPromise).to.be.rejectedWith('currency must consist of 2 to 5 upper case English letters or numbers');
  });

  it('should fail adding a currency with an invalid swap client', async () => {
    const addCurrencyPromise = service.addCurrency({ currency: 'BBQ', swapClient: -1, decimalPlaces: 0 });
    await expect(addCurrencyPromise).to.be.rejectedWith('swap client is not recognized');
  });

  it('should fail adding a currency that already exists', async () => {
    const addCurrencyPromise = service.addCurrency({ currency: 'LTC', swapClient: SwapClientType.Lnd, decimalPlaces: 0 });
    await expect(addCurrencyPromise).to.be.rejectedWith('currency LTC already exists');
  });

  it('should fail adding a pair that already exists', async () => {
    const addPairPromise = service.addPair({
      baseCurrency: 'LTC',
      quoteCurrency: 'BTC',
    });
    await expect(addPairPromise).to.be.rejectedWith('pair LTC/BTC already exists');
  });

  it('should fail adding a pair with a currency that does not exist', async () => {
    const addCurrencyPromise = service.addPair({ baseCurrency: 'XXX', quoteCurrency: 'LTC' });
    await expect(addCurrencyPromise).to.be.rejectedWith('currency XXX does not exist');
  });

  it('should fail removing a currency used in an existing trading pair', async () => {
    const removeCurrencyPromise = service.removeCurrency({ currency: 'LTC' });
    await expect(removeCurrencyPromise).to.be.rejectedWith('currency LTC cannot be removed because it is used for LTC/BTC');
  });

  it('should remove a trading pair', async () => {
    await expect(service.removePair({ pairId })).to.be.fulfilled;
  });

  it('should remove two currencies', async () => {
    const removeCurrencyPromises = [service.removeCurrency({ currency: 'LTC' }), service.removeCurrency({ currency: 'BTC' })];
    await expect(Promise.all(removeCurrencyPromises)).to.be.fulfilled;
  });

  it('should fail to ban a node by alias that does not exist', async () => {
    const alias = 'doesNotExist';
    const banNodePromise = service.ban({ nodeIdentifier: alias });
    await expect(banNodePromise).to.be.rejectedWith(p2pErrors.ALIAS_NOT_FOUND(alias).message);
  });

  it('should fail to ban a node by nodePubKey that does not exist', async () => {
    const nodePubKey = '028599d05b18c0c3f8028915a17d603416f7276c822b6b2d20e71a3502bd0f9e0b';
    const banNodePromise = service.ban({ nodeIdentifier: nodePubKey });
    await expect(banNodePromise).to.be.rejectedWith(p2pErrors.NODE_NOT_FOUND(nodePubKey).message);
  });

  it('should shutdown', async () => {
    service.shutdown();
    const shutdownPromise = new Promise((resolve) => {
      xud.on('shutdown', () => resolve());
    });
    await expect(shutdownPromise).to.be.fulfilled;
  });
});
