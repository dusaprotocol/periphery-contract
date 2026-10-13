import { Args, bytesToFixedSizeArray } from '@massalabs/as-types';
import { Address, call } from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly/integer/u256';
import { DepositReturn } from './IVault';

export class IRouterVault {
  constructor(public _origin: Address = new Address()) {}

  init(wmas: Address): void {
    const args = new Args().add(wmas);
    call(this._origin, 'constructor', args, 0);
  }

  deposit(
    tokenA: Address,
    tokenB: Address,
    type: u64,
    amountX: u256,
    amountY: u256,
    amountXMin: u256,
    AmountYMin: u256,
  ): DepositReturn {
    const args = new Args()
      .add(tokenA)
      .add(tokenB)
      .add(type)
      .add(amountX)
      .add(amountY)
      .add(amountXMin)
      .add(AmountYMin);
    const res = bytesToFixedSizeArray<u256>(
      call(this._origin, 'deposit', args, 0),
    );
    return new DepositReturn(res[0], res[1], res[2]);
  }

  depositMAS(
    tokenA: Address,
    tokenB: Address,
    type: u64,
    amountX: u64,
    amountY: u256,
    amountXMin: u256,
    AmountYMin: u256,
  ): DepositReturn {
    const args = new Args()
      .add(tokenA)
      .add(tokenB)
      .add(type)
      .add(amountY)
      .add(amountXMin)
      .add(AmountYMin);
    const res = bytesToFixedSizeArray<u256>(
      call(this._origin, 'depositMAS', args, amountX),
    );
    return new DepositReturn(res[0], res[1], res[2]);
  }

  withdrawAll(tokenA: Address, tokenB: Address, type: u64): void {
    const args = new Args().add(tokenA).add(tokenB).add(type);
    call(this._origin, 'withdrawAll', args, 0);
  }

  withdraw(tokenA: Address, tokenB: Address, type: u64, to: Address): u256[] {
    const args = new Args().add(tokenA).add(tokenB).add(type).add(to);
    const res = bytesToFixedSizeArray<u256>(
      call(this._origin, 'withdraw', args, 0),
    );
    return res;
  }

  withdrawAllMAS(token: Address, type: u64): void {
    const args = new Args().add(token).add(type);
    call(this._origin, 'withdrawAllMAS', args, 0);
  }

  withdrawMAS(token: Address, type: u64, to: Address): u256[] {
    const args = new Args().add(token).add(type).add(to);
    const res = bytesToFixedSizeArray<u256>(
      call(this._origin, 'withdrawMAS', args, 0),
    );
    return res;
  }

  addVault(tokenA: Address, tokenB: Address, type: u64, vault: Address): void {
    const args = new Args().add(tokenA).add(tokenB).add(type).add(vault);
    call(this._origin, 'addVault', args, 0);
  }
}
