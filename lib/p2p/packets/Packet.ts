import PacketType from './PacketType';
import crypto from 'crypto';
import uuidv1 from 'uuid/v1';
import stringify from 'json-stable-stringify';

type PacketHeader = {
  /** An identifer for the packet which must be unique for a given socket. */
  id: string;
  /** The id of the received packet to which this packet is responding. */
  reqId?: string;
};

interface PacketInterface {
  body?: any;
  header: PacketHeader;
}

function isPacketInterface(obj: any): obj is PacketInterface {
  if (obj) {
    const header = (<PacketInterface>obj).header;
    return header !== undefined && typeof header.id === 'string';
  }
  return false;
}

function isPacket(obj: any): obj is Packet {
  const p = (<Packet>obj);
  return (
    p.toRaw !== undefined  && typeof p.toRaw === 'function'
    && p.serialize !== undefined && typeof p.serialize === 'function'
    && p.type !== undefined && typeof p.type === 'number'
    && p.direction !== undefined && typeof p.direction === 'number'
  );
}

enum PacketDirection {
  /** A packet that is pushed to a peer without expecting any response. */
  Unilateral,
  /** A packet requesting a response. */
  Request,
  /** A packet that is sent in response to an incoming packet. */
  Response,
}

abstract class Packet<T = any> implements PacketInterface {
  public abstract get type(): PacketType;
  public abstract get direction(): PacketDirection;
  public body?: T;
  public header: PacketHeader;

  /**
   * Create a packet from a deserialized packet message.
   * @param packet a deserialized object containing a packet header and optional body
   */
  constructor(packet: PacketInterface);

  /**
   * Create a packet from a packet body.
   * @param reqId the id of the requesting packet to set on the header if this packet is a response
   */
  constructor(body?: T, reqId?: string);

  constructor(bodyOrPacket?: T | PacketInterface, reqId?: string) {
    if (isPacketInterface(bodyOrPacket)) {
      // we are constructing the deserialized packet
      this.header = bodyOrPacket.header;

      if (bodyOrPacket.body) {
        this.body = bodyOrPacket.body;
      }
    } else {
      // we are constructing a new outgoing packet from a body
      this.header = { id: uuidv1() };

      if (reqId) {
        this.header.reqId = reqId;
      }

      if (bodyOrPacket) {
        this.body = bodyOrPacket;
      }
    }
  }

  public abstract serialize(): Uint8Array;

  public toJSON = () => {
    return stringify({ header: this.header, body: this.body });
  }

  /**
   * Serialize this packet to binary Buffer.
   * @returns Buffer representation of the packet
   */
  public toRaw = (): Buffer => {
    return Buffer.from(this.serialize().buffer as ArrayBuffer);
  }

  public checksum = (): Buffer => {
    return crypto.createHash('sha256').update(this.toJSON()).digest();
  }
}

export default Packet;
export { PacketHeader, PacketDirection, PacketInterface, isPacket };
