import { Logger } from './logger.service';

describe('Logger', () => {
  it('redacts credential fields and authorization headers', () => {
    const logger = new Logger();
    const sanitized = logger.sanitize({
      username: 'william',
      appPassword: 'secret-value',
      note: 'Authorization: Bearer abc.def and password=hunter2',
    }) as { username: string; appPassword: string; note: string };

    expect(sanitized.username).toBe('william');
    expect(sanitized.appPassword).toBe('[redacted]');
    expect(sanitized.note).not.toContain('abc.def');
    expect(sanitized.note).not.toContain('hunter2');
  });
});
