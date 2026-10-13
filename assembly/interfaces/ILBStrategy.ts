import {
  Args,
  bytesToFixedSizeArray,
  bytesToNativeTypeArray,
  bytesToU64,
} from '@massalabs/as-types';
import { Address, Storage, call } from '@massalabs/massa-as-sdk';
import { IERC20, IPair } from '@dusalabs/core';
import { Amounts } from '@dusalabs/core/assembly/structs/Returns';
import { StrategyParameters } from '../structs';
import { ACTIVE_BINS } from '../storage/LBStrategy';
import { u256 } from 'as-bignum/assembly/integer/u256';

//TODO : add return struct

export class ILBStrategy {
  _origin: Address;

  /**
   * Wraps a smart contract exposing standard token FFI.
   *
   * @param {Address} at - Address of the smart contract.
   */
  constructor(at: Address) {
    this._origin = at;
  }

  init(
    _dusaRouter: Address,
    _vault: Address,
    _feeRecipient: Address,
    _strategyParams: StrategyParameters,
    binOffset: u64,
    centerOffset: u64,
  ): void {
    const args = new Args()
      .add(_dusaRouter)
      .add(_vault)
      .add(_feeRecipient)
      .add(_strategyParams)
      .add(binOffset)
      .add(centerOffset);
    call(this._origin, 'constructor', args, 0);
  }

  strategyPositionAtIndex(index: u64): u64 {
    const args = new Args().add(index);
    return bytesToU64(call(this._origin, 'strategyPositionAtIndex', args, 0));
  }

  strategyPositionNumber(): u64 {
    return bytesToU64(
      call(this._origin, 'strategyPositionNumber', new Args(), 0),
    );
  }

  checkProposedBinLength(proposedDeltas: i64[], activeId: u64): u64 {
    const args = new Args().add(proposedDeltas).add(activeId);
    return bytesToU64(call(this._origin, 'checkProposedBinLength', args, 0));
  }

  earn(): Amounts {
    const res = new Args(call(this._origin, 'earn', new Args(), 0));
    return new Amounts(res.nextU256().unwrap(), res.nextU256().unwrap());
  }

  removeLiquidity(denominator: u256): Amounts {
    const res = new Args(
      call(this._origin, 'removeLiquidity', new Args().add(denominator), 0),
    );
    return new Amounts(res.nextU256().unwrap(), res.nextU256().unwrap());
  }

  harvest(): Amounts {
    const res = new Args(call(this._origin, 'harvest', new Args(), 0));
    return new Amounts(res.nextU256().unwrap(), res.nextU256().unwrap());
  }

  getActiveBinIds(): u64[] {
    const res = new Args(call(this._origin, 'getActiveBinIds', new Args(), 0));
    return res.nextFixedSizeArray<u64>().unwrap();
  }

  getTotalAmounts(): Amounts {
    const res = new Args(call(this._origin, 'getTotalAmounts', new Args(), 0));
    return new Amounts(res.nextU256().unwrap(), res.nextU256().unwrap());
  }

  binHasXLiquidity(_deltaIds: i64[]): bool {
    const args = new Args().add(_deltaIds);
    return call(this._origin, 'binHasXLiquidity', args, 0)[0] == 1;
  }

  binHasYLiquidity(_deltaIds: i64[]): bool {
    const args = new Args().add(_deltaIds);
    return call(this._origin, 'binHasYLiquidity', args, 0)[0] == 1;
  }

  rewardsAvailable(_increasingBinIds: u64[]): Amounts {
    const args = new Args().add(_increasingBinIds);
    const res = new Args(call(this._origin, 'rewardsAvailable', args, 0));
    return new Amounts(res.nextU256().unwrap(), res.nextU256().unwrap());
  }

  getBalanceX(): u256 {
    return this.tokenX().balanceOf(this._origin);
  }

  getBalanceY(): u256 {
    return this.tokenY().balanceOf(this._origin);
  }

  retireStrat(): void {
    call(this._origin, 'retireStrat', new Args(), 0);
  }

  panic(): void {
    call(this._origin, 'panic', new Args(), 0);
  }

  executeRebalance(
    _deltaIds: i64[],
    _distributionX: u256[],
    _distributionY: u256[],
    _idSlippage: u64,
  ): Amounts {
    const args = new Args()
      .add(_deltaIds)
      .add(_distributionX)
      .add(_distributionY)
      .add(_idSlippage);
    const res = new Args(call(this._origin, 'executeRebalance', args, 0));
    return new Amounts(res.nextU256().unwrap(), res.nextU256().unwrap());
  }

  tokenX(): IERC20 {
    return new IERC20(new Address(Storage.getOf(this._origin, 'TOKEN_X')));
  }

  tokenY(): IERC20 {
    return new IERC20(new Address(Storage.getOf(this._origin, 'TOKEN_Y')));
  }

  pair(): IPair {
    return new IPair(new Address(Storage.getOf(this._origin, 'PAIR')));
  }

  vault(): Address {
    return new Address(Storage.getOf(this._origin, 'VAULT'));
  }

  strategyActiveBins(): u64[] {
    return bytesToNativeTypeArray<u64>(
      Storage.getOf(this._origin, ACTIVE_BINS),
    );
  }

  stop(): void {
    call(this._origin, 'stop', new Args(), 0);
  }

  start(): void {
    call(this._origin, 'start', new Args(), 0);
  }

  setOwner(_owner: Address): void {
    const args = new Args().add(_owner);
    call(this._origin, 'setOwner', args, 0);
  }

  setDusaRouter(_dusaRouter: Address): void {
    const args = new Args().add(_dusaRouter);
    call(this._origin, 'setDusaRouter', args, 0);
  }

  setFeeRecipient(_feeRecipient: Address): void {
    const args = new Args().add(_feeRecipient);
    call(this._origin, 'setFeeRecipient', args, 0);
  }

  setPerformanceFee(_performanceFee: u64): void {
    const args = new Args().add(_performanceFee);
    call(this._origin, 'setPerformanceFee', args, 0);
  }
}
