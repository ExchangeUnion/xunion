import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import Config from '../../lib/Config';
import { DisconnectionReason, XuNetwork } from '../../lib/constants/enums';
import DB from '../../lib/db/DB';
import Logger, { Level } from '../../lib/Logger';
import NodeKey from '../../lib/nodekey/NodeKey';
import Peer from '../../lib/p2p/Peer';
import Pool from '../../lib/p2p/Pool';
import errors from '../../lib/p2p/errors';
import { Address } from '../../lib/p2p/types';
import addressUtils from '../../lib/utils/addressUtils';

chai.use(chaiAsPromised);

describe('P2P Pool Tests', async () => {
  let db: DB;
  let pool: Pool;
  let nodeKeyOne: NodeKey;
  const loggers = Logger.createLoggers(Level.Warn);
  const sandbox = sinon.createSandbox();

  const createPeer = (nodePubKey: string, addresses: Address[]) => {
    const peer = sandbox.createStubInstance(Peer) as any;
    peer.beginOpen = () => {
      peer.nodeState = {
        addresses,
        pairs: ['LTC/BTC'],
      };
      peer['_nodePubKey'] = nodePubKey;
      peer['_version'] = '100.0.0';
      peer.address = addresses[0];
    };
    peer.completeOpen = () => {};
    peer.socket = {};
    peer.sendPacket = () => {};
    peer.close = async () => {
      peer.sentDisconnectionReason =
        DisconnectionReason.NotAcceptingConnections;
      await pool['handlePeerClose'](peer);
    };
    pool['bindPeer'](peer);

    return peer;
  };

  before(async () => {
    nodeKeyOne = await NodeKey['generate']();
    const nodeKeyTwo = await NodeKey['generate']();

    const config = new Config();
    config.p2p.listen = false;
    config.p2p.discover = false;
    db = new DB(loggers.db);
    await db.init();

    pool = new Pool({
      config: config.p2p,
      xuNetwork: XuNetwork.SimNet,
      logger: loggers.p2p,
      models: db.models,
      nodeKey: nodeKeyTwo,
      version: '1.0.0',
    });

    await pool.init();
  });

  it('should open a connection with a peer', async () => {
    const addresses = [{ host: '123.123.123.123', port: 8885 }];
    const peer = createPeer(nodeKeyOne.pubKey, addresses);

    const openPromise = pool['openPeer'](peer, nodeKeyOne.pubKey);
    expect(openPromise).to.be.fulfilled;
    await openPromise;
  });

  it('should close a peer', async () => {
    await pool.closePeer(
      nodeKeyOne.pubKey,
      DisconnectionReason.NotAcceptingConnections
    );
    expect(pool['peers'].has(nodeKeyOne.pubKey)).to.be.false;
    expect(pool['peers'].size).to.equal(0);
  });

  it('should ban a peer', async () => {
    await pool['nodes'].createNode({
      nodePubKey: nodeKeyOne.pubKey,
      addresses: [],
    });
    const banPromise = pool.banNode(nodeKeyOne.pubKey);
    expect(banPromise).to.be.fulfilled;
    await banPromise;
    const nodeReputationPromise = await pool.getNodeReputation(
      nodeKeyOne.pubKey
    );
    expect(nodeReputationPromise.banned).to.be.true;
  });

  it('should throw error when connecting to tor node with tor disabled', async () => {
    const address = addressUtils.fromString('3g2upl4pq6kufc4m.onion');
    const addPromise = pool.addOutbound(
      address,
      nodeKeyOne.pubKey,
      false,
      false
    );
    await expect(addPromise).to.be.rejectedWith(
      errors.NODE_TOR_ADDRESS(nodeKeyOne.pubKey, address).message
    );
  });

  it('should unban a peer', async () => {
    const unbanPromise = pool.unbanNode(nodeKeyOne.pubKey, false);
    expect(unbanPromise).to.be.fulfilled;
    await unbanPromise;
    const nodeReputationPromise = await pool.getNodeReputation(
      nodeKeyOne.pubKey
    );
    expect(nodeReputationPromise.banned).to.be.false;
  });

  it('should update a node on new handshake', async () => {
    const addresses = [{ host: '86.75.30.9', port: 8885 }];
    const peer = createPeer(nodeKeyOne.pubKey, addresses);

    await pool['openPeer'](peer, nodeKeyOne.pubKey);

    const nodeInstance = await db.models.Node.findOne({
      where: {
        nodePubKey: nodeKeyOne.pubKey,
      },
    });
    expect(nodeInstance).to.not.be.undefined;
    expect(nodeInstance!.addresses!).to.have.length(1);
    expect(nodeInstance!.addresses![0].host).to.equal(addresses[0].host);

    await pool.closePeer(
      nodeKeyOne.pubKey,
      DisconnectionReason.NotAcceptingConnections
    );
  });

  describe('reconnect logic', () => {
    let dcPeer: Peer;
    let tryConnectNodeStub: any;
    beforeEach(async () => {
      const addresses = [{ host: '321.321.321.321', port: 1337 }];
      dcPeer = createPeer(nodeKeyOne.pubKey, addresses);
      tryConnectNodeStub = sinon.stub();
      pool['tryConnectNode'] = tryConnectNodeStub;
      const openPromise = pool['openPeer'](dcPeer, nodeKeyOne.pubKey);
      expect(openPromise).to.be.fulfilled;
      await openPromise;
    });

    it('should not reconnect upon shutdown inbound', async () => {
      dcPeer.inbound = true;
      dcPeer.recvDisconnectionReason = DisconnectionReason.Shutdown;
      await pool['handlePeerClose'](dcPeer);
      expect(tryConnectNodeStub.calledOnce).to.be.equal(false);
    });

    it('should reconnect upon shutdown outbound', async () => {
      dcPeer.recvDisconnectionReason = DisconnectionReason.Shutdown;
      await pool['handlePeerClose'](dcPeer);
      expect(tryConnectNodeStub.calledOnce).to.be.equal(true);
    });

    it('should reconnect upon already connected', async () => {
      dcPeer.recvDisconnectionReason = DisconnectionReason.AlreadyConnected;
      await pool['handlePeerClose'](dcPeer);
      expect(tryConnectNodeStub.calledOnce).to.be.equal(true);
    });
  });

  after(async () => {
    await db.close();
    await pool.disconnect();

    sandbox.restore();
  });
});
