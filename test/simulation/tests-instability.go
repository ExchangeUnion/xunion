package main

import (
	"fmt"
	"time"

	"github.com/ExchangeUnion/xud-simulation/xudrpc"
	"github.com/ExchangeUnion/xud-simulation/xudtest"
)

var ltcQuantity int64 = 1000000

// instabilityTestCases are test cases which try to simulate instability
// due to bugs, network outages, or system issues. They test whether xud
// can handle such problems gracefully and prevent loss of funds.
var instabilityTestCases = []*testCase{
	{
		name: "network initialization", // must be the first test case to be run
		test: testNetworkInit,
	},
	//{
	//	name: "maker crashed after send payment", // replacing Alice
	//	test: testMakerCrashedAfterSend,
	//},
	//{
	//	name: "maker lnd crashed before order settlement", // replacing Alice
	//	test: testMakerLndCrashedBeforeSettlement,
	//},
	{
		name: "maker connext client crashed before order settlement", // replacing Alice
		test: testMakerConnextClientCrashedBeforeSettlement,
	},
	//{
	//	name: "maker crashed after send payment with delayed settlement; incoming: lnd, outgoing: lnd", // replacing Alice + Bob
	//	test: testMakerCrashedAfterSendDelayedSettlement,
	//},
	//{
	//	name: "maker crashed after send payment with delayed settlement; incoming: connext, outgoing: lnd", // replacing Alice + Bob
	//	test: testMakerCrashedAfterSendDelayedSettlementConnextIn,
	//},
	//{
	//	name: "maker crashed after send payment with delayed settlement; incoming: lnd, outgoing: connext", // replacing Alice + Bob
	//	test: testMakerCrashedAfterSendDelayedSettlementConnextOut,
	//},
}

// testMakerLndCrashedBeforeSettlement
func testMakerCrashedAfterSend(net *xudtest.NetworkHarness, ht *harnessTest) {
	var err error
	net.Alice, err = net.SetCustomXud(ht.ctx, ht, net.Alice, []string{"CUSTOM_SCENARIO=INSTABILITY::MAKER_CRASH_AFTER_SEND"})
	ht.assert.NoError(err)
	ht.act.init(net.Alice)

	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	// Save the initial balance.
	alicePrevBalance, err := getBalance(ht.ctx, net.Alice)
	ht.assert.NoError(err)
	alicePrevLtcBalance := alicePrevBalance.ltc.channel.GetBalance()

	// Place an order on Alice.
	aliceOrderReq := &xudrpc.PlaceOrderRequest{
		OrderId:  "maker_order_id",
		Price:    0.02,
		Quantity: uint64(ltcQuantity),
		PairId:   "LTC/BTC",
		Side:     xudrpc.OrderSide_BUY,
	}
	ht.act.placeOrderAndBroadcast(net.Alice, net.Bob, aliceOrderReq)

	// Place a matching order on Bob.
	bobOrderReq := &xudrpc.PlaceOrderRequest{
		OrderId:  "taker_order_id",
		Price:    aliceOrderReq.Price,
		Quantity: aliceOrderReq.Quantity,
		PairId:   aliceOrderReq.PairId,
		Side:     xudrpc.OrderSide_SELL,
	}

	_, err = net.Bob.Client.PlaceOrderSync(ht.ctx, bobOrderReq)
	ht.assert.NoError(err)

	<-net.Alice.ProcessExit

	err = net.Alice.Start(nil)
	ht.assert.NoError(err)

	// Brief delay to allow for swap to be recovered consistently
	time.Sleep(1 * time.Second)

	// Verify that alice received her LTC
	aliceBalance, err := getBalance(ht.ctx, net.Alice)
	ht.assert.NoError(err)
	aliceLtcBalance := aliceBalance.ltc.channel.GetBalance()
	ht.assert.Equal(alicePrevLtcBalance+ltcQuantity, aliceLtcBalance, "alice did not receive LTC")
}

func testMakerLndCrashedBeforeSettlement(net *xudtest.NetworkHarness, ht *harnessTest) {
	var err error
	net.Alice, err = net.SetCustomXud(ht.ctx, ht, net.Alice, []string{
		"CUSTOM_SCENARIO=INSTABILITY::MAKER_CLIENT_CRASHED_BEFORE_SETTLE",
		fmt.Sprintf("CLIENT_PID=%d", net.Alice.LndLtcNode.Cmd.Process.Pid),
		fmt.Sprintf("CLIENT_TYPE=%s", "LndLtc"),
	})
	ht.assert.NoError(err)
	ht.act.init(net.Alice)

	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	// Save the initial balance.
	alicePrevBalance, err := getBalance(ht.ctx, net.Alice)
	ht.assert.NoError(err)
	alicePrevLtcBalance := alicePrevBalance.ltc.channel.GetBalance()

	// Place an order on Alice.
	aliceOrderReq := &xudrpc.PlaceOrderRequest{
		OrderId:  "maker_order_id",
		Price:    0.02,
		Quantity: uint64(ltcQuantity),
		PairId:   "LTC/BTC",
		Side:     xudrpc.OrderSide_BUY,
	}
	ht.act.placeOrderAndBroadcast(net.Alice, net.Bob, aliceOrderReq)

	// Place a matching order on Bob.
	bobOrderReq := &xudrpc.PlaceOrderRequest{
		OrderId:  "taker_order_id",
		Price:    aliceOrderReq.Price,
		Quantity: aliceOrderReq.Quantity,
		PairId:   aliceOrderReq.PairId,
		Side:     xudrpc.OrderSide_SELL,
	}
	go net.Bob.Client.PlaceOrderSync(ht.ctx, bobOrderReq)

	// Alice's lnd-ltc is expected to be killed by Alice's custom xud.
	<-net.Alice.LndLtcNode.ProcessExit

	// Wait a bit so that Alice's call to lnd-ltc for settlement would fail.
	time.Sleep(5 * time.Second)

	// Restart Alice's lnd-ltc.
	err = net.Alice.LndLtcNode.Start(nil)
	ht.assert.NoError(err)

	// Brief delay to allow for swap to be recovered consistently.
	// The pending swap recheck interval is usually 5m, but was adjusted in
	// Alice's custom xud to 5s (as well as the swap completion timeout interval).
	time.Sleep(10 * time.Second)

	// Verify that alice received her LTC.
	aliceBalance, err := getBalance(ht.ctx, net.Alice)
	ht.assert.NoError(err)
	aliceLtcBalance := aliceBalance.ltc.channel.GetBalance()
	ht.assert.Equal(alicePrevLtcBalance+ltcQuantity, aliceLtcBalance, "alice did not recover LTC funds")
}

func testMakerConnextClientCrashedBeforeSettlement(net *xudtest.NetworkHarness, ht *harnessTest) {
	var err error
	net.Alice, err = net.SetCustomXud(ht.ctx, ht, net.Alice, []string{
		"CUSTOM_SCENARIO=INSTABILITY::MAKER_CLIENT_CRASHED_BEFORE_SETTLE",
		fmt.Sprintf("CLIENT_PID=%d", net.Alice.ConnextClient.Cmd.Process.Pid),
		fmt.Sprintf("CLIENT_TYPE=%s", "ConnextClient"),
	})
	ht.assert.NoError(err)
	ht.act.init(net.Alice)

	ht.act.initConnext(net, net.Alice, false)
	ht.act.initConnext(net, net.Bob, true)

	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	err = openETHChannel(ht.ctx, net.Bob, 400, 0)
	ht.assert.NoError(err)

	// Save the initial balances.
	alicePrevBalance, err := net.Alice.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "ETH"})
	ht.assert.NoError(err)
	alicePrevEthBalance := alicePrevBalance.Balances["ETH"]

	//bobPrevBalance, err := net.Bob.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "BTC"})
	//ht.assert.NoError(err)
	//bobPrevBtcBalance := bobPrevBalance.Balances["BTC"]

	// Place an order on Alice.
	aliceOrderReq := &xudrpc.PlaceOrderRequest{
		OrderId:  "maker_order_id",
		Price:    40,
		Quantity: 1,
		PairId:   "BTC/ETH",
		Side:     xudrpc.OrderSide_SELL,
	}
	ht.act.placeOrderAndBroadcast(net.Alice, net.Bob, aliceOrderReq)

	// Place a matching order on Bob.
	bobOrderReq := &xudrpc.PlaceOrderRequest{
		OrderId:  "taker_order_id",
		Price:    aliceOrderReq.Price,
		Quantity: aliceOrderReq.Quantity,
		PairId:   aliceOrderReq.PairId,
		Side:     xudrpc.OrderSide_BUY,
	}
	go net.Bob.Client.PlaceOrderSync(ht.ctx, bobOrderReq)

	// Alice's connext client is expected to be killed by Alice's custom xud.
	<-net.Alice.ConnextClient.ProcessExit

	// Wait a bit so that Alice's call to connext client for settlement would fail.
	time.Sleep(5 * time.Second)

	// Restart Alice's connext client.
	err = net.Alice.ConnextClient.Start(nil)
	ht.assert.NoError(err)

	err = waitConnextReady(net.Alice)
	ht.assert.NoError(err)

	// Brief delay to allow for swap to be recovered consistently.
	// The pending swap recheck interval is usually 5m, but was adjusted in
	// Alice's custom xud to 5s (as well as the swap completion timeout interval).
	time.Sleep(10 * time.Second)

	// <DEBUG>
	info, err := net.Alice.Client.GetInfo(ht.ctx, &xudrpc.GetInfoRequest{})
	fmt.Printf("info: %v\n", info.PendingSwapHashes)
	//time.Sleep(600 * time.Second)
	// </DEBUG>

	// Verify that alice received her ETH.
	aliceBalance, err := net.Alice.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "ETH"})
	ht.assert.NoError(err)
	aliceEthBalance := aliceBalance.Balances["ETH"]
	diff := uint64(float64(aliceOrderReq.Quantity) * aliceOrderReq.Price)
	ht.assert.Equal(alicePrevEthBalance.ChannelBalance+diff, aliceEthBalance.ChannelBalance, "alice did not recover ETH funds")
}

func testMakerCrashedAfterSendDelayedSettlement(net *xudtest.NetworkHarness, ht *harnessTest) {
	var err error
	net.Alice, err = net.SetCustomXud(ht.ctx, ht, net.Alice, []string{"CUSTOM_SCENARIO=INSTABILITY::MAKER_CRASH_AFTER_SEND"})
	ht.assert.NoError(err)

	net.Bob, err = net.SetCustomXud(ht.ctx, ht, net.Bob, []string{"CUSTOM_SCENARIO=INSTABILITY::TAKER_DELAY_BEFORE_SETTLE"})
	ht.assert.NoError(err)

	ht.act.init(net.Alice)
	ht.act.init(net.Bob)

	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	// Save the initial balance.
	alicePrevBalance, err := getBalance(ht.ctx, net.Alice)
	ht.assert.NoError(err)
	alicePrevLtcBalance := alicePrevBalance.ltc.channel.GetBalance()

	// Place an order on Alice.
	aliceOrderReq := &xudrpc.PlaceOrderRequest{
		OrderId:  "maker_order_id",
		Price:    0.02,
		Quantity: uint64(ltcQuantity),
		PairId:   "LTC/BTC",
		Side:     xudrpc.OrderSide_BUY,
	}
	ht.act.placeOrderAndBroadcast(net.Alice, net.Bob, aliceOrderReq)

	// Place a matching order on Bob.
	bobOrderReq := &xudrpc.PlaceOrderRequest{
		OrderId:  "taker_order_id",
		Price:    aliceOrderReq.Price,
		Quantity: aliceOrderReq.Quantity,
		PairId:   aliceOrderReq.PairId,
		Side:     xudrpc.OrderSide_SELL,
	}
	go net.Bob.Client.PlaceOrderSync(ht.ctx, bobOrderReq)

	<-net.Alice.ProcessExit

	net.Alice.Start(nil)

	// Verify that alice hasn't claimed her LTC yet. The incoming LTC payment
	// cannot be settled until the outgoing BTC payment is settled by bob,
	// which is being intentionally delayed.
	aliceIntermediateBalance, err := getBalance(ht.ctx, net.Alice)
	ht.assert.NoError(err)
	aliceIntermediateLtcBalance := aliceIntermediateBalance.ltc.channel.GetBalance()
	ht.assert.Less(aliceIntermediateLtcBalance, alicePrevLtcBalance)

	// Delay to allow for payment to be claimed by bob then recovered by alice
	time.Sleep(10 * time.Second)

	// Verify that alice received her LTC
	aliceBalance, err := getBalance(ht.ctx, net.Alice)
	ht.assert.NoError(err)
	aliceLtcBalance := aliceBalance.ltc.channel.GetBalance()
	ht.assert.Equal(alicePrevLtcBalance+ltcQuantity, aliceLtcBalance, "alice did not recover LTC funds")
}

func testMakerCrashedAfterSendDelayedSettlementConnextOut(net *xudtest.NetworkHarness, ht *harnessTest) {
	var err error
	net.Alice, err = net.SetCustomXud(ht.ctx, ht, net.Alice, []string{"CUSTOM_SCENARIO=INSTABILITY::MAKER_CRASH_AFTER_SEND"})
	ht.assert.NoError(err)

	net.Bob, err = net.SetCustomXud(ht.ctx, ht, net.Bob, []string{"CUSTOM_SCENARIO=INSTABILITY::TAKER_DELAY_BEFORE_SETTLE"})
	ht.assert.NoError(err)

	ht.act.init(net.Alice)
	ht.act.initConnext(net, net.Alice, true)

	ht.act.init(net.Bob)
	ht.act.initConnext(net, net.Bob, false)

	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	err = openETHChannel(ht.ctx, net.Alice, 400, 0)
	ht.assert.NoError(err)

	// Save the initial balances.
	alicePrevBalance, err := net.Alice.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "BTC"})
	ht.assert.NoError(err)
	alicePrevBtcBalance := alicePrevBalance.Balances["BTC"]

	bobPrevBalance, err := net.Bob.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "ETH"})
	ht.assert.NoError(err)
	bobPrevEthBalance := bobPrevBalance.Balances["ETH"]

	// Place an order on Alice.
	aliceOrderReq := &xudrpc.PlaceOrderRequest{
		OrderId:  "maker_order_id",
		Price:    40,
		Quantity: 1,
		PairId:   "BTC/ETH",
		Side:     xudrpc.OrderSide_BUY,
	}
	ht.act.placeOrderAndBroadcast(net.Alice, net.Bob, aliceOrderReq)

	// Place a matching order on Bob.
	bobOrderReq := &xudrpc.PlaceOrderRequest{
		OrderId:  "taker_order_id",
		Price:    aliceOrderReq.Price,
		Quantity: aliceOrderReq.Quantity,
		PairId:   aliceOrderReq.PairId,
		Side:     xudrpc.OrderSide_SELL,
	}
	go net.Bob.Client.PlaceOrderSync(ht.ctx, bobOrderReq)

	<-net.Alice.ProcessExit

	err = net.Alice.Start(nil)
	ht.assert.NoError(err)

	err = waitConnextReady(net.Alice)
	ht.assert.NoError(err)

	// Verify that alice hasn't claimed her BTC yet. The incoming BTC payment
	// cannot be settled until the outgoing ETH payment is settled by bob,
	// which is being intentionally delayed.
	aliceIntermediateBalance, err := net.Alice.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "BTC"})
	ht.assert.NoError(err)
	aliceIntermediateBtcBalance := aliceIntermediateBalance.Balances["BTC"]
	ht.assert.Equal(alicePrevBtcBalance.ChannelBalance, aliceIntermediateBtcBalance.ChannelBalance)

	bobIntermediateBalance, err := net.Bob.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "ETH"})
	ht.assert.NoError(err)
	bobIntermediateEthBalance := bobIntermediateBalance.Balances["ETH"]
	ht.assert.Equal(bobPrevEthBalance.ChannelBalance, bobIntermediateEthBalance.ChannelBalance)

	// Wait to allow the ETH payment to be claimed by bob and then recovered by alice.
	time.Sleep(10 * time.Second)

	// Verify that both parties received their payment.
	aliceBalance, err := net.Alice.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "BTC"})
	ht.assert.NoError(err)
	aliceBtcBalance := aliceBalance.Balances["BTC"]
	diff := aliceOrderReq.Quantity
	ht.assert.Equal(alicePrevBtcBalance.ChannelBalance+diff, aliceBtcBalance.ChannelBalance, "alice did not recover BTC funds")

	bobBalance, err := net.Bob.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "ETH"})
	ht.assert.NoError(err)
	bobEthBalance := bobBalance.Balances["ETH"]
	diff = uint64(float64(bobOrderReq.Quantity) * bobOrderReq.Price)
	ht.assert.Equal(bobPrevEthBalance.ChannelBalance+diff, bobEthBalance.ChannelBalance)
}

func testMakerCrashedAfterSendDelayedSettlementConnextIn(net *xudtest.NetworkHarness, ht *harnessTest) {
	var err error
	net.Alice, err = net.SetCustomXud(ht.ctx, ht, net.Alice, []string{"CUSTOM_SCENARIO=INSTABILITY::MAKER_CRASH_AFTER_SEND"})
	ht.assert.NoError(err)

	net.Bob, err = net.SetCustomXud(ht.ctx, ht, net.Bob, []string{"CUSTOM_SCENARIO=INSTABILITY::TAKER_DELAY_BEFORE_SETTLE"})
	ht.assert.NoError(err)

	ht.act.init(net.Alice)
	ht.act.initConnext(net, net.Alice, false)

	ht.act.init(net.Bob)
	ht.act.initConnext(net, net.Bob, true)

	// Connect Alice to Bob.
	ht.act.connect(net.Alice, net.Bob)
	ht.act.verifyConnectivity(net.Alice, net.Bob)

	err = openETHChannel(ht.ctx, net.Bob, 400, 0)
	ht.assert.NoError(err)

	// Save the initial balances.
	alicePrevBalance, err := net.Alice.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "ETH"})
	ht.assert.NoError(err)
	alicePrevEthBalance := alicePrevBalance.Balances["ETH"]

	bobPrevBalance, err := net.Bob.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "BTC"})
	ht.assert.NoError(err)
	bobPrevBtcBalance := bobPrevBalance.Balances["BTC"]

	// Place an order on Alice.
	aliceOrderReq := &xudrpc.PlaceOrderRequest{
		OrderId:  "maker_order_id",
		Price:    40,
		Quantity: 1,
		PairId:   "BTC/ETH",
		Side:     xudrpc.OrderSide_SELL,
	}
	ht.act.placeOrderAndBroadcast(net.Alice, net.Bob, aliceOrderReq)

	// Place a matching order on Bob.
	bobOrderReq := &xudrpc.PlaceOrderRequest{
		OrderId:  "taker_order_id",
		Price:    aliceOrderReq.Price,
		Quantity: aliceOrderReq.Quantity,
		PairId:   aliceOrderReq.PairId,
		Side:     xudrpc.OrderSide_BUY,
	}
	go net.Bob.Client.PlaceOrderSync(ht.ctx, bobOrderReq)

	<-net.Alice.ProcessExit

	err = net.Alice.Start(nil)
	ht.assert.NoError(err)

	err = waitConnextReady(net.Alice)
	ht.assert.NoError(err)

	// Verify that alice hasn't claimed her ETH yet. The incoming ETH payment
	// cannot be settled until the outgoing BTC payment is settled by bob,
	// which is being intentionally delayed.
	aliceIntermediateBalance, err := net.Alice.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "ETH"})
	ht.assert.NoError(err)
	aliceIntermediateEthBalance := aliceIntermediateBalance.Balances["ETH"]
	ht.assert.Equal(alicePrevEthBalance.ChannelBalance, aliceIntermediateEthBalance.ChannelBalance)

	bobIntermediateBalance, err := net.Bob.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "BTC"})
	ht.assert.NoError(err)
	bobIntermediateBtcBalance := bobIntermediateBalance.Balances["BTC"]
	ht.assert.Equal(bobPrevBtcBalance.ChannelBalance, bobIntermediateBtcBalance.ChannelBalance)

	// Wait to allow the ETH payment to be claimed by bob and then recovered by alice.
	time.Sleep(10 * time.Second)

	// Verify that both parties received their payment.
	aliceBalance, err := net.Alice.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "ETH"})
	ht.assert.NoError(err)
	aliceEthBalance := aliceBalance.Balances["ETH"]
	diff := uint64(float64(aliceOrderReq.Quantity) * aliceOrderReq.Price)
	ht.assert.Equal(alicePrevEthBalance.ChannelBalance+diff, aliceEthBalance.ChannelBalance, "alice did not recover ETH funds")

	bobBalance, err := net.Bob.Client.GetBalance(ht.ctx, &xudrpc.GetBalanceRequest{Currency: "BTC"})
	ht.assert.NoError(err)
	bobBtcBalance := bobBalance.Balances["BTC"]
	diff = bobOrderReq.Quantity
	ht.assert.Equal(bobPrevBtcBalance.ChannelBalance+diff, bobBtcBalance.ChannelBalance)
}
