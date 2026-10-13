import { Args, Result, Serializable } from '@massalabs/as-types';
import { Address } from '@massalabs/massa-as-sdk';

export class CallData implements Serializable {
  constructor(
    public method: string = '',
    public args: StaticArray<u8> = [],
    public to: Address = new Address(''),
    public coins: u64 = 0,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.method)
      .add(this.args)
      .add(this.to)
      .add(this.coins)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.method = args.nextString().expect('Failed to deserialize method');
    this.args = args.nextBytes().expect('Failed to deserialize args');
    this.to = new Address(args.nextString().expect('Failed to deserialize to'));
    this.coins = args.nextU64().expect('Failed to deserialize coins');
    return new Result(args.offset);
  }
}
