import LndClient from '../../lib/lndclient/LndClient';
import { LndClientConfig } from '../../lib/lndclient/types';
import Logger from '../../lib/Logger';
import { getValidDeal } from '../utils';
import { SwapRole } from '../../lib/constants/enums';
import { ClientStatus } from '../../lib/swaps/SwapClient';

const openChannelSyncResponse = {
  hasFundingTxidStr: () => {
    return true;
  },
  getFundingTxidStr: () => 'some_tx_id',
};

const preimage = 'IDAKXrx4dayn0H/gCxN12jPK2/LchwPZop4zICw43jg=';

jest.mock('../../lib/Logger');
const mockedLogger = <jest.Mock<Logger>>(<any>Logger);
describe('LndClient', () => {
  let lnd: LndClient;
  let config: LndClientConfig;
  let currency: string;
  let logger: Logger;

  beforeEach(() => {
    config = {
      disable: false,
      certpath: '/cert/path',
      macaroonpath: '/macaroon/path',
      host: '127.0.0.1',
      port: 4321,
      nomacaroons: true,
      cltvdelta: 40,
    };
    currency = 'BTC';
    logger = new mockedLogger();
    logger.error = jest.fn();
    logger.info = jest.fn();
    logger.trace = jest.fn();
    logger.debug = jest.fn();

    lnd = new LndClient({ config, currency, logger });
    lnd['status'] = ClientStatus.ConnectionVerified;
  });

  afterEach(async () => {
    jest.clearAllMocks();
    lnd.close();
  });

  describe('openChannel', () => {
    const peerPubKey = '02f8895eb03c37b2665415be4d83b20228acc0abc55ebf6728565141c66cfc164a';
    const units = 16000000n;
    const externalIp1 = '123.456.789.321:9735';
    const externalIp2 = '192.168.63.155:9777';
    const lndListeningUris = [`${peerPubKey}@${externalIp1}`, `${peerPubKey}@${externalIp2}`];

    test('it tries all 2 lnd uris when connectPeer to first one fails', async () => {
      expect.assertions(3);
      lnd['openChannelSync'] = jest.fn().mockReturnValue(Promise.resolve(openChannelSyncResponse));
      const connectPeerFail = () => {
        throw new Error('connectPeer failed');
      };
      lnd['connectPeer'] = jest
        .fn()
        .mockImplementationOnce(connectPeerFail)
        .mockImplementationOnce(() => {
          return Promise.resolve();
        });
      await lnd.openChannel({
        units,
        remoteIdentifier: peerPubKey,
        uris: lndListeningUris,
      });
      expect(lnd['connectPeer']).toHaveBeenCalledTimes(2);
      expect(lnd['connectPeer']).toHaveBeenCalledWith(peerPubKey, externalIp1);
      expect(lnd['connectPeer']).toHaveBeenCalledWith(peerPubKey, externalIp2);
    });

    test('it does succeed when connecting to already connected peer', async () => {
      expect.assertions(4);
      lnd['openChannelSync'] = jest.fn().mockReturnValue(Promise.resolve(openChannelSyncResponse));
      const alreadyConnected = () => {
        throw new Error('already connected');
      };
      lnd['connectPeer'] = jest.fn().mockImplementation(alreadyConnected);
      await lnd.openChannel({
        units,
        remoteIdentifier: peerPubKey,
        uris: lndListeningUris,
      });
      expect(lnd['connectPeer']).toHaveBeenCalledTimes(1);
      expect(lnd['connectPeer']).toHaveBeenCalledWith(peerPubKey, externalIp1);
      expect(lnd['openChannelSync']).toHaveBeenCalledTimes(1);
      expect(lnd['openChannelSync']).toHaveBeenCalledWith(peerPubKey, Number(units), 0, 0);
    });

    test('it pushes satoshis to the peer when specified', async () => {
      expect.assertions(4);
      const pushUnits = 481824n;
      lnd['openChannelSync'] = jest.fn().mockReturnValue(Promise.resolve(openChannelSyncResponse));
      lnd['connectPeer'] = jest.fn().mockImplementationOnce(() => {
        return Promise.resolve();
      });
      await lnd.openChannel({
        units,
        pushUnits,
        remoteIdentifier: peerPubKey,
        uris: lndListeningUris,
      });
      expect(lnd['connectPeer']).toHaveBeenCalledTimes(1);
      expect(lnd['connectPeer']).toHaveBeenCalledWith(peerPubKey, externalIp1);
      expect(lnd['openChannelSync']).toHaveBeenCalledTimes(1);
      expect(lnd['openChannelSync']).toHaveBeenCalledWith(peerPubKey, Number(units), Number(pushUnits), 0);
    });

    test('it should set fee when specified', async () => {
      expect.assertions(4);
      const fee = 24;
      lnd['openChannelSync'] = jest.fn().mockReturnValue(Promise.resolve(openChannelSyncResponse));
      lnd['connectPeer'] = jest.fn().mockImplementationOnce(() => {
        return Promise.resolve();
      });
      await lnd.openChannel({
        units,
        fee,
        remoteIdentifier: peerPubKey,
        uris: lndListeningUris,
      });
      expect(lnd['connectPeer']).toHaveBeenCalledTimes(1);
      expect(lnd['connectPeer']).toHaveBeenCalledWith(peerPubKey, externalIp1);
      expect(lnd['openChannelSync']).toHaveBeenCalledTimes(1);
      expect(lnd['openChannelSync']).toHaveBeenCalledWith(peerPubKey, Number(units), 0, fee);
    });

    test('it stops trying to connect to lnd uris when first once succeeds', async () => {
      expect.assertions(3);
      lnd['openChannelSync'] = jest.fn().mockReturnValue(Promise.resolve(openChannelSyncResponse));
      lnd['connectPeer'] = jest.fn().mockImplementationOnce(() => {
        return Promise.resolve();
      });
      await lnd.openChannel({
        units,
        remoteIdentifier: peerPubKey,
        uris: lndListeningUris,
      });
      expect(lnd['connectPeer']).toHaveBeenCalledTimes(1);
      expect(lnd['connectPeer']).toHaveBeenCalledWith(peerPubKey, externalIp1);
      expect(lnd['connectPeer']).not.toHaveBeenCalledWith(peerPubKey, externalIp2);
    });

    test('it throws when openchannel fails', async () => {
      expect.assertions(2);
      lnd['connectPeer'] = jest.fn().mockReturnValue(Promise.resolve());
      lnd['openChannelSync'] = jest.fn().mockImplementation(() => {
        throw new Error('openChannelSync error');
      });
      try {
        await lnd.openChannel({
          units,
          remoteIdentifier: peerPubKey,
          uris: lndListeningUris,
        });
      } catch (e) {
        expect(e).toMatchSnapshot();
      }
      expect(lnd['openChannelSync']).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendPayment', () => {
    test('it resolves upon maker success', async () => {
      lnd['sendPaymentV2'] = jest.fn().mockReturnValue(Promise.resolve(preimage));
      const deal = getValidDeal();
      const buildSendRequestSpy = jest.spyOn(lnd as any, 'buildSendRequest');
      await expect(lnd.sendPayment(deal)).resolves.toEqual(preimage);
      expect(buildSendRequestSpy).toHaveBeenCalledWith({
        amount: deal.takerAmount,
        destination: deal.takerPubKey,
        rHash: deal.rHash,
        cltvLimit: deal.takerMaxTimeLock + 3,
        finalCltvDelta: deal.takerCltvDelta,
      });
    });

    test('it resolves upon taker success', async () => {
      lnd['sendPaymentV2'] = jest.fn().mockReturnValue(Promise.resolve(preimage));
      const deal = {
        ...getValidDeal(),
        role: SwapRole.Taker,
      };
      const buildSendRequestSpy = jest.spyOn(lnd as any, 'buildSendRequest');
      await expect(lnd.sendPayment(deal)).resolves.toEqual(preimage);
      expect(buildSendRequestSpy).toHaveBeenCalledWith({
        amount: deal.makerAmount,
        destination: deal.destination,
        finalCltvDelta: deal.makerCltvDelta,
        rHash: deal.rHash,
      });
    });

    test('it rejects upon sendPaymentSync error', async () => {
      lnd['sendPaymentV2'] = jest.fn().mockRejectedValue('error');
      await expect(lnd.sendPayment(getValidDeal())).rejects.toEqual('error');
    });

    test('it resolves upon sendSmallestAmount success', async () => {
      lnd['sendPaymentV2'] = jest.fn().mockReturnValue(Promise.resolve(preimage));
      const buildSendRequestSpy = jest.spyOn(lnd as any, 'buildSendRequest');
      const rHash = '04b6ac45b770ec4abbb9713aebfa57b963a1f6c7a795d9b5757687e0688add80';
      const destination = '034c5266591bff232d1647f45bcf6bbc548d3d6f70b2992d28aba0afae067880ac';
      await expect(lnd.sendSmallestAmount(rHash, destination)).resolves.toEqual(preimage);
      expect(buildSendRequestSpy).toHaveBeenCalledWith({
        destination,
        rHash,
        finalCltvDelta: lnd.finalLock,
        amount: 1,
      });
    });
  });

  describe('swapCapacities', () => {
    test('fetch and persist swap capacities', async () => {
      expect.assertions(5);

      lnd['pendingChannels'] = jest.fn().mockImplementation(() => {
        return Promise.resolve({
          toObject: () => {
            return { pendingOpenChannelsList: [] };
          },
        });
      });

      lnd['listChannels'] = jest.fn().mockImplementation(() => {
        return Promise.resolve({
          toObject: () => {
            return {
              channelsList: [
                {
                  active: true,
                  localBalance: 100,
                  localChanReserveSat: 2,
                  remoteBalance: 200,
                  remoteChanReserveSat: 5,
                },
                {
                  active: true,
                  localBalance: 80,
                  localChanReserveSat: 2,
                  remoteBalance: 220,
                  remoteChanReserveSat: 5,
                },
                {
                  active: true,
                  localBalance: 110,
                  localChanReserveSat: 20,
                  remoteBalance: 300,
                  remoteChanReserveSat: 5,
                },
                {
                  active: false,
                  localBalance: 50,
                  localChanReserveSat: 2,
                  remoteBalance: 50,
                  remoteChanReserveSat: 2,
                },
              ],
            };
          },
        });
      });

      const expectedOutbound = 100 + 80 + 110 - 2 - 2 - 20; // 266
      const expectedInbound = 200 + 220 + 300 - 5 - 5 - 5; // 705

      const swapCapacities = await lnd.swapCapacities();
      expect(swapCapacities.maxOutboundChannelCapacity).toEqual(expectedOutbound);
      expect(swapCapacities.maxInboundChannelCapacity).toEqual(expectedInbound);

      expect(lnd['listChannels']).toHaveBeenCalledTimes(1);
      expect(lnd['totalOutboundAmount']).toEqual(expectedOutbound);
      expect(lnd['totalInboundAmount']).toEqual(expectedInbound);
    });
  });
});
