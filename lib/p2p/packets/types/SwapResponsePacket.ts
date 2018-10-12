import Packet, { PacketDirection } from '../Packet';
import PacketType from '../PacketType';

// TODO: proper error handling
export type SwapResponsePacketBody = {
  rHash: string;
  /** Specifies the accepted quantity (which may be less than the proposed quantity). */
  quantity: number;
  makerCltvDelta: number;
};

class SwapAcceptedPacket extends Packet<SwapResponsePacketBody> {
  public get type() {
    return PacketType.SwapResponse;
  }

  public get direction() {
    return PacketDirection.Response;
  }
}

export default SwapAcceptedPacket;
