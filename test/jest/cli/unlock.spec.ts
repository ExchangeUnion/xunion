import { formatOutput } from '../../../lib/cli/commands/unlock';

describe('formatOutput', () => {
  const mockLog = jest.fn();
  console.log = mockLog;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should show unlock successfully with just BTC', () => {
    formatOutput({
      unlockedLndsList: ['BTC'],
      lockedLndsList: [],
      connextReady: false,
    });

    expect(mockLog.mock.calls).toMatchSnapshot();
  });

  it('should show unlock successfully with just BTC, LTC, and ETH (connext)', () => {
    formatOutput({
      unlockedLndsList: ['BTC, LTC'],
      lockedLndsList: [],
      connextReady: true,
    });

    expect(mockLog.mock.calls).toMatchSnapshot();
  });

  it('should show LTC as locked', () => {
    formatOutput({
      unlockedLndsList: ['BTC'],
      lockedLndsList: ['LTC'],
      connextReady: false,
    });

    expect(mockLog.mock.calls).toMatchSnapshot();
  });
});
