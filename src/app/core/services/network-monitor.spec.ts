import { NetworkMonitor } from './network-monitor';

describe('NetworkMonitor', () => {
  it('schedules one resume when the connection returns and ignores repeats', () => {
    const monitor = new NetworkMonitor();
    let resumes = 0;
    monitor.onReconnect(() => {
      resumes += 1;
    });

    monitor.apply(false);
    monitor.apply(false);
    monitor.apply(true);
    monitor.apply(true);
    monitor.apply(false);
    monitor.apply(true);

    expect(resumes).toBe(2);
    expect(monitor.isOnline()).toBe(true);
  });
});
