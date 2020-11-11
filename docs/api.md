# Protocol Documentation
<a name="top"></a>

## Table of Contents

- [xudrpc.proto](#xudrpc.proto)
    - [AddCurrencyResponse](#xudrpc.AddCurrencyResponse)
    - [AddPairRequest](#xudrpc.AddPairRequest)
    - [AddPairResponse](#xudrpc.AddPairResponse)
    - [Balance](#xudrpc.Balance)
    - [BanRequest](#xudrpc.BanRequest)
    - [BanResponse](#xudrpc.BanResponse)
    - [Chain](#xudrpc.Chain)
    - [Channels](#xudrpc.Channels)
    - [CloseChannelRequest](#xudrpc.CloseChannelRequest)
    - [CloseChannelResponse](#xudrpc.CloseChannelResponse)
    - [ConnectRequest](#xudrpc.ConnectRequest)
    - [ConnectResponse](#xudrpc.ConnectResponse)
    - [ConnextInfo](#xudrpc.ConnextInfo)
    - [CreateNodeRequest](#xudrpc.CreateNodeRequest)
    - [CreateNodeResponse](#xudrpc.CreateNodeResponse)
    - [Currency](#xudrpc.Currency)
    - [DepositRequest](#xudrpc.DepositRequest)
    - [DepositResponse](#xudrpc.DepositResponse)
    - [DiscoverNodesRequest](#xudrpc.DiscoverNodesRequest)
    - [DiscoverNodesResponse](#xudrpc.DiscoverNodesResponse)
    - [ExecuteSwapRequest](#xudrpc.ExecuteSwapRequest)
    - [GetBalanceRequest](#xudrpc.GetBalanceRequest)
    - [GetBalanceResponse](#xudrpc.GetBalanceResponse)
    - [GetBalanceResponse.BalancesEntry](#xudrpc.GetBalanceResponse.BalancesEntry)
    - [GetInfoRequest](#xudrpc.GetInfoRequest)
    - [GetInfoResponse](#xudrpc.GetInfoResponse)
    - [GetInfoResponse.LndEntry](#xudrpc.GetInfoResponse.LndEntry)
    - [GetNodeInfoRequest](#xudrpc.GetNodeInfoRequest)
    - [GetNodeInfoResponse](#xudrpc.GetNodeInfoResponse)
    - [ListCurrenciesRequest](#xudrpc.ListCurrenciesRequest)
    - [ListCurrenciesResponse](#xudrpc.ListCurrenciesResponse)
    - [ListOrdersRequest](#xudrpc.ListOrdersRequest)
    - [ListOrdersResponse](#xudrpc.ListOrdersResponse)
    - [ListOrdersResponse.OrdersEntry](#xudrpc.ListOrdersResponse.OrdersEntry)
    - [ListPairsRequest](#xudrpc.ListPairsRequest)
    - [ListPairsResponse](#xudrpc.ListPairsResponse)
    - [ListPeersRequest](#xudrpc.ListPeersRequest)
    - [ListPeersResponse](#xudrpc.ListPeersResponse)
    - [LndInfo](#xudrpc.LndInfo)
    - [NodeIdentifier](#xudrpc.NodeIdentifier)
    - [OpenChannelRequest](#xudrpc.OpenChannelRequest)
    - [OpenChannelResponse](#xudrpc.OpenChannelResponse)
    - [Order](#xudrpc.Order)
    - [OrderRemoval](#xudrpc.OrderRemoval)
    - [OrderUpdate](#xudrpc.OrderUpdate)
    - [Orders](#xudrpc.Orders)
    - [OrdersCount](#xudrpc.OrdersCount)
    - [Peer](#xudrpc.Peer)
    - [Peer.LndPubKeysEntry](#xudrpc.Peer.LndPubKeysEntry)
    - [PlaceOrderEvent](#xudrpc.PlaceOrderEvent)
    - [PlaceOrderRequest](#xudrpc.PlaceOrderRequest)
    - [PlaceOrderResponse](#xudrpc.PlaceOrderResponse)
    - [RemoveAllOrdersRequest](#xudrpc.RemoveAllOrdersRequest)
    - [RemoveAllOrdersResponse](#xudrpc.RemoveAllOrdersResponse)
    - [RemoveCurrencyRequest](#xudrpc.RemoveCurrencyRequest)
    - [RemoveCurrencyResponse](#xudrpc.RemoveCurrencyResponse)
    - [RemoveOrderRequest](#xudrpc.RemoveOrderRequest)
    - [RemoveOrderResponse](#xudrpc.RemoveOrderResponse)
    - [RemovePairRequest](#xudrpc.RemovePairRequest)
    - [RemovePairResponse](#xudrpc.RemovePairResponse)
    - [RestoreNodeRequest](#xudrpc.RestoreNodeRequest)
    - [RestoreNodeRequest.LndBackupsEntry](#xudrpc.RestoreNodeRequest.LndBackupsEntry)
    - [RestoreNodeResponse](#xudrpc.RestoreNodeResponse)
    - [SetLogLevelRequest](#xudrpc.SetLogLevelRequest)
    - [SetLogLevelResponse](#xudrpc.SetLogLevelResponse)
    - [ShutdownRequest](#xudrpc.ShutdownRequest)
    - [ShutdownResponse](#xudrpc.ShutdownResponse)
    - [SubscribeOrdersRequest](#xudrpc.SubscribeOrdersRequest)
    - [SubscribeSwapsAcceptedRequest](#xudrpc.SubscribeSwapsAcceptedRequest)
    - [SubscribeSwapsRequest](#xudrpc.SubscribeSwapsRequest)
    - [SwapAccepted](#xudrpc.SwapAccepted)
    - [SwapFailure](#xudrpc.SwapFailure)
    - [SwapSuccess](#xudrpc.SwapSuccess)
    - [Trade](#xudrpc.Trade)
    - [TradeHistoryRequest](#xudrpc.TradeHistoryRequest)
    - [TradeHistoryResponse](#xudrpc.TradeHistoryResponse)
    - [TradingLimits](#xudrpc.TradingLimits)
    - [TradingLimitsRequest](#xudrpc.TradingLimitsRequest)
    - [TradingLimitsResponse](#xudrpc.TradingLimitsResponse)
    - [TradingLimitsResponse.LimitsEntry](#xudrpc.TradingLimitsResponse.LimitsEntry)
    - [UnbanRequest](#xudrpc.UnbanRequest)
    - [UnbanResponse](#xudrpc.UnbanResponse)
    - [UnlockNodeRequest](#xudrpc.UnlockNodeRequest)
    - [UnlockNodeResponse](#xudrpc.UnlockNodeResponse)
    - [WithdrawRequest](#xudrpc.WithdrawRequest)
    - [WithdrawResponse](#xudrpc.WithdrawResponse)
  
    - [Currency.SwapClient](#xudrpc.Currency.SwapClient)
    - [ListOrdersRequest.Owner](#xudrpc.ListOrdersRequest.Owner)
    - [LogLevel](#xudrpc.LogLevel)
    - [OrderSide](#xudrpc.OrderSide)
    - [Role](#xudrpc.Role)
  
    - [Xud](#xudrpc.Xud)
    - [XudInit](#xudrpc.XudInit)
  
- [Scalar Value Types](#scalar-value-types)



<a name="xudrpc.proto"></a>
<p align="right"><a href="#top">Top</a></p>

## xudrpc.proto



<a name="xudrpc.AddCurrencyResponse"></a>

### AddCurrencyResponse







<a name="xudrpc.AddPairRequest"></a>

### AddPairRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| base_currency | [string](#string) |  | The base currency that is bought and sold for this trading pair. |
| quote_currency | [string](#string) |  | The currency used to quote a price for the base currency. |






<a name="xudrpc.AddPairResponse"></a>

### AddPairResponse







<a name="xudrpc.Balance"></a>

### Balance



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| total_balance | [uint64](#uint64) |  | Total balance denominated in satoshis. |
| channel_balance | [uint64](#uint64) |  | Sum of confirmed channel balances denominated in satoshis. |
| pending_channel_balance | [uint64](#uint64) |  | Sum of pending channel balances denominated in satoshis. |
| inactive_channel_balance | [uint64](#uint64) |  | Sum of inactive channel balances denominated in satoshis. |
| wallet_balance | [uint64](#uint64) |  | Confirmed wallet balance in satoshis. |
| unconfirmed_wallet_balance | [uint64](#uint64) |  | Unconfirmed wallet balance in satoshis. |






<a name="xudrpc.BanRequest"></a>

### BanRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| node_identifier | [string](#string) |  | The node pub key or alias of the node to ban. |






<a name="xudrpc.BanResponse"></a>

### BanResponse







<a name="xudrpc.Chain"></a>

### Chain



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| chain | [string](#string) |  | The blockchain the swap client is on (eg bitcoin, litecoin) |
| network | [string](#string) |  | The network the swap client is on (eg regtest, testnet, mainnet) |






<a name="xudrpc.Channels"></a>

### Channels



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| active | [uint32](#uint32) |  | The number of active/online channels for this lnd instance that can be used for swaps. |
| inactive | [uint32](#uint32) |  | The number of inactive/offline channels for this lnd instance. |
| pending | [uint32](#uint32) |  | The number of channels that are pending on-chain confirmation before they can be used. |
| closed | [uint32](#uint32) |  | The number of channels that have been closed. |






<a name="xudrpc.CloseChannelRequest"></a>

### CloseChannelRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| node_identifier | [string](#string) |  | The node pub key or alias of the peer with which to close any channels with. |
| currency | [string](#string) |  | The ticker symbol of the currency of the channel to close. |
| force | [bool](#bool) |  | Whether to force close the channel in case the peer is offline or unresponsive. |
| destination | [string](#string) |  | The on-chain address to send funds extracted from the channel. If unspecified, the funds return to the default wallet for the client closing the channel. |
| amount | [uint64](#uint64) |  | For Connext only - the amount to extract from the channel. If 0 or unspecified, the entire off-chain balance for the specified currency will be extracted. |
| fee | [uint64](#uint64) |  | A manual fee rate set in sat/byte that should be used when crafting the closure transaction. |






<a name="xudrpc.CloseChannelResponse"></a>

### CloseChannelResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| transaction_ids | [string](#string) | repeated | The id of the transaction per channel close. |






<a name="xudrpc.ConnectRequest"></a>

### ConnectRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| node_uri | [string](#string) |  | The uri of the node to connect to in &#34;[nodePubKey]@[host]:[port]&#34; format. |






<a name="xudrpc.ConnectResponse"></a>

### ConnectResponse







<a name="xudrpc.ConnextInfo"></a>

### ConnextInfo



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| status | [string](#string) |  |  |
| address | [string](#string) |  |  |
| version | [string](#string) |  |  |
| chain | [string](#string) |  |  |






<a name="xudrpc.CreateNodeRequest"></a>

### CreateNodeRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| password | [string](#string) |  | The password in utf-8 with which to encrypt the new xud node key as well as any uninitialized underlying wallets. |






<a name="xudrpc.CreateNodeResponse"></a>

### CreateNodeResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| seed_mnemonic | [string](#string) | repeated | The 24 word mnemonic to recover the xud identity key and underlying wallets |
| initialized_lnds | [string](#string) | repeated | The list of lnd clients that were initialized. |
| initialized_connext | [bool](#bool) |  | Whether the connext wallet was initialized. |






<a name="xudrpc.Currency"></a>

### Currency



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| currency | [string](#string) |  | The ticker symbol for this currency such as BTC, LTC, ETH, etc... |
| swap_client | [Currency.SwapClient](#xudrpc.Currency.SwapClient) |  | The payment channel network client to use for executing swaps. |
| token_address | [string](#string) |  | The contract address for layered tokens such as ERC20. |
| decimal_places | [uint32](#uint32) |  | The number of places to the right of the decimal point of the smallest subunit of the currency. For example, BTC, LTC, and others where the smallest subunits (satoshis) are 0.00000001 full units (bitcoins) have 8 decimal places. ETH has 18. This can be thought of as the base 10 exponent of the smallest subunit expressed as a positive integer. A default value of 8 is used if unspecified. |






<a name="xudrpc.DepositRequest"></a>

### DepositRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| currency | [string](#string) |  | The ticker symbol of the currency to deposit. |






<a name="xudrpc.DepositResponse"></a>

### DepositResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| address | [string](#string) |  | The address to use to deposit funds. |






<a name="xudrpc.DiscoverNodesRequest"></a>

### DiscoverNodesRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| node_identifier | [string](#string) |  | The node pub key or alias of the peer to discover nodes from. |






<a name="xudrpc.DiscoverNodesResponse"></a>

### DiscoverNodesResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| num_nodes | [uint32](#uint32) |  |  |






<a name="xudrpc.ExecuteSwapRequest"></a>

### ExecuteSwapRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| order_id | [string](#string) |  | The order id of the maker order. |
| pair_id | [string](#string) |  | The trading pair of the swap orders. |
| peer_pub_key | [string](#string) |  | The node pub key of the peer which owns the maker order. This is optional but helps locate the order more quickly. |
| quantity | [uint64](#uint64) |  | The quantity to swap denominated in satoshis. The whole order will be swapped if unspecified. |






<a name="xudrpc.GetBalanceRequest"></a>

### GetBalanceRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| currency | [string](#string) |  | The ticker symbol of the currency to query for, if unspecified then balances for all supported currencies are queried. |






<a name="xudrpc.GetBalanceResponse"></a>

### GetBalanceResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| balances | [GetBalanceResponse.BalancesEntry](#xudrpc.GetBalanceResponse.BalancesEntry) | repeated | A map between currency ticker symbols and their balances. |






<a name="xudrpc.GetBalanceResponse.BalancesEntry"></a>

### GetBalanceResponse.BalancesEntry



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| key | [string](#string) |  |  |
| value | [Balance](#xudrpc.Balance) |  |  |






<a name="xudrpc.GetInfoRequest"></a>

### GetInfoRequest







<a name="xudrpc.GetInfoResponse"></a>

### GetInfoResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| version | [string](#string) |  | The version of this instance of xud. |
| node_pub_key | [string](#string) |  | The node pub key of this node. |
| uris | [string](#string) | repeated | A list of uris that can be used to connect to this node. These are shared with peers. |
| num_peers | [uint32](#uint32) |  | The number of currently connected peers. |
| num_pairs | [uint32](#uint32) |  | The number of supported trading pairs. |
| orders | [OrdersCount](#xudrpc.OrdersCount) |  | The number of active, standing orders in the order book. |
| lnd | [GetInfoResponse.LndEntry](#xudrpc.GetInfoResponse.LndEntry) | repeated |  |
| alias | [string](#string) |  | The alias of this instance of xud. |
| network | [string](#string) |  | The network of this node. |
| pending_swap_hashes | [string](#string) | repeated |  |
| connext | [ConnextInfo](#xudrpc.ConnextInfo) |  |  |






<a name="xudrpc.GetInfoResponse.LndEntry"></a>

### GetInfoResponse.LndEntry



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| key | [string](#string) |  |  |
| value | [LndInfo](#xudrpc.LndInfo) |  |  |






<a name="xudrpc.GetNodeInfoRequest"></a>

### GetNodeInfoRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| node_identifier | [string](#string) |  | The node pub key or alias of the node for which to get information. |






<a name="xudrpc.GetNodeInfoResponse"></a>

### GetNodeInfoResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| reputationScore | [sint32](#sint32) |  | The node&#39;s reputation score. Points are subtracted for unexpected or potentially malicious behavior. Points are added when swaps are successfully executed. |
| banned | [bool](#bool) |  | Whether the node is currently banned. |






<a name="xudrpc.ListCurrenciesRequest"></a>

### ListCurrenciesRequest







<a name="xudrpc.ListCurrenciesResponse"></a>

### ListCurrenciesResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| currencies | [Currency](#xudrpc.Currency) | repeated | The list of available currencies in the orderbook. |






<a name="xudrpc.ListOrdersRequest"></a>

### ListOrdersRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| pair_id | [string](#string) |  | The trading pair for which to retrieve orders. |
| owner | [ListOrdersRequest.Owner](#xudrpc.ListOrdersRequest.Owner) |  | Whether only own, only peer or both orders should be included in result. |
| limit | [uint32](#uint32) |  | The maximum number of orders to return from each side of the order book. |
| include_aliases | [bool](#bool) |  | Whether to include the node aliases of owners of the orders. |






<a name="xudrpc.ListOrdersResponse"></a>

### ListOrdersResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| orders | [ListOrdersResponse.OrdersEntry](#xudrpc.ListOrdersResponse.OrdersEntry) | repeated | A map between pair ids and their buy and sell orders. |






<a name="xudrpc.ListOrdersResponse.OrdersEntry"></a>

### ListOrdersResponse.OrdersEntry



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| key | [string](#string) |  |  |
| value | [Orders](#xudrpc.Orders) |  |  |






<a name="xudrpc.ListPairsRequest"></a>

### ListPairsRequest







<a name="xudrpc.ListPairsResponse"></a>

### ListPairsResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| pairs | [string](#string) | repeated | The list of supported trading pair tickers in formats like &#34;LTC/BTC&#34;. |






<a name="xudrpc.ListPeersRequest"></a>

### ListPeersRequest







<a name="xudrpc.ListPeersResponse"></a>

### ListPeersResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| peers | [Peer](#xudrpc.Peer) | repeated | The list of connected peers. |






<a name="xudrpc.LndInfo"></a>

### LndInfo



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| status | [string](#string) |  |  |
| channels | [Channels](#xudrpc.Channels) |  |  |
| chains | [Chain](#xudrpc.Chain) | repeated |  |
| blockheight | [uint32](#uint32) |  |  |
| uris | [string](#string) | repeated |  |
| version | [string](#string) |  |  |
| alias | [string](#string) |  |  |






<a name="xudrpc.NodeIdentifier"></a>

### NodeIdentifier



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| node_pub_key | [string](#string) |  | The pub key of this node |
| alias | [string](#string) |  | An alias for this node deterministically generated from the pub key |






<a name="xudrpc.OpenChannelRequest"></a>

### OpenChannelRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| node_identifier | [string](#string) |  | The node pub key or alias of the peer with which to open channel with. |
| currency | [string](#string) |  | The ticker symbol of the currency to open the channel for. |
| amount | [uint64](#uint64) |  | The amount to be deposited into the channel denominated in satoshis. |
| push_amount | [uint64](#uint64) |  | The balance amount to be pushed to the remote side of the channel denominated in satoshis. |
| fee | [uint64](#uint64) |  | The manual fee rate set in sat/byte that should be used when crafting the funding transaction in the channel. |






<a name="xudrpc.OpenChannelResponse"></a>

### OpenChannelResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| transaction_id | [string](#string) |  | The id of the transaction that opened the channel. |






<a name="xudrpc.Order"></a>

### Order



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| price | [double](#double) |  | The price of the order. |
| quantity | [uint64](#uint64) |  | The quantity of the order in satoshis. |
| pair_id | [string](#string) |  | The trading pair that this order is for. |
| id | [string](#string) |  | A UUID for this order. |
| node_identifier | [NodeIdentifier](#xudrpc.NodeIdentifier) |  | The identifier of the node that created this order. |
| local_id | [string](#string) |  | The local id for this order, if applicable. |
| created_at | [uint64](#uint64) |  | The epoch time in milliseconds when this order was created. |
| side | [OrderSide](#xudrpc.OrderSide) |  | Whether this order is a buy or sell |
| is_own_order | [bool](#bool) |  | Whether this order is a local own order or a remote peer order. |
| hold | [uint64](#uint64) |  | The quantity on hold pending swap execution. |






<a name="xudrpc.OrderRemoval"></a>

### OrderRemoval



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| quantity | [uint64](#uint64) |  | The quantity removed from the order. |
| pair_id | [string](#string) |  | The trading pair that the order is for. |
| order_id | [string](#string) |  | The global UUID for the order. |
| local_id | [string](#string) |  | The local id for the order, if applicable. |
| is_own_order | [bool](#bool) |  | Whether the order being removed is a local own order or a remote peer order. |






<a name="xudrpc.OrderUpdate"></a>

### OrderUpdate



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| order | [Order](#xudrpc.Order) |  | An order that was added to the order book. |
| order_removal | [OrderRemoval](#xudrpc.OrderRemoval) |  | An order (or portion thereof) that was removed from the order book. |






<a name="xudrpc.Orders"></a>

### Orders



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| buy_orders | [Order](#xudrpc.Order) | repeated | A list of buy orders sorted by descending price. |
| sell_orders | [Order](#xudrpc.Order) | repeated | A list of sell orders sorted by ascending price. |






<a name="xudrpc.OrdersCount"></a>

### OrdersCount



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| peer | [uint32](#uint32) |  | The number of orders belonging to remote xud nodes. |
| own | [uint32](#uint32) |  | The number of orders belonging to our local xud node. |






<a name="xudrpc.Peer"></a>

### Peer



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| address | [string](#string) |  | The socket address with host and port for this peer. |
| node_pub_key | [string](#string) |  | The node pub key to uniquely identify this peer. |
| lnd_pub_keys | [Peer.LndPubKeysEntry](#xudrpc.Peer.LndPubKeysEntry) | repeated | A map of ticker symbols to lnd pub keys for this peer |
| inbound | [bool](#bool) |  | Indicates whether this peer was connected inbound. |
| pairs | [string](#string) | repeated | A list of trading pair tickers supported by this peer. |
| xud_version | [string](#string) |  | The version of xud being used by the peer. |
| seconds_connected | [uint32](#uint32) |  | The time in seconds that we have been connected to this peer. |
| alias | [string](#string) |  | The alias for this peer&#39;s public key |






<a name="xudrpc.Peer.LndPubKeysEntry"></a>

### Peer.LndPubKeysEntry



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| key | [string](#string) |  |  |
| value | [string](#string) |  |  |






<a name="xudrpc.PlaceOrderEvent"></a>

### PlaceOrderEvent



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| match | [Order](#xudrpc.Order) |  | An order (or portion thereof) that matched the newly placed order. |
| swap_success | [SwapSuccess](#xudrpc.SwapSuccess) |  | A successful swap of a peer order that matched the newly placed order. |
| remaining_order | [Order](#xudrpc.Order) |  | The remaining portion of the order, after matches, that enters the order book. |
| swap_failure | [SwapFailure](#xudrpc.SwapFailure) |  | A swap attempt that failed. |






<a name="xudrpc.PlaceOrderRequest"></a>

### PlaceOrderRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| price | [double](#double) |  | The price of the order. |
| quantity | [uint64](#uint64) |  | The quantity of the order denominated in satoshis. |
| pair_id | [string](#string) |  | The trading pair that the order is for. |
| order_id | [string](#string) |  | The local id to assign to the order. |
| side | [OrderSide](#xudrpc.OrderSide) |  | Whether the order is a buy or sell. |
| replace_order_id | [string](#string) |  | The local id of an existing order to be replaced. If provided, the order must be successfully found and removed before the new order is placed, otherwise an error is returned. |
| immediate_or_cancel | [bool](#bool) |  | Whether the order must be filled immediately and not allowed to enter the order book. |






<a name="xudrpc.PlaceOrderResponse"></a>

### PlaceOrderResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| internal_matches | [Order](#xudrpc.Order) | repeated | A list of own orders (or portions thereof) that matched the newly placed order. |
| swap_successes | [SwapSuccess](#xudrpc.SwapSuccess) | repeated | A list of successful swaps of peer orders that matched the newly placed order. |
| remaining_order | [Order](#xudrpc.Order) |  | The remaining portion of the order, after matches, that enters the order book. |
| swap_failures | [SwapFailure](#xudrpc.SwapFailure) | repeated | A list of swap attempts that failed. |






<a name="xudrpc.RemoveAllOrdersRequest"></a>

### RemoveAllOrdersRequest







<a name="xudrpc.RemoveAllOrdersResponse"></a>

### RemoveAllOrdersResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| removed_order_ids | [string](#string) | repeated | The local order ids that were successfully removed. |
| on_hold_order_ids | [string](#string) | repeated | The local order ids that were on hold and failed to be removed. |






<a name="xudrpc.RemoveCurrencyRequest"></a>

### RemoveCurrencyRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| currency | [string](#string) |  | The ticker symbol for this currency such as BTC, LTC, ETH, etc... |






<a name="xudrpc.RemoveCurrencyResponse"></a>

### RemoveCurrencyResponse







<a name="xudrpc.RemoveOrderRequest"></a>

### RemoveOrderRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| order_id | [string](#string) |  | The local id of the order to remove. |
| quantity | [uint64](#uint64) |  | The quantity to remove from the order denominated in satoshis. If zero or unspecified then the entire order is removed. |






<a name="xudrpc.RemoveOrderResponse"></a>

### RemoveOrderResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| quantity_on_hold | [uint64](#uint64) |  | Any portion of the order that was on hold due to ongoing swaps at the time of the request and could not be removed until after the swaps finish. |






<a name="xudrpc.RemovePairRequest"></a>

### RemovePairRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| pair_id | [string](#string) |  | The trading pair ticker to remove in a format such as &#34;LTC/BTC&#34;. |






<a name="xudrpc.RemovePairResponse"></a>

### RemovePairResponse







<a name="xudrpc.RestoreNodeRequest"></a>

### RestoreNodeRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| seed_mnemonic | [string](#string) | repeated | The 24 word mnemonic to recover the xud identity key and underlying wallets |
| password | [string](#string) |  | The password in utf-8 with which to encrypt the restored xud node key as well as any restored underlying wallets. |
| lnd_backups | [RestoreNodeRequest.LndBackupsEntry](#xudrpc.RestoreNodeRequest.LndBackupsEntry) | repeated | A map between the currency of the LND and its multi channel SCB |
| xud_database | [bytes](#bytes) |  | The XUD database backup |






<a name="xudrpc.RestoreNodeRequest.LndBackupsEntry"></a>

### RestoreNodeRequest.LndBackupsEntry



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| key | [string](#string) |  |  |
| value | [bytes](#bytes) |  |  |






<a name="xudrpc.RestoreNodeResponse"></a>

### RestoreNodeResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| restored_lnds | [string](#string) | repeated | The list of lnd clients that were initialized. |
| restored_connext | [bool](#bool) |  | Whether the connext wallet was initialized. |






<a name="xudrpc.SetLogLevelRequest"></a>

### SetLogLevelRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| log_level | [LogLevel](#xudrpc.LogLevel) |  |  |






<a name="xudrpc.SetLogLevelResponse"></a>

### SetLogLevelResponse







<a name="xudrpc.ShutdownRequest"></a>

### ShutdownRequest







<a name="xudrpc.ShutdownResponse"></a>

### ShutdownResponse







<a name="xudrpc.SubscribeOrdersRequest"></a>

### SubscribeOrdersRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| existing | [bool](#bool) |  | Whether to transmit all existing active orders upon establishing the stream. |






<a name="xudrpc.SubscribeSwapsAcceptedRequest"></a>

### SubscribeSwapsAcceptedRequest







<a name="xudrpc.SubscribeSwapsRequest"></a>

### SubscribeSwapsRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| include_taker | [bool](#bool) |  | Whether to include the results for swaps initiated via the PlaceOrder or ExecuteSwap calls. These swap results are also returned in the responses for the respective calls. |






<a name="xudrpc.SwapAccepted"></a>

### SwapAccepted



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| order_id | [string](#string) |  | The global UUID for the order that was accepted to be swapped. |
| local_id | [string](#string) |  | The local id for the order that was accepted to be swapped. |
| pair_id | [string](#string) |  | The trading pair that the swap is for. |
| quantity | [uint64](#uint64) |  | The order quantity that was accepted to be swapped. |
| price | [double](#double) |  | The price for the swap. |
| peer_pub_key | [string](#string) |  | The node pub key of the peer that executed this order. |
| r_hash | [string](#string) |  | The hex-encoded payment hash for the swap. |
| amount_receiving | [uint64](#uint64) |  | The amount received denominated in satoshis. |
| amount_sending | [uint64](#uint64) |  | The amount sent denominated in satoshis. |
| currency_receiving | [string](#string) |  | The ticker symbol of the currency received. |
| currency_sending | [string](#string) |  | The ticker symbol of the currency sent. |






<a name="xudrpc.SwapFailure"></a>

### SwapFailure



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| order_id | [string](#string) |  | The global UUID for the order that failed the swap. |
| pair_id | [string](#string) |  | The trading pair that the swap is for. |
| quantity | [uint64](#uint64) |  | The order quantity that was attempted to be swapped. |
| peer_pub_key | [string](#string) |  | The node pub key of the peer that we attempted to swap with. |
| failure_reason | [string](#string) |  | The reason why the swap failed. |






<a name="xudrpc.SwapSuccess"></a>

### SwapSuccess



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| order_id | [string](#string) |  | The global UUID for the order that was swapped. |
| local_id | [string](#string) |  | The local id for the order that was swapped. |
| pair_id | [string](#string) |  | The trading pair that the swap is for. |
| quantity | [uint64](#uint64) |  | The order quantity that was swapped. |
| r_hash | [string](#string) |  | The hex-encoded payment hash for the swap. |
| amount_received | [uint64](#uint64) |  | The amount received denominated in satoshis. |
| amount_sent | [uint64](#uint64) |  | The amount sent denominated in satoshis. |
| peer_pub_key | [string](#string) |  | The node pub key of the peer that executed this order. |
| role | [Role](#xudrpc.Role) |  | Our role in the swap, either MAKER or TAKER. |
| currency_received | [string](#string) |  | The ticker symbol of the currency received. |
| currency_sent | [string](#string) |  | The ticker symbol of the currency sent. |
| r_preimage | [string](#string) |  | The hex-encoded preimage. |
| price | [double](#double) |  | The price used for the swap. |






<a name="xudrpc.Trade"></a>

### Trade



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| maker_order | [Order](#xudrpc.Order) |  | The maker order involved in this trade. |
| taker_order | [Order](#xudrpc.Order) |  | The taker order involved in this trade. Note that when a trade occurs from a remote peer filling one of our orders, we do not receive the order (only a swap request) and this field will be empty. |
| r_hash | [string](#string) |  | The payment hash involved in this trade. |
| quantity | [uint64](#uint64) |  | The quantity transacted in this trade. |
| pair_id | [string](#string) |  | The trading pair for this trade. |
| price | [double](#double) |  | The price used for the trade. |
| role | [Role](#xudrpc.Role) |  | Our role in the trade. |
| executed_at | [uint64](#uint64) |  | The epoch time in milliseconds that this trade was executed |
| side | [OrderSide](#xudrpc.OrderSide) |  | Whether this node was on the buy or sell side of the trade - or both in case of internal trades. |
| counterparty | [NodeIdentifier](#xudrpc.NodeIdentifier) |  | The counterparty to this trade, if applicable. |






<a name="xudrpc.TradeHistoryRequest"></a>

### TradeHistoryRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| limit | [uint32](#uint32) |  | The maximum number of trades to return |






<a name="xudrpc.TradeHistoryResponse"></a>

### TradeHistoryResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| trades | [Trade](#xudrpc.Trade) | repeated |  |






<a name="xudrpc.TradingLimits"></a>

### TradingLimits



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| max_sell | [uint64](#uint64) |  | Maximum outbound limit for a sell order denominated in satoshis. |
| max_buy | [uint64](#uint64) |  | Maximum inbound limit for a buy order denominated in satoshis. |
| reserved_sell | [uint64](#uint64) |  | The outbound amount reserved for open sell orders. |
| reserved_buy | [uint64](#uint64) |  | The inbound amount reserved for open buy orders. |






<a name="xudrpc.TradingLimitsRequest"></a>

### TradingLimitsRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| currency | [string](#string) |  | The ticker symbol of the currency to query for, if unspecified then trading limits for all supported currencies are queried. |






<a name="xudrpc.TradingLimitsResponse"></a>

### TradingLimitsResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| limits | [TradingLimitsResponse.LimitsEntry](#xudrpc.TradingLimitsResponse.LimitsEntry) | repeated | A map between currency ticker symbols and their trading limits. |






<a name="xudrpc.TradingLimitsResponse.LimitsEntry"></a>

### TradingLimitsResponse.LimitsEntry



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| key | [string](#string) |  |  |
| value | [TradingLimits](#xudrpc.TradingLimits) |  |  |






<a name="xudrpc.UnbanRequest"></a>

### UnbanRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| node_identifier | [string](#string) |  | The node pub key or alias of the peer to unban. |
| reconnect | [bool](#bool) |  | Whether to attempt to connect to the peer after it is unbanned. |






<a name="xudrpc.UnbanResponse"></a>

### UnbanResponse







<a name="xudrpc.UnlockNodeRequest"></a>

### UnlockNodeRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| password | [string](#string) |  | The password in utf-8 with which to unlock an existing xud node key as well as underlying client wallets such as lnd. |






<a name="xudrpc.UnlockNodeResponse"></a>

### UnlockNodeResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| unlocked_lnds | [string](#string) | repeated | The list of lnd clients that were unlocked. |
| locked_lnds | [string](#string) | repeated | The list of lnd clients that could not be unlocked. |
| connext_ready | [bool](#bool) |  | Whether the Connext client is connected and ready to accept calls. |






<a name="xudrpc.WithdrawRequest"></a>

### WithdrawRequest



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| currency | [string](#string) |  | The ticker symbol of the currency to withdraw. |
| destination | [string](#string) |  | The address to withdraw funds to. |
| amount | [uint64](#uint64) |  | The amount to withdraw denominated in satoshis |
| all | [bool](#bool) |  | Whether to withdraw all available funds for this currency. If true, the amount field is ignored. |
| fee | [uint32](#uint32) |  | The fee to use for the withdrawal transaction denominated in satoshis per byte. |






<a name="xudrpc.WithdrawResponse"></a>

### WithdrawResponse



| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| transaction_id | [string](#string) |  | The id of the withdrawal transaction. |





 


<a name="xudrpc.Currency.SwapClient"></a>

### Currency.SwapClient


| Name | Number | Description |
| ---- | ------ | ----------- |
| LND | 0 |  |
| CONNEXT | 2 |  |



<a name="xudrpc.ListOrdersRequest.Owner"></a>

### ListOrdersRequest.Owner


| Name | Number | Description |
| ---- | ------ | ----------- |
| BOTH | 0 |  |
| OWN | 1 |  |
| PEER | 2 |  |



<a name="xudrpc.LogLevel"></a>

### LogLevel


| Name | Number | Description |
| ---- | ------ | ----------- |
| ALERT | 0 |  |
| ERROR | 1 |  |
| WARN | 2 |  |
| INFO | 3 |  |
| VERBOSE | 4 |  |
| DEBUG | 5 |  |
| TRACE | 6 |  |



<a name="xudrpc.OrderSide"></a>

### OrderSide


| Name | Number | Description |
| ---- | ------ | ----------- |
| BUY | 0 |  |
| SELL | 1 |  |
| BOTH | 2 |  |



<a name="xudrpc.Role"></a>

### Role


| Name | Number | Description |
| ---- | ------ | ----------- |
| TAKER | 0 |  |
| MAKER | 1 |  |
| INTERNAL | 2 |  |


 

 


<a name="xudrpc.Xud"></a>

### Xud
The primary service for interacting with a running xud node.

| Method Name | Request Type | Response Type | Description |
| ----------- | ------------ | ------------- | ------------|
| AddCurrency | [Currency](#xudrpc.Currency) | [AddCurrencyResponse](#xudrpc.AddCurrencyResponse) | Adds a currency to the list of supported currencies. Once added, the currency may be used for new trading pairs. shell: xucli addcurrency &lt;currency&gt; &lt;swap_client&gt; [decimal_places] [token_address] |
| AddPair | [AddPairRequest](#xudrpc.AddPairRequest) | [AddPairResponse](#xudrpc.AddPairResponse) | Adds a trading pair to the list of supported trading pairs. The newly supported pair is advertised to peers so they may begin sending orders for it. shell: xucli addpair &lt;base_currency&gt; &lt;quote_currency&gt; |
| Ban | [BanRequest](#xudrpc.BanRequest) | [BanResponse](#xudrpc.BanResponse) | Bans a node and immediately disconnects from it. This can be used to prevent any connections to a specific node. shell: xucli ban &lt;node_identifier&gt; |
| CloseChannel | [CloseChannelRequest](#xudrpc.CloseChannelRequest) | [CloseChannelResponse](#xudrpc.CloseChannelResponse) | Closes any existing payment channels with a peer for the specified currency. shell: xucli closechannel &lt;currency&gt; [node_identifier ] [--force] |
| Connect | [ConnectRequest](#xudrpc.ConnectRequest) | [ConnectResponse](#xudrpc.ConnectResponse) | Attempts to connect to a node. Once connected, the node is added to the list of peers and becomes available for swaps and trading. A handshake exchanges information about the peer&#39;s supported trading and swap clients. Orders will be shared with the peer upon connection and upon new order placements. shell: xucli connect &lt;node_uri&gt; |
| WalletDeposit | [DepositRequest](#xudrpc.DepositRequest) | [DepositResponse](#xudrpc.DepositResponse) | Gets an address to deposit a given currency into the xud wallets. shell: xucli walletdeposit &lt;currency&gt; |
| DiscoverNodes | [DiscoverNodesRequest](#xudrpc.DiscoverNodesRequest) | [DiscoverNodesResponse](#xudrpc.DiscoverNodesResponse) | Discover nodes from a specific peer and apply new connections |
| GetBalance | [GetBalanceRequest](#xudrpc.GetBalanceRequest) | [GetBalanceResponse](#xudrpc.GetBalanceResponse) | Gets the total balance available across all payment channels and wallets for one or all currencies. shell: xucli getbalance [currency] |
| GetInfo | [GetInfoRequest](#xudrpc.GetInfoRequest) | [GetInfoResponse](#xudrpc.GetInfoResponse) | Gets general information about this node. shell: xucli getinfo |
| GetNodeInfo | [GetNodeInfoRequest](#xudrpc.GetNodeInfoRequest) | [GetNodeInfoResponse](#xudrpc.GetNodeInfoResponse) | Gets general information about a node. shell: xucli getnodeinfo &lt;node_identifier&gt; |
| ListOrders | [ListOrdersRequest](#xudrpc.ListOrdersRequest) | [ListOrdersResponse](#xudrpc.ListOrdersResponse) | Gets orders from the order book. This call returns the state of the order book at a given point in time, although it is not guaranteed to still be vaild by the time a response is received and processed by a client. It accepts an optional trading pair id parameter. If specified, only orders for that particular trading pair are returned. Otherwise, all orders are returned. Orders are separated into buys and sells for each trading pair, but unsorted. shell: xucli listorders [pair_id] [include_own_orders] [limit] |
| ListCurrencies | [ListCurrenciesRequest](#xudrpc.ListCurrenciesRequest) | [ListCurrenciesResponse](#xudrpc.ListCurrenciesResponse) | Gets a list of this node&#39;s supported currencies. shell: xucli listcurrencies |
| ListPairs | [ListPairsRequest](#xudrpc.ListPairsRequest) | [ListPairsResponse](#xudrpc.ListPairsResponse) | Gets a list of this nodes suported trading pairs. shell: xucli listpairs |
| ListPeers | [ListPeersRequest](#xudrpc.ListPeersRequest) | [ListPeersResponse](#xudrpc.ListPeersResponse) | Gets a list of connected peers. shell: xucli listpeers |
| OpenChannel | [OpenChannelRequest](#xudrpc.OpenChannelRequest) | [OpenChannelResponse](#xudrpc.OpenChannelResponse) | Opens a payment channel to a peer for the specified amount and currency. shell: xucli openchannel &lt;currency&gt; &lt;amount&gt; [node_identifier] [push_amount] |
| PlaceOrder | [PlaceOrderRequest](#xudrpc.PlaceOrderRequest) | [PlaceOrderEvent](#xudrpc.PlaceOrderEvent) stream | Adds an order to the order book. If price is zero or unspecified a market order will get added. |
| PlaceOrderSync | [PlaceOrderRequest](#xudrpc.PlaceOrderRequest) | [PlaceOrderResponse](#xudrpc.PlaceOrderResponse) | The synchronous, non-streaming version of PlaceOrder. shell: xucli buy &lt;quantity&gt; &lt;pair_id&gt; &lt;price&gt; [order_id] [stream] shell: xucli sell &lt;quantity&gt; &lt;pair_id&gt; &lt;price&gt; [order_id] [stream] |
| ExecuteSwap | [ExecuteSwapRequest](#xudrpc.ExecuteSwapRequest) | [SwapSuccess](#xudrpc.SwapSuccess) | Executes a swap on a maker peer order. |
| RemoveCurrency | [RemoveCurrencyRequest](#xudrpc.RemoveCurrencyRequest) | [RemoveCurrencyResponse](#xudrpc.RemoveCurrencyResponse) | Removes a currency from the list of supported currencies. Only currencies that are not in use for any currently supported trading pairs may be removed. Once removed, the currency can no longer be used for any supported trading pairs. shell: xucli removecurrency &lt;currency&gt; |
| RemoveOrder | [RemoveOrderRequest](#xudrpc.RemoveOrderRequest) | [RemoveOrderResponse](#xudrpc.RemoveOrderResponse) | Removes an order from the order book by its local id. This should be called when an order is canceled or filled outside of xud. Removed orders become immediately unavailable for swaps, and peers are notified that the order is no longer valid. Any portion of the order that is on hold due to ongoing swaps will not be removed until after the swap attempts complete. shell: xucli removeorder &lt;order_id&gt; [quantity] |
| RemoveAllOrders | [RemoveAllOrdersRequest](#xudrpc.RemoveAllOrdersRequest) | [RemoveAllOrdersResponse](#xudrpc.RemoveAllOrdersResponse) | Removes all orders from the order book. Removed orders become immediately unavailable for swaps, and peers are notified that the orders are no longer valid. Any portion of the orders that is on hold due to ongoing swaps will not be removed until after the swap attempts complete. shell: xucli removeallorders |
| RemovePair | [RemovePairRequest](#xudrpc.RemovePairRequest) | [RemovePairResponse](#xudrpc.RemovePairResponse) | Removes a trading pair from the list of currently supported trading pair. This call will effectively cancel any standing orders for that trading pair. Peers are informed when a pair is no longer supported so that they will know to stop sending orders for it. shell: xucli removepair &lt;pair_id&gt; |
| SetLogLevel | [SetLogLevelRequest](#xudrpc.SetLogLevelRequest) | [SetLogLevelResponse](#xudrpc.SetLogLevelResponse) | Set the logging level. shell: xucli loglevel &lt;level&gt; |
| Shutdown | [ShutdownRequest](#xudrpc.ShutdownRequest) | [ShutdownResponse](#xudrpc.ShutdownResponse) | Begin gracefully shutting down xud. shell: xucli shutdown |
| SubscribeOrders | [SubscribeOrdersRequest](#xudrpc.SubscribeOrdersRequest) | [OrderUpdate](#xudrpc.OrderUpdate) stream | Subscribes to orders being added to and removed from the order book. This call allows the client to maintain an up-to-date view of the order book. For example, an exchange that wants to show its users a real time view of the orders available to them would subscribe to this streaming call to be alerted as new orders are added and expired orders are removed. |
| SubscribeSwapFailures | [SubscribeSwapsRequest](#xudrpc.SubscribeSwapsRequest) | [SwapFailure](#xudrpc.SwapFailure) stream | Subscribes to failed swaps. By default, only swaps that are initiated by a remote peer are transmitted unless a flag is set to include swaps initiated by the local node. This call allows the client to get real-time notifications when swap attempts are failing. It can be used for status monitoring, debugging, and testing purposes. |
| SubscribeSwaps | [SubscribeSwapsRequest](#xudrpc.SubscribeSwapsRequest) | [SwapSuccess](#xudrpc.SwapSuccess) stream | Subscribes to completed swaps. By default, only swaps that are initiated by a remote peer are transmitted unless a flag is set to include swaps initiated by the local node. This call allows the client to get real-time notifications when its orders are filled by a peer. It can be used for tracking order executions, updating balances, and informing a trader when one of their orders is settled through the Exchange Union network. |
| SubscribeSwapsAccepted | [SubscribeSwapsAcceptedRequest](#xudrpc.SubscribeSwapsAcceptedRequest) | [SwapAccepted](#xudrpc.SwapAccepted) stream | Subscribes to accepted swaps. This stream emits a message when the local xud node accepts a swap request from a peer, but before the swap has actually succeeded. |
| TradeHistory | [TradeHistoryRequest](#xudrpc.TradeHistoryRequest) | [TradeHistoryResponse](#xudrpc.TradeHistoryResponse) | Gets a list of completed trades. shell: xucli tradehistory [limit] |
| TradingLimits | [TradingLimitsRequest](#xudrpc.TradingLimitsRequest) | [TradingLimitsResponse](#xudrpc.TradingLimitsResponse) | Gets the trading limits for one or all currencies. shell: xucli tradinglimits [currency] |
| Unban | [UnbanRequest](#xudrpc.UnbanRequest) | [UnbanResponse](#xudrpc.UnbanResponse) | Removes a ban from a node manually and, optionally, attempts to connect to it. shell: xucli unban &lt;node_identifier&gt; [reconnect] |
| WalletWithdraw | [WithdrawRequest](#xudrpc.WithdrawRequest) | [WithdrawResponse](#xudrpc.WithdrawResponse) | Withdraws a given currency from the xud wallets to a specified address. shell: xucli withdraw [amount] [currency] &lt;destination&gt; [fee] |


<a name="xudrpc.XudInit"></a>

### XudInit
A service for interacting with a locked or uninitalized xud node.

| Method Name | Request Type | Response Type | Description |
| ----------- | ------------ | ------------- | ------------|
| CreateNode | [CreateNodeRequest](#xudrpc.CreateNodeRequest) | [CreateNodeResponse](#xudrpc.CreateNodeResponse) | Creates an xud identity node key and underlying wallets. The node key and wallets are derived from a single seed and encrypted using a single password provided as a parameter to the call. shell: xucli create |
| RestoreNode | [RestoreNodeRequest](#xudrpc.RestoreNodeRequest) | [RestoreNodeResponse](#xudrpc.RestoreNodeResponse) | Restores an xud instance and underlying wallets from a seed. shell: xucli restore [backup_directory] |
| UnlockNode | [UnlockNodeRequest](#xudrpc.UnlockNodeRequest) | [UnlockNodeResponse](#xudrpc.UnlockNodeResponse) | Unlocks and decrypts the xud node key and any underlying wallets. shell: xucli unlock |

 



## Scalar Value Types

| .proto Type | Notes | C++ | Java | Python | Go | C# | PHP | Ruby |
| ----------- | ----- | --- | ---- | ------ | -- | -- | --- | ---- |
| <a name="double" /> double |  | double | double | float | float64 | double | float | Float |
| <a name="float" /> float |  | float | float | float | float32 | float | float | Float |
| <a name="int32" /> int32 | Uses variable-length encoding. Inefficient for encoding negative numbers – if your field is likely to have negative values, use sint32 instead. | int32 | int | int | int32 | int | integer | Bignum or Fixnum (as required) |
| <a name="int64" /> int64 | Uses variable-length encoding. Inefficient for encoding negative numbers – if your field is likely to have negative values, use sint64 instead. | int64 | long | int/long | int64 | long | integer/string | Bignum |
| <a name="uint32" /> uint32 | Uses variable-length encoding. | uint32 | int | int/long | uint32 | uint | integer | Bignum or Fixnum (as required) |
| <a name="uint64" /> uint64 | Uses variable-length encoding. | uint64 | long | int/long | uint64 | ulong | integer/string | Bignum or Fixnum (as required) |
| <a name="sint32" /> sint32 | Uses variable-length encoding. Signed int value. These more efficiently encode negative numbers than regular int32s. | int32 | int | int | int32 | int | integer | Bignum or Fixnum (as required) |
| <a name="sint64" /> sint64 | Uses variable-length encoding. Signed int value. These more efficiently encode negative numbers than regular int64s. | int64 | long | int/long | int64 | long | integer/string | Bignum |
| <a name="fixed32" /> fixed32 | Always four bytes. More efficient than uint32 if values are often greater than 2^28. | uint32 | int | int | uint32 | uint | integer | Bignum or Fixnum (as required) |
| <a name="fixed64" /> fixed64 | Always eight bytes. More efficient than uint64 if values are often greater than 2^56. | uint64 | long | int/long | uint64 | ulong | integer/string | Bignum |
| <a name="sfixed32" /> sfixed32 | Always four bytes. | int32 | int | int | int32 | int | integer | Bignum or Fixnum (as required) |
| <a name="sfixed64" /> sfixed64 | Always eight bytes. | int64 | long | int/long | int64 | long | integer/string | Bignum |
| <a name="bool" /> bool |  | bool | boolean | boolean | bool | bool | boolean | TrueClass/FalseClass |
| <a name="string" /> string | A string must always contain UTF-8 encoded or 7-bit ASCII text. | string | String | str/unicode | string | string | string | String (UTF-8) |
| <a name="bytes" /> bytes | May contain any arbitrary sequence of bytes. | string | ByteString | str | []byte | ByteString | string | String (ASCII-8BIT) |

