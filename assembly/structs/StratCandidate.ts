import { Args, Result, Serializable } from '@massalabs/as-types';
import { Address } from '@massalabs/massa-as-sdk';

export class StratCandidate implements Serializable {
  constructor(
    public implementation: Address = new Address(''),
    public proposedTime: u64 = 0,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.implementation)
      .add(this.proposedTime)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.implementation = new Address(
      args.nextString().expect('Failed to deserialize implementation'),
    );
    this.proposedTime = args
      .nextU64()
      .expect('Failed to deserialize proposedTime');
    return new Result(args.offset);
  }
}
