import Packet, { PacketDirection } from '../Packet';
import PacketType from '../PacketType';

// TODO: proper error handling
export type SwapErrorPacketBody = {
  rHash: string;
  errorMessage: string;
};

class SwapFailedPacket extends Packet<SwapErrorPacketBody> {
  public get type() {
    return PacketType.SwapError;
  }

  public get direction(): PacketDirection {
    // SwapFailedPacket may serve as a response to SwapRequest packet
    if (this.header.reqId) {
      return PacketDirection.Response;
    }
    return PacketDirection.Unilateral;
  }
}

export default SwapFailedPacket;
