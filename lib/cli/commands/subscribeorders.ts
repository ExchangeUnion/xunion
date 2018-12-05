import { loadXudClient } from '../command';
import { Arguments } from 'yargs';
import * as xudrpc from '../../proto/xudrpc_pb';

export const command = 'streamorders [existing] [all]';

export const describe = 'stream order added, removed, and swapped events (DEMO)';

export const builder = {
  existing: {
    description: 'should return existing orders',
    type: 'boolean',
    default: true,
  },
  all: {
    description: 'should return all existing orders',
    type: 'boolean',
    default: false,
  },
};

export const handler = (argv: Arguments) => {
  const addedOrdersRequest = new xudrpc.SubscribeAddedOrdersRequest();
  addedOrdersRequest.setExisting(argv.existing);
  const addedOrdersSubscription = loadXudClient(argv).subscribeAddedOrders(addedOrdersRequest);
  addedOrdersSubscription.on('data', (order: xudrpc.Order) => {
    console.log(`Order added: ${JSON.stringify(order.toObject())}`);
  });

  const removedOrdersSubscription = loadXudClient(argv).subscribeRemovedOrders(new xudrpc.SubscribeRemovedOrdersRequest());
  removedOrdersSubscription.on('data', (orderRemoval: xudrpc.OrderRemoval) => {
    console.log(`Order removed: ${JSON.stringify(orderRemoval.toObject())}`);
  });

  const swapsSubscription = loadXudClient(argv).subscribeSwaps(new xudrpc.SubscribeSwapsRequest());
  swapsSubscription.on('data', (swapResult: xudrpc.SwapResult) => {
    console.log(`Order swapped: ${JSON.stringify(swapResult.toObject())}`);
  });
};
