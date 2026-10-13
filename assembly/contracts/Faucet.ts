import { Args } from '@massalabs/as-types';
import {
  Address,
  Context,
  Storage,
  callerHasWriteAccess,
} from '@massalabs/massa-as-sdk';
import { IERC20, PersistentMap } from '@dusalabs/core';
import { u256 } from 'as-bignum/assembly/integer';
import { setOwner } from '@massalabs/sc-standards/assembly/contracts/utils/ownership';

const USDC = 'usdc';
const USDT = 'usdt';
const WBTC = 'wbtc';
const WETH = 'weth';
const LAST_CLAIM = new PersistentMap<string, u64>('last_claim');

export function constructor(bs: StaticArray<u8>): void {
  assert(callerHasWriteAccess(), 'constructor can only be called once');

  const args = new Args(bs);
  Storage.set(USDC, args.nextString().unwrap());
  Storage.set(USDT, args.nextString().unwrap());
  Storage.set(WBTC, args.nextString().unwrap());
  Storage.set(WETH, args.nextString().unwrap());

  setOwner(new Args().add(Context.caller()).serialize());
}

export function claim(_: StaticArray<u8>): void {
  const caller = Context.caller();
  const now = Context.timestamp();
  const lastClaim = LAST_CLAIM.get(caller.toString(), 0);

  if (now - lastClaim < 86400000) {
    assert(false, 'You can only claim once per day');
  }

  const usdc = new IERC20(new Address(Storage.get(USDC)));
  const usdt = new IERC20(new Address(Storage.get(USDT)));
  const wbtc = new IERC20(new Address(Storage.get(WBTC)));
  const weth = new IERC20(new Address(Storage.get(WETH)));
  usdc.transfer(caller, u256.from(u64(2_500 * 10 ** usdc.decimals())));
  usdt.transfer(caller, u256.from(u64(2_500 * 10 ** usdt.decimals())));
  wbtc.transfer(caller, u256.from(u64(10 ** (wbtc.decimals() - 1))));
  weth.transfer(caller, u256.from(u64(2 * 10 ** weth.decimals())));

  LAST_CLAIM.set(caller.toString(), now);
}
