import { Args, byteToBool, bytesToFixedSizeArray } from '@massalabs/as-types';
import { Address, Storage, call } from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly/integer/u256';
import { IERC20 } from '@dusalabs/core';
import { TokenWrapper } from '@massalabs/sc-standards/assembly/contracts/FT';

export class DepositReturn {
  constructor(
    public shares: u256,
    public amountXAdded: u256,
    public amountYAdded: u256,
  ) {}
}

export class IVault extends TokenWrapper {
  constructor(public _origin: Address = new Address()) {
    super(_origin);
  }

  initt(
    approval_delay: u64,
    tokenX: Address,
    tokenY: Address,
    tokenName: string,
    tokenSymbol: string,
    tokenDecimals: u64,
  ): void {
    const args = new Args()
      .add(approval_delay)
      .add(tokenX)
      .add(tokenY)
      .add(tokenName)
      .add(tokenSymbol)
      .add(u8(tokenDecimals));
    call(this._origin, 'constructor', args, 0);
  }

  deposit(to: Address): DepositReturn {
    const args = new Args().add(to);
    const res = bytesToFixedSizeArray<u256>(
      call(this._origin, 'deposit', args, 0),
    );
    return new DepositReturn(res[0], res[1], res[2]);
  }

  withdrawAll(): void {
    call(this._origin, 'withdrawAll', new Args(), 0);
  }

  withdraw(to: Address): u256[] {
    const args = new Args().add(to);
    const res = bytesToFixedSizeArray<u256>(
      call(this._origin, 'withdraw', args, 0),
    );
    return res;
  }

  want(): Address[] {
    const res = new Args(call(this._origin, 'want', new Args(), 0));
    return [
      new Address(res.nextString().unwrap()),
      new Address(res.nextString().unwrap()),
    ];
  }

  getUnderlyingAssets(shares: u256): u256[] {
    const args = new Args().add(shares);
    const res = bytesToFixedSizeArray<u256>(
      call(this._origin, 'getUnderlyingAssets', args, 0),
    );
    return res;
  }

  tokenX(): IERC20 {
    return new IERC20(new Address(Storage.getOf(this._origin, 'TOKEN_X')));
  }

  tokenY(): IERC20 {
    return new IERC20(new Address(Storage.getOf(this._origin, 'TOKEN_Y')));
  }
  /// -----------------------------------------------------------
  /// Owner functions
  /// -----------------------------------------------------------

  start(): void {
    const args = new Args();
    call(this._origin, 'start', args, 0);
  }
  setStrategyAddress(strategy: Address): void {
    const args = new Args().add(strategy);
    call(this._origin, 'setStrategyAddress', args, 0);
  }

  proposeStrat(strategy: Address): void {
    const args = new Args().add(strategy);
    call(this._origin, 'proposeStrat', args, 0);
  }

  upgradeStrat(): void {
    call(this._origin, 'upgradeStrat', new Args(), 0);
  }

  inCaseTokensGetStuck(token: Address): void {
    const args = new Args().add(token);
    call(this._origin, 'inCaseTokensGetStuck', args, 0);
  }

  inCaseLBTokensGetStuck(pair: Address, id: u64): void {
    const args = new Args().add(pair).add(id);
    call(this._origin, 'inCaseLBTokensGetStuck', args, 0);
  }

  isOwner(address: Address): bool {
    const args = new Args().add(address);
    return byteToBool(call(this._origin, 'isOwner', args, 0));
  }
}
