import { Args, bytesToU64 } from '@massalabs/as-types';
import { Address, call } from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly/integer/u256';
import { DCA } from '../structs/DCA';
import { DCAS } from '../storage/DCA';
import { createKey } from '@dusalabs/core/assembly/libraries/Utils';

export class IDCA {
  constructor(public _origin: Address) {}

  /**
   * Initialize the contract
   * @param quoter - Address of the quoter contract
   * @param wmas - Address of the wmas contract
   * @param usdc - Address of the usdc contract
   * @param pair_mas_usdc - Address of the mas-usdc main pair contract
   */
  init(
    quoter: Address,
    wmas: Address,
    usdc: Address,
    pair_mas_usdc: Address,
  ): void {
    const args = new Args().add(quoter).add(wmas).add(usdc).add(pair_mas_usdc);
    call(this._origin, 'constructor', args, 0);
  }

  /**
   * Start a DCA
   * @param amountEachDCA {u256} - Amount of tokens to swap each DCA
   * @param interval {u64} - Interval between each DCA in milliseconds
   * @param nbOfDCA {u64} - Number of DCA (if 0, infinite)
   * @param tokenPath {Address[]} - Path of the tokens to swap (ex: [tokenA, tokenB, tokenC] => tokenA -> tokenB -> tokenC)
   * @param threshold {u32} - The slippage tolerance in ‰ (ex: 20 is 2%)
   * @param moreGas {bool} - Boolean representing if the swap needs more gas to be executed, for big amounts
   * @param startIn {u64} - Start the DCA in x milliseconds (default: 0)
   * @param masToSend Massa to send for storage
   * @returns {u64} - Id of the DCA
   */
  startDCA(
    amountEachDCA: u256,
    interval: u64,
    nbOfDCA: u64,
    tokenPath: Address[],
    threshold: u32,
    moreGas: bool,
    startIn: u64 = 0,
    masToSend: u64 = 0,
  ): u64 {
    const args = new Args()
      .add(amountEachDCA)
      .add(interval)
      .add(nbOfDCA)
      .addSerializableObjectArray(tokenPath)
      .add(threshold)
      .add(moreGas)
      .add(startIn);
    const res = call(this._origin, 'startDCA', args, masToSend);
    return bytesToU64(res);
  }

  /**
   * Stop a DCA
   * @param dcaId {u64} - Id of the DCA
   */
  stopDCA(dcaId: u64): void {
    call(this._origin, 'stopDCA', new Args().add(dcaId), 0);
  }

  /**
   * Update a DCA
   * @param dcaId {u64} - Id of the DCA
   * @param amountEachDCA {u256} - Amount of tokens to swap each DCA
   * @param interval {u64} - Interval between each DCA in milliseconds
   * @param nbOfDCA {u64} - Number of DCA (if 0, infinite)
   * @param tokenPath {Address[]} - Path of the tokens to swap (ex: [tokenA, tokenB, tokenC] => tokenA -> tokenB -> tokenC)
   * @param threshold {u32} - The slippage tolerance in ‰ (ex: 20 is 2%)
   * @param moreGas {bool} - Boolean representing if the swap needs more gas to be executed, for big amounts
   * @param masToSend Massa to send for storage
   */
  updateDCA(
    dcaId: u64,
    amountEachDCA: u256,
    interval: u64,
    nbOfDCA: u64,
    tokenPath: Address[],
    threshold: u32,
    moreGas: bool,
    masToSend: u64 = 0,
  ): void {
    const args = new Args()
      .add(dcaId)
      .add(amountEachDCA)
      .add(interval)
      .add(nbOfDCA)
      .addSerializableObjectArray(tokenPath)
      .add(threshold)
      .add(moreGas);
    call(this._origin, 'updateDCA', args, masToSend);
  }

  /**
   * Collect the fee of a DCA
   * @param tokenAddresses {Address[]} - Addresses of the tokens to collect the fee
   */
  collectFee(tokenPath: Address[]): void {
    const args = new Args().addSerializableObjectArray(tokenPath);
    call(this._origin, 'collectFee', args, 0);
  }

  getDCA(dcaId: u64, owner: Address): DCA {
    const dcaKey = createKey([owner.toString(), dcaId.toString()]);
    return DCAS.getOf(this._origin, dcaKey, new DCA());
  }
}
