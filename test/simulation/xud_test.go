package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ExchangeUnion/xud-simulation/lntest"
	"github.com/ExchangeUnion/xud-simulation/xudrpc"
	"github.com/ExchangeUnion/xud-simulation/xudtest"
	ltcchaincfg "github.com/ltcsuite/ltcd/chaincfg"
	ltcchainhash "github.com/ltcsuite/ltcd/chaincfg/chainhash"
	ltctest "github.com/ltcsuite/ltcd/integration/rpctest"
	ltcclient "github.com/ltcsuite/ltcd/rpcclient"
	"github.com/ltcsuite/ltcutil"
	btcchaincfg "github.com/roasbeef/btcd/chaincfg"
	btcchainhash "github.com/roasbeef/btcd/chaincfg/chainhash"
	btctest "github.com/roasbeef/btcd/integration/rpctest"
	btcclient "github.com/roasbeef/btcd/rpcclient"
	"github.com/roasbeef/btcutil"
	"github.com/stretchr/testify/require"
)

var (
	cfg *config
)

func TestMain(m *testing.M) {
	cfg = loadConfig()

	res := m.Run()
	os.Exit(res)
}

func TestIntegration(t *testing.T) {
	// Disabling balance checks because we're now opening the payment channels after xud launch,
	// and so the capacity checks would only trigger after 60 sec.
	// We can solve this by making the capacity checks interval configurable.
	xudNetwork, teardown := launchNetwork(true)
	defer func() {
		time.Sleep(5 * time.Second)
		teardown()
	}()

	assert := require.New(t)

	log.Printf("Running %v integration tests", len(integrationTestCases))

	// Open channels from both directions on each chain.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	amt := int64(15000000)
	pushAmt := int64(7500000)

	aliceBobBtcChanPoint, err := openBtcChannel(ctx, xudNetwork.LndBtcNetwork, xudNetwork.Alice.LndBtcNode, xudNetwork.Bob.LndBtcNode, amt, pushAmt)
	assert.NoError(err)
	aliceBobLtcChanPoint, err := openLtcChannel(ctx, xudNetwork.LndLtcNetwork, xudNetwork.Alice.LndLtcNode, xudNetwork.Bob.LndLtcNode, amt, pushAmt)
	assert.NoError(err)

	bobCarolBtcChanPoint, err := openBtcChannel(ctx, xudNetwork.LndBtcNetwork, xudNetwork.Bob.LndBtcNode, xudNetwork.Carol.LndBtcNode, amt, pushAmt)
	assert.NoError(err)
	bobCarolLtcChanPoint, err := openLtcChannel(ctx, xudNetwork.LndLtcNetwork, xudNetwork.Bob.LndLtcNode, xudNetwork.Carol.LndLtcNode, amt, pushAmt)
	assert.NoError(err)

	carolDavidBtcChanPoint, err := openBtcChannel(ctx, xudNetwork.LndBtcNetwork, xudNetwork.Carol.LndBtcNode, xudNetwork.Dave.LndBtcNode, amt, pushAmt)
	assert.NoError(err)
	carolDavidLtcChanPoint, err := openLtcChannel(ctx, xudNetwork.LndLtcNetwork, xudNetwork.Carol.LndLtcNode, xudNetwork.Dave.LndLtcNode, amt, pushAmt)
	assert.NoError(err)

	// open a second LTC channel between alice and carol for multipath payments
	aliceCarolLtcChanPoint, err := openLtcChannel(ctx, xudNetwork.LndLtcNetwork, xudNetwork.Alice.LndLtcNode, xudNetwork.Carol.LndLtcNode, amt, pushAmt)
	assert.NoError(err)

	initialStates := make(map[int]*xudrpc.GetInfoResponse)
	for i, testCase := range integrationTestCases {
		success := t.Run(testCase.name, func(t1 *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Duration(cfg.Timeout))
			ht := newHarnessTest(ctx, cancel, t1)
			defer ht.teardown()

			ht.RunTestCase(testCase, xudNetwork)
		})

		// Stop at the first failure. Mimic behavior of original test
		// framework.
		if !success {
			break
		}

		ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		// Save the nodes initial state after the initialization test.
		// On all consecutive tests, verify that it hasn't changed,
		// so that tests won't be affected by preceding ones.
		if i == 0 {
			for num, node := range xudNetwork.ActiveNodes {
				res, err := node.Client.GetInfo(ctx, &xudrpc.GetInfoRequest{})
				assert.NoError(err)
				initialStates[num] = res
			}
		} else {
			for num, node := range xudNetwork.ActiveNodes {
				res, err := node.Client.GetInfo(ctx, &xudrpc.GetInfoRequest{})
				assert.NoError(err)
				initialState, ok := initialStates[num]
				assert.True(ok)

				msg := fmt.Sprintf("test should not leave a node (%v) in altered state", node.Name)
				assert.Equal(initialState.Version, res.Version, msg)
				assert.Equal(initialState.NodePubKey, res.NodePubKey, msg)
				// assert.Equal(initialState.NumPeers, res.NumPeers, msg)
				// assert.Equal(initialState.NumPairs, res.NumPairs, msg)

				// TODO: check why the following assertion fails after 'order_matching_and_swap' test.
				// ht.assert.Equal(initialState.Orders, res.Orders, msg)
			}
		}
	}

	// Close all channels, mostly in order to verify there are no pending HTLCs (which would require force-close).
	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err = closeBtcChannel(ctx, xudNetwork.LndBtcNetwork, xudNetwork.Alice.LndBtcNode, aliceBobBtcChanPoint, false)
	assert.NoError(err)
	err = closeLtcChannel(ctx, xudNetwork.LndLtcNetwork, xudNetwork.Alice.LndLtcNode, aliceBobLtcChanPoint, false)
	assert.NoError(err)
	err = closeLtcChannel(ctx, xudNetwork.LndLtcNetwork, xudNetwork.Alice.LndLtcNode, aliceCarolLtcChanPoint, false)
	assert.NoError(err)
	err = closeBtcChannel(ctx, xudNetwork.LndBtcNetwork, xudNetwork.Bob.LndBtcNode, bobCarolBtcChanPoint, false)
	assert.NoError(err)
	err = closeLtcChannel(ctx, xudNetwork.LndLtcNetwork, xudNetwork.Bob.LndLtcNode, bobCarolLtcChanPoint, false)
	assert.NoError(err)
	err = closeBtcChannel(ctx, xudNetwork.LndBtcNetwork, xudNetwork.Carol.LndBtcNode, carolDavidBtcChanPoint, false)
	assert.NoError(err)
	err = closeLtcChannel(ctx, xudNetwork.LndLtcNetwork, xudNetwork.Carol.LndLtcNode, carolDavidLtcChanPoint, false)
	assert.NoError(err)
}

func TestInstability(t *testing.T) {
	xudNetwork, teardown := launchNetwork(true)
	defer teardown()

	assert := require.New(t)

	log.Printf("Running %v instability tests", len(instabilityTestCases))

	// Open channels from both directions on each chain.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	amt := int64(15000000)
	pushAmt := int64(7500000)

	aliceBobBtcChanPoint, err := openBtcChannel(ctx, xudNetwork.LndBtcNetwork, xudNetwork.Alice.LndBtcNode, xudNetwork.Bob.LndBtcNode, amt, pushAmt)
	assert.NoError(err)
	aliceBobLtcChanPoint, err := openLtcChannel(ctx, xudNetwork.LndLtcNetwork, xudNetwork.Alice.LndLtcNode, xudNetwork.Bob.LndLtcNode, amt, pushAmt)
	assert.NoError(err)

	for _, testCase := range instabilityTestCases {
		success := t.Run(testCase.name, func(t1 *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			ht := newHarnessTest(ctx, cancel, t1)
			defer ht.teardown()

			ht.RunTestCase(testCase, xudNetwork)
		})

		if !success {
			break
		}
	}

	// Close all channels before next iteration.
	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err = closeBtcChannel(ctx, xudNetwork.LndBtcNetwork, xudNetwork.Alice.LndBtcNode, aliceBobBtcChanPoint, false)
	assert.NoError(err)
	err = closeLtcChannel(ctx, xudNetwork.LndLtcNetwork, xudNetwork.Alice.LndLtcNode, aliceBobLtcChanPoint, false)
	assert.NoError(err)
}

func TestSecurity(t *testing.T) {
	xudNetwork, teardown := launchNetwork(true)
	defer teardown()

	assert := require.New(t)

	log.Printf("Running %v security tests", len(securityTestCases))

	// For each test: open channels, save the balance, execute the test,
	// compare the balance and close the channels cooperatively.
	for _, testCase := range securityTestCases {
		// Open channels from both directions on each chain.
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		amt := int64(15000000)
		pushAmt := int64(7500000)

		aliceBtcChanPoint, err := openBtcChannel(ctx, xudNetwork.LndBtcNetwork, xudNetwork.Alice.LndBtcNode, xudNetwork.Bob.LndBtcNode, amt, pushAmt)
		assert.NoError(err)
		aliceLtcChanPoint, err := openLtcChannel(ctx, xudNetwork.LndLtcNetwork, xudNetwork.Alice.LndLtcNode, xudNetwork.Bob.LndLtcNode, amt, pushAmt)
		assert.NoError(err)
		bobBtcChanPoint, err := openBtcChannel(ctx, xudNetwork.LndBtcNetwork, xudNetwork.Bob.LndBtcNode, xudNetwork.Alice.LndBtcNode, amt, pushAmt)
		assert.NoError(err)
		bobLtcChanPoint, err := openLtcChannel(ctx, xudNetwork.LndLtcNetwork, xudNetwork.Bob.LndLtcNode, xudNetwork.Alice.LndLtcNode, amt, pushAmt)
		assert.NoError(err)

		// Save the initial balance.
		alicePrevBalance, err := getBalance(ctx, xudNetwork.Alice)
		assert.NoError(err)
		bobPrevBalance, err := getBalance(ctx, xudNetwork.Bob)
		assert.NoError(err)

		success := t.Run(testCase.name, func(t1 *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			ht := newHarnessTest(ctx, cancel, t1)
			defer ht.teardown()

			ht.RunTestCase(testCase, xudNetwork)
		})

		if !success {
			break
		}

		ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if !testCase.balanceMayChange {
			// Verify that balance remain unchanged.
			aliceBalance, err := getBalance(ctx, xudNetwork.Alice)
			assert.NoError(err)
			assert.Equal(alicePrevBalance, aliceBalance, "alice balance mismatch")

			bobBalance, err := getBalance(ctx, xudNetwork.Bob)
			assert.NoError(err)
			assert.Equal(bobPrevBalance, bobBalance, "bob balance mismatch")
		}

		// Close all channels before next iteration.
		err = closeBtcChannel(ctx, xudNetwork.LndBtcNetwork, xudNetwork.Alice.LndBtcNode, aliceBtcChanPoint, false)
		assert.NoError(err)
		err = closeLtcChannel(ctx, xudNetwork.LndLtcNetwork, xudNetwork.Alice.LndLtcNode, aliceLtcChanPoint, false)
		assert.NoError(err)
		err = closeBtcChannel(ctx, xudNetwork.LndBtcNetwork, xudNetwork.Bob.LndBtcNode, bobBtcChanPoint, false)
		assert.NoError(err)
		err = closeLtcChannel(ctx, xudNetwork.LndLtcNetwork, xudNetwork.Bob.LndLtcNode, bobLtcChanPoint, false)
		assert.NoError(err)
	}
}

func TestSecurityUnsettledChannels(t *testing.T) {
	xudNetwork, teardown := launchNetwork(true)
	defer teardown()

	log.Printf("Running %v unsettled-channels security tests", len(unsettledChannelsSecurityTests))

	for _, testCase := range unsettledChannelsSecurityTests {
		success := t.Run(testCase.name, func(t1 *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Duration(20*time.Minute))
			ht := newHarnessTest(ctx, cancel, t1)
			defer ht.teardown()

			ht.RunTestCase(testCase, xudNetwork)
		})

		if !success {
			break
		}
	}
}

/*
func verifyEthProviderReachability() error {
	client, err := ethclient.Dial(connexttest.EthProviderURL)
	if err != nil {
		return err
	}

	if _, err := client.NetworkID(context.Background()); err != nil {
		return err
	}

	return nil
}

func verifyConnextNodeReachability() error {
	res, err := http.Get(connexttest.NodeURL)
	if err != nil {
		return err
	}
	_ = res.Body.Close()

	return nil
}
*/

func launchNetwork(noBalanceChecks bool) (*xudtest.NetworkHarness, func()) {
	/*
		if err := verifyEthProviderReachability(); err != nil {
			log.Fatalf("EthProvider reachability failure: %v", err)
		}
		if err := verifyConnextNodeReachability(); err != nil {
			log.Fatalf("Connext node reachability failure: %v", err)
		}
	*/

	// Create XUD network instance without launching it.
	log.Printf("xud: creating network")
	xudHarness, err := xudtest.NewNetworkHarness()
	if err != nil {
		log.Fatalf("unable to create xud network harness: %v", err)
	}
	go func() {
		for {
			select {
			case xudError, more := <-xudHarness.ProcessErrors():
				if !more {
					return
				}

				if strings.Contains(xudError.Err.Error(), "signal: killed") {
					log.Printf("xud process (%v-%v) did not shutdown gracefully. process (%v) killed",
						xudError.Node.ID, xudError.Node.Name, xudError.Node.Cmd.Process.Pid)
				}
				//log.Printf("xud process finished with error:\n%v", xudError)
			}
		}
	}()
	if err := xudHarness.SetUp(noBalanceChecks); err != nil {
		log.Fatalf("cannot set up xud network: %v", err)
	}

	// Create LND-LTC network instance to gain access to the backend
	// 'OnTxAccepted' call back.
	var lndLtcNetworkHarness *lntest.NetworkHarness

	// Create and initialize LTCD instance.
	ltcHandlers := &ltcclient.NotificationHandlers{
		OnTxAccepted: func(hash *ltcchainhash.Hash, amt ltcutil.Amount) {
			newHash := new(lntest.Hash)
			copy(newHash[:], hash[:])
			lndLtcNetworkHarness.OnTxAccepted(newHash)
		},
	}
	ltcdHarness, err := ltctest.New(&ltcchaincfg.SimNetParams, ltcHandlers, []string{"--rejectnonstd", "--txindex"})
	if err != nil {
		log.Fatalf("ltcd: unable to create mining node: %v", err)
	}

	log.Printf("ltcd: launching node...")
	if err := ltcdHarness.SetUp(true, 50); err != nil {
		log.Fatalf("ltcd: unable to set up mining node: %v", err)
	}
	if err := ltcdHarness.Node.NotifyNewTransactions(false); err != nil {
		log.Fatalf("ltcd: unable to request transaction notifications: %v", err)
	}

	numBlocks := ltcchaincfg.SimNetParams.MinerConfirmationWindow * 2
	if _, err := ltcdHarness.Node.Generate(numBlocks); err != nil {
		log.Fatalf("ltcd: unable to generate blocks: %v", err)
	}
	log.Printf("ltcd: %d blocks generated", numBlocks)

	// Initialize LND-LTC network instance.
	lndLtcNetworkHarness, err = lntest.NewNetworkHarness(ltcdHarness, "litecoin")
	if err != nil {
		log.Fatalf("lnd-ltc: unable to create network harness: %v", err)
	}
	go func() {
		for {
			select {
			case err, more := <-lndLtcNetworkHarness.ProcessErrors():
				if !more {
					return
				}
				log.Printf("lnd-ltc: finished with error (stderr):\n%v", err)
			}
		}
	}()
	log.Printf("lnd-ltc: launching network...")
	if err = lndLtcNetworkHarness.SetUp(nil); err != nil {
		log.Fatalf("lnd-ltc: unable to set up test network: %v", err)
	}

	// Create LND-LTC network instance to gain access to the backend
	// 'OnTxAccepted' call back.
	var lndBtcNetworkHarness *lntest.NetworkHarness

	// Create and initialize BTCD instance.
	args := []string{"--rejectnonstd", "--txindex"}
	handlers := &btcclient.NotificationHandlers{
		OnTxAccepted: func(hash *btcchainhash.Hash, amt btcutil.Amount) {
			newHash := new(lntest.Hash)
			copy(newHash[:], hash[:])
			lndBtcNetworkHarness.OnTxAccepted(newHash)
		},
	}
	btcdHarness, err := btctest.New(&btcchaincfg.SimNetParams, handlers, args)
	if err != nil {
		log.Fatalf("btcd: unable to create mining node: %v", err)
	}

	log.Printf("btcd: launching node...")
	if err := btcdHarness.SetUp(true, 50); err != nil {
		log.Fatalf("btcd: unable to set up mining node: %v", err)
	}
	if err := btcdHarness.Node.NotifyNewTransactions(false); err != nil {
		log.Fatalf("btcd: unable to request transaction notifications: %v", err)
	}

	// Mine enough blocks in order for segwit and the CSV package
	// soft-fork to activate on SimNet.
	numBlocks = btcchaincfg.SimNetParams.MinerConfirmationWindow * 2
	if _, err := btcdHarness.Node.Generate(numBlocks); err != nil {
		log.Fatalf("btcd: unable to generate blocks: %v", err)
	}
	log.Printf("btcd: %d blocks generated", numBlocks)

	// Initialize LND-BTC network.
	lndBtcNetworkHarness, err = lntest.NewNetworkHarness(btcdHarness, "bitcoin")
	if err != nil {
		log.Fatalf("lnd-btc: unable to create harness: %v", err)
	}
	go func() {
		for {
			select {
			case err, more := <-lndBtcNetworkHarness.ProcessErrors():
				if !more {
					return
				}
				log.Printf("lnd-btc: finished with error (stderr):\n%v", err)
			}
		}
	}()
	log.Printf("lnd-btc: launching network...")
	if err = lndBtcNetworkHarness.SetUp(nil); err != nil {
		log.Fatalf("lnd-btc: unable to set up test network: %v", err)
	}

	/*
		connextNetworkHarness := connexttest.NewNetworkHarness()
		go func() {
			for {
				select {
				case err, more := <-connextNetworkHarness.ProcessErrors():
					if !more {
						return
					}
					if strings.Contains(err.Err.Error(), "signal: terminated") {
						continue
					}

					log.Printf("connext: finished with error (stderr):\n%v", err)
				}
			}
		}()
		log.Printf("connext: launching network...")
		if err := connextNetworkHarness.SetUp(); err != nil {
			log.Fatalf("connext: unable to set up test network: %v", err)
		}
		if err := connextNetworkHarness.Start(); err != nil {
			log.Fatalf("connext: unable to start test network: %v", err)
		}
	*/

	// Launch XUD network.
	xudHarness.SetLnd(lndBtcNetworkHarness, "BTC")
	xudHarness.SetLnd(lndLtcNetworkHarness, "LTC")
	// xudHarness.SetConnext(connextNetworkHarness)

	log.Printf("xud: launching network...")
	if err := xudHarness.Start(); err != nil {
		log.Fatalf("cannot start xud network: %v", err)
	}

	teardown := func() {
		if err := lndBtcNetworkHarness.TearDownAll(); err != nil {
			log.Fatalf("lnd-btc: cannot tear down network harness: %v", err)
		}
		log.Printf("lnd-btc: network harness teared down")

		if err := btcdHarness.TearDown(); err != nil {
			log.Fatalf("btcd: cannot tear down harness: %v", err)
		} else {
			log.Printf("btcd: harness teared down")
		}

		if err := lndLtcNetworkHarness.TearDownAll(); err != nil {
			log.Printf("lnd-ltc: cannot tear down network harness: %v", err)
		}
		log.Printf("lnd-ltc: network harness teared down")

		if err := ltcdHarness.TearDown(); err != nil {
			log.Fatalf("ltcd: cannot tear down harness: %v", err)
		}
		log.Printf("ltcd: harness teared down")

		/*
			if err := connextNetworkHarness.TearDownAll(); err != nil {
				log.Printf("connext: cannot tear down network harness: %v", err)
			}
			log.Printf("connext: network harness teared down")
		*/

		if err := xudHarness.TearDownAll(cfg.XudKill, cfg.XudCleanup); err != nil {
			log.Fatalf("cannot tear down xud network harness: %v", err)
		} else {
			log.Printf("xud network harness teared down")
		}
	}

	return xudHarness, teardown
}
