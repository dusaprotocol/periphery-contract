import { Args } from '@massalabs/as-types';
import { CallData } from '../structs/Call';
import { call } from '@massalabs/massa-as-sdk';

// The main function is the one called in a ExecuteSC operation.
export function main(bs: StaticArray<u8>): StaticArray<u8> {
  return multicall(bs);
}

export function multicall(bs: StaticArray<u8>): StaticArray<u8> {
  const calls = new Args(bs).nextSerializableObjectArray<CallData>().unwrap();
  const results = new Args();
  for (let i = 0; i < calls.length; i++) {
    const data = calls[i];
    const res = call(data.to, data.method, new Args(data.args), data.coins);
    results.add(res);
  }
  return results.serialize();
}

/**
 * @notice Function used by an SC to receive Massa coins
 * @param _ unused
 */
export function receiveCoins(_: StaticArray<u8>): void {}
