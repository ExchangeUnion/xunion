// package: xudp2p
// file: xudp2p.proto

/* tslint:disable */

import * as jspb from "google-protobuf";

export class Address extends jspb.Message { 
    getHost(): string;
    setHost(value: string): void;

    getPort(): number;
    setPort(value: number): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Address.AsObject;
    static toObject(includeInstance: boolean, msg: Address): Address.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: Address, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): Address;
    static deserializeBinaryFromReader(message: Address, reader: jspb.BinaryReader): Address;
}

export namespace Address {
    export type AsObject = {
        host: string,
        port: number,
    }
}

export class Order extends jspb.Message { 
    getId(): string;
    setId(value: string): void;

    getPairId(): string;
    setPairId(value: string): void;

    getPrice(): number;
    setPrice(value: number): void;

    getQuantity(): number;
    setQuantity(value: number): void;

    getIsBuy(): boolean;
    setIsBuy(value: boolean): void;

    getReplaceOrderId(): string;
    setReplaceOrderId(value: string): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Order.AsObject;
    static toObject(includeInstance: boolean, msg: Order): Order.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: Order, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): Order;
    static deserializeBinaryFromReader(message: Order, reader: jspb.BinaryReader): Order;
}

export namespace Order {
    export type AsObject = {
        id: string,
        pairId: string,
        price: number,
        quantity: number,
        isBuy: boolean,
        replaceOrderId: string,
    }
}

export class Node extends jspb.Message { 
    getNodePubKey(): string;
    setNodePubKey(value: string): void;

    clearAddressesList(): void;
    getAddressesList(): Array<Address>;
    setAddressesList(value: Array<Address>): void;
    addAddresses(value?: Address, index?: number): Address;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Node.AsObject;
    static toObject(includeInstance: boolean, msg: Node): Node.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: Node, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): Node;
    static deserializeBinaryFromReader(message: Node, reader: jspb.BinaryReader): Node;
}

export namespace Node {
    export type AsObject = {
        nodePubKey: string,
        addressesList: Array<Address.AsObject>,
    }
}

export class LndUris extends jspb.Message { 
    clearLndUriList(): void;
    getLndUriList(): Array<string>;
    setLndUriList(value: Array<string>): void;
    addLndUri(value: string, index?: number): string;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): LndUris.AsObject;
    static toObject(includeInstance: boolean, msg: LndUris): LndUris.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: LndUris, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): LndUris;
    static deserializeBinaryFromReader(message: LndUris, reader: jspb.BinaryReader): LndUris;
}

export namespace LndUris {
    export type AsObject = {
        lndUriList: Array<string>,
    }
}

export class NodeState extends jspb.Message { 
    clearAddressesList(): void;
    getAddressesList(): Array<Address>;
    setAddressesList(value: Array<Address>): void;
    addAddresses(value?: Address, index?: number): Address;

    clearPairsList(): void;
    getPairsList(): Array<string>;
    setPairsList(value: Array<string>): void;
    addPairs(value: string, index?: number): string;


    getLndPubKeysMap(): jspb.Map<string, string>;
    clearLndPubKeysMap(): void;


    getTokenIdentifiersMap(): jspb.Map<string, string>;
    clearTokenIdentifiersMap(): void;


    getLndUrisMap(): jspb.Map<string, LndUris>;
    clearLndUrisMap(): void;

    getConnextIdentifier(): string;
    setConnextIdentifier(value: string): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): NodeState.AsObject;
    static toObject(includeInstance: boolean, msg: NodeState): NodeState.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: NodeState, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): NodeState;
    static deserializeBinaryFromReader(message: NodeState, reader: jspb.BinaryReader): NodeState;
}

export namespace NodeState {
    export type AsObject = {
        addressesList: Array<Address.AsObject>,
        pairsList: Array<string>,

        lndPubKeysMap: Array<[string, string]>,

        tokenIdentifiersMap: Array<[string, string]>,

        lndUrisMap: Array<[string, LndUris.AsObject]>,
        connextIdentifier: string,
    }
}

export class PingPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): PingPacket.AsObject;
    static toObject(includeInstance: boolean, msg: PingPacket): PingPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: PingPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): PingPacket;
    static deserializeBinaryFromReader(message: PingPacket, reader: jspb.BinaryReader): PingPacket;
}

export namespace PingPacket {
    export type AsObject = {
        id: string,
    }
}

export class PongPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;

    getReqId(): string;
    setReqId(value: string): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): PongPacket.AsObject;
    static toObject(includeInstance: boolean, msg: PongPacket): PongPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: PongPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): PongPacket;
    static deserializeBinaryFromReader(message: PongPacket, reader: jspb.BinaryReader): PongPacket;
}

export namespace PongPacket {
    export type AsObject = {
        id: string,
        reqId: string,
    }
}

export class OrderPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;


    hasOrder(): boolean;
    clearOrder(): void;
    getOrder(): Order | undefined;
    setOrder(value?: Order): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): OrderPacket.AsObject;
    static toObject(includeInstance: boolean, msg: OrderPacket): OrderPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: OrderPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): OrderPacket;
    static deserializeBinaryFromReader(message: OrderPacket, reader: jspb.BinaryReader): OrderPacket;
}

export namespace OrderPacket {
    export type AsObject = {
        id: string,
        order?: Order.AsObject,
    }
}

export class OrderInvalidationPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;

    getOrderId(): string;
    setOrderId(value: string): void;

    getPairId(): string;
    setPairId(value: string): void;

    getQuantity(): number;
    setQuantity(value: number): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): OrderInvalidationPacket.AsObject;
    static toObject(includeInstance: boolean, msg: OrderInvalidationPacket): OrderInvalidationPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: OrderInvalidationPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): OrderInvalidationPacket;
    static deserializeBinaryFromReader(message: OrderInvalidationPacket, reader: jspb.BinaryReader): OrderInvalidationPacket;
}

export namespace OrderInvalidationPacket {
    export type AsObject = {
        id: string,
        orderId: string,
        pairId: string,
        quantity: number,
    }
}

export class GetOrdersPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;

    clearPairIdsList(): void;
    getPairIdsList(): Array<string>;
    setPairIdsList(value: Array<string>): void;
    addPairIds(value: string, index?: number): string;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): GetOrdersPacket.AsObject;
    static toObject(includeInstance: boolean, msg: GetOrdersPacket): GetOrdersPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: GetOrdersPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): GetOrdersPacket;
    static deserializeBinaryFromReader(message: GetOrdersPacket, reader: jspb.BinaryReader): GetOrdersPacket;
}

export namespace GetOrdersPacket {
    export type AsObject = {
        id: string,
        pairIdsList: Array<string>,
    }
}

export class OrdersPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;

    getReqId(): string;
    setReqId(value: string): void;

    clearOrdersList(): void;
    getOrdersList(): Array<Order>;
    setOrdersList(value: Array<Order>): void;
    addOrders(value?: Order, index?: number): Order;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): OrdersPacket.AsObject;
    static toObject(includeInstance: boolean, msg: OrdersPacket): OrdersPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: OrdersPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): OrdersPacket;
    static deserializeBinaryFromReader(message: OrdersPacket, reader: jspb.BinaryReader): OrdersPacket;
}

export namespace OrdersPacket {
    export type AsObject = {
        id: string,
        reqId: string,
        ordersList: Array<Order.AsObject>,
    }
}

export class NodeStateUpdatePacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;


    hasNodeState(): boolean;
    clearNodeState(): void;
    getNodeState(): NodeState | undefined;
    setNodeState(value?: NodeState): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): NodeStateUpdatePacket.AsObject;
    static toObject(includeInstance: boolean, msg: NodeStateUpdatePacket): NodeStateUpdatePacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: NodeStateUpdatePacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): NodeStateUpdatePacket;
    static deserializeBinaryFromReader(message: NodeStateUpdatePacket, reader: jspb.BinaryReader): NodeStateUpdatePacket;
}

export namespace NodeStateUpdatePacket {
    export type AsObject = {
        id: string,
        nodeState?: NodeState.AsObject,
    }
}

export class SessionInitPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;

    getSign(): string;
    setSign(value: string): void;

    getPeerPubKey(): string;
    setPeerPubKey(value: string): void;

    getEphemeralPubKey(): string;
    setEphemeralPubKey(value: string): void;


    hasNodeState(): boolean;
    clearNodeState(): void;
    getNodeState(): NodeState | undefined;
    setNodeState(value?: NodeState): void;

    getVersion(): string;
    setVersion(value: string): void;

    getNodePubKey(): string;
    setNodePubKey(value: string): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): SessionInitPacket.AsObject;
    static toObject(includeInstance: boolean, msg: SessionInitPacket): SessionInitPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: SessionInitPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): SessionInitPacket;
    static deserializeBinaryFromReader(message: SessionInitPacket, reader: jspb.BinaryReader): SessionInitPacket;
}

export namespace SessionInitPacket {
    export type AsObject = {
        id: string,
        sign: string,
        peerPubKey: string,
        ephemeralPubKey: string,
        nodeState?: NodeState.AsObject,
        version: string,
        nodePubKey: string,
    }
}

export class SessionAckPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;

    getReqId(): string;
    setReqId(value: string): void;

    getEphemeralPubKey(): string;
    setEphemeralPubKey(value: string): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): SessionAckPacket.AsObject;
    static toObject(includeInstance: boolean, msg: SessionAckPacket): SessionAckPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: SessionAckPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): SessionAckPacket;
    static deserializeBinaryFromReader(message: SessionAckPacket, reader: jspb.BinaryReader): SessionAckPacket;
}

export namespace SessionAckPacket {
    export type AsObject = {
        id: string,
        reqId: string,
        ephemeralPubKey: string,
    }
}

export class DisconnectingPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;

    getReason(): number;
    setReason(value: number): void;

    getPayload(): string;
    setPayload(value: string): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): DisconnectingPacket.AsObject;
    static toObject(includeInstance: boolean, msg: DisconnectingPacket): DisconnectingPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: DisconnectingPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): DisconnectingPacket;
    static deserializeBinaryFromReader(message: DisconnectingPacket, reader: jspb.BinaryReader): DisconnectingPacket;
}

export namespace DisconnectingPacket {
    export type AsObject = {
        id: string,
        reason: number,
        payload: string,
    }
}

export class GetNodesPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): GetNodesPacket.AsObject;
    static toObject(includeInstance: boolean, msg: GetNodesPacket): GetNodesPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: GetNodesPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): GetNodesPacket;
    static deserializeBinaryFromReader(message: GetNodesPacket, reader: jspb.BinaryReader): GetNodesPacket;
}

export namespace GetNodesPacket {
    export type AsObject = {
        id: string,
    }
}

export class NodesPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;

    getReqId(): string;
    setReqId(value: string): void;

    clearNodesList(): void;
    getNodesList(): Array<Node>;
    setNodesList(value: Array<Node>): void;
    addNodes(value?: Node, index?: number): Node;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): NodesPacket.AsObject;
    static toObject(includeInstance: boolean, msg: NodesPacket): NodesPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: NodesPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): NodesPacket;
    static deserializeBinaryFromReader(message: NodesPacket, reader: jspb.BinaryReader): NodesPacket;
}

export namespace NodesPacket {
    export type AsObject = {
        id: string,
        reqId: string,
        nodesList: Array<Node.AsObject>,
    }
}

export class SanitySwapInitPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;

    getCurrency(): string;
    setCurrency(value: string): void;

    getRHash(): string;
    setRHash(value: string): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): SanitySwapInitPacket.AsObject;
    static toObject(includeInstance: boolean, msg: SanitySwapInitPacket): SanitySwapInitPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: SanitySwapInitPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): SanitySwapInitPacket;
    static deserializeBinaryFromReader(message: SanitySwapInitPacket, reader: jspb.BinaryReader): SanitySwapInitPacket;
}

export namespace SanitySwapInitPacket {
    export type AsObject = {
        id: string,
        currency: string,
        rHash: string,
    }
}

export class SanitySwapAckPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;

    getReqId(): string;
    setReqId(value: string): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): SanitySwapAckPacket.AsObject;
    static toObject(includeInstance: boolean, msg: SanitySwapAckPacket): SanitySwapAckPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: SanitySwapAckPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): SanitySwapAckPacket;
    static deserializeBinaryFromReader(message: SanitySwapAckPacket, reader: jspb.BinaryReader): SanitySwapAckPacket;
}

export namespace SanitySwapAckPacket {
    export type AsObject = {
        id: string,
        reqId: string,
    }
}

export class SwapRequestPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;

    getProposedQuantity(): number;
    setProposedQuantity(value: number): void;

    getPairId(): string;
    setPairId(value: string): void;

    getOrderId(): string;
    setOrderId(value: string): void;

    getRHash(): string;
    setRHash(value: string): void;

    getTakerCltvDelta(): number;
    setTakerCltvDelta(value: number): void;

    getPayReq(): string;
    setPayReq(value: string): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): SwapRequestPacket.AsObject;
    static toObject(includeInstance: boolean, msg: SwapRequestPacket): SwapRequestPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: SwapRequestPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): SwapRequestPacket;
    static deserializeBinaryFromReader(message: SwapRequestPacket, reader: jspb.BinaryReader): SwapRequestPacket;
}

export namespace SwapRequestPacket {
    export type AsObject = {
        id: string,
        proposedQuantity: number,
        pairId: string,
        orderId: string,
        rHash: string,
        takerCltvDelta: number,
        payReq: string,
    }
}

export class SwapAcceptedPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;

    getReqId(): string;
    setReqId(value: string): void;

    getRHash(): string;
    setRHash(value: string): void;

    getQuantity(): number;
    setQuantity(value: number): void;

    getMakerCltvDelta(): number;
    setMakerCltvDelta(value: number): void;

    getPayReq(): string;
    setPayReq(value: string): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): SwapAcceptedPacket.AsObject;
    static toObject(includeInstance: boolean, msg: SwapAcceptedPacket): SwapAcceptedPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: SwapAcceptedPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): SwapAcceptedPacket;
    static deserializeBinaryFromReader(message: SwapAcceptedPacket, reader: jspb.BinaryReader): SwapAcceptedPacket;
}

export namespace SwapAcceptedPacket {
    export type AsObject = {
        id: string,
        reqId: string,
        rHash: string,
        quantity: number,
        makerCltvDelta: number,
        payReq: string,
    }
}

export class SwapFailedPacket extends jspb.Message { 
    getId(): string;
    setId(value: string): void;

    getReqId(): string;
    setReqId(value: string): void;

    getRHash(): string;
    setRHash(value: string): void;

    getErrorMessage(): string;
    setErrorMessage(value: string): void;

    getFailureReason(): number;
    setFailureReason(value: number): void;


    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): SwapFailedPacket.AsObject;
    static toObject(includeInstance: boolean, msg: SwapFailedPacket): SwapFailedPacket.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: SwapFailedPacket, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): SwapFailedPacket;
    static deserializeBinaryFromReader(message: SwapFailedPacket, reader: jspb.BinaryReader): SwapFailedPacket;
}

export namespace SwapFailedPacket {
    export type AsObject = {
        id: string,
        reqId: string,
        rHash: string,
        errorMessage: string,
        failureReason: number,
    }
}
