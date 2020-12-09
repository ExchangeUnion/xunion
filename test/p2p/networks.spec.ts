/* tslint:disable max-line-length */
import chai, { expect } from 'chai';
import Xud from '../../lib/Xud';
import chaiAsPromised from 'chai-as-promised';
import { toUri } from '../../lib/utils/uriUtils';
import { XuNetwork } from '../../lib/constants/enums';
import { createConfig } from './sanity.spec';

chai.use(chaiAsPromised);

describe('P2P Networks Tests', () => {
  function testConnectionFailure(srcNodeNetwork: XuNetwork, destNodeNetwork: XuNetwork) {
    it(`should fail to connect a node from ${srcNodeNetwork} to a node from ${destNodeNetwork}`, async () => {
      const srcNodeConfig = createConfig(1, 0, false, srcNodeNetwork);
      const destNodeConfig = createConfig(2, 0, false, destNodeNetwork);
      const srcNode = new Xud();
      const destNode = new Xud();
      await Promise.all([srcNode.start(srcNodeConfig), destNode.start(destNodeConfig)]);

      const host = 'localhost';
      const port = destNode['pool']!['listenPort']!;
      const nodePubKey = destNode['pool']!.nodePubKey;
      const nodeTwoUri = toUri({ host, port, nodePubKey });

      const rejectionMsg = `Peer ${nodePubKey}@${host}:${port} closed due to WireProtocolErr framer: incompatible msg origin network (expected: ${srcNodeNetwork}, found: ${destNodeNetwork})`;
      await expect(srcNode.service.connect({ nodeUri: nodeTwoUri, retryConnecting: false })).to.be.rejectedWith(rejectionMsg);

      expect(await srcNode.service.listPeers().length).to.equal(0);
      expect(await destNode.service.listPeers().length).to.equal(0);

      await Promise.all([srcNode['shutdown'](), destNode['shutdown']()]);
    });
  }

  function testConnectionSuccess(srcNodeNetwork: XuNetwork, destNodeNetwork: XuNetwork) {
    it(`should successfully connect a node from ${srcNodeNetwork} to a node from ${destNodeNetwork}`, async () => {
      const srcNodeConfig = createConfig(1, 0, false, srcNodeNetwork);
      const destNodeConfig = createConfig(2, 0, false, destNodeNetwork);
      const srcNode = new Xud();
      const destNode = new Xud();
      await Promise.all([srcNode.start(srcNodeConfig), destNode.start(destNodeConfig)]);
      const srcNodePubKey = srcNode['pool']!.nodePubKey;
      const destNodePubKey = destNode['pool']!.nodePubKey;

      const host = 'localhost';
      const port = destNode['pool']!['listenPort']!;
      const nodeTwoUri = toUri({ host, port, nodePubKey: destNodePubKey });

      await expect(srcNode.service.connect({ nodeUri: nodeTwoUri, retryConnecting: false })).to.be.fulfilled;

      const peers = srcNode.service.listPeers();
      expect(peers.length).to.equal(1);
      expect(peers[0].nodePubKey).to.equal(destNodePubKey);

      const verifyDestNodePeers = () => new Promise((resolve) => {
        setTimeout(() => {
          const peers = destNode.service.listPeers();
          expect(peers.length).to.equal(1);
          expect(peers[0].nodePubKey).to.equal(srcNodePubKey);
          resolve();
        }, 100);
      });
      await verifyDestNodePeers();

      await Promise.all([srcNode['shutdown'](), destNode['shutdown']()]);
    });
  }

  testConnectionFailure(XuNetwork.MainNet, XuNetwork.SimNet);
  testConnectionFailure(XuNetwork.MainNet, XuNetwork.TestNet);
  testConnectionFailure(XuNetwork.MainNet, XuNetwork.RegTest);
  testConnectionFailure(XuNetwork.TestNet, XuNetwork.MainNet);
  testConnectionFailure(XuNetwork.TestNet, XuNetwork.SimNet);
  testConnectionFailure(XuNetwork.TestNet, XuNetwork.RegTest);
  testConnectionFailure(XuNetwork.SimNet, XuNetwork.MainNet);
  testConnectionFailure(XuNetwork.SimNet, XuNetwork.TestNet);
  testConnectionFailure(XuNetwork.SimNet, XuNetwork.RegTest);
  testConnectionFailure(XuNetwork.RegTest, XuNetwork.MainNet);
  testConnectionFailure(XuNetwork.RegTest, XuNetwork.TestNet);
  testConnectionFailure(XuNetwork.RegTest, XuNetwork.SimNet);

  testConnectionSuccess(XuNetwork.SimNet, XuNetwork.SimNet);
  testConnectionSuccess(XuNetwork.TestNet, XuNetwork.TestNet);
  testConnectionSuccess(XuNetwork.SimNet, XuNetwork.SimNet);
  testConnectionSuccess(XuNetwork.RegTest, XuNetwork.RegTest);
});
