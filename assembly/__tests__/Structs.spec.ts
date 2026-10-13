import { Args, Result, Serializable } from '@massalabs/as-types';
import { Address } from '@massalabs/massa-as-sdk';
import { DCA, FeeManager, LimitOrder, StrategyParameters } from '../structs';
import { IERC20, IPair } from '@dusalabs/core';
import { u256 } from 'as-bignum/assembly/index';

const randomBool = (): boolean => (Math.random() > 0.5 ? true : false);
const randomString = (): string => Math.random().toString(36).substring(7);
const randomAddress = (): Address => new Address(randomString());
const randomU8 = (): u8 => u8(Math.random() * F32.MAX_SAFE_INTEGER);
const randomU32 = (): u32 => u32(Math.random() * F32.MAX_SAFE_INTEGER);
const randomU64 = (): u64 => u64(Math.random() * F64.MAX_SAFE_INTEGER);
const randomU256 = (): u256 =>
  new u256(randomU64(), randomU64(), randomU64(), randomU64());

describe('DCA', () => {
  test('ser/deser', () => {
    const amountEachDCA = randomU256();
    const interval = randomU64();
    const nbOfDCA = randomU64();
    const tokenIn = randomAddress();
    const tokenOut = randomAddress();
    const startTime = randomU64();
    const endTime = randomU64();
    const period = randomU64();
    const thread = randomU8();

    const struct = new DCA(
      amountEachDCA,
      interval,
      nbOfDCA,
      [tokenIn, tokenOut],
      startTime,
      endTime,
    );
    const ser = struct.serialize();
    const deser = new Args(ser).nextSerializable<DCA>().unwrap();
    expect(deser.amountEachDCA).toBe(amountEachDCA);
    expect(deser.interval).toBe(interval);
    expect(deser.nbOfDCA).toBe(nbOfDCA);
    expect(deser.tokenPath).toStrictEqual([tokenIn, tokenOut]);
    expect(deser.startTime).toBe(startTime);
    expect(deser.endTime).toBe(endTime);
  });
});

describe('LimitOrder', () => {
  test('ser/deser', () => {
    const pair = randomAddress();
    const swapForY = randomBool();
    const binId = randomU32();
    const amountIn = randomU256();
    const amountOutMin = randomU256();
    const to = randomAddress();
    const order = new LimitOrder(
      new IPair(pair),
      swapForY,
      binId,
      amountIn,
      amountOutMin,
      to,
    );
    const ser = order.serialize();
    const deser = new Args(ser).nextSerializable<LimitOrder>().unwrap();
    expect(deser.pair).toStrictEqual(new IPair(pair));
    expect(deser.swapForY).toBe(swapForY);
    expect(deser.binId).toBe(binId);
    expect(deser.amountIn).toBe(amountIn);
    expect(deser.amountOutMin).toBe(amountOutMin);
    expect(deser.to).toStrictEqual(to);
  });
});
