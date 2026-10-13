import {
  Args,
  bytesToU64,
  stringToBytes,
  u64ToBytes,
} from '@massalabs/as-types';
import {
  Context,
  Storage,
  callerHasWriteAccess,
  deferredCallRegister,
  Slot,
  generateEvent,
  deferredCallCancel,
  deferredCallExists,
} from '@massalabs/massa-as-sdk';

// TEMP
export { recover, upgrade } from './Upgradeable';

export const DEFERRED_ID = stringToBytes('DEFERRED_ID');

export function constructor(_: StaticArray<u8>): void {
  assert(callerHasWriteAccess());
  Storage.set(DEFERRED_ID, u64ToBytes(0));
}

/**
 * Start a DCA
 * @param {StaticArray<u8>} _
 *
 */
export function callDeferrer(_: StaticArray<u8>): void {
  const deferredId = bytesToU64(Storage.get(DEFERRED_ID));
  const currentPeriod = Context.currentPeriod();
  const currentThread = Context.currentThread();
  if (deferredId < 2) {
    const deferredCallId = deferredCallRegister(
      Context.callee().toString(),
      'callDeferrer',
      new Slot(currentPeriod + 3, currentThread),
      70_000_000, // previously 70_000_000
      new Args().serialize(),
      0,
    );
    Storage.set(DEFERRED_ID, u64ToBytes(deferredId + 1));
    Storage.set('callId', deferredCallId);
    generateEvent(
      ['DeferredCallId', deferredId.toString(), deferredCallId.toString()].join(
        ' ',
      ),
    );
  } else {
    const id = Storage.get('callId');
    const exists = deferredCallExists(id);
    if (exists) {
      generateEvent('DeferredCallExists');
      deferredCallCancel(id);
    } else {
      generateEvent('DeferredCallDoesNotExist');
    }
    generateEvent('DeferredCallComplete');
  }
}
