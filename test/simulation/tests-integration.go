package main

import (
	"fmt"
	// "github.com/ExchangeUnion/xud-simulation/connexttest"
	"time"

	"github.com/ExchangeUnion/xud-simulation/xudrpc"
	"github.com/ExchangeUnion/xud-simulation/xudtest"
)

var integrationTestCases = []*testCase{
	{
		name: "network initialization", // must be the first test case to be run
		test: testNetworkInit,
	},
	{
		name: "order matching and swap",
		test: testOrderMatchingAndSwap,
	},
	{
		name: "order matching and multi path swap",
		test: testOrderMatchingAndMultiPathSwap,
	},
	{
		name: "dust order discarded",
		test: testDustOrderDiscarded,
	},
	{
		name: "order replacement",
		test: testOrderReplacement,
	},
	{
		name: "internal match and invalidation",
		test: testInternalMatchAndInvalidation,
	},
	{
		name: "p2p discovery",
		test: testP2PDiscovery,
	},
	{
		name: "p2p incorrect public key",
		test: testP2PIncorrectPubKey,
	},
	{
		name: "p2p ban unban",
		test: testP2PBanUnban,
	},
	{
		name: "p2p already connected",
		test: testP2PAlreadyConnected,
	},
	{
		name: "order broadcast and invalidation",
		test: testOrderBroadcastAndInvalidation,
	},
	{
		name: "runtime add pair of active orders",
		test: testRuntimeAddPairActiveOrders,
	},
	{
		name: "multiple hop swap",
		test: testMultiHopSwap,
	},
}

// testNetworkInit implements:
// 1) Verify connectivity to swap clients of all nodes.
// 2) Add currencies and pairs to all nodes.

// testNetworkInit must be the first test case to be run, and the only one
// allowed to alter the nodes critical state (peers, order book, etc.).
// All following test cases must cleanup their changes before finishing
// so that test cases would be stateless and won't be affected
// by their preceding ones.
func testNetworkInit(net *xudtest.NetworkHarness, ht *harnessTest) {
	for _, node := range net.ActiveNodes {
		ht.act.init(node)
	}
}

// testP2PDiscovery implements:
// Connect Alice to Bob, Bob to Carol, Dave to Carol. After a short while, all of them should end up connected.
func testP2PDiscovery(net *xudtest.NetworkHarness, ht *harnessTest) {
	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	// Connect Bob to Carol.
	ht.act.connect(net.Bob, net.Carol)
	ht.act.verifyConnectivity(net.Bob, net.Carol)

	// Carol should hear about Alice from Bob,
	// and should end up connected to her.
	time.Sleep(1 * time.Second)
	ht.act.verifyConnectivity(net.Alice, net.Carol)

	// Connect Dave to Carol.
	ht.act.connect(net.Dave, net.Carol)
	ht.act.verifyConnectivity(net.Dave, net.Carol)

	// Dave should hear about Alice and Bob from Carol,
	// and should end up connected to them.
	time.Sleep(1 * time.Second)
	ht.act.verifyConnectivity(net.Alice, net.Dave)
	ht.act.verifyConnectivity(net.Bob, net.Dave)

	// Cleanup.
	ht.act.disconnect(net.Alice, net.Bob)
	ht.act.disconnect(net.Alice, net.Carol)
	ht.act.disconnect(net.Alice, net.Dave)
	ht.act.disconnect(net.Bob, net.Carol)
	ht.act.disconnect(net.Bob, net.Dave)
	ht.act.disconnect(net.Carol, net.Dave)
}

// testP2PIncorrectPubKey implements:
// Alice connects to Bob expecting an incorrect public key.
// Bob should reject the connection due to auth invalid target.
func testP2PIncorrectPubKey(net *xudtest.NetworkHarness, ht *harnessTest) {
	// Alice connects to Bob while expecting an incorrect public key.
	incorrectPubKey := net.Bob.PubKey() + "Q"
	destNodeURI := fmt.Sprintf("%v@%v", incorrectPubKey, net.Bob.Cfg.P2PAddr())
	reqConn := &xudrpc.ConnectRequest{NodeUri: destNodeURI}

	// Bob should reject the connection since Alice signed her handshake data
	// specifying a different public key target then his.
	_, err := net.Alice.Client.Connect(ht.ctx, reqConn)
	ht.assert.Error(err)
	ht.assert.Contains(err.Error(), fmt.Sprintf(
		"Peer %v disconnected from us due to AuthFailureInvalidTarget",
		incorrectPubKey+"@"+net.Bob.Cfg.P2PAddr()))
}

// testP2PBanUnban implements:
// 1) If Alice ban Bob, connection attempts from both directions should fail.
// 2) if Alice unban Bob, connection attempts from both directions should succeed.
func testP2PBanUnban(net *xudtest.NetworkHarness, ht *harnessTest) {
	// Alice to ban Bob.
	ht.act.ban(net.Alice, net.Bob)

	// Alice should not attempt to connect to Bob while he is banned.
	reqConn := &xudrpc.ConnectRequest{NodeUri: net.Bob.NodeURI()}
	_, err := net.Alice.Client.Connect(ht.ctx, reqConn)
	ht.assert.Error(err)
	ht.assert.Contains(err.Error(), fmt.Sprintf(
		"could not connect to node %v because it is banned", net.Bob.PubKey()))

	// If Bob connects to Alice, he should get rejected.
	reqConn = &xudrpc.ConnectRequest{NodeUri: net.Alice.NodeURI()}
	_, err = net.Bob.Client.Connect(ht.ctx, reqConn)
	ht.assert.Error(err)
	ht.assert.Contains(err.Error(), fmt.Sprintf(
		" Peer %v disconnected from us due to Banned",
		net.Alice.PubKey()+"@"+net.Alice.Cfg.P2PAddr()))

	// After Alice unban Bob, connection attempts from both directions should succeed.
	ht.act.unban(net.Alice, net.Bob)
	ht.act.connect(net.Alice, net.Bob)
	ht.act.disconnect(net.Alice, net.Bob)
	ht.act.connect(net.Bob, net.Alice)

	// Cleanup.
	ht.act.disconnect(net.Alice, net.Bob)
}

// testP2PAlreadyConnected implements:
// If Alice and Bob are already connected, connection attempts from both directions should fail.
func testP2PAlreadyConnected(net *xudtest.NetworkHarness, ht *harnessTest) {
	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	// Alice should not attempt to connect to Bob while they are already connected.
	reqConn := &xudrpc.ConnectRequest{NodeUri: net.Bob.NodeURI()}
	_, err := net.Alice.Client.Connect(ht.ctx, reqConn)
	ht.assert.Error(err)
	ht.assert.Contains(err.Error(), fmt.Sprintf(
		"node %v at %v already connected", net.Bob.PubKey(), net.Bob.Cfg.P2PAddr()))

	// Bob should not attempt to connect to Alice while they are already connected.
	reqConn = &xudrpc.ConnectRequest{NodeUri: net.Alice.NodeURI()}
	_, err = net.Bob.Client.Connect(ht.ctx, reqConn)
	ht.assert.Error(err)
	ht.assert.Contains(err.Error(), fmt.Sprintf(
		"node %v at %v already connected", net.Alice.PubKey(), net.Alice.Cfg.P2PAddr()))

	// Cleanup.
	ht.act.disconnect(net.Alice, net.Bob)
}

// testOrderBroadcastAndInvalidation implements:
// 1) Placed order should get broadcasted over the network, and added to connected peers' order books.
// 2) Removed order should get invalidated over the network, and removed from connected peers' order books.
func testOrderBroadcastAndInvalidation(net *xudtest.NetworkHarness, ht *harnessTest) {
	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	req := &xudrpc.PlaceOrderRequest{
		Price:    0.02,
		Quantity: 1000000,
		PairId:   "LTC/BTC",
		OrderId:  "testOrderBroadcastAndInvalidation",
		Side:     xudrpc.OrderSide_BUY,
	}

	order := ht.act.placeOrderAndBroadcast(net.Alice, net.Bob, req)
	_, err := net.Alice.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "BTC"})
	ht.assert.NoError(err)

	ht.act.removeOrderAndInvalidate(net.Alice, net.Bob, order)
	_, err = net.Alice.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "BTC"})
	ht.assert.NoError(err)

	// Cleanup.
	ht.act.disconnect(net.Alice, net.Bob)
}

func testInternalMatchAndInvalidation(net *xudtest.NetworkHarness, ht *harnessTest) {
	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	// Place an order on Alice.
	req := &xudrpc.PlaceOrderRequest{
		OrderId:  "internal_maker_order_id",
		Price:    0.02,
		Quantity: 1000000,
		PairId:   "LTC/BTC",
		Side:     xudrpc.OrderSide_BUY,
	}
	order := ht.act.placeOrderAndBroadcast(net.Alice, net.Bob, req)

	// Place a matching order on Alice.
	ht.act.matchOrderAndInvalidate(net.Alice, net.Bob, order)

	// Cleanup.
	ht.act.disconnect(net.Alice, net.Bob)
}

// testRuntimeAddPairActiveOrders implements:
// Added trading pairs and currencies should trigger broadcast of active orders from already-connected peers.
func testRuntimeAddPairActiveOrders(net *xudtest.NetworkHarness, ht *harnessTest) {
	// Remove previously-added pairs/currencies from both Alice and Bob.
	ht.act.removePair(net.Alice, "LTC/BTC")
	// ht.act.removePair(net.Alice, "BTC/ETH")
	ht.act.removeCurrency(net.Alice, "LTC")
	ht.act.removeCurrency(net.Alice, "BTC")
	// ht.act.removeCurrency(net.Alice, "ETH")
	ht.act.removePair(net.Bob, "LTC/BTC")
	// ht.act.removePair(net.Bob, "BTC/ETH")
	ht.act.removeCurrency(net.Bob, "LTC")
	ht.act.removeCurrency(net.Bob, "BTC")
	// ht.act.removeCurrency(net.Bob, "ETH")

	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	// Re-add the pairs/currencies to Alice after peer connection was already established.
	ht.act.addCurrency(net.Alice, "BTC", xudrpc.Currency_LND, "", 8)
	ht.act.addCurrency(net.Alice, "LTC", xudrpc.Currency_LND, "", 8)
	// TODO(karl): enable connext V2 simulation tests
	// ht.act.addCurrency(net.Alice, "ETH", xudrpc.Currency_CONNEXT, connexttest.ETHTokenAddress, 18)
	ht.act.addPair(net.Alice, "LTC", "BTC")
	// ht.act.addPair(net.Alice, "BTC", "ETH")

	// Place LTC/BTC order on Alice.
	req := &xudrpc.PlaceOrderRequest{
		OrderId:  "maker_order_id",
		Price:    0.02,
		Quantity: 1000000,
		PairId:   "LTC/BTC",
		Side:     xudrpc.OrderSide_BUY,
	}
	res, err := net.Alice.Client.PlaceOrderSync(ht.ctx, req)
	ht.assert.NoError(err)
	ht.assert.Len(res.InternalMatches, 0)
	ht.assert.Len(res.SwapSuccesses, 0)
	ht.assert.Len(res.SwapFailures, 0)
	ht.assert.NotNil(res.RemainingOrder)

	// Bob should receive the order once his LTC/BTC pair is re-added.
	bobOrdersChan := subscribeOrders(ht.ctx, net.Bob)
	ht.act.addCurrency(net.Bob, "BTC", xudrpc.Currency_LND, "", 8)
	ht.act.addCurrency(net.Bob, "LTC", xudrpc.Currency_LND, "", 8)
	ht.act.addPair(net.Bob, "LTC", "BTC")

	e := <-bobOrdersChan
	ht.assert.NoError(e.err)
	ht.assert.NotNil(e.orderUpdate)
	peerOrder := e.orderUpdate.GetOrder()
	ht.assert.Equal(peerOrder.Id, res.RemainingOrder.Id)
	ht.assert.Equal(peerOrder.PairId, req.PairId)
	ht.assert.Equal(peerOrder.NodeIdentifier.NodePubKey, net.Alice.PubKey())
	ht.act.removeOrderAndInvalidate(net.Alice, net.Bob, res.RemainingOrder)

	// Place BTC/ETH order on Alice.
	/*
		req = &xudrpc.PlaceOrderRequest{
			OrderId:  "maker_order_id",
			Price:    40,
			Quantity: 100,
			PairId:   "BTC/ETH",
			Side:     xudrpc.OrderSide_BUY,
		}
		res, err = net.Alice.Client.PlaceOrderSync(ht.ctx, req)
		ht.assert.NoError(err)
		ht.assert.Len(res.InternalMatches, 0)
		ht.assert.Len(res.SwapSuccesses, 0)
		ht.assert.Len(res.SwapFailures, 0)
		ht.assert.NotNil(res.RemainingOrder)

		// Bob should receive the order once his BTC/ETH pair is re-added.
		bobOrdersChan = subscribeOrders(ht.ctx, net.Bob)
		ht.act.addCurrency(net.Bob, "ETH", xudrpc.Currency_CONNEXT, connexttest.ETHTokenAddress, 18)
		ht.act.addPair(net.Bob, "BTC", "ETH")

		e = <-bobOrdersChan
		ht.assert.NoError(e.err)
		ht.assert.NotNil(e.orderUpdate)
		peerOrder = e.orderUpdate.GetOrder()
		ht.assert.Equal(peerOrder.Id, res.RemainingOrder.Id)
		ht.assert.Equal(peerOrder.PairId, req.PairId)
		ht.assert.Equal(peerOrder.NodeIdentifier.NodePubKey, net.Alice.PubKey())
		ht.act.removeOrderAndInvalidate(net.Alice, net.Bob, res.RemainingOrder)
	*/

	// Cleanup.
	ht.act.disconnect(net.Alice, net.Bob)
}

func testOrderMatchingAndSwap(net *xudtest.NetworkHarness, ht *harnessTest) {
	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	// Place an order on Alice.
	req := &xudrpc.PlaceOrderRequest{
		OrderId:  "maker_order_id",
		Price:    0.02,
		Quantity: 1000000,
		PairId:   "LTC/BTC",
		Side:     xudrpc.OrderSide_BUY,
	}
	ht.act.placeOrderAndBroadcast(net.Alice, net.Bob, req)

	// Place a matching order on Bob.
	req = &xudrpc.PlaceOrderRequest{
		OrderId:  "taker_order_id",
		Price:    req.Price,
		Quantity: req.Quantity,
		PairId:   req.PairId,
		Side:     xudrpc.OrderSide_SELL,
	}
	ht.act.placeOrderAndSwap(net.Bob, net.Alice, req)

	// Cleanup.
	ht.act.disconnect(net.Alice, net.Bob)
}

func testOrderMatchingAndMultiPathSwap(net *xudtest.NetworkHarness, ht *harnessTest) {
	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	// Place an order on Alice.
	req := &xudrpc.PlaceOrderRequest{
		OrderId:  "multi_path_order",
		Price:    0.02,
		Quantity: 8600000,
		PairId:   "LTC/BTC",
		Side:     xudrpc.OrderSide_BUY,
	}
	ht.act.placeOrderAndBroadcast(net.Alice, net.Bob, req)

	// Place a matching order on Bob.
	req = &xudrpc.PlaceOrderRequest{
		OrderId:  "multi_path_order",
		Price:    req.Price,
		Quantity: req.Quantity,
		PairId:   req.PairId,
		Side:     xudrpc.OrderSide_SELL,
	}
	ht.act.placeOrderAndSwap(net.Bob, net.Alice, req)

	// Cleanup.
	ht.act.disconnect(net.Alice, net.Bob)
}

func testDustOrderDiscarded(net *xudtest.NetworkHarness, ht *harnessTest) {
	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	// Place an order on Alice.
	req := &xudrpc.PlaceOrderRequest{
		OrderId:  "dust_order",
		Price:    0.02,
		Quantity: 10000,
		PairId:   "LTC/BTC",
		Side:     xudrpc.OrderSide_BUY,
	}
	ht.act.placeOrderAndBroadcast(net.Alice, net.Bob, req)

	// Place a matching order on Bob.
	req = &xudrpc.PlaceOrderRequest{
		OrderId:  "dust_order",
		Price:    req.Price,
		Quantity: 10099,
		PairId:   req.PairId,
		Side:     xudrpc.OrderSide_SELL,
	}

	aliceOrderChan := subscribeOrders(ht.ctx, net.Alice)
	res, err := net.Bob.Client.PlaceOrderSync(ht.ctx, req)

	// verify that there is no remaining order
	ht.assert.NoError(err)
	ht.assert.Len(res.InternalMatches, 0)
	ht.assert.Len(res.SwapFailures, 0)
	ht.assert.Len(res.SwapSuccesses, 1)
	ht.assert.Nil(res.RemainingOrder)

	e := <-aliceOrderChan
	ht.assert.NoError(e.err)
	ht.assert.NotNil(e.orderUpdate)
	orderRemoval := e.orderUpdate.GetOrderRemoval()
	ht.assert.NotNil(orderRemoval)
	ht.assert.Equal(req.PairId, orderRemoval.PairId)
	ht.assert.True(orderRemoval.IsOwnOrder)

	// verify that the order books are empty
	srcNodeCount, destNodeCount, err := getOrdersCount(ht.ctx, net.Alice, net.Bob)
	ht.assert.NoError(err)
	ht.assert.Equal(0, int(srcNodeCount.Own))
	ht.assert.Equal(0, int(srcNodeCount.Peer))
	ht.assert.Equal(0, int(destNodeCount.Own))
	ht.assert.Equal(0, int(destNodeCount.Peer))

	// Cleanup.
	ht.act.disconnect(net.Alice, net.Bob)
}

func testOrderReplacement(net *xudtest.NetworkHarness, ht *harnessTest) {
	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	var originalQuantity uint64 = 1000000
	originalPrice := 0.02
	var newQuantity uint64 = 2000000
	newPrice := 0.03
	var replacedOrderID = "replaced_order_id"

	// Place an order on Alice.
	req := &xudrpc.PlaceOrderRequest{
		OrderId:  replacedOrderID,
		Price:    originalPrice,
		Quantity: originalQuantity,
		PairId:   "LTC/BTC",
		Side:     xudrpc.OrderSide_BUY,
	}
	ht.act.placeOrderAndBroadcast(net.Alice, net.Bob, req)

	// Subscribe to orders on Bob
	bobOrderChan := subscribeOrders(ht.ctx, net.Bob)

	// Replace the order on Alice
	req = &xudrpc.PlaceOrderRequest{
		ReplaceOrderId: replacedOrderID,
		Price:          newPrice,
		Quantity:       newQuantity,
		PairId:         req.PairId,
		Side:           req.Side,
	}
	res, err := net.Alice.Client.PlaceOrderSync(ht.ctx, req)
	order := res.RemainingOrder
	ht.assert.NoError(err)
	ht.assert.Len(res.InternalMatches, 0)
	ht.assert.Len(res.SwapSuccesses, 0)
	ht.assert.Len(res.SwapFailures, 0)
	ht.assert.NotNil(res.RemainingOrder)
	ht.assert.True(order.IsOwnOrder)
	ht.assert.Equal(replacedOrderID, order.LocalId)

	// Retrieve and verify the removed order event on Bob.
	e := <-bobOrderChan
	ht.assert.NoError(e.err)
	ht.assert.NotNil(e.orderUpdate)
	orderRemoval := e.orderUpdate.GetOrderRemoval()
	ht.assert.NotNil(orderRemoval)
	ht.assert.Equal(originalQuantity, orderRemoval.Quantity)
	ht.assert.Equal(req.PairId, orderRemoval.PairId)
	ht.assert.False(orderRemoval.IsOwnOrder)

	// Retrieve and verify the added order event on Bob.
	e = <-bobOrderChan
	ht.assert.NoError(e.err)
	ht.assert.NotNil(e.orderUpdate)
	peerOrder := e.orderUpdate.GetOrder()
	ht.assert.NotNil(peerOrder)

	// Verify the peer order.
	ht.assert.Equal(newPrice, peerOrder.Price)
	ht.assert.Equal(req.PairId, peerOrder.PairId)
	ht.assert.Equal(newQuantity, peerOrder.Quantity)
	ht.assert.Equal(req.Side, peerOrder.Side)
	ht.assert.False(peerOrder.IsOwnOrder)
	ht.assert.Equal(net.Alice.PubKey(), peerOrder.NodeIdentifier.NodePubKey)

	// Verify that only the replaced order is in the order books
	srcNodeCount, destNodeCount, err := getOrdersCount(ht.ctx, net.Alice, net.Bob)
	ht.assert.NoError(err)
	ht.assert.Equal(1, int(srcNodeCount.Own))
	ht.assert.Equal(0, int(srcNodeCount.Peer))
	ht.assert.Equal(0, int(destNodeCount.Own))
	ht.assert.Equal(1, int(destNodeCount.Peer))

	// Cleanup.
	ht.act.removeOrderAndInvalidate(net.Alice, net.Bob, order)
	ht.act.disconnect(net.Alice, net.Bob)
}

func testMultiHopSwap(net *xudtest.NetworkHarness, ht *harnessTest) {
	// Connect Alice to Dave.
	ht.act.connect(net.Alice, net.Dave)
	ht.act.verifyConnectivity(net.Alice, net.Dave)

	// Place a buy order on Alice.
	req := &xudrpc.PlaceOrderRequest{
		OrderId:  "maker_order_id",
		Price:    0.02,
		Quantity: 1000000,
		PairId:   "LTC/BTC",
		Side:     xudrpc.OrderSide_BUY,
	}
	ht.act.placeOrderAndBroadcast(net.Alice, net.Dave, req)

	// Place a matching order on Dave.
	req = &xudrpc.PlaceOrderRequest{
		OrderId:  "taker_order_id",
		Price:    req.Price,
		Quantity: req.Quantity,
		PairId:   req.PairId,
		Side:     xudrpc.OrderSide_SELL,
	}
	ht.act.placeOrderAndSwap(net.Dave, net.Alice, req)

	// Place a sell order on Dave.
	req = &xudrpc.PlaceOrderRequest{
		OrderId:  "maker_order_id2",
		Price:    req.Price,
		Quantity: req.Quantity,
		PairId:   req.PairId,
		Side:     xudrpc.OrderSide_SELL,
	}
	ht.act.placeOrderAndBroadcast(net.Dave, net.Alice, req)

	// Place a matching order on Alice.
	req = &xudrpc.PlaceOrderRequest{
		OrderId:  "taker_order_id2",
		Price:    req.Price,
		Quantity: req.Quantity,
		PairId:   req.PairId,
		Side:     xudrpc.OrderSide_BUY,
	}
	ht.act.placeOrderAndSwap(net.Alice, net.Dave, req)

	// Cleanup.
	ht.act.disconnect(net.Alice, net.Dave)
}
