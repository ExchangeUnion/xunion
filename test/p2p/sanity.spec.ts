import chai, { expect } from 'chai';
import Xud from '../../lib/Xud';
import chaiAsPromised from 'chai-as-promised';
import { getUri } from '../../lib/utils/utils';
import { getUnusedPort } from '../utils';
import { DisconnectionReason, ReputationEvent } from '../../lib/types/enums';

chai.use(chaiAsPromised);

const createConfig = (instanceid: number, p2pPort: number) => ({
  instanceid,
  initdb: false,
  dbpath: ':memory:',
  loglevel: 'warn',
  logpath: '',
  p2p: {
    listen: true,
    port: p2pPort,
    addresses: [`localhost:${p2pPort}`],
  },
  rpc: {
    disable: true,
  },
  lndbtc: {
    disable: true,
  },
  lndltc: {
    disable: true,
  },
  raiden: {
    disable: true,
  },
});

describe('P2P Sanity Tests', () => {
  let nodeOneConfig: any;
  let nodeOne: Xud;
  let nodeOneUri: string;
  let nodeTwoConfig: any;
  let nodeTwo: Xud;
  let nodeTwoUri: string;
  let nodeTwoPort: number;
  let unusedPort: number;

  before(async () => {
    nodeOneConfig = createConfig(1, 0);
    nodeTwoConfig = createConfig(2, 0);

    nodeOne = new Xud();
    nodeTwo = new Xud();

    await Promise.all([nodeOne.start(nodeOneConfig), nodeTwo.start(nodeTwoConfig)]);

    nodeTwoPort = nodeTwo['pool']['listenPort']!;
    nodeOneUri = getUri({ nodePubKey: nodeOne.nodePubKey, host: 'localhost', port: nodeOne['pool']['listenPort']! });
    nodeTwoUri = getUri({ nodePubKey: nodeTwo.nodePubKey, host: 'localhost', port: nodeTwoPort });

    unusedPort = await getUnusedPort();
  });

  it('should connect successfully', async () => {
    await expect(nodeOne.service.connect({ nodeUri: nodeTwoUri, retryConnecting: false }))
      .to.be.fulfilled;

    const listPeersResult = await nodeOne.service.listPeers();
    expect(listPeersResult.length).to.equal(1);
    expect(listPeersResult[0].nodePubKey).to.equal(nodeTwo.nodePubKey);
  });

  it('should fail connecting to the same node', async () => {
    await expect(nodeOne.service.connect({ nodeUri: nodeTwoUri, retryConnecting: false }))
      .to.be.rejectedWith('already connected');
  });

  it('should disconnect successfully', async () => {
    await expect(nodeOne['pool']['closePeer'](nodeTwo.nodePubKey, DisconnectionReason.NotAcceptingConnections)).to.be.fulfilled;

    const listPeersResult = await nodeOne.service.listPeers();
    expect(listPeersResult).to.be.empty;
  });

  it('should fail when connecting to an unexpected node pub key', async () => {
    const connectPromise = nodeOne.service.connect({
      nodeUri: getUri({ nodePubKey: 'thewrongpubkey', host: 'localhost', port: nodeTwoPort }),
      retryConnecting: false,
    });
    await expect(connectPromise).to.be.rejectedWith(
      `node at localhost:${nodeTwoPort} sent pub key ${nodeTwo.nodePubKey}, expected thewrongpubkey`);
    const listPeersResult = await nodeOne.service.listPeers();
    expect(listPeersResult).to.be.empty;
  });

  it('should fail when connecting to self', async () => {
    await expect(nodeOne.service.connect({ nodeUri: nodeOneUri, retryConnecting: false }))
    .to.be.rejectedWith('cannot attempt connection to self');
  });

  it('should fail connecting to a non-existing node', async () => {
    const port = unusedPort;
    const connectPromise = nodeOne.service.connect({
      nodeUri: getUri({ port, nodePubKey: 'notarealnodepubkey', host: 'localhost' }),
      retryConnecting: false,
    });
    await expect(connectPromise).to.be.rejectedWith(`could not connect to peer at localhost:${port}`);
  });

  it('should revoke connection retries when connecting to the same nodePubKey', (done) => {
    const port = unusedPort;
    const nodePubKey = 'notarealnodepubkey';
    const connectPromise = nodeOne.service.connect({
      nodeUri: getUri({ port, nodePubKey, host: 'localhost' }),
      retryConnecting: true,
    });

    setTimeout(() => {
      expect(nodeOne.service.connect({
        nodeUri: getUri({ port, nodePubKey, host: 'localhost' }),
        retryConnecting: false,
      })).to.be.rejectedWith(`could not connect to peer at localhost:${unusedPort}`);
      done();
    }, 500);

    expect(connectPromise).to.be.rejectedWith(`Connection retry attempts to peer were revoked`);
  });

  after(async () => {
    await Promise.all([nodeOne['shutdown'](), nodeTwo['shutdown']()]);
  });
});
