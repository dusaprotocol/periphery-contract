import {
  IPair,
  SafeMath256,
  PRECISION,
  Amounts,
  createEvent,
  EVENT_DELIMITER,
  BinHelper,
  u256ToString,
  IERC20,
  ReentrancyGuardUpgradeable,
  Math512Bits,
  SCALE_OFFSET,
  transferRemaining,
  IWMAS,
  SafeMath,
} from '@dusalabs/core';
import { Args, bytesToU32, u256ToBytes, u32ToBytes } from '@massalabs/as-types';
import {
  Storage,
  Context,
  Address,
  callerHasWriteAccess,
  balance,
  generateEvent,
  transferCoins,
  transferredCoins,
} from '@massalabs/massa-as-sdk/assembly/index';
import { u256 } from 'as-bignum/assembly/integer/u256';
import {
  ORDERS,
  ORDER_ID,
  USER,
  BIN,
  PAIR,
  PREVIOUS_BIN,
  WMAS,
} from '../storage/LimitOrder';
import { LimitOrder } from '../structs';
import {
  _setOwner,
  _onlyOwner,
} from '@massalabs/sc-standards/assembly/contracts/utils/ownership-internal';

export * from '@massalabs/sc-standards/assembly/contracts/utils/ownership';

/**
 * Limit Order Hooks
 * This contracts allows users to place limit orders using the Liquidity Book protocol.
 * It allows to create orders for any Liquidity Book pair V1.1.
 *
 * The flow of the Limit Order Manager is the following:
 * - Users create orders for a specific pair, type (bid or ask), price (bin id) and amount
 *  (in token Y for bid orders and token X for ask orders) which will be added to the liquidity book pair.
 * - Users can cancel orders, which will remove the liquidity from the liquidity book pair according to the order amount
 * and send the token amounts back to the user (the amounts depend on the bin composition).
 * - Order will be executed by an hooks which will remove the liquidity from the order and send the token to the owner
 *
 * Users can place orders using the `placeOrder` function by specifying the following parameters:
 * - `orderType`: the order type (0: bid or 1: ask)
 * - `binId`: the bin id of the order, which is the price of the order
 * - `amount`: the amount of token to be used for the order, in token Y for bid orders and token X for ask orders
 * Orders can't be placed in the active bin id. Bid orders need to be placed in a bin id lower than the active id,
 * while ask orders need to be placed in a bin id greater than the active bin id.
 *
 * Users can cancel orders using the `cancelOrder` function by specifying the OrderId.
 * If the order is already executed, it can't be cancelled, and user will need to claim the filled amount.
 * If the user is trying to cancel an order that is inside the active bin id, he may receive a partially filled order,
 * according to the active bin composition.
 *
 */
// ======================================================== //
// ====                  CONSTRUCTOR                   ==== //
// ======================================================== //

/**
 * Initializes the sc.
 * @param _pair (Address) Address of the pair linked to the limit order
 * @param _wmas (Address) Address of the wmas token
 */
export function constructor(bs: StaticArray<u8>): void {
  assert(callerHasWriteAccess(), 'constructor can only be called once');

  const args = new Args(bs);
  const _pair = new Address(args.nextString().expect('_pair is missing'));
  const _wmas = args.nextString().expect('_wmas is missing');

  Storage.set(PAIR, _pair.toString());
  Storage.set(
    PREVIOUS_BIN,
    u32ToBytes(new IPair(_pair).getPairInformation().activeId),
  );
  Storage.set(WMAS, _wmas);
  Storage.set(ORDER_ID, u32ToBytes(0));
  _setOwner(Context.caller().toString());
  ReentrancyGuardUpgradeable.__ReentrancyGuard_init();
}

// ======================================================== //
// ====               EXPORTED FUNCTION                ==== //
// ======================================================== //

/**
 * Function called by the pair at the end of each swap
 * @param sender (Address) Caller of the swap
 * @param to (Address) Swap recipient
 * @param swapForY (bool) if the swap is for tokenX or tokenY
 */
export function afterSwap(bs: StaticArray<u8>): void {
  ReentrancyGuardUpgradeable.nonReentrant();
  const args = new Args(bs);
  const sender = args.nextString().expect('sender is missing'); //unused
  const to = args.nextString().expect('to is missing'); //unused
  const swapForY = args.nextBool().expect('swapForY is missing');
  const pair = _getPair();

  _checkTrustedCaller(pair._origin);
  _afterSwap(swapForY, pair);
  ReentrancyGuardUpgradeable.endNonReentrant();
}

/**
 * Place an order.
 * @param orderType (u8) 0 for bid or 1 for ask
 * @param binId (u64) bin id of the order, corresponding to the price of the order
 * @param amount (u256) amount of tokenIn
 * @return orderId (u32)
 *
 * The function checks order validity, deposits liquidity and updates the user's order.
 * Caller must increase the allowance for the contract to spend the amount of token.
 *
 * Orders can't be placed in the active bin id. Bid orders need to be placed in a bin id lower than the active id,
 * while ask orders need to be placed in a bin id greater than the active bin id.
 */
export function addLimitOrder(bs: StaticArray<u8>): StaticArray<u8> {
  ReentrancyGuardUpgradeable.nonReentrant();
  const args = new Args(bs);
  const orderType = args.nextU8().expect('orderType missing'); // 0 = BID, 1 = ASK
  const binId = args.nextU64().expect('binId missing');
  const amount = args.nextU256().expect('amount missing');
  const user = Context.caller();
  const pair = _getPair();

  // for Massa's Storage
  const SCBalance = balance();
  const sent = transferredCoins();

  if (orderType == 0)
    pair.getTokenY().transferFrom(Context.caller(), pair._origin, amount);
  else pair.getTokenX().transferFrom(Context.caller(), pair._origin, amount);

  const orderId = _addLimitOrder(orderType, binId, amount, user, pair);

  transferRemaining(SCBalance, balance(), sent, Context.caller());

  ReentrancyGuardUpgradeable.endNonReentrant();

  return new Args().add(orderId).serialize();
}

/**
 * Place an order.
 * @param orderType (u8) 0 for bid or 1 for ask
 * @param binId (u64) bin id of the order, corresponding to the price of the order
 * @param masToSend (u64) The amount of MAS to send for storage fees
 * @return orderId (u32)
 *
 * Caller must sent in the call the amount to be added + masToSend
 *
 * The function checks order validity, wrap MAS into WMAS, deposits liquidity and updates the user's order.
 * Caller must increase the allowance for the contract to spend the amount of token.
 *
 * Orders can't be placed in the active bin id. Bid orders need to be placed in a bin id lower than the active id,
 * while ask orders need to be placed in a bin id greater than the active bin id.
 */
export function addLimitOrderMas(bs: StaticArray<u8>): StaticArray<u8> {
  ReentrancyGuardUpgradeable.nonReentrant();
  const args = new Args(bs);
  const orderType = args.nextU8().expect('orderType missing'); // 0 = BID, 1 = ASK
  const binId = args.nextU64().expect('binId missing');
  const masToSend = args.nextU64().expect('masToSend is missing');
  const user = Context.caller();
  const pair = _getPair();

  // for Massa's Storage
  const SCBalance = balance();
  const sent = transferredCoins();

  // substract the amount of MAS used for storage fees
  const value = SafeMath.sub(sent, masToSend);

  const wmas = _getWMAS();
  assert(_isTokenInMas(wmas, pair, orderType), 'Token in is not MAS');
  const _amount = SafeMath.add(
    value,
    wmas.computeMintStorageCost(Context.callee()),
  );
  wmas.deposit(_amount);
  wmas.transfer(pair._origin, u256.from(value));

  const orderId = _addLimitOrder(
    orderType,
    binId,
    u256.from(value),
    user,
    pair,
  );

  transferRemaining(SCBalance, balance(), sent, Context.caller());

  ReentrancyGuardUpgradeable.endNonReentrant();

  return new Args().add(orderId).serialize();
}

/**
 * Place an order.
 * @param orderType (u8) 0 for bid or 1 for ask
 * @param binId (u64) bin id of the order, corresponding to the price of the order
 * @param amount (u256) amount of tokenIn
 * @param user (Address) Address of the user
 * @param pair (IPair) Address of the pair
 * @return orderId (u32)
 */
function _addLimitOrder(
  orderType: u8,
  binId: u64,
  amount: u256,
  user: Address,
  pair: IPair,
): u32 {
  // Check that order is valid.
  assert(_isOrderValid(pair, orderType, binId), 'Order not valid');
  assert(amount > u256.Zero, 'Limit_Order: Amount_must_be_positive');
  assert(orderType == 0 || orderType == 1, 'Limit_Order: Invalid_order_type');

  const orderId = _incrementOrderId();
  const bin = _getBinOrders(binId);
  const userOrder = _getUserOrders(user);

  const liquidity = _depositToPair(binId, orderType, pair);

  const order = new LimitOrder(
    orderType,
    binId,
    amount,
    user,
    liquidity,
    false,
  );
  bin.push(orderId);
  userOrder.push(orderId);

  ORDERS.set(orderId, order);
  USER.set(user.toString(), new Args().add(userOrder).serialize());
  BIN.set(order.binId, new Args().add(bin).serialize());

  generateEvent(createEvent('NEW_LIMIT_ORDER', [orderId.toString()]));

  return orderId;
}

/**
 * Increase the amount of an existing order
 * @param orderId (u32) OrderId to edit - must be the owner of the order calling
 * @param amount (u256) the amount of tokenIn to add to the previous order
 *
 * Caller must increase the allowance for the contract to spend the amount of token.
 */
export function editLimitOrder(bs: StaticArray<u8>): void {
  ReentrancyGuardUpgradeable.nonReentrant();
  const args = new Args(bs);
  const orderId = args.nextU32().expect('orderId missing');
  const amount = args.nextU256().expect('amount missing');
  const user = Context.caller();
  const pair = _getPair();

  // for Massa's Storage
  const SCBalance = balance();
  const sent = transferredCoins();

  const order = ORDERS.getSome(orderId, 'WRONG_ID');

  // Check that order is valid, ex bin isn't active
  assert(order.owner.equals(user), 'Not the order owner');
  assert(_isOrderValid(pair, order.orderType, order.binId), 'Order not valid');
  assert(!order.executed, 'Order already executed');
  assert(amount > u256.Zero, 'Limit_Order: Amount_must_be_positive');

  if (order.orderType == 0)
    pair.getTokenY().transferFrom(Context.caller(), pair._origin, amount);
  else pair.getTokenX().transferFrom(Context.caller(), pair._origin, amount);

  const liquidity = _depositToPair(order.binId, order.orderType, pair);

  order.amountIn = SafeMath256.add(order.amountIn, amount);
  order.amountLPToken = SafeMath256.add(order.amountLPToken, liquidity);

  ORDERS.set(orderId, order);

  generateEvent(createEvent('EDIT_LIMIT_ORDER', [orderId.toString()]));

  transferRemaining(SCBalance, balance(), sent, Context.caller());

  ReentrancyGuardUpgradeable.endNonReentrant();
}

/**
 * Increase the amount of an existing order in Mas
 * @param orderId (u32) OrderId to edit - must be the owner of the order calling
 * @param masToSend (u64) The amount of MAS to send for storage fees
 *
 * Caller must sent in the call the amount to be added + masToSend
 * Caller must increase the allowance for the contract to spend the amount of token.
 */
export function editLimitOrderMas(bs: StaticArray<u8>): void {
  ReentrancyGuardUpgradeable.nonReentrant();
  const args = new Args(bs);
  const orderId = args.nextU32().expect('orderId missing');
  const masToSend = args.nextU64().expect('masToSend is missing');
  const user = Context.caller();
  const pair = _getPair();

  // for Massa's Storage
  const SCBalance = balance();
  const sent = transferredCoins();

  // substract the amount of MAS used for storage fees
  const value = SafeMath.sub(sent, masToSend);
  const wmas = _getWMAS();
  const order = ORDERS.getSome(orderId, 'WRONG_ID');
  assert(_isTokenInMas(wmas, pair, order.orderType), 'Token in is not MAS');

  const _amount = SafeMath.add(
    value,
    wmas.computeMintStorageCost(Context.callee()),
  );
  wmas.deposit(_amount);
  wmas.transfer(pair._origin, u256.from(value));

  // Check that order is valid, ex bin isn't active
  assert(order.owner.equals(user), 'Not the order owner');
  assert(_isOrderValid(pair, order.orderType, order.binId), 'Order not valid');
  assert(!order.executed, 'Order already executed');
  assert(u256.from(value) > u256.Zero, 'Limit_Order: Amount_must_be_positive');

  const liquidity = _depositToPair(order.binId, order.orderType, pair);

  order.amountIn = SafeMath256.add(order.amountIn, u256.from(value));
  order.amountLPToken = SafeMath256.add(order.amountLPToken, liquidity);

  ORDERS.set(orderId, order);

  generateEvent(createEvent('EDIT_LIMIT_ORDER', [orderId.toString()]));

  transferRemaining(SCBalance, balance(), sent, Context.caller());

  ReentrancyGuardUpgradeable.endNonReentrant();
}

/**
 * Cancel an order.
 * @param orderId (u32) OrderId to cancel - must be the owner of the order calling
 * @returns amounts received by the user
 *
 * This function withdraws the liquidity and recover the tokens.
 *
 * If the order is already executed, it can't be cancelled, and user will need to claim the filled amount.
 * If the user is trying to cancel an order that is inside the active bin id, he may receive a partially filled order,
 * according to the active bin composition.
 */
export function cancelOrder(bs: StaticArray<u8>): StaticArray<u8> {
  ReentrancyGuardUpgradeable.nonReentrant();

  const orderId = new Args(bs).nextU32().unwrap();
  const user = Context.caller();
  const order = ORDERS.getSome(orderId, 'Limit_Order: Wrong_Order_Id');
  const pair = _getPair();

  // for Massa's Storage
  const SCBalance = balance();
  const sent = transferredCoins();

  assert(!order.executed, 'Limit_Order: Already_Executed');
  assert(order.owner.equals(user), 'Limit_Order: Not_order_owner');

  const amounts = _cancelOrder(order, user, orderId, pair);

  // Transfer both token in case order was in the active Id
  if (amounts.amountX > u256.Zero)
    pair.getTokenX().transfer(user, amounts.amountX);
  if (amounts.amountY > u256.Zero)
    pair.getTokenY().transfer(user, amounts.amountY);

  transferRemaining(SCBalance, balance(), sent, Context.caller());

  generateEvent(createEvent('LIMIT_ORDER_CANCELED', [orderId.toString()]));

  ReentrancyGuardUpgradeable.endNonReentrant();

  return new Args().add(amounts.amountX).add(amounts.amountY).serialize();
}

/**
 * Cancel an order.
 * @param orderId (u32) OrderId to cancel - must be the owner of the order calling
 * @returns amounts received by the user
 *
 * This function withdraws the liquidity and recover the tokens. It sent back the token as MAS.
 *
 * If the order is already executed, it can't be cancelled, and user will need to claim the filled amount.
 * If the user is trying to cancel an order that is inside the active bin id, he may receive a partially filled order,
 * according to the active bin composition.
 */
export function cancelOrderMas(bs: StaticArray<u8>): StaticArray<u8> {
  ReentrancyGuardUpgradeable.nonReentrant();

  const orderId = new Args(bs).nextU32().unwrap();
  const user = Context.caller();
  const order = ORDERS.getSome(orderId, 'Limit_Order: Wrong_Order_Id');
  const pair = _getPair();

  // for Massa's Storage
  const SCBalance = balance();
  const sent = transferredCoins();

  const wmas = _getWMAS();
  const isMASTokenY = wmas._origin.equals(pair.getTokenY()._origin);
  const isOrderInMas =
    order.orderType == 0
      ? isMASTokenY
      : wmas._origin.equals(pair.getTokenX()._origin);
  assert(isOrderInMas, 'Token in is not MAS');

  assert(!order.executed, 'Limit_Order: Already_Executed');
  assert(order.owner.equals(user), 'Limit_Order: Not_order_owner');

  const amounts = _cancelOrder(order, user, orderId, pair);

  // Transfer Mas back to user
  const amountMAS = isMASTokenY
    ? amounts.amountY.toU64()
    : amounts.amountX.toU64();
  wmas.withdraw(amountMAS, user);

  // Transfer the other token in case order was in the active Id
  if (isMASTokenY && amounts.amountX > u256.Zero)
    pair.getTokenX().transfer(user, amounts.amountX);
  if (!isMASTokenY && amounts.amountY > u256.Zero)
    pair.getTokenY().transfer(user, amounts.amountY);

  transferRemaining(SCBalance, balance(), sent, Context.caller());

  generateEvent(createEvent('LIMIT_ORDER_CANCELED', [orderId.toString()]));

  ReentrancyGuardUpgradeable.endNonReentrant();

  return new Args().add(amounts.amountX).add(amounts.amountY).serialize();
}

/**
 * Cancel an order.
 * @param order (LimitOrder) Limit Order to cancel
 * @param user (Address) Address of the user
 * @param orderId (u32) OrderId to cancel
 * @param pair (IPair) Address of the pair
 *
 */
function _cancelOrder(
  order: LimitOrder,
  user: Address,
  orderId: u32,
  pair: IPair,
): Amounts {
  let bin = _getBinOrders(order.binId);
  let userOrder = _getUserOrders(user);

  userOrder = _removeOrderId(userOrder, orderId);
  bin = _removeOrderId(bin, orderId);

  USER.set(user.toString(), new Args().add(userOrder).serialize());
  BIN.set(order.binId, new Args().add(bin).serialize());
  ORDERS.delete(orderId);

  return _withdrawFromPair([order.binId], [order.amountLPToken], pair);
}

/**
 * Claim the tokens from an executed limit order.
 * @param orderId (u32) OrderId to claim
 * @dev anyone can call this function, tokens are sent to the owner of the order
 * @returns amounts received by the user
 *
 * This function calculates the amount received based on the order’s amountIn, binId,
 * and the getPriceFromId function. For BID orders (orderType = 0) where the user
 * deposited token Y, the claimable token X is computed as:
 *
 *    tokenX = amountIn << SCALE_OFFSET / getPriceFromId(binId, binStep)
 *
 * For ASK orders (orderType = 1) where the user deposited token X, the claimable token Y is:
 *
 *    tokenY = getPriceFromId(binId, binStep) * amountIn >> SCALE_OFFSET
 *
 * The tokens are then transferred to the order owner and the order deleted.
 */
export function claimOrder(bs: StaticArray<u8>): StaticArray<u8> {
  ReentrancyGuardUpgradeable.nonReentrant();

  const args = new Args(bs);
  const orderId = args.nextU32().expect('orderId is missing');
  const order = ORDERS.getSome(orderId, 'Invalid order id');
  const pair = _getPair();

  // for Massa's Storage
  const SCBalance = balance();
  const sent = transferredCoins();

  // Order must be executed.
  assert(order.executed, 'Order has not been executed yet');

  // get the claimable amounts
  const claimable = _getAmountOut(order, pair);

  // remove order from storage
  let userOrder = _getUserOrders(order.owner);
  userOrder = _removeOrderId(userOrder, orderId);
  USER.set(order.owner.toString(), new Args().add(userOrder).serialize());
  ORDERS.delete(orderId);

  // Transfer tokens to the owner
  if (order.orderType == 0) {
    pair.getTokenX().transfer(order.owner, claimable);
  } else {
    pair.getTokenY().transfer(order.owner, claimable);
  }

  transferRemaining(SCBalance, balance(), sent, Context.caller());

  generateEvent(
    createEvent('ORDER_CLAIMED', [orderId.toString(), u256ToString(claimable)]),
  );

  ReentrancyGuardUpgradeable.endNonReentrant();

  return u256ToBytes(claimable);
}

/**
 * Claim the tokens from an executed limit order and return Mas.
 * @param orderId (u32) OrderId to claim
 * @dev anyone can call this function, tokens are sent to the owner of the order
 * @returns amounts received by the user
 *
 * This function calculates the amount received based on the order’s amountIn, binId,
 * and the getPriceFromId function. For BID orders (orderType = 0) where the user
 * deposited token Y, the claimable token X is computed as:
 *
 *    tokenX = amountIn << SCALE_OFFSET / getPriceFromId(binId, binStep)
 *
 * For ASK orders (orderType = 1) where the user deposited token X, the claimable token Y is:
 *
 *    tokenY = getPriceFromId(binId, binStep) * amountIn >> SCALE_OFFSET
 *
 * The tokens are then transferred to the order owner and the order deleted.
 */
export function claimOrderMas(bs: StaticArray<u8>): StaticArray<u8> {
  ReentrancyGuardUpgradeable.nonReentrant();

  const args = new Args(bs);
  const orderId = args.nextU32().expect('orderId is missing');
  const order = ORDERS.getSome(orderId, 'Invalid order id');
  const pair = _getPair();

  // for Massa's Storage
  const SCBalance = balance();
  const sent = transferredCoins();

  const wmas = _getWMAS();
  const isOrderForMas =
    order.orderType == 0
      ? wmas._origin.equals(pair.getTokenX()._origin)
      : wmas._origin.equals(pair.getTokenY()._origin);
  assert(isOrderForMas, 'Token out is not MAS');

  // Order must be executed.
  assert(order.executed, 'Order has not been executed yet');

  // get the claimable amounts
  const amountMAS = _getAmountOut(order, pair);

  // remove order from storage
  let userOrder = _getUserOrders(order.owner);
  userOrder = _removeOrderId(userOrder, orderId);
  USER.set(order.owner.toString(), new Args().add(userOrder).serialize());
  ORDERS.delete(orderId);

  // Transfer Mas to user
  wmas.withdraw(amountMAS.toU64(), order.owner);

  transferRemaining(SCBalance, balance(), sent, Context.caller());

  generateEvent(
    createEvent('ORDER_CLAIMED', [orderId.toString(), u256ToString(amountMAS)]),
  );

  ReentrancyGuardUpgradeable.endNonReentrant();

  return u256ToBytes(amountMAS);
}

/**
 * Owner function to collect the fee
 * No direct fee are taken on the limit order, owner collect the LP's fees
 * @dev Can't transfer LBTokens as they don't have a `transfer` function
 * @param {StaticArray<u8>} bs - byte string containing the tokens to collect (Address[]) and the amounts (u256[])
 */
export function collectFee(bs: StaticArray<u8>): void {
  _onlyOwner();

  const args = new Args(bs);
  const tokens = args.nextSerializableObjectArray<Address>().unwrap();
  const amounts = args.nextFixedSizeArray<u256>().unwrap();

  for (let i = 0; i < tokens.length; i++) {
    new IERC20(tokens[i]).transfer(Context.caller(), amounts[i]);
  }
  generateEvent('FEE_COLLECTED');
}

/**
 * Owner function to recover lost MAS
 * @param {StaticArray<u8>} bs - byte string containing the amount to recover
 */
export function recoverMas(bs: StaticArray<u8>): void {
  _onlyOwner();

  transferCoins(Context.caller(), new Args(bs).nextU64().unwrap());
  generateEvent('MAS_RECOVERED');
}

// kept to not make the pair unusable if the flag is changed
export function onHooksSet(bs: StaticArray<u8>): void {}
export function beforeSwap(bs: StaticArray<u8>): void {}
export function beforeFlashLoan(bs: StaticArray<u8>): void {}
export function afterFlashLoan(bs: StaticArray<u8>): void {}
export function beforeMint(bs: StaticArray<u8>): void {}
export function afterMint(bs: StaticArray<u8>): void {}
export function beforeBurn(bs: StaticArray<u8>): void {}
export function afterBurn(bs: StaticArray<u8>): void {}
export function beforeBatchTransferFrom(bs: StaticArray<u8>): void {}
export function afterBatchTransferFrom(bs: StaticArray<u8>): void {}

// ======================================================== //
// ====              HOOK IMPLEMENTATIONS              ==== //
// ======================================================== //
//
// Internal hook implementations

/**
 * Called at the end of each swap.
 * Check bin mouvement and call executeOrders if needed
 * @param swapForY (bool) if the swap is for tokenX or tokenY
 * @param pair The liquidity book pair.
 */
function _afterSwap(swapForY: bool, pair: IPair): void {
  // Get the previous active bin and the new active bin
  const previousBin = bytesToU32(Storage.get(PREVIOUS_BIN));
  const newBin = pair.getPairInformation().activeId;

  // Check if there is changes in bins
  if (newBin == previousBin) return;

  // Determine which orders to execute based on direction of movement.
  if (!swapForY) {
    // ASK Order. Execute orders in bins that are now below the active bin. newBin > previousBin
    // orders in bin 'newBin' are not executed as they are in the activeBin
    executeOrders(u64(previousBin), u64(newBin - 1), pair);
  } else {
    // BID Order. Execute orders in bins that are now above the active bin. newBin < previousBin
    // orders in bin 'newBin' are not executed as they are in the activeBin
    executeOrders(u64(newBin + 1), u64(previousBin), pair);
  }

  // Update the stored previous active bin for the next swap event
  Storage.set(PREVIOUS_BIN, u32ToBytes(newBin));
}

/**
 * @dev Deposit liquidity to a liquidity book pair.
 * @param binId The bin id of the order, which is the price of the order.
 * @param orderType The order type (bid or ask).
 * @param pair The liquidity book pair.
 * @return liquidity The liquidity deposited.
 */
function _depositToPair(binId: u64, orderType: u8, pair: IPair): u256 {
  let distributionX = [u256.Zero];
  let distributionY = [u256.Zero];

  if (orderType == 0) {
    distributionY = [PRECISION];
  } else {
    distributionX = [PRECISION];
  }

  const r = pair.mint(
    [binId],
    distributionX,
    distributionY,
    Context.callee(),
    balance(),
  );

  return r.liquidityMinted[0];
}

/**
 * @dev Withdraw liquidity from a liquidity book pair.
 * @param _ids The bin ids of the order, which is the price of the order.
 * @param _amounts The liquidity amounts to withdraw for each bins.
 * @param pair The liquidity book pair.
 * @return Amounts The amount of token X & token Y withdrawn.
 */
function _withdrawFromPair(
  _ids: u64[],
  _amounts: u256[],
  pair: IPair,
): Amounts {
  pair.safeBatchTransferFrom(
    Context.callee(),
    pair._origin,
    _ids,
    _amounts,
    balance(),
  );
  return pair.burn(_ids, _amounts, Context.callee(), balance());
}

/**
 * Increment the order id
 * @returns The next order id
 */
function _incrementOrderId(): u32 {
  const id = bytesToU32(Storage.get(ORDER_ID));
  Storage.set(ORDER_ID, u32ToBytes(id + 1));
  return id;
}

/**
 * Execute orders.
 * @param startBin The lowest bin to check for orders.
 * @param endBin The highest bin to check for orders.
 * @param pair The liquidity book pair.
 * @dev Order are mark as executed in ORDERS and deleted in BIN
 */
function executeOrders(startBin: u64, endBin: u64, pair: IPair): void {
  let ids: u64[] = [];
  let totalLiquidities: u256[] = [];
  // Iterate over each crossed bin
  for (let binId = startBin; binId <= endBin; binId++) {
    let orderIds = _getBinOrders(binId);
    if (orderIds.length == 0) continue;

    // Filter executable orders in this bin and sum total liquidity
    let totalLiquidity = u256.Zero;
    for (let i = 0; i < orderIds.length; i++) {
      let orderId = orderIds[i];
      let order = ORDERS.getSome(orderId, 'Missing order');
      totalLiquidity = SafeMath256.add(totalLiquidity, order.amountLPToken);
      order.executed = true;
      ORDERS.set(orderId, order);
    }

    ids.push(binId);
    totalLiquidities.push(totalLiquidity);
    BIN.delete(binId);
  }

  if (ids.length > 0) {
    // Withdraw liquidity from the pair
    _withdrawFromPair(ids, totalLiquidities, pair);

    generateEvent(
      createEvent('LIMIT_ORDER_EXECUTED', [ids.join(EVENT_DELIMITER)]),
    );
  }
}

// ======================================================== //
// ====                HELPER FUNCTIONS                ==== //
// ======================================================== //

/**
 * Ensures that the caller is the trusted Pair.
 */
function _checkTrustedCaller(pair: Address): void {
  assert(Context.caller().equals(pair), 'BaseHooksInvalidCaller');
}

/**
 * Returns the Pair contract.
 */
function _getPair(): IPair {
  return new IPair(new Address(Storage.get(PAIR)));
}

/**
 * Returns the ordersId of a bin.
 */
function _getBinOrders(binId: u64): u32[] {
  const res = BIN.get(binId, []);
  if (res.length == 0) return [];
  return new Args(res).nextFixedSizeArray<u32>().unwrap();
}

/**
 * Returns the ordersId of a user.
 */
function _getUserOrders(user: Address): u32[] {
  const res = USER.get(user.toString(), []);
  if (res.length == 0) return [];
  return new Args(res).nextFixedSizeArray<u32>().unwrap();
}

/**
 * Return true if the order type and the binId are compatible.
 */
function _isOrderValid(pair: IPair, orderType: u8, binId: u64): bool {
  const activeId = pair.getPairInformation().activeId;
  if (orderType == 0) {
    // BID
    return binId < activeId;
  } else {
    // ASK
    return binId > activeId;
  }
}

/**
 * Return the amount out of an order
 * Can be used even if the order wasn't executed
 */
function _getAmountOut(order: LimitOrder, pair: IPair): u256 {
  // Retrieve the price for this order's bin.
  const price: u256 = BinHelper.getPriceFromId(
    order.binId,
    u16(pair.feeParameters().binStep),
  );

  if (order.orderType == 0) {
    // BID order: deposited token Y. Calculate token X to be received.
    // tokenX = amountIn << offset / price.
    return Math512Bits.shiftDivRoundDown(order.amountIn, SCALE_OFFSET, price);
  } else {
    // ASK order: deposited token X. Calculate token Y to be received.
    // tokenY =  price * amountIn >> offset.
    return Math512Bits.mulShiftRoundDown(price, order.amountIn, SCALE_OFFSET);
  }
}

/**
 * Remove an orderId from a list or orderIds.
 * @dev Does not keep the same order of elements in Orderlist
 */
function _removeOrderId(Orderlist: u32[], orderId: u32): u32[] {
  // swap with the last element then reduce the array's length
  const orderIndex = Orderlist.indexOf(orderId);

  assert(orderIndex >= 0, 'orderId not in Orderlist');

  let lastIndex = Orderlist.length - 1;
  // If the element to remove isn't already the last one, swap it.
  if (orderIndex < lastIndex) {
    Orderlist[orderIndex] = Orderlist[lastIndex];
  }
  Orderlist.pop();

  return Orderlist;
}

function _getWMAS(): IWMAS {
  return new IWMAS(new Address(Storage.get(WMAS)));
}

/**
 * @dev Check that the token an order spends is WMAS: tokenY for a bid, tokenX for an ask.
 * The MAS functions record the sent MAS as the order amount, so it must be the order's token.
 */
function _isTokenInMas(wmas: IWMAS, pair: IPair, orderType: u8): bool {
  const tokenIn = orderType == 0 ? pair.getTokenY() : pair.getTokenX();
  return wmas._origin.equals(tokenIn._origin);
}

/**
 * @notice Function used by an SC to receive Massa coins
 * @param _ unused
 */
export function receiveCoins(_: StaticArray<u8>): void {}
