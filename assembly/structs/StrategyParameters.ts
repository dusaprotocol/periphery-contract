import { Args, Result, Serializable } from '@massalabs/as-types';
import { Address } from '@massalabs/massa-as-sdk';
import { IERC20 } from '@dusalabs/core';
import { u256 } from 'as-bignum/assembly/integer/u256';

export class StrategyParameters implements Serializable {
  constructor(
    public tokenX: IERC20 = new IERC20(new Address('0')),
    public tokenY: IERC20 = new IERC20(new Address('0')),
    public pair: Address = new Address('0'),
    public binStep: u32 = 0,
    public deltaIds: i64[] = [],
    public distributionX: u256[] = [],
    public distributionY: u256[] = [],
    public idSlippage: u64 = 0,
  ) {}

  // ======================================================== //
  // ====                  SERIALIZATION                 ==== //
  // ======================================================== //

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.tokenX._origin)
      .add(this.tokenY._origin)
      .add(this.pair)
      .add(this.binStep)
      .add(this.deltaIds)
      .add(this.distributionX)
      .add(this.distributionY)
      .add(this.idSlippage)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.tokenX = new IERC20(
      new Address(args.nextString().expect('Failed to deserialize tokenX')),
    );
    this.tokenY = new IERC20(
      new Address(args.nextString().expect('Failed to deserialize tokenY')),
    );
    this.pair = new Address(
      args.nextString().expect('Failed to deserialize pair'),
    );
    this.binStep = args.nextU32().expect('Failed to deserialize binStep');
    this.deltaIds = args
      .nextFixedSizeArray<i64>()
      .expect('Failed to deserialize deltaIds');
    this.distributionX = args
      .nextFixedSizeArray<u256>()
      .expect('Failed to deserialize distributionX');
    this.distributionY = args
      .nextFixedSizeArray<u256>()
      .expect('Failed to deserialize distributionY');
    this.idSlippage = args.nextU64().expect('Failed to deserialize idSlippage');
    return new Result(args.offset);
  }
}
