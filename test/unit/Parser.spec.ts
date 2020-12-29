import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { randomBytes } from 'crypto';
import { DisconnectionReason, SwapFailureReason, XuNetwork } from '../../lib/constants/enums';
import { errorCodes } from '../../lib/p2p/errors';
import Framer from '../../lib/p2p/Framer';
import Network from '../../lib/p2p/Network';
import { Packet, PacketType } from '../../lib/p2p/packets';
import * as packets from '../../lib/p2p/packets/types';
import { SessionInitPacketBody } from '../../lib/p2p/packets/types/SessionInitPacket';
import Parser from '../../lib/p2p/Parser';
import { Address, NodeState } from '../../lib/p2p/types';
import { removeUndefinedProps as removeUndefinedPropsTyped } from '../../lib/utils/utils';
import uuid = require('uuid');
import stringify = require('json-stable-stringify');

const removeUndefinedProps = (obj: any): any => {
  return removeUndefinedPropsTyped(obj);
};

chai.use(chaiAsPromised);

describe('Parser', () => {
  const timeoutError = 'timeout';
  const network = new Network(XuNetwork.SimNet);
  const framer = new Framer(network);
  const encryptionKey = randomBytes(Framer.ENCRYPTION_KEY_LENGTH);
  const rHash = '62c8bbef4587cff4286246e63044dc3e454b5693fb5ebd0171b7e58644bfafe2';
  let parser: Parser;

  beforeEach(() => {
    parser = new Parser(framer);
  });

  function waitForPackets(num = 1): Promise<Packet[]> {
    return new Promise((resolve, reject) => {
      setTimeout(() => reject(timeoutError), 50);
      const parsedPackets: Packet[] = [];
      parser.on('packet', (parsedPacket: Packet) => {
        parsedPackets.push(parsedPacket);
        if (parsedPackets.length === num) {
          resolve(parsedPackets);
        }
      });
      parser.once('error', reject);
    });
  }

  function verify(packets: Packet[]): Promise<Packet[]> {
    return new Promise((resolve, reject) => {
      waitForPackets(packets.length)
        .then((parsedPackets) => {
          for (let i = 0; i < packets.length; i += 1) {
            expect(stringify(packets[i])).to.equal(stringify(parsedPackets[i]));
            expect(packets[i].type).to.equal(parsedPackets[i].type);
          }
          resolve();
        })
        .catch(reject);
    });
  }

  function testValidPacket(packet: Packet) {
    it(`should parse a valid ${PacketType[packet.type]} packet`, (done) => {
      verify([packet]).then(done).catch(done);

      framer.frame(packet).then(parser.feed).catch(done);
    });

    it(`should parse an encrypted valid ${PacketType[packet.type]} packet`, (done) => {
      verify([packet]).then(done).catch(done);

      parser.setEncryptionKey(encryptionKey);

      framer.frame(packet, encryptionKey).then(parser.feed).catch(done);
    });
  }

  function testInvalidPacket(packet: Packet) {
    it(`should not parse an invalid ${PacketType[packet.type]} packet`, (done) => {
      verify([packet])
        .then(() => done('err: packet is valid'))
        .catch(() => done());

      framer.frame(packet).then(parser.feed).catch(done);
    });
  }

  function testSplitPacket(packet: Packet) {
    it(`should parse ${PacketType[packet.type]} packet split`, (done) => {
      verify([packet]).then(done).catch(done);

      framer
        .frame(packet)
        .then((data) => {
          const middleIndex = data.length >> 1;
          parser.feed(data.slice(0, middleIndex));
          parser.feed(data.slice(middleIndex));
        })
        .catch(done);
    });

    it(`should parse encrypted ${PacketType[packet.type]} packet split`, (done) => {
      verify([packet]).then(done).catch(done);

      parser.setEncryptionKey(encryptionKey);

      framer
        .frame(packet, encryptionKey)
        .then((data) => {
          const middleIndex = data.length >> 1;
          parser.feed(data.slice(0, middleIndex));
          parser.feed(data.slice(middleIndex));
        })
        .catch(done);
    });
  }

  function testConcatenatedPackets(packets: Packet[]) {
    it(`should parse ${packets.map((packet) => PacketType[packet.type]).join(' ')} concatenated`, (done) => {
      verify(packets).then(done).catch(done);

      Promise.all(
        packets.map((packet) => {
          return framer.frame(packet);
        }),
      )
        .then((buffers) => {
          parser.feed(Buffer.concat(buffers));
        })
        .catch(done);
    });

    it(`should parse encrypted ${packets.map((packet) => PacketType[packet.type]).join(' ')} concatenated`, (done) => {
      verify(packets).then(done).catch(done);

      parser.setEncryptionKey(encryptionKey);

      Promise.all(
        packets.map((packet) => {
          return framer.frame(packet, encryptionKey);
        }),
      )
        .then((buffers) => {
          parser.feed(Buffer.concat(buffers));
        })
        .catch(done);
    });
  }

  function testConcatenatedAndSplit(packets: Packet[], splitByte: number) {
    const packetsStr = packets.map((packet) => PacketType[packet.type]).join(' ');
    it(`should parse ${packetsStr} concatenated and split on byte ${splitByte} from each packet beginning`, (done) => {
      verify(packets).catch(done);

      let remaining = Buffer.alloc(0);
      const framerPromises: Promise<void>[] = [];
      packets.forEach((packet) => {
        framerPromises.push(
          framer.frame(packet).then((buffer) => {
            const concatBuffer = Buffer.concat([remaining, buffer]);
            const chunk = concatBuffer.slice(0, splitByte); // split on a specific byte
            remaining = concatBuffer.slice(splitByte); // keep the remaining for the next chunk
            parser.feed(chunk);
          }),
        );
      });
      Promise.all(framerPromises)
        .then(() => {
          parser.feed(remaining);
          done();
        })
        .catch(done);
    });

    it(`should parse encrypted ${packetsStr} concatenated and split on byte ${splitByte} from each packet beginning`, (done) => {
      verify(packets).then(done).catch(done);

      parser.setEncryptionKey(encryptionKey);

      let remaining = Buffer.alloc(0);
      const framerPromises: Promise<void>[] = [];
      packets.forEach((packet) => {
        framerPromises.push(
          framer.frame(packet, encryptionKey).then((buffer) => {
            const concatBuffer = Buffer.concat([remaining, buffer]);
            const chunk = concatBuffer.slice(0, splitByte); // split on a specific byte
            remaining = concatBuffer.slice(splitByte); // keep the remaining for the next chunk
            parser.feed(chunk);
          }),
        );
      });
      Promise.all(framerPromises)
        .then(() => {
          parser.feed(remaining);
        })
        .catch(done);
    });
  }

  const nodeState: NodeState = {
    addresses: [
      { host: '1.1.1.1', port: 8885 },
      { host: '2.2.2.2', port: 8885 },
    ],
    pairs: [uuid()],
    connextIdentifier: uuid(),
    lndPubKeys: { BTC: uuid(), LTC: uuid() },
    lndUris: { BTC: [''], LTC: [''] },
    tokenIdentifiers: { BTC: 'bitcoin-testnet', LTC: 'litecoin-testnet' },
  };

  const sessionInitPacketBody: SessionInitPacketBody = {
    nodeState,
    version: '1.0.0',
    nodePubKey: uuid(),
    sign: uuid(),
    peerPubKey: uuid(),
    ephemeralPubKey: uuid(),
  };

  describe('test packets validation', () => {
    testValidPacket(new packets.PingPacket());
    testInvalidPacket(new packets.PingPacket(undefined, uuid()));

    testValidPacket(new packets.PongPacket(undefined, uuid()));
    testInvalidPacket(new packets.PongPacket(undefined));

    testValidPacket(new packets.SessionInitPacket(sessionInitPacketBody));
    testValidPacket(
      new packets.SessionInitPacket({
        ...sessionInitPacketBody,
        nodeState: { ...nodeState, pairs: [] },
      }),
    );
    testValidPacket(
      new packets.SessionInitPacket({
        ...sessionInitPacketBody,
        nodeState: { ...nodeState, addresses: [] },
      }),
    );
    testValidPacket(
      new packets.SessionInitPacket({
        ...sessionInitPacketBody,
        nodeState: removeUndefinedProps({
          ...nodeState,
          lndPubKeys: { ...nodeState.lndPubKeys, BTC: undefined },
        }),
      }),
    );
    testValidPacket(
      new packets.SessionInitPacket({
        ...sessionInitPacketBody,
        nodeState: removeUndefinedProps({
          ...nodeState,
          lndPubKeys: { ...nodeState.lndPubKeys, LTC: undefined },
        }),
      }),
    );
    testValidPacket(
      new packets.SessionInitPacket({
        ...sessionInitPacketBody,
        nodeState: removeUndefinedProps({
          ...nodeState,
          tokenIdentifiers: { ...nodeState.tokenIdentifiers, BTC: undefined },
        }),
      }),
    );
    testInvalidPacket(new packets.SessionInitPacket(sessionInitPacketBody, uuid()));
    testInvalidPacket(
      new packets.SessionInitPacket(removeUndefinedProps({ ...sessionInitPacketBody, sign: undefined })),
    );
    testInvalidPacket(
      new packets.SessionInitPacket(
        removeUndefinedProps({
          ...sessionInitPacketBody,
          ephemeralPubKey: undefined,
        }),
      ),
    );
    testInvalidPacket(
      new packets.SessionInitPacket(
        removeUndefinedProps({
          ...sessionInitPacketBody,
          peerPubKey: undefined,
        }),
      ),
    );
    testInvalidPacket(
      new packets.SessionInitPacket({
        ...sessionInitPacketBody,
        nodeState: { ...nodeState, addresses: [{} as Address] },
      }),
    );

    const sessionAckPacketBody = {
      ephemeralPubKey: sessionInitPacketBody.ephemeralPubKey,
    };
    testValidPacket(new packets.SessionAckPacket(sessionAckPacketBody, uuid()));
    testInvalidPacket(new packets.SessionAckPacket(sessionAckPacketBody));
    testInvalidPacket(
      new packets.SessionAckPacket(
        removeUndefinedProps({
          ...sessionAckPacketBody,
          ephemeralPubKey: undefined,
        }),
        uuid(),
      ),
    );

    testValidPacket(new packets.NodeStateUpdatePacket(nodeState));
    testValidPacket(new packets.NodeStateUpdatePacket({ ...nodeState, pairs: [] }));
    testValidPacket(new packets.NodeStateUpdatePacket({ ...nodeState, addresses: [] }));
    testValidPacket(
      new packets.NodeStateUpdatePacket(
        removeUndefinedProps({
          ...nodeState,
          lndPubKeys: { ...nodeState.lndPubKeys, BTC: undefined },
        }),
      ),
    );
    testValidPacket(
      new packets.NodeStateUpdatePacket(
        removeUndefinedProps({
          ...nodeState,
          lndPubKeys: { ...nodeState.lndPubKeys, LTC: undefined },
        }),
      ),
    );
    testValidPacket(
      new packets.NodeStateUpdatePacket(
        removeUndefinedProps({
          ...nodeState,
          tokenIdentifiers: { ...nodeState.tokenIdentifiers, LTC: undefined },
        }),
      ),
    );
    testInvalidPacket(new packets.NodeStateUpdatePacket(nodeState, uuid()));
    testInvalidPacket(
      new packets.NodeStateUpdatePacket({
        ...nodeState,
        addresses: [{} as Address],
      }),
    );

    const disconnectingPacketBody = {
      reason: DisconnectionReason.IncompatibleProtocolVersion,
      payload: uuid(),
    };
    testValidPacket(new packets.DisconnectingPacket(disconnectingPacketBody));
    testValidPacket(
      new packets.DisconnectingPacket(removeUndefinedProps({ ...disconnectingPacketBody, payload: undefined })),
    );
    testInvalidPacket(new packets.DisconnectingPacket(disconnectingPacketBody, uuid()));
    testInvalidPacket(
      new packets.DisconnectingPacket(removeUndefinedProps({ ...disconnectingPacketBody, reason: undefined })),
    );

    testValidPacket(new packets.GetNodesPacket());
    testInvalidPacket(new packets.GetNodesPacket(undefined, uuid()));

    const node = {
      nodePubKey: uuid(),
      addresses: [
        { host: '1.1.1.1', port: 8885 },
        { host: '2.2.2.2', port: 8885 },
      ],
    };
    testValidPacket(new packets.NodesPacket([node], uuid()));
    testInvalidPacket(new packets.NodesPacket([node]));
    testInvalidPacket(new packets.NodesPacket([removeUndefinedProps({ ...node, nodePubKey: undefined })], uuid()));
    testInvalidPacket(new packets.NodesPacket([{ ...node, addresses: [] }], uuid()));

    const orderPacketBody = {
      id: uuid(),
      pairId: uuid(),
      price: 10,
      quantity: 10,
      isBuy: false,
    };
    testValidPacket(new packets.OrderPacket(orderPacketBody));
    testValidPacket(new packets.OrderPacket({ ...orderPacketBody, isBuy: true }));
    testValidPacket(new packets.OrderPacket({ ...orderPacketBody, replaceOrderId: uuid() }));
    testInvalidPacket(new packets.OrderPacket(orderPacketBody, uuid()));
    testInvalidPacket(new packets.OrderPacket(removeUndefinedProps({ ...orderPacketBody, id: undefined })));
    testInvalidPacket(new packets.OrderPacket(removeUndefinedProps({ ...orderPacketBody, pairId: undefined })));
    testInvalidPacket(new packets.OrderPacket(removeUndefinedProps({ ...orderPacketBody, price: undefined })));
    testInvalidPacket(new packets.OrderPacket(removeUndefinedProps({ ...orderPacketBody, price: 0 })));
    testInvalidPacket(new packets.OrderPacket(removeUndefinedProps({ ...orderPacketBody, quantity: undefined })));
    testInvalidPacket(new packets.OrderPacket(removeUndefinedProps({ ...orderPacketBody, quantity: 0 })));

    const orderInvalidationPacketBody = {
      id: uuid(),
      pairId: uuid(),
      quantity: 10,
    };
    testValidPacket(new packets.OrderInvalidationPacket(orderInvalidationPacketBody));
    testInvalidPacket(new packets.OrderInvalidationPacket(orderInvalidationPacketBody, uuid()));
    testInvalidPacket(new packets.OrderInvalidationPacket(removeUndefinedProps({ ...orderPacketBody, id: undefined })));
    testInvalidPacket(
      new packets.OrderInvalidationPacket(removeUndefinedProps({ ...orderPacketBody, pairId: undefined })),
    );
    testInvalidPacket(
      new packets.OrderInvalidationPacket(removeUndefinedProps({ ...orderPacketBody, quantity: undefined })),
    );
    testInvalidPacket(new packets.OrderInvalidationPacket(removeUndefinedProps({ ...orderPacketBody, quantity: 0 })));

    const getOrdersPacketBody = { pairIds: [uuid()] };
    testValidPacket(new packets.GetOrdersPacket(getOrdersPacketBody));
    testInvalidPacket(new packets.GetOrdersPacket(getOrdersPacketBody, uuid()));
    testInvalidPacket(
      new packets.GetOrdersPacket(removeUndefinedProps({ ...getOrdersPacketBody, pairIds: undefined })),
    );
    testInvalidPacket(new packets.GetOrdersPacket(removeUndefinedProps({ ...getOrdersPacketBody, pairIds: [] })));

    const ordersPacketBody = [orderPacketBody];
    testValidPacket(new packets.OrdersPacket(ordersPacketBody, uuid()));
    testValidPacket(new packets.OrdersPacket([], uuid()));
    testInvalidPacket(new packets.OrdersPacket(ordersPacketBody));

    const sanitySwapInitPacketBody = {
      rHash,
      currency: 'BTC',
    };
    testValidPacket(new packets.SanitySwapInitPacket(sanitySwapInitPacketBody));
    testInvalidPacket(new packets.SanitySwapInitPacket(sanitySwapInitPacketBody, uuid()));
    testInvalidPacket(
      new packets.SanitySwapInitPacket(
        removeUndefinedProps({
          ...sanitySwapInitPacketBody,
          currency: undefined,
        }),
      ),
    );
    testInvalidPacket(
      new packets.SanitySwapInitPacket(removeUndefinedProps({ ...sanitySwapInitPacketBody, rHash: undefined })),
    );

    const swapRequestPacketBody = {
      rHash,
      proposedQuantity: 10,
      pairId: uuid(),
      orderId: uuid(),
      takerCltvDelta: 10,
      payReq:
        'lnbc420n1p06uxnfpp5hxq94vpge8kpxj76hghn4uk940w38hjy5wpzqdzupmyajczhgyssdqqcqzpgsp57nj39u8wz0hkjs2pszlvcqysgvttk9039dnw3zv6evlywu37uy7q9qy9qsqjp4vqexungwscl6mkdx5eejf6rf09c0red8g8hzh4qrh0yzwuudzssv3yndmpsacaczxfwkevp3h4yf5wk5xqkwnf0s8nlhdvedydpsqsa7a8y',
    };
    testValidPacket(new packets.SwapRequestPacket(swapRequestPacketBody));
    testValidPacket(
      new packets.SwapRequestPacket(removeUndefinedProps({ ...swapRequestPacketBody, payReq: undefined })),
    );
    testInvalidPacket(new packets.SwapRequestPacket(swapRequestPacketBody, uuid()));
    testInvalidPacket(
      new packets.SwapRequestPacket(
        removeUndefinedProps({
          ...swapRequestPacketBody,
          proposedQuantity: undefined,
        }),
      ),
    );
    testInvalidPacket(
      new packets.SwapRequestPacket(removeUndefinedProps({ ...swapRequestPacketBody, proposedQuantity: 0 })),
    );
    testInvalidPacket(
      new packets.SwapRequestPacket(removeUndefinedProps({ ...swapRequestPacketBody, orderId: undefined })),
    );
    testInvalidPacket(
      new packets.SwapRequestPacket(removeUndefinedProps({ ...swapRequestPacketBody, rHash: undefined })),
    );
    testInvalidPacket(
      new packets.SwapRequestPacket(
        removeUndefinedProps({
          ...swapRequestPacketBody,
          takerCltvDelta: undefined,
        }),
      ),
    );
    testInvalidPacket(
      new packets.SwapRequestPacket(removeUndefinedProps({ ...swapRequestPacketBody, takerCltvDelta: 0 })),
    );

    const swapAcceptedPacketBody = {
      rHash,
      quantity: 10,
      makerCltvDelta: 10,
      payReq:
        'lnbc420n1p06uxnfpp5hxq94vpge8kpxj76hghn4uk940w38hjy5wpzqdzupmyajczhgyssdqqcqzpgsp57nj39u8wz0hkjs2pszlvcqysgvttk9039dnw3zv6evlywu37uy7q9qy9qsqjp4vqexungwscl6mkdx5eejf6rf09c0red8g8hzh4qrh0yzwuudzssv3yndmpsacaczxfwkevp3h4yf5wk5xqkwnf0s8nlhdvedydpsqsa7a8y',
    };
    testValidPacket(new packets.SwapAcceptedPacket(swapAcceptedPacketBody, uuid()));
    testValidPacket(
      new packets.SwapAcceptedPacket(removeUndefinedProps({ ...swapAcceptedPacketBody, payReq: undefined }), uuid()),
    );
    testInvalidPacket(new packets.SwapAcceptedPacket(swapAcceptedPacketBody));
    testInvalidPacket(
      new packets.SwapAcceptedPacket(removeUndefinedProps({ ...swapAcceptedPacketBody, rHash: undefined }), uuid()),
    );
    testInvalidPacket(
      new packets.SwapAcceptedPacket(removeUndefinedProps({ ...swapAcceptedPacketBody, quantity: undefined }), uuid()),
    );
    testInvalidPacket(
      new packets.SwapAcceptedPacket(removeUndefinedProps({ ...swapAcceptedPacketBody, quantity: 0 }), uuid()),
    );
    testInvalidPacket(
      new packets.SwapAcceptedPacket(
        removeUndefinedProps({ ...swapAcceptedPacketBody, makerCltvDelta: undefined }),
        uuid(),
      ),
    );
    testInvalidPacket(
      new packets.SwapAcceptedPacket(removeUndefinedProps({ ...swapAcceptedPacketBody, makerCltvDelta: 0 }), uuid()),
    );

    const swapFailedPacketBody = {
      rHash,
      errorMessage: 'this is a test',
      failureReason: SwapFailureReason.SendPaymentFailure,
    };
    testValidPacket(new packets.SwapFailedPacket(swapFailedPacketBody));
    testValidPacket(new packets.SwapFailedPacket(swapFailedPacketBody, uuid()));
    testValidPacket(
      new packets.SwapFailedPacket(
        removeUndefinedProps({
          ...swapFailedPacketBody,
          errorMessage: undefined,
        }),
      ),
    );
    testInvalidPacket(
      new packets.SwapFailedPacket(removeUndefinedProps({ ...swapFailedPacketBody, rHash: undefined })),
    );
    testInvalidPacket(
      new packets.SwapFailedPacket(
        removeUndefinedProps({
          ...swapFailedPacketBody,
          failureReason: undefined,
        }),
      ),
    );
  });
  describe('test TCP segmentation/concatenation support', () => {
    const pingPacket = new packets.PingPacket();
    const sessionInitPacket = new packets.SessionInitPacket(sessionInitPacketBody);

    testSplitPacket(pingPacket);
    testSplitPacket(sessionInitPacket);
    testConcatenatedPackets([pingPacket, sessionInitPacket, pingPacket]);
    testConcatenatedAndSplit([pingPacket, sessionInitPacket, pingPacket], Framer.MSG_HEADER_LENGTH - 1);
    testConcatenatedAndSplit([pingPacket, sessionInitPacket, pingPacket], Framer.MSG_HEADER_LENGTH);
    testConcatenatedAndSplit([pingPacket, sessionInitPacket, pingPacket], Framer.MSG_HEADER_LENGTH + 1);
  });

  describe('test more edge-cases', () => {
    it('should not try to parse an empty buffer', async () => {
      await expect(waitForPackets()).to.be.rejectedWith(timeoutError);
      parser.feed(Buffer.alloc(0));
    });

    it('should not try parse just the header as a packet', (done) => {
      waitForPackets()
        .then(() => done('err: packet should not be parsed'))
        .catch((err) => {
          if (err === timeoutError) {
            done();
          } else {
            done(err);
          }
        });

      const sessionInitPacket = new packets.SessionInitPacket(sessionInitPacketBody);
      framer
        .frame(sessionInitPacket)
        .then((data) => {
          const header = data.slice(0, Framer.MSG_HEADER_LENGTH);
          parser.feed(header);
        })
        .catch(done);
    });

    it('should buffer a max buffer length', (done) => {
      parser = new Parser(framer, Framer.MSG_HEADER_LENGTH, 10);

      waitForPackets()
        .then(() => done('err: packet should not be parsed'))
        .catch((err) => {
          if (err === timeoutError) {
            done();
          } else {
            done(err);
          }
        });

      parser.feed(Buffer.allocUnsafe(10));
    });

    it('should not buffer when max buffer size exceeds', (done) => {
      parser = new Parser(framer, Framer.MSG_HEADER_LENGTH, 10);

      waitForPackets()
        .then(() => done('err: packet should not be parsed'))
        .catch((err) => {
          if (err && err.code === errorCodes.PARSER_MAX_BUFFER_SIZE_EXCEEDED) {
            done();
          } else {
            done(err);
          }
        });

      parser.feed(Buffer.allocUnsafe(11));
    });
  });
});
