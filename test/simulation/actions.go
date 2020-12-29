package main

import (
	"context"
	"errors"
	"fmt"

	// "github.com/ExchangeUnion/xud-simulation/connexttest"
	// "math/big"
	"time"

	"github.com/roasbeef/btcutil"

	"github.com/ExchangeUnion/xud-simulation/lntest"
	"github.com/ExchangeUnion/xud-simulation/xudrpc"
	"github.com/ExchangeUnion/xud-simulation/xudtest"
	"github.com/lightningnetwork/lnd/lnrpc"
	"github.com/stretchr/testify/require"
)

// actions provide self-contained reusable scenarios to be used in tests.
// each action performs its expected success/failure assertions by its own.
type actions struct {
	// assert provides assertion methods to stop test execution upon failure.
	assert *require.Assertions

	// ctx is the context for the test scenario.
	ctx context.Context
}

func (a *actions) init(node *xudtest.HarnessNode) {
	var info *xudrpc.GetInfoResponse
	isReady := func() bool {
		var err error
		info, err = node.Client.GetInfo(context.Background(), &xudrpc.GetInfoRequest{})
		a.assert.NoError(err)
		return len(info.Lnd["BTC"].Chains) == 1 && len(info.Lnd["LTC"].Chains) == 1
	}

	timeout := time.After(10 * time.Second)
	for !isReady() {
		select {
		case <-timeout:
			a.assert.Fail("timeout waiting for LND synced chains")
		case <-time.After(1 * time.Second):
		}
	}

	a.assert.Equal(info.Lnd["BTC"].Chains[0].Chain, "bitcoin")
	a.assert.Equal(info.Lnd["BTC"].Chains[0].Network, "simnet")
	a.assert.Equal(info.Lnd["LTC"].Chains[0].Chain, "litecoin")
	a.assert.Equal(info.Lnd["LTC"].Chains[0].Network, "simnet")

	// Set the node public key.
	node.SetPubKey(info.NodePubKey)

	// Add currencies.
	a.addCurrency(node, "BTC", xudrpc.Currency_LND, "", 8)
	a.addCurrency(node, "LTC", xudrpc.Currency_LND, "", 8)
	// a.addCurrency(node, "ETH", xudrpc.Currency_CONNEXT, connexttest.ETHTokenAddress, 18)

	// Add pairs.
	a.addPair(node, "LTC", "BTC")
	// a.addPair(node, "BTC", "ETH")
}

/*
func (a *actions) FundETH(net *xudtest.NetworkHarness, node *xudtest.HarnessNode) {
	// Wait for node's connext connection to catch-up.
	a.waitConnextReady(node)

	// Fund node's wallet.
	resInfo, err := node.Client.GetInfo(context.Background(), &xudrpc.GetInfoRequest{})
	a.assert.NoError(err)
	amount := big.NewInt(2000000000000000000)
	err = net.ConnextNetwork.Wallet.SendEth(resInfo.Connext.Address, amount)
	a.assert.NoError(err)

	time.Sleep(15 * time.Second)

	// Verify node's ETH balance.
	bal, err := node.Client.GetBalance(a.ctx, &xudrpc.GetBalanceRequest{Currency: "ETH"})
	ethBal := bal.Balances["ETH"]
	a.assert.NoError(err)
	a.assert.Equal(uint64(200000000), ethBal.TotalBalance)
	a.assert.Equal(uint64(200000000), ethBal.WalletBalance)
	a.assert.Equal(uint64(0), ethBal.ChannelBalance)
}
*/

func (a *actions) waitConnextReady(node *xudtest.HarnessNode) {
	isReady := func() bool {
		info, err := node.Client.GetInfo(context.Background(), &xudrpc.GetInfoRequest{})
		if err != nil {
			return false
		}

		return info.Connext.Address != ""
	}

	timeout := time.After(30 * time.Second)
	for !isReady() {
		select {
		case <-timeout:
			a.assert.Fail("timeout waiting for connext to be ready")
		case <-time.After(1 * time.Second):
		}
	}
}

func (a *actions) removeCurrency(node *xudtest.HarnessNode, currency string) {
	req := &xudrpc.RemoveCurrencyRequest{Currency: currency}
	_, err := node.Client.RemoveCurrency(a.ctx, req)
	a.assert.NoError(err)
}

func (a *actions) addCurrency(node *xudtest.HarnessNode, currency string, swapClient xudrpc.Currency_SwapClient, tokenAddress string, decimalPlaces uint32) {
	if len(tokenAddress) > 0 {
		req := &xudrpc.Currency{Currency: currency, SwapClient: swapClient, TokenAddress: tokenAddress, DecimalPlaces: decimalPlaces}
		_, err := node.Client.AddCurrency(a.ctx, req)
		a.assert.NoError(err)
	} else {
		req := &xudrpc.Currency{Currency: currency, SwapClient: swapClient}
		_, err := node.Client.AddCurrency(a.ctx, req)
		a.assert.NoError(err)
	}
}

func (a *actions) removePair(node *xudtest.HarnessNode, pairId string) {
	// Check the current number of pairs.
	res, err := node.Client.GetInfo(a.ctx, &xudrpc.GetInfoRequest{})
	a.assert.NoError(err)

	prevNumPairs := res.NumPairs

	// Remove the pair.
	req := &xudrpc.RemovePairRequest{PairId: pairId}
	_, err = node.Client.RemovePair(a.ctx, req)
	a.assert.NoError(err)

	// Verify that the pair was removed.
	res, err = node.Client.GetInfo(a.ctx, &xudrpc.GetInfoRequest{})
	a.assert.NoError(err)
	a.assert.Equal(res.NumPairs, prevNumPairs-1)
}

func (a *actions) addPair(node *xudtest.HarnessNode, baseCurrency string, quoteCurrency string) {
	// Check the current number of pairs.
	res, err := node.Client.GetInfo(a.ctx, &xudrpc.GetInfoRequest{})
	a.assert.NoError(err)

	prevNumPairs := res.NumPairs

	// Add the pair.
	req := &xudrpc.AddPairRequest{BaseCurrency: baseCurrency, QuoteCurrency: quoteCurrency}
	_, err = node.Client.AddPair(a.ctx, req)
	a.assert.NoError(err)

	// Verify that the pair was added.
	res, err = node.Client.GetInfo(a.ctx, &xudrpc.GetInfoRequest{})
	a.assert.NoError(err)
	a.assert.Equal(res.NumPairs, prevNumPairs+1)
}

func (a *actions) connect(srcNode, destNode *xudtest.HarnessNode) {
	destNodeURI := fmt.Sprintf("%v@%v",
		destNode.PubKey(),
		destNode.Cfg.P2PAddr(),
	)

	// connect srcNode to destNode.
	reqConn := &xudrpc.ConnectRequest{NodeUri: destNodeURI}
	_, err := srcNode.Client.Connect(a.ctx, reqConn)
	a.assert.NoError(err)
}

func (a *actions) openChannel(srcNode, destNode *xudtest.HarnessNode, currency string, amount uint64) {
	// connect srcNode to destNode.
	reqConn := &xudrpc.OpenChannelRequest{NodeIdentifier: destNode.PubKey(), Currency: currency, Amount: amount}
	_, err := srcNode.Client.OpenChannel(a.ctx, reqConn)
	a.assert.NoError(err)
}

func (a *actions) disconnect(srcNode, destNode *xudtest.HarnessNode) {
	a.ban(srcNode, destNode)
	a.unban(srcNode, destNode)
}

func (a *actions) ban(srcNode, destNode *xudtest.HarnessNode) {
	reqBan := &xudrpc.BanRequest{NodeIdentifier: destNode.PubKey()}
	_, err := srcNode.Client.Ban(a.ctx, reqBan)
	a.assert.NoError(err)
}

func (a *actions) unban(srcNode, destNode *xudtest.HarnessNode) {
	reqUnban := &xudrpc.UnbanRequest{NodeIdentifier: destNode.PubKey(), Reconnect: false}
	_, err := srcNode.Client.Unban(a.ctx, reqUnban)
	a.assert.NoError(err)
}

func (a *actions) matchOrderAndInvalidate(srcNode, destNode *xudtest.HarnessNode,
	order *xudrpc.Order) {
	a.assert.True(order.IsOwnOrder)

	// Subscribe to added orders on destNode
	destNodeOrderChan := subscribeOrders(a.ctx, destNode)

	// Fetch nodes current order book state.
	prevSrcNodeCount, prevDestNodeCount, err := getOrdersCount(a.ctx, srcNode, destNode)
	a.assert.NoError(err)
	a.assert.NotZero(prevSrcNodeCount.Own)
	a.assert.NotZero(prevDestNodeCount.Peer)

	var side xudrpc.OrderSide
	if order.Side == xudrpc.OrderSide_BUY {
		side = xudrpc.OrderSide_SELL
	} else {
		side = xudrpc.OrderSide_BUY
	}

	req := &xudrpc.PlaceOrderRequest{
		Price:    order.Price,
		Quantity: order.Quantity,
		PairId:   order.PairId,
		Side:     side,
	}

	// Place the order on srcNode and verify the result.
	res, err := srcNode.Client.PlaceOrderSync(a.ctx, req)
	a.assert.NoError(err)
	a.assert.Len(res.InternalMatches, 1)
	a.assert.Len(res.SwapSuccesses, 0)
	a.assert.Len(res.SwapFailures, 0)
	a.assert.Nil(res.RemainingOrder)

	// Verify that order is removed by peer
	e := <-destNodeOrderChan
	a.assert.NoError(e.err)
	a.assert.NotNil(e.orderUpdate)
	orderRemoval := e.orderUpdate.GetOrderRemoval()
	a.assert.Equal(orderRemoval.OrderId, order.Id)
	a.assert.Equal(orderRemoval.Quantity, order.Quantity)
	a.assert.Equal(orderRemoval.PairId, order.PairId)

	// Verify that the order was removed from the order books.
	srcNodeCount, destNodeCount, err := getOrdersCount(a.ctx, srcNode, destNode)
	a.assert.NoError(err)
	a.assert.Equal(srcNodeCount.Own, prevSrcNodeCount.Own-1)
	a.assert.Equal(srcNodeCount.Peer, prevSrcNodeCount.Peer)
	a.assert.Equal(destNodeCount.Own, prevDestNodeCount.Own)
	a.assert.Equal(destNodeCount.Peer, prevDestNodeCount.Peer-1)
}

func (a *actions) placeOrderAndBroadcast(srcNode, destNode *xudtest.HarnessNode,
	req *xudrpc.PlaceOrderRequest) *xudrpc.Order {
	// Subscribe to added orders on destNode
	destNodeOrderChan := subscribeOrders(a.ctx, destNode)

	// Fetch nodes current order book state.
	prevSrcNodeCount, prevDestNodeCount, err := getOrdersCount(a.ctx, srcNode, destNode)
	a.assert.NoError(err)

	// Place the order on srcNode and verify the result.
	res, err := srcNode.Client.PlaceOrderSync(a.ctx, req)
	a.assert.NoError(err)

	// Verify the response.
	a.assert.Len(res.InternalMatches, 0)
	a.assert.Len(res.SwapSuccesses, 0)
	a.assert.Len(res.SwapFailures, 0)
	a.assert.NotNil(res.RemainingOrder)
	a.assert.NotEqual(res.RemainingOrder.Id, req.OrderId)
	a.assert.True(res.RemainingOrder.IsOwnOrder)
	a.assert.Equal(res.RemainingOrder.LocalId, req.OrderId)

	// Retrieve and verify the added order event on destNode.

	var peerOrder *xudrpc.Order
	select {
	case e := <-destNodeOrderChan:
		a.assert.NoError(e.err)
		a.assert.NotNil(e.orderUpdate)
		peerOrder = e.orderUpdate.GetOrder()
	case <-time.After(5 * time.Second):
		a.assert.Fail("timeout waiting for broadcasted order on destNode")
	}

	// Verify the peer order.
	a.assert.NotEqual(peerOrder.Id, req.OrderId) // Local id should not equal the global id.
	a.assert.Equal(peerOrder.Price, req.Price)
	a.assert.Equal(peerOrder.PairId, req.PairId)
	a.assert.Equal(peerOrder.Quantity, req.Quantity)
	a.assert.Equal(peerOrder.Side, req.Side)
	a.assert.False(peerOrder.IsOwnOrder)
	a.assert.Equal(peerOrder.Id, res.RemainingOrder.Id)
	a.assert.Equal(peerOrder.NodeIdentifier.NodePubKey, srcNode.PubKey())

	// Verify that a new order was added to the order books.
	srcNodeCount, destNodeCount, err := getOrdersCount(a.ctx, srcNode, destNode)
	a.assert.NoError(err)
	a.assert.Equal(srcNodeCount.Own, prevSrcNodeCount.Own+1)
	a.assert.Equal(srcNodeCount.Peer, prevSrcNodeCount.Peer)
	a.assert.Equal(destNodeCount.Own, prevDestNodeCount.Own)
	a.assert.Equal(destNodeCount.Peer, prevDestNodeCount.Peer+1)

	return res.RemainingOrder
}

func (a *actions) removeOrderAndInvalidate(srcNode, destNode *xudtest.HarnessNode, order *xudrpc.Order) {
	// Subscribe to removed orders on destNode.
	destNodeOrdersChan := subscribeOrders(a.ctx, destNode)

	// Fetch nodes current order book state.
	prevSrcNodeCount, prevDestNodeCount, err := getOrdersCount(a.ctx, srcNode, destNode)
	a.assert.NoError(err)
	a.assert.NotZero(prevSrcNodeCount)
	a.assert.NotZero(prevDestNodeCount)

	// Ensure that destNode and srcNode are connected.
	a.verifyConnectivity(destNode, srcNode)

	// Remove the order on srcNode.
	req := &xudrpc.RemoveOrderRequest{OrderId: order.LocalId}
	res, err := srcNode.Client.RemoveOrder(a.ctx, req)
	a.assert.NoError(err)

	// Verify no quantity on hold.
	a.assert.Equal(res.QuantityOnHold, uint64(0))

	// Retrieve and verify the removed orders event on destNode.
	e := <-destNodeOrdersChan
	a.assert.NoError(e.err)
	a.assert.NotNil(e.orderUpdate)
	orderRemoval := e.orderUpdate.GetOrderRemoval()

	// Verify the order removal.
	a.assert.Empty(orderRemoval.LocalId)
	a.assert.Equal(orderRemoval.Quantity, order.Quantity)
	a.assert.Equal(orderRemoval.PairId, order.PairId)
	a.assert.False(orderRemoval.IsOwnOrder)

	// Verify that the order was removed from the order books.
	srcNodeCount, destNodeCount, err := getOrdersCount(a.ctx, srcNode, destNode)
	a.assert.NoError(err)
	a.assert.Equal(srcNodeCount.Own, prevSrcNodeCount.Own-1)
	a.assert.Equal(srcNodeCount.Peer, prevSrcNodeCount.Peer)
	a.assert.Equal(destNodeCount.Own, prevDestNodeCount.Own)
	a.assert.Equal(destNodeCount.Peer, prevDestNodeCount.Peer-1)
}

func (a *actions) placeOrderAndSwap(srcNode, destNode *xudtest.HarnessNode,
	req *xudrpc.PlaceOrderRequest) {
	ctx, cancel := context.WithCancel(a.ctx)
	defer cancel()

	destNodeSwapChan := subscribeSwaps(ctx, destNode, false)
	srcNodeSwapChan := subscribeSwaps(ctx, srcNode, true)

	// Place the order on srcNode and verify the result.
	res, err := srcNode.Client.PlaceOrderSync(ctx, req)
	a.assert.NoError(err)
	a.assert.Len(res.InternalMatches, 0)
	a.assert.Len(res.SwapFailures, 0)
	a.assert.Len(res.SwapSuccesses, 1)
	a.assert.Nil(res.RemainingOrder)

	// Retrieve and verify the swap events on both nodes.
	eMaker := <-destNodeSwapChan
	a.assert.NoError(eMaker.err)
	a.assert.NotNil(eMaker.swap)
	eTaker := <-srcNodeSwapChan
	a.assert.NoError(eTaker.err)
	a.assert.NotNil(eTaker.swap)

	// Verify that the swap event on the taker side is equal to PlaceOrder response swap.
	a.assert.Equal(eTaker.swap, res.SwapSuccesses[0])

	// Verify the swap events info.
	a.assert.Equal(eMaker.swap.OrderId, eTaker.swap.OrderId)
	a.assert.Equal(eMaker.swap.PairId, eTaker.swap.PairId)
	a.assert.Equal(eMaker.swap.Quantity, eTaker.swap.Quantity)
	a.assert.Equal(eMaker.swap.RHash, eTaker.swap.RHash)

	a.assert.Equal(eMaker.swap.PeerPubKey, srcNode.PubKey())
	a.assert.Equal(eTaker.swap.PeerPubKey, destNode.PubKey())

	// TODO: add assertions on currency/amount
	//fmt.Printf("### taker: %v\n\n", eTaker.swap)
	//fmt.Printf("### maker: %v\n\n", eMaker.swap)
}

func (a *actions) verifyConnectivity(n1, n2 *xudtest.HarnessNode) {
	a.verifyPeer(n1, n2)
	a.verifyPeer(n2, n1)
}

func (a *actions) verifyPeer(srcNode, destNode *xudtest.HarnessNode) {
	resListPeers, err := srcNode.Client.ListPeers(a.ctx, &xudrpc.ListPeersRequest{})
	a.assert.NoError(err)

	peerIndex := -1
	for i := 0; i < len(resListPeers.Peers); i++ {
		if resListPeers.Peers[i].NodePubKey == destNode.PubKey() {
			peerIndex = i
			break
		}
	}
	a.assert.NotEqual(peerIndex, -1, "peer is missing")
	a.assert.Equal(resListPeers.Peers[peerIndex].LndPubKeys["BTC"], destNode.LndBtcNode.PubKeyStr)
	a.assert.Equal(resListPeers.Peers[peerIndex].LndPubKeys["LTC"], destNode.LndLtcNode.PubKeyStr)
}

type subscribeOrdersEvent struct {
	orderUpdate *xudrpc.OrderUpdate
	err         error
}

func subscribeOrders(ctx context.Context, node *xudtest.HarnessNode) <-chan *subscribeOrdersEvent {
	out := make(chan *subscribeOrdersEvent, 1)

	// Subscribe before starting a non-blocking routine.
	req := xudrpc.SubscribeOrdersRequest{}
	stream, err := node.Client.SubscribeOrders(ctx, &req)
	if err != nil {
		out <- &subscribeOrdersEvent{nil, err}
		return out
	}

	go func() {
		go func() {
			for {
				order, err := stream.Recv()
				out <- &subscribeOrdersEvent{order, err}
				if err != nil {
					break
				}
			}
		}()

		select {
		case <-ctx.Done():
			if e := ctx.Err(); e != context.Canceled {
				out <- &subscribeOrdersEvent{nil, errors.New("timeout reached before event was received")}
			}
		}
	}()

	return out
}

type subscribeSwapsEvent struct {
	swap *xudrpc.SwapSuccess
	err  error
}

func subscribeSwaps(ctx context.Context, node *xudtest.HarnessNode, includeTaker bool) <-chan *subscribeSwapsEvent {
	out := make(chan *subscribeSwapsEvent, 1)

	// Subscribe before starting a non-blocking routine.
	req := xudrpc.SubscribeSwapsRequest{IncludeTaker: includeTaker}
	stream, err := node.Client.SubscribeSwaps(ctx, &req)
	if err != nil {
		out <- &subscribeSwapsEvent{nil, err}
		return out
	}

	go func() {
		go func() {
			for {
				swap, err := stream.Recv()
				out <- &subscribeSwapsEvent{swap, err}
				if err != nil {
					break
				}
			}
		}()

		select {
		case <-ctx.Done():
			if e := ctx.Err(); e != context.Canceled {
				out <- &subscribeSwapsEvent{nil, errors.New("timeout reached before event was received")}
			}
		}
	}()

	return out
}

type subscribeSwapFailuresEvent struct {
	swapFailure *xudrpc.SwapFailure
	err         error
}

func subscribeSwapFailures(ctx context.Context, node *xudtest.HarnessNode, includeTaker bool) <-chan *subscribeSwapFailuresEvent {
	out := make(chan *subscribeSwapFailuresEvent, 1)

	// Subscribe before starting a non-blocking routine.
	req := xudrpc.SubscribeSwapsRequest{IncludeTaker: includeTaker}
	stream, err := node.Client.SubscribeSwapFailures(ctx, &req)
	if err != nil {
		out <- &subscribeSwapFailuresEvent{nil, err}
		return out
	}

	go func() {
		go func() {
			for {
				swapFailure, err := stream.Recv()
				out <- &subscribeSwapFailuresEvent{swapFailure, err}
				if err != nil {
					break
				}
			}
		}()

		select {
		case <-ctx.Done():
			if e := ctx.Err(); e != context.Canceled {
				out <- &subscribeSwapFailuresEvent{nil, errors.New("timeout reached before event was received")}
			}
		}
	}()

	return out
}

func getOrdersCount(ctx context.Context, n1, n2 *xudtest.HarnessNode) (*xudrpc.OrdersCount, *xudrpc.OrdersCount, error) {
	n1i, err := getInfo(ctx, n1)
	if err != nil {
		return nil, nil, err
	}

	n2i, err := getInfo(ctx, n2)
	if err != nil {
		return nil, nil, err
	}

	return n1i.Orders, n2i.Orders, nil
}

func getInfo(ctx context.Context, n *xudtest.HarnessNode) (*xudrpc.GetInfoResponse, error) {
	info, err := n.Client.GetInfo(ctx, &xudrpc.GetInfoRequest{})
	if err != nil {
		return nil, fmt.Errorf("RPC GetInfo failure: %v", err)
	}

	return info, nil
}

func openBtcChannel(ctx context.Context, ln *lntest.NetworkHarness, srcNode, destNode *lntest.HarnessNode, amt int64, pushAmt int64) (*lnrpc.ChannelPoint, error) {
	openChanStream, err := ln.OpenChannel(ctx, srcNode, destNode, btcutil.Amount(amt), btcutil.Amount(pushAmt), false)
	if err != nil {
		return nil, err
	}

	if _, err := ln.BtcMiner.Node.Generate(6); err != nil {
		return nil, err
	}

	return ln.WaitForChannelOpen(ctx, openChanStream)
}

func closeBtcChannel(ctx context.Context, ln *lntest.NetworkHarness, node *lntest.HarnessNode, cp *lnrpc.ChannelPoint, force bool) error {
	closeChanStream, _, err := ln.CloseChannel(ctx, node, cp, force)
	if err != nil {
		return err
	}

	if _, err := ln.BtcMiner.Node.Generate(6); err != nil {
		return err
	}

	if _, err := ln.WaitForChannelClose(ctx, closeChanStream); err != nil {
		return err
	}

	return nil
}

func openLtcChannel(ctx context.Context, ln *lntest.NetworkHarness, srcNode, destNode *lntest.HarnessNode, amt int64, pushAmt int64) (*lnrpc.ChannelPoint, error) {
	openChanStream, err := ln.OpenChannel(ctx, srcNode, destNode, btcutil.Amount(amt), btcutil.Amount(pushAmt), false)
	if err != nil {
		return nil, err
	}

	if _, err := ln.LtcMiner.Node.Generate(6); err != nil {
		return nil, err
	}

	return ln.WaitForChannelOpen(ctx, openChanStream)
}

func closeLtcChannel(ctx context.Context, ln *lntest.NetworkHarness, node *lntest.HarnessNode, cp *lnrpc.ChannelPoint, force bool) error {
	closeChanStream, _, err := ln.CloseChannel(ctx, node, cp, force)
	if err != nil {
		return err
	}

	if _, err := ln.LtcMiner.Node.Generate(6); err != nil {
		return err
	}

	if _, err := ln.WaitForChannelClose(ctx, closeChanStream); err != nil {
		return err
	}

	return nil
}

func openETHChannel(ctx context.Context, srcNode *xudtest.HarnessNode, amt uint64, pushAmt uint64) error {
	req := &xudrpc.OpenChannelRequest{NodeIdentifier: "", Currency: "ETH", Amount: amt, PushAmount: pushAmt}
	if _, err := srcNode.Client.OpenChannel(ctx, req); err != nil {
		return err
	}

	return nil
}

type balance struct {
	channel *lnrpc.ChannelBalanceResponse
	wallet  *lnrpc.WalletBalanceResponse
}

type balances struct {
	btc balance
	ltc balance
}

func getBalance(ctx context.Context, node *xudtest.HarnessNode) (*balances, error) {
	var b balances
	var err error

	b.ltc.channel, err = node.LndLtcNode.ChannelBalance(ctx, &lnrpc.ChannelBalanceRequest{})
	if err != nil {
		return nil, err
	}

	b.ltc.wallet, err = node.LndLtcNode.WalletBalance(ctx, &lnrpc.WalletBalanceRequest{})
	if err != nil {
		return nil, err
	}

	b.btc.channel, err = node.LndBtcNode.ChannelBalance(ctx, &lnrpc.ChannelBalanceRequest{})
	if err != nil {
		return nil, err
	}

	b.btc.wallet, err = node.LndBtcNode.WalletBalance(ctx, &lnrpc.WalletBalanceRequest{})
	if err != nil {
		return nil, err
	}

	return &b, nil
}
