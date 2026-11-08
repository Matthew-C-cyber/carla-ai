import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCron, describeCron, parseClock, toHHmm } from '../src/schedule';

describe('parseClock', () => {
  it('understands 12-hour and 24-hour times', () => {
    assert.deepEqual(parseClock('9am'), { hour: 9, minute: 0 });
    assert.deepEqual(parseClock('9:30 PM'), { hour: 21, minute: 30 });
    assert.deepEqual(parseClock('7 a.m.'), { hour: 7, minute: 0 });
    assert.deepEqual(parseClock('17:45'), { hour: 17, minute: 45 });
    assert.deepEqual(parseClock('0730'), { hour: 7, minute: 30 });
  });

  it('handles midnight and noon edge cases', () => {
    assert.deepEqual(parseClock('12am'), { hour: 0, minute: 0 });
    assert.deepEqual(parseClock('12pm'), { hour: 12, minute: 0 });
    assert.deepEqual(parseClock('noon'), { hour: 12, minute: 0 });
    assert.deepEqual(parseClock('midnight'), { hour: 0, minute: 0 });
  });

  it('rejects invalid input', () => {
    for (const bad of ['25:00', '13pm', '9:75', 'soon', '']) assert.equal(parseClock(bad), null, bad);
  });
});

describe('buildCron', () => {
  const at = { hour: 8, minute: 5 };

  it('builds each frequency', () => {
    assert.equal(buildCron({ frequency: 'daily', clock: at }), '5 8 * * *');
    assert.equal(buildCron({ frequency: 'weekdays', clock: at }), '5 8 * * 1-5');
    assert.equal(buildCron({ frequency: 'weekly', clock: at, weekday: 1 }), '5 8 * * 1');
    assert.equal(buildCron({ frequency: 'monthly', clock: at, dayOfMonth: 15 }), '5 8 15 * *');
  });

  it('requires the extra field for weekly and monthly', () => {
    assert.throws(() => buildCron({ frequency: 'weekly', clock: at }));
    assert.throws(() => buildCron({ frequency: 'monthly', clock: at, dayOfMonth: 31 }));
  });
});

describe('describeCron', () => {
  it('turns cron expressions back into English', () => {
    assert.equal(describeCron('5 8 * * *'), 'every day at 8:05 AM');
    assert.equal(describeCron('0 17 * * 1-5'), 'every weekday at 5:00 PM');
    assert.equal(describeCron('30 0 * * 0'), 'every Sunday at 12:30 AM');
    assert.equal(describeCron('0 12 22 * *'), 'on the 22nd of every month at 12:00 PM');
    assert.equal(describeCron('0 12 11 * *'), 'on the 11th of every month at 12:00 PM');
  });

  it('formats digest times', () => {
    assert.equal(toHHmm({ hour: 7, minute: 5 }), '07:05');
  });
});
