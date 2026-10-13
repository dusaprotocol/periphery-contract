import { Args, Result, Serializable } from '@massalabs/as-types';
import { u256 } from 'as-bignum/assembly/integer/u256';
import { Address } from '@massalabs/massa-as-sdk';

// Structure of a DCA
export class DCA implements Serializable {
  /**
   * @param amountEachDCA {u256} - Amount of tokens to swap each DCA
   * @param interval {u64} - Interval between each DCA in milliseconds
   * @param nbOfDCA {u64} - Number of DCA (if 0, infinite)
   * @param tokenPath {Address[]} - Path of the tokens to swap (ex: [tokenA, tokenB, tokenC] => tokenA -> tokenB -> tokenC)
   * @param threshold {u32} - The slippage tolerance in ‰ (ex: 20 is 2%)
   * @param moreGas {bool} - Boolean representing if the swap needs more gas to be executed, for big amounts
   * @param startTime {u64} - Start the DCA in x milliseconds (default: 0)
   * @param executedCount {u64} - Number of DCA already executed
   * @param deferredCallId {string} - ID of the deferred call associated with the DCA
   */
  constructor(
    public amountEachDCA: u256 = u256.Zero,
    public interval: u64 = 0,
    public nbOfDCA: u64 = 0,
    public tokenPath: Array<Address> = [new Address()],
    public threshold: u32 = 0,
    public moreGas: bool = false,
    public startTime: u64 = 0,
    public executedCount: u64 = 0,
    public deferredCallId: string = '',
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.amountEachDCA)
      .add(this.interval)
      .add(this.nbOfDCA)
      .addSerializableObjectArray(this.tokenPath)
      .add(this.threshold)
      .add(this.moreGas)
      .add(this.startTime)
      .add(this.executedCount)
      .add(this.deferredCallId)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.amountEachDCA = args.nextU256().unwrap();
    this.interval = args.nextU64().unwrap();
    this.nbOfDCA = args.nextU64().unwrap();
    this.tokenPath = args.nextSerializableObjectArray<Address>().unwrap();
    this.threshold = args.nextU32().unwrap();
    this.moreGas = args.nextBool().unwrap();
    this.startTime = args.nextU64().unwrap();
    this.executedCount = args.nextU64().unwrap();
    this.deferredCallId = args.nextString().unwrap();
    return new Result(args.offset);
  }
}
