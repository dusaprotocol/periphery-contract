import { Args, Result, Serializable } from '@massalabs/as-types';
import { Address } from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly/integer/u256';

// Structure of a limit order
export class LimitOrder implements Serializable {
  /**
   * @param orderType {u8} - 0 = BID, 1 = ASK
   * @param binId {u64} - Id of the bin to use for the swap
   * @param amountIn {u256} - Amount of tokens to swap
   * @param owner {Address} - Address to receive the tokens
   * @param amountLPToken {u256} - Number of LBToken received in return
   * @param executed {bool} - If the order was executed
   */
  constructor(
    public orderType: u8 = 0,
    public binId: u64 = 0,
    public amountIn: u256 = u256.Zero,
    public owner: Address = new Address(''),
    public amountLPToken: u256 = u256.Zero,
    public executed: bool = false,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.orderType)
      .add(this.binId)
      .add(this.amountIn)
      .add(this.owner)
      .add(this.amountLPToken)
      .add(this.executed)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.orderType = args.nextU8().unwrap();
    this.binId = args.nextU64().unwrap();
    this.amountIn = args.nextU256().unwrap();
    this.owner = new Address(args.nextString().unwrap());
    this.amountLPToken = args.nextU256().unwrap();
    this.executed = args.nextBool().unwrap();
    return new Result(args.offset);
  }
}
