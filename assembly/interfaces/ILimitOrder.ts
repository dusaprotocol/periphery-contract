import { Args, bytesToU256, bytesToU32 } from '@massalabs/as-types';
import { Address, call } from '@massalabs/massa-as-sdk';
import { LimitOrder } from '../structs';
import { IUpgradeable } from './IUpgradeable';
import { Amounts, IPair, SafeMath } from '@dusalabs/core';
import { BIN, ORDERS, PAIR, USER } from '../storage/LimitOrder';
import { u256 } from 'as-bignum/assembly/integer/u256';

export class ILimitOrder extends IUpgradeable {
  constructor(public _origin: Address) {
    super(_origin);
  }

  /**
   * Initialize the contract
   * @param pair  Address of the pair linked to the limit order
   * @param wmas Address of the wmas token
   * @param masToSend Massa to send for storage
   */
  init(pair: IPair, wmas: Address, masToSend: u64 = 0): void {
    call(
      this._origin,
      'constructor',
      new Args().add(pair._origin).add(wmas),
      masToSend,
    );
  }

  /**
   * Add a limit order
   * @param orderType {u8} - 0 = BID, 1 = ASK
   * @param binId {u64} - Id of the bin to use for the swap
   * @param amount {u256} - Amount of tokens to swap
   * @param masToSend Massa to send for storage
   * @returns {u64} - Id of the order
   */
  addLimitOrder(
    orderType: u8,
    binId: u64,
    amount: u256,
    masToSend: u64 = 0,
  ): u32 {
    const res = call(
      this._origin,
      'addLimitOrder',
      new Args().add(orderType).add(binId).add(amount),
      masToSend,
    );
    return bytesToU32(res);
  }

  /**
   * Add a limit order in tokenIn = MAS
   * @param orderType {u8} - 0 = BID, 1 = ASK
   * @param binId {u64} - Id of the bin to use for the swap
   * @param amount {u256} - Amount of tokens to swap
   * @param masToSend Massa to send for storage
   * @returns {u64} - Id of the order
   */
  addLimitOrderMas(
    orderType: u8,
    binId: u64,
    amount: u256,
    masToSend: u64 = 0,
  ): u32 {
    const res = call(
      this._origin,
      'addLimitOrderMas',
      new Args().add(orderType).add(binId).add(masToSend),
      SafeMath.add(masToSend, amount.toU64()),
    );
    return bytesToU32(res);
  }

  /**
   * Edit an existing limit order
   * @param orderId {u32} - Id of the order
   * @param amount {u256} - Amount of tokens to swap
   * @param masToSend Massa to send for storage
   */
  editLimitOrder(orderId: u32, amount: u256, masToSend: u64 = 0): void {
    call(
      this._origin,
      'editLimitOrder',
      new Args().add(orderId).add(amount),
      masToSend,
    );
  }

  /**
   * Edit an existing limit order in tokenIn = MAS
   * @param orderId {u32} - Id of the order
   * @param amount {u256} - Amount of tokens to swap
   * @param masToSend Massa to send for storage
   */
  editLimitOrderMas(orderId: u32, amount: u256, masToSend: u64 = 0): void {
    call(
      this._origin,
      'editLimitOrderMas',
      new Args().add(orderId).add(masToSend),
      SafeMath.add(masToSend, amount.toU64()),
    );
  }

  /**
   * Remove a limit order
   * @param orderId {u32} - Id of the order
   * @param masToSend Massa to send for storage
   * @returns {Amounts} - The amount of token X and token Y that the user will receive.
   */
  cancelOrder(orderId: u32, masToSend: u64 = 0): Amounts {
    const res = new Args(
      call(this._origin, 'cancelOrder', new Args().add(orderId), masToSend),
    );
    return new Amounts(res.nextU256().unwrap(), res.nextU256().unwrap());
  }

  /**
   * Remove a limit order in tokenIn = MAS
   * @param orderId {u32} - Id of the order
   * @param masToSend Massa to send for storage
   * @returns {Amounts} - The amount of token X and token Y that the user will receive.
   */
  cancelOrderMas(orderId: u32, masToSend: u64 = 0): Amounts {
    const res = new Args(
      call(this._origin, 'cancelOrderMas', new Args().add(orderId), masToSend),
    );
    return new Amounts(res.nextU256().unwrap(), res.nextU256().unwrap());
  }

  /**
   * Claim an executed limit order
   * @param orderId {u32} - Id of the order
   * @param masToSend Massa to send for storage
   * @returns {u256} - The amount of token that the user will receive.
   */
  claimOrder(orderId: u32, masToSend: u64 = 0): u256 {
    return bytesToU256(
      call(this._origin, 'claimOrder', new Args().add(orderId), masToSend),
    );
  }

  /**
   * Claim an executed limit order in tokenOut = MAS
   * @param orderId {u32} - Id of the order
   * @param masToSend Massa to send for storage
   * @returns {u256} - The amount of token that the user will receive.
   */
  claimOrderMas(orderId: u32, masToSend: u64 = 0): u256 {
    return bytesToU256(
      call(this._origin, 'claimOrderMas', new Args().add(orderId), masToSend),
    );
  }

  /**
   * Checks if the contract is correctly linked to the Pair.
   */
  isLinked(): bool {
    const hooksParameters = this.getPair().getHooksParameters();
    return hooksParameters.hooks.equals(Context.callee());
  }

  /**
   * Returns the Pair contract.
   */
  getPair(): IPair {
    return new IPair(new Address(Storage.getOf(this._origin, PAIR)));
  }

  /**
   * Returns the order corresponding to the Id.
   * Returns an empty order if it doesn't exist.
   */
  getLimitOrder(id: u32): LimitOrder {
    return ORDERS.getOf(this._origin, id, new LimitOrder());
  }

  /**
   * Returns the orderIds of a user.
   */
  getUserOrderIds(user: Address): u32[] {
    const res = USER.getOf(this._origin, user.toString(), []);
    if (res.length == 0) return [];
    return new Args(res).nextFixedSizeArray<u32>().unwrap();
  }

  /**
   * Returns the active order in a bin.
   */
  getBinOrderIds(binId: u64): u32[] {
    const res = BIN.getOf(this._origin, binId.toString(), []);
    if (res.length == 0) return [];
    return new Args(res).nextFixedSizeArray<u32>().unwrap();
  }
}
