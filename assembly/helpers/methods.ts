import {
  Context,
  deferredCallQuote,
  Slot,
  Storage,
} from '@massalabs/massa-as-sdk';
import { PERIOD_DURATION, THREAD_DURATION, THREADS } from './constants';
import { bytesToU64 } from '@massalabs/as-types';
import { MAX_PRICE } from '../storage/DCA';

export function findSlotUnderPrice(
  startPeriod: u64,
  startThread: u8,
  endPeriod: u64,
  maxGas: u64,
  paramSize: u64,
): Slot {
  const maxPrice = bytesToU64(Storage.get(MAX_PRICE));
  const firstSlotPrice = deferredCallQuote(
    new Slot(startPeriod, startThread),
    maxGas,
    paramSize,
  );
  if (firstSlotPrice < maxPrice) return new Slot(startPeriod, startThread);
  else
    // check the first period separately, starting from the startThread and not 0
    for (let thread: u8 = startThread; thread < 32; thread++) {
      const price = deferredCallQuote(
        new Slot(startPeriod, thread),
        maxGas,
        paramSize,
      );
      if (price < maxPrice) {
        return new Slot(startPeriod, thread);
      }
    }
  // check the other periods
  for (let period = startPeriod + 1; period <= endPeriod; period++) {
    for (let thread: u8 = 0; thread < 32; thread++) {
      const price = deferredCallQuote(
        new Slot(period, thread),
        maxGas,
        paramSize,
      );
      if (price < maxPrice) {
        return new Slot(period, thread);
      }
    }
  }
  assert(false, 'No available slot under acceptable price');
  return new Slot(0, 0);
}

export const computeTargetSlotFromDelay = (delayMillis: u64): Slot => {
  const periodsDelay = delayMillis / PERIOD_DURATION;
  const millisRemainder = delayMillis % PERIOD_DURATION;

  const threadsDelay = u8(millisRemainder / THREAD_DURATION);

  let targetThread = (Context.currentThread() + threadsDelay) % THREADS;
  let targetPeriod = Context.currentPeriod() + periodsDelay;

  // Adjust period if thread overflows
  if (Context.currentThread() + threadsDelay >= THREADS) {
    targetPeriod += 1;
  }

  return new Slot(targetPeriod, targetThread);
};
