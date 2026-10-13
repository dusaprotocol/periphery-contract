import { Args, Result, Serializable } from '@massalabs/as-types';
import { Address, generateEvent } from '@massalabs/massa-as-sdk';
import { StratManager } from './StratManager';
import { createEvent } from '@dusalabs/core/assembly/libraries/Utils';

export const MAX_FEE: u64 = 1000;
export const PERFORMANCE_FEE_CAP: u64 = 200;

export class FeeManager extends StratManager implements Serializable {
  constructor(
    public vault: Address = new Address('0'),
    public feeRecipient: Address = new Address('0'),
    public owner: Address = new Address('0'),
    public performanceFee: u64 = 150,
  ) {
    super(vault, feeRecipient, owner);
  }

  setPerformanceFee(bs: StaticArray<u8>): void {
    this.onlyOwner();
    const _fee = new Args(bs).nextU64().unwrap();
    assert(_fee <= PERFORMANCE_FEE_CAP, '!cap');

    this.performanceFee = _fee;

    //emit
    const event = createEvent('PERFORMANCE_FEE_SET', [
      this.performanceFee.toString(),
    ]);
    generateEvent(event);
  }

  // ======================================================== //
  // ====                  SERIALIZATION                 ==== //
  // ======================================================== //

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.vault)
      .add(this.feeRecipient)
      .add(this.owner)
      .add(this.performanceFee)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.vault = new Address(
      args.nextString().expect('Failed to deserialize vault'),
    );
    this.feeRecipient = new Address(
      args.nextString().expect('Failed to deserialize feeRecipient'),
    );
    this.owner = new Address(
      args.nextString().expect('Failed to deserialize owner'),
    );
    this.performanceFee = args
      .nextU64()
      .expect('Failed to deserialize performanceFee');
    return new Result(args.offset);
  }
}
