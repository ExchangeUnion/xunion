import * as pb from '../../../proto/xudp2p_pb';
import { removeUndefinedProps } from '../../../utils/utils';
import Packet, { PacketDirection, ResponseType } from '../Packet';
import PacketType from '../PacketType';

// TODO: proper error handling
export type SwapAcceptedPacketBody = {
  rHash: string;
  /** Specifies the accepted quantity (which may be less than the proposed quantity). */
  quantity: number;
  /** The CLTV delta from the current height that should be used to set the timelock for the final hop when sending to maker. */
  makerCltvDelta: number;
  payReq?: string;
};

class SwapAcceptedPacket extends Packet<SwapAcceptedPacketBody> {
  public get type(): PacketType {
    return PacketType.SwapAccepted;
  }

  public get direction(): PacketDirection {
    return PacketDirection.Response;
  }

  public get responseType(): ResponseType {
    return undefined;
  }

  public static deserialize = (binary: Uint8Array): SwapAcceptedPacket | pb.SwapAcceptedPacket.AsObject => {
    const obj = pb.SwapAcceptedPacket.deserializeBinary(binary).toObject();
    return SwapAcceptedPacket.validate(obj) ? SwapAcceptedPacket.convert(obj) : obj;
  };

  private static validate = (obj: pb.SwapAcceptedPacket.AsObject): boolean => {
    return !!(obj.id && obj.reqId && obj.rHash && obj.quantity && obj.makerCltvDelta);
  };

  private static convert = (obj: pb.SwapAcceptedPacket.AsObject): SwapAcceptedPacket => {
    return new SwapAcceptedPacket({
      header: {
        id: obj.id,
        reqId: obj.reqId,
      },
      body: removeUndefinedProps({
        rHash: obj.rHash,
        quantity: obj.quantity,
        makerCltvDelta: obj.makerCltvDelta,
        payReq: obj.payReq || undefined,
      }),
    });
  };

  public serialize = (): Uint8Array => {
    const msg = new pb.SwapAcceptedPacket();
    msg.setId(this.header.id);
    msg.setReqId(this.header.reqId!);
    msg.setRHash(this.body!.rHash);
    msg.setQuantity(this.body!.quantity);
    msg.setMakerCltvDelta(this.body!.makerCltvDelta);
    if (this.body!.payReq) {
      msg.setPayReq(this.body!.payReq);
    }

    return msg.serializeBinary();
  };
}

export default SwapAcceptedPacket;
