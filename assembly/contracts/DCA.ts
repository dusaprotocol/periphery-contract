import { Args, bytesToU64, SafeMath, u64ToBytes } from '@massalabs/as-types';
import {
  Address,
  Context,
  generateEvent,
  Storage,
  callerHasWriteAccess,
  deferredCallRegister,
  deferredCallCancel,
  balance,
  deferredCallExists,
  transferredCoins,
  transferCoins,
} from '@massalabs/massa-as-sdk';
import { DCA } from '../structs/DCA';
import { u256 } from 'as-bignum/assembly/integer/u256';
import {
  onlyOwner,
  setOwner,
} from '@massalabs/sc-standards/assembly/contracts/utils/ownership';
import {
  computeTargetSlotFromDelay,
  findSlotUnderPrice,
} from '../helpers/methods';
import { onlyAutonomous } from '../helpers/utils';
import {
  QUOTER,
  DCA_ID,
  DCAS,
  WMAS,
  MAX_GAS,
  USDC,
  PAIR_MAS_USDC,
  MAX_SWAP,
  MAX_PRICE,
} from '../storage/DCA';
import {
  IERC20,
  IPair,
  u256ToString,
  createKey,
  IWMAS,
  SafeMath256,
  BinHelper,
  createEvent,
  Math512Bits,
  SCALE_OFFSET,
  PRECISION,
  transferRemaining,
} from '@dusalabs/core';
import { IQuoter } from '../interfaces/IQuoter';
import { Quote } from '../structs/DcaQuote';
import {
  ONE_MINUTE,
  ONE_WEEK,
  ONE_MONTH,
  STORAGE_COST,
} from '../helpers/constants';

// ERRORS
const DCA_Wrong_Id = (id: u64): string => {
  return `DCA_Wrong_Id: ${id.toString()}`;
};

export function constructor(bs: StaticArray<u8>): void {
  assert(callerHasWriteAccess());

  const args = new Args(bs);
  Storage.set(QUOTER, args.nextString().unwrap());
  Storage.set(WMAS, args.nextString().unwrap());
  Storage.set(USDC, args.nextString().unwrap());
  Storage.set(PAIR_MAS_USDC, args.nextString().unwrap());
  Storage.set(DCA_ID, u64ToBytes(0));
  Storage.set(MAX_GAS, u64ToBytes(u64(60_000_000)));
  Storage.set(MAX_SWAP, u64ToBytes(5_000_000));
  Storage.set(MAX_PRICE, u64ToBytes(u64(5_000_000_000)));
  setOwner(new Args().add(Context.caller()).serialize());
}

/**
 * Start a DCA
 * @param {StaticArray<u8>} bs
 *
 */
export function startDCA(bs: StaticArray<u8>): StaticArray<u8> {
  const SCBalance = balance();
  const sent = transferredCoins();

  const args = new Args(bs);
  const dcaId = incrementDCAId();
  const caller = Context.caller();

  const amountEachDCA = args.nextU256().unwrap();
  const interval = args.nextU64().unwrap(); // in milliseconds
  const nbOfDCA = args.nextU64().unwrap(); // if end time not set: nbOfDCA = 0
  const tokenPath = args.nextSerializableObjectArray<Address>().unwrap();
  const threshold = args.nextU32().unwrap();
  const moreGas = args.nextBool().unwrap(); // used for big swap that consume more gas

  const wmas = new IWMAS(new Address(Storage.get(WMAS)));
  const masInPath = tokenPath.includes(wmas._origin);

  assert(interval >= ONE_MINUTE, 'Interval too short');
  assert(interval <= 2 * ONE_MONTH, 'Interval too long');
  assert(tokenPath.length < 5 && tokenPath.length > 1, '“incorrect tokenPath');
  assert(threshold < 1000 && threshold >= 10, 'invalid threshold');
  assert(
    masInPath || tokenPath.includes(new Address(Storage.get(USDC))),
    'tokenPath must includes WMAS or USDC',
  );

  const startInResult = args.nextU64();
  const startIn = startInResult.isOk() ? startInResult.unwrap() : 0;
  assert(startIn <= 2 * ONE_MONTH, 'Start too far');
  const startTime = Context.timestamp() + startIn;
  const dcaKey = buildDCAKey(caller, dcaId);

  const dca = new DCA(
    amountEachDCA,
    interval,
    nbOfDCA,
    tokenPath,
    threshold,
    moreGas,
    startTime,
    0,
  );
  DCAS.set(dcaKey, dca);

  const event = createEvent('DCA_ADDED', [caller.toString(), dcaId.toString()]);
  generateEvent(event);

  let relaysPrepaid: u64 = 0;
  if (startIn == 0) _advance(caller, dcaId, buildDCAKey(caller, dcaId), dca);
  else {
    const balanceBeforeSchedule = balance();
    _scheduleDCA(caller, dcaId, startIn, dcaKey, dca, masInPath);
    relaysPrepaid = relaysCost(
      SafeMath.sub(balanceBeforeSchedule, balance()),
      startIn,
      tokenPath.length,
    );
  }

  // the caller also pays the relays of a start delay longer than ONE_WEEK
  transferRemaining(
    SCBalance,
    SafeMath.sub(balance(), relaysPrepaid),
    sent,
    Context.caller(),
  );

  return u64ToBytes(dcaId);
}

/**
 * Stop a DCA
 * @param {StaticArray<u8>} bs byte string containing the DCA id (u64)
 */
export function stopDCA(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const dcaId = args.nextU64().unwrap();
  const caller = Context.caller();
  const dcaKey = buildDCAKey(caller, dcaId);
  assert(DCAS.contains(dcaKey), DCA_Wrong_Id(dcaId));

  deleteDCA(dcaKey);
}

/**
 * Update a DCA
 * @param {StaticArray<u8>} bs - byte string containing the DCA id (u64), amountEachDCA (u256), interval (u64), nbOfDCA (u64), tokenPath (Address[])
 */
export function updateDCA(bs: StaticArray<u8>): void {
  const SCBalance = balance();
  const sent = transferredCoins();

  const args = new Args(bs);
  const dcaId = args.nextU64().unwrap();
  const caller = Context.caller();
  const dcaKey = buildDCAKey(caller, dcaId);
  assert(DCAS.contains(dcaKey), DCA_Wrong_Id(dcaId));

  const dca = DCAS.getSome(dcaKey);

  if (dca.deferredCallId != '' && deferredCallExists(dca.deferredCallId)) {
    deferredCallCancel(dca.deferredCallId);
  }

  const amountEachDCA = args.nextU256().unwrap();
  const interval = args.nextU64().unwrap(); // in milliseconds
  const nbOfDCA = args.nextU64().unwrap();
  const tokenPath = args.nextSerializableObjectArray<Address>().unwrap();
  const threshold = args.nextU32().unwrap();
  const moreGas = args.nextBool().unwrap();

  const wmas = new IWMAS(new Address(Storage.get(WMAS)));
  const masInPath = tokenPath.includes(wmas._origin);

  assert(interval >= ONE_MINUTE, 'Interval too short');
  assert(interval <= 2 * ONE_MONTH, 'Interval too long');
  assert(tokenPath.length < 5 && tokenPath.length > 1, '“incorrect tokenPath');
  assert(threshold < 1000 && threshold >= 10, 'invalid threshold');
  assert(
    masInPath || tokenPath.includes(new Address(Storage.get(USDC))),
    'tokenPath must includes WMAS or USDC',
  );

  dca.amountEachDCA = amountEachDCA;
  dca.interval = interval;
  dca.nbOfDCA = nbOfDCA;
  dca.tokenPath = tokenPath;
  dca.threshold = threshold;
  dca.moreGas = moreGas;

  DCAS.set(dcaKey, dca);

  const balanceBeforeSchedule = balance();
  _scheduleDCA(caller, dcaId, interval, dcaKey, dca, masInPath);
  const relaysPrepaid = relaysCost(
    SafeMath.sub(balanceBeforeSchedule, balance()),
    interval,
    tokenPath.length,
  );

  const event = createEvent('DCA_UPDATED', [
    caller.toString(),
    dcaId.toString(),
  ]);
  generateEvent(event);

  // the caller also pays the relays of an interval longer than ONE_WEEK
  transferRemaining(
    SCBalance,
    SafeMath.sub(balance(), relaysPrepaid),
    sent,
    Context.caller(),
  );
}

/**
 * Owner function to collect the fee
 * @param {StaticArray<u8>} bs - byte string containing the tokens to collect (Address[])
 */
export function collectFee(bs: StaticArray<u8>): void {
  onlyOwner();

  const args = new Args(bs);
  const tokens = args.nextSerializableObjectArray<Address>().unwrap();

  for (let i = 0; i < tokens.length; i++) {
    const token = new IERC20(tokens[i]);
    token.transfer(Context.caller(), token.balanceOf(Context.callee()));
  }
  generateEvent('FEE_COLLECTED');
}

/**
 * Owner function to recover lost MAS
 * @param {StaticArray<u8>} bs - byte string containing the amount to recover
 */
export function recoverMas(bs: StaticArray<u8>): void {
  onlyOwner();

  transferCoins(Context.caller(), new Args(bs).nextU64().unwrap());
  generateEvent('MAS_RECOVERED');
}

export function updateMaxGas(bs: StaticArray<u8>): void {
  onlyOwner();

  const newMaxGas = new Args(bs).nextU64().unwrap();
  const previousMaxGas = bytesToU64(Storage.get(MAX_GAS));

  assert(newMaxGas != previousMaxGas, 'SAME MAX GAS');

  Storage.set(MAX_GAS, u64ToBytes(newMaxGas));

  const event = createEvent('NEW_MAX_GAS', [
    previousMaxGas.toString(),
    newMaxGas.toString(),
  ]);
  generateEvent(event);
}

export function updateMaxPrice(bs: StaticArray<u8>): void {
  onlyOwner();

  const newMaxPrice = new Args(bs).nextU64().unwrap();
  const previousMaxPrice = bytesToU64(Storage.get(MAX_PRICE));

  assert(newMaxPrice != previousMaxPrice, 'SAME MAX PRICE');

  Storage.set(MAX_PRICE, u64ToBytes(newMaxPrice));

  const event = createEvent('NEW_MAX_PRICE', [
    previousMaxPrice.toString(),
    newMaxPrice.toString(),
  ]);
  generateEvent(event);
}

export function updateMaxSwap(bs: StaticArray<u8>): void {
  onlyOwner();

  const newMaxSwap = new Args(bs).nextU64().unwrap();
  const previousMaxSwap = bytesToU64(Storage.get(MAX_SWAP));

  assert(newMaxSwap != previousMaxSwap, 'SAME MAX SWAP');

  Storage.set(MAX_SWAP, u64ToBytes(newMaxSwap));

  const event = createEvent('NEW_MAX_SWAP', [
    previousMaxSwap.toString(),
    newMaxSwap.toString(),
  ]);
  generateEvent(event);
}

export function updateQuoter(bs: StaticArray<u8>): void {
  onlyOwner();

  const newQuoter = new Args(bs).nextString().unwrap();
  const previousQuoter = Storage.get(QUOTER);

  assert(newQuoter != previousQuoter, 'SAME QUOTER');

  Storage.set(QUOTER, newQuoter);

  const event = createEvent('NEW_QUOTER', [previousQuoter, newQuoter]);
  generateEvent(event);
}

export function updatePairMasUsdc(bs: StaticArray<u8>): void {
  onlyOwner();

  const newPair = new Args(bs).nextString().unwrap();
  const previousPair = Storage.get(PAIR_MAS_USDC);

  assert(newPair != previousPair, 'SAME PAIR');

  Storage.set(PAIR_MAS_USDC, newPair);

  const event = createEvent('NEW_PAIR', [previousPair, newPair]);
  generateEvent(event);
}

// ==================================================== //
// ====               SC AUTOMATION                ==== //
// ==================================================== //

/**
 * @notice Contract automation
 * @dev This function is called by the contract itself
 * @param {StaticArray<u8>} bs - serialized arguments for the message (dcaOwner, dcaId)
 */
export function advance(bs: StaticArray<u8>): void {
  onlyAutonomous();

  const args = new Args(bs);
  const dcaOwner = new Address(args.nextString().unwrap());
  const dcaId = args.nextU64().unwrap();

  const dcaKey = buildDCAKey(dcaOwner, dcaId);
  const dca = DCAS.getSome(dcaKey);
  _advance(dcaOwner, dcaId, dcaKey, dca);
}

function _advance(
  dcaOwner: Address,
  dcaId: u64,
  dcaKey: string,
  dca: DCA,
): void {
  let token = new IERC20(dca.tokenPath[0]);

  const balanceBefore = balance();

  if (
    token.balanceOf(dcaOwner) < dca.amountEachDCA ||
    token.allowance(dcaOwner, Context.callee()) < dca.amountEachDCA
  ) {
    generateEvent(createEvent('DCA_ERROR_TRANSFER', [dcaId.toString()]));
    deleteDCA(dcaKey);
    return;
  }

  const quoter = new IQuoter(new Address(Storage.get(QUOTER)));
  const quote = quoter.findBestPathFromAmountIn(
    dca.tokenPath,
    dca.amountEachDCA,
    false,
  );

  let pair = new IPair(quote.pairs[0]);
  let swapForY = token.equals(pair.getTokenX());
  const wmas = new IWMAS(new Address(Storage.get(WMAS)));
  const usdc = new Address(Storage.get(USDC));
  const masInPath = dca.tokenPath.includes(wmas._origin);

  if (!quote.pairs[0].isValid()) {
    generateEvent(createEvent('DCA_ERROR', [dcaId.toString()]));
    return;
  }

  for (let i = 0; i < quote.pairs.length; i++) {
    const _pair = new IPair(quote.pairs[i]);
    // each hop swaps its own input token, not tokenPath[0]
    const _swapForY = new IERC20(dca.tokenPath[i]).equals(_pair.getTokenX());
    if (
      !oracleCheck(_pair, _swapForY, dca.threshold) ||
      !minAmountOutCheck(quote, i, _pair, _swapForY, dca.threshold)
    ) {
      _scheduleDCA(dcaOwner, dcaId, ONE_MINUTE * 60, dcaKey, dca, masInPath);
      return;
    }
  }

  dca.executedCount += 1;

  let amountMasNeeded: u64 = 0;

  // schedule a new DCA if there is remaining execution
  // delete it otherwise
  if (dca.executedCount >= dca.nbOfDCA && dca.nbOfDCA != 0) {
    deleteDCA(dcaKey);
    // stop DCA if there was too many execution
    if (dca.executedCount > dca.nbOfDCA) return;
  } else {
    DCAS.set(dcaKey, dca);

    _scheduleDCA(dcaOwner, dcaId, dca.interval, dcaKey, dca, masInPath);

    amountMasNeeded = SafeMath.sub(balanceBefore, balance());
  }

  // take into account each DCA relays
  amountMasNeeded = SafeMath.add(
    amountMasNeeded,
    relaysCost(amountMasNeeded, dca.interval, dca.tokenPath.length),
  );

  // Recover token for the DCA
  token.transferFrom(dcaOwner, Context.callee(), dca.amountEachDCA);

  const _amount = keepSomeMasForGasFees(
    wmas,
    usdc,
    token,
    dca.amountEachDCA,
    amountMasNeeded,
    masInPath,
  );

  // transfer token to contract
  token.transfer(pair._origin, _amount);

  // if tokenPath.length > 1, perform intermediate swaps
  for (let i = 1; i < quote.pairs.length; i++) {
    let amount = pair.swap(swapForY, Context.callee(), STORAGE_COST);

    pair = new IPair(quote.pairs[i]);
    token = new IERC20(dca.tokenPath[i]);
    swapForY = token.equals(pair.getTokenX());

    amount = keepSomeMasForGasFees(
      wmas,
      usdc,
      token,
      amount,
      amountMasNeeded,
      masInPath,
    );

    token.transfer(pair._origin, amount);
  }
  token = new IERC20(dca.tokenPath[dca.tokenPath.length - 1]);

  // swap token
  let amountOut = pair.swap(swapForY, Context.callee(), STORAGE_COST);

  amountOut = keepSomeMasForGasFees(
    wmas,
    usdc,
    token,
    amountOut,
    amountMasNeeded,
    masInPath,
  );

  // Collect fee of 0.7% for fee
  let fee = u256.div(SafeMath256.mul(amountOut, u256.from(7)), u256.from(1000)); // 0.7% fee
  amountOut = u256.sub(amountOut, fee);

  // Send token
  if (token._origin.equals(wmas._origin)) {
    new IWMAS(token._origin).withdraw(amountOut.toU64(), dcaOwner);
  } else {
    token.transfer(dcaOwner, amountOut);
  }

  const event = createEvent('DCA_EXECUTED', [
    dcaOwner.toString(),
    dcaId.toString(),
    u256ToString(amountOut),
  ]);
  generateEvent(event);
}

/**
 * Schedule the next deferred call for the DCA
 * @param bs - serialized arguments for the message (caller, dcaId, remainingDelay)
 */
export function scheduleDCA(bs: StaticArray<u8>): void {
  onlyAutonomous();
  const args = new Args(bs);
  const caller = new Address(args.nextString().unwrap());
  const dcaId = args.nextU64().unwrap();
  let remainingDelay = args.nextU64().unwrap();

  const dcaKey = buildDCAKey(caller, dcaId);
  const dca = DCAS.getSome(dcaKey);
  const wmas = new IWMAS(new Address(Storage.get(WMAS)));
  const masInPath = dca.tokenPath.includes(wmas._origin);

  _scheduleDCA(caller, dcaId, remainingDelay, dcaKey, dca, masInPath);
}

// ==================================================== //
// ====                  HELPERS                   ==== //
// ==================================================== //
/**
 * Build DCA key for storage
 * @param dcaOwner - address of the DCA owner
 * @param dcaId - id of the DCA
 * @returns Key for storage
 */
function buildDCAKey(dcaOwner: Address, dcaId: u64): string {
  return createKey([dcaOwner.toString(), dcaId.toString()]);
}

/**
 * Delete DCA from storage
 * @param dcaOwner - address of the DCA owner
 * @param dcaId - id of the DCA
 */
function deleteDCA(dcaKey: string): void {
  const dca = DCAS.getSome(dcaKey);

  // Cancel the deferred call if it exists
  if (dca.deferredCallId !== '' && deferredCallExists(dca.deferredCallId)) {
    deferredCallCancel(dca.deferredCallId);
  }

  DCAS.delete(dcaKey); // Recover locked resources
  const event = createEvent('DCA_ENDED', dcaKey.split(':'));
  generateEvent(event);
}

/**
 * Increment DCA id
 * @returns incremented DCA id
 */
function incrementDCAId(): u64 {
  const id = bytesToU64(Storage.get(DCA_ID));
  Storage.set(DCA_ID, u64ToBytes(id + 1));
  return id;
}

function keepSomeMasForGasFees(
  wmas: IWMAS,
  usdc: Address,
  token: IERC20,
  amount: u256,
  amountNeeded: u64,
  masInPath: bool,
): u256 {
  if (masInPath) {
    if (wmas._origin == token._origin && amountNeeded > 0) {
      amount = SafeMath256.sub(amount, u256.fromU64(amountNeeded));
      wmas.withdraw(amountNeeded, Context.callee());
    }
    return amount;
  } else {
    if (usdc.equals(token._origin) && amountNeeded > 0) {
      const _pair = new IPair(new Address(Storage.get(PAIR_MAS_USDC)));
      const _swapForY = token.equals(_pair.getTokenX());

      // estimate the amount of usdc to swap to Mas
      const amountIn = _amountToSwap(amountNeeded, _pair, _swapForY);
      assert(
        amountIn <= u256.from(bytesToU64(Storage.get(MAX_SWAP))),
        'Price Too High',
      );

      // perform the swap
      new IERC20(usdc).transfer(_pair._origin, amountIn);
      let amountOut = _pair.swap(_swapForY, Context.callee(), STORAGE_COST);
      assert(amountOut.toU64() >= amountNeeded, 'SWAP ERROR');

      amount = SafeMath256.sub(amount, amountIn);
      wmas.withdraw(amountNeeded, Context.callee());
    }
    return amount;
  }
}

/**
 * Estimate the amountIn needed to get a specific amountOut
 * @param amountOutNeeded - the amountOut wanted
 * @param _pair - address of the pair
 * @param _swapForY - if the swap is for tokenX or Y of the pair
 */
function _amountToSwap(
  amountOutNeeded: u64,
  _pair: IPair,
  _swapForY: bool,
): u256 {
  const pair = _pair.getPairInformation();
  const _fp = _pair.feeParameters();
  let _amountOut = u256.from(amountOutNeeded);

  let _amountOutOfBin = u256.Zero;
  let _amountInWithFees = u256.Zero;
  let _reserve = u256.Zero;
  let amountIn = u256.Zero;
  let feesIn = u256.Zero;

  while (true) {
    const r2 = _pair.getBin(pair.activeId);
    _reserve = _swapForY ? r2.reserveY : r2.reserveX;

    const _price = BinHelper.getPriceFromId(pair.activeId, u16(_fp.binStep));
    if (!_reserve.isZero()) {
      _amountOutOfBin = _amountOut >= _reserve ? _reserve : _amountOut;
      const _amountInToBin = _swapForY
        ? Math512Bits.shiftDivRoundUp(_amountOutOfBin, SCALE_OFFSET, _price)
        : Math512Bits.mulShiftRoundUp(_price, _amountOutOfBin, SCALE_OFFSET);

      // We update the fee, but we don't store the new volatility reference, volatility accumulated and indexRef to not penalize traders
      _fp.updateVolatilityAccumulated(pair.activeId);
      const _fee = _fp.getFeeAmount(_amountInToBin);
      _amountInWithFees = SafeMath256.add(_amountInToBin, _fee);

      amountIn = SafeMath256.add(amountIn, _amountInWithFees);
      feesIn = SafeMath256.add(feesIn, _fee);
      _amountOut = SafeMath256.sub(_amountOut, _amountOutOfBin);
    }

    if (!_amountOut.isZero()) {
      const r = _pair.findFirstNonEmptyBinId(pair.activeId, _swapForY);

      pair.activeId = r.unwrap();
    } else {
      break;
    }
  }

  return amountIn;
}

/**
 * Schedule the next deferred call for the DCA
 * @param bs - serialized arguments for the message (caller, dcaId, remainingDelay)
 */
function _scheduleDCA(
  caller: Address,
  dcaId: u64,
  remainingDelay: u64,
  dcaKey: string,
  dca: DCA,
  masInPath: bool,
): void {
  // First, determine the delayMillis for the next deferred call
  let delayMillis: u64;
  if (remainingDelay > ONE_WEEK) {
    delayMillis = ONE_WEEK;
    remainingDelay -= ONE_WEEK;
  } else {
    delayMillis = remainingDelay;
    remainingDelay = 0;
  }

  // Prepare the arguments for the next deferred call
  const nextArgs = new Args()
    .add(caller)
    .add(dcaId)
    .add(remainingDelay)
    .serialize();

  const wantedSlot = computeTargetSlotFromDelay(delayMillis);
  const endPeriod = wantedSlot.period + 10;

  let gas = bytesToU64(Storage.get(MAX_GAS));

  // increase the gas for big swap
  if (dca.moreGas) gas *= 2;

  const targetSlot = findSlotUnderPrice(
    wantedSlot.period,
    wantedSlot.thread,
    endPeriod,
    (dca.tokenPath.length - 1) * gas,
    nextArgs.length,
  );

  let deferredCallId: string;
  if (remainingDelay > 0) {
    deferredCallId = deferredCallRegister(
      Context.callee().toString(),
      'scheduleDCA',
      targetSlot,
      30_000_000,
      nextArgs,
      0,
    );
  } else {
    const argsAdvance = new Args().add(caller).add(dcaId).serialize();
    deferredCallId = deferredCallRegister(
      Context.callee().toString(),
      'advance',
      targetSlot,
      (dca.tokenPath.length - 1) * gas + (masInPath ? 0 : gas),
      argsAdvance,
      0,
    );
  }

  // Update the DCA deferredCallId
  dca.deferredCallId = deferredCallId;
  DCAS.set(dcaKey, dca);
}

/**
 * MAS needed for the deferred calls relaying a delay longer than ONE_WEEK,
 * estimated from the cost of the first booking
 * @param bookingCost - MAS spent by the first booking
 * @param delay - delay of the scheduled execution in milliseconds
 * @param pathLength - number of tokens in the DCA path
 */
function relaysCost(bookingCost: u64, delay: u64, pathLength: i32): u64 {
  if (delay <= ONE_WEEK) return 0;
  return SafeMath.add(
    SafeMath.mul(bookingCost, delay / ONE_WEEK),
    SafeMath.mul(bookingCost, 2 * (pathLength - 1)),
  );
}

/**
 * Time weighted average active id of the pair, between 5 and 2 minutes ago
 * @param pair - the pair
 */
function twapActiveId(pair: IPair): u64 {
  const time1 = 120; //2 minutes;
  const time2 = 300; //5 minutes;
  return (
    (((pair.getOracleSampleFrom(time1).cumulativeId as i64) -
      (pair.getOracleSampleFrom(time2).cumulativeId as i64)) as u64) /
    (time2 - time1)
  );
}

/**
 * Check that the quoted output of a hop, after fees, is within the threshold of
 * the oracle (TWAP) price, so emptied bins or a manipulated spot price can't be
 * used to sandwich the DCA
 * @param quote - quote of the DCA swap
 * @param hop - index of the hop in the quote
 * @param pair - pair of the hop
 * @param _swapForY - if the hop swaps tokenX for tokenY
 * @param threshold - max deviation in per mille
 */
function minAmountOutCheck(
  quote: Quote,
  hop: i32,
  pair: IPair,
  _swapForY: bool,
  threshold: u64,
): bool {
  const amountIn = quote.amounts[hop];
  const feesIn = u256.div(
    SafeMath256.mul(amountIn, quote.fees[hop]),
    u256.from(PRECISION),
  );
  const amountInAfterFees = SafeMath256.sub(amountIn, feesIn);

  const binstep = u16(pair.feeParameters().binStep);
  const priceMedium = BinHelper.getPriceFromId(twapActiveId(pair), binstep);
  const fairAmountOut = _swapForY
    ? Math512Bits.mulShiftRoundDown(
        priceMedium,
        amountInAfterFees,
        SCALE_OFFSET,
      )
    : Math512Bits.shiftDivRoundDown(
        amountInAfterFees,
        SCALE_OFFSET,
        priceMedium,
      );

  // no SafeMath is fine as threshold < 1000
  const minAmountOut = u256.div(
    SafeMath256.mul(fairAmountOut, u256.from(1000 - threshold)),
    u256.from(1000),
  );
  return quote.amounts[hop + 1] >= minAmountOut;
}

function oracleCheck(pair: IPair, _swapForY: bool, threshold: u64): bool {
  const activeId = pair.getPairInformation().activeId;
  const binMedium = twapActiveId(pair);
  const binstep = u16(pair.feeParameters().binStep);
  const priceNow = BinHelper.getPriceFromId(activeId, binstep);
  const priceMedium = BinHelper.getPriceFromId(binMedium, binstep);

  // Check the price volatilty, no SafeMath is fine as threshold < 1000
  if (_swapForY) {
    // Check if the price is within the bounds.
    if (
      priceNow <
      u256.div(
        u256.mul(priceMedium, u256.from(1000 - threshold)),
        u256.from(1000),
      )
    )
      return false;
  } else {
    // Check if the price is within the bounds.
    if (
      priceNow >
      u256.div(
        u256.mul(priceMedium, u256.from(1000 + threshold)),
        u256.from(1000),
      )
    )
      return false;
  }
  return true;
}

/**
 * @notice Function used by an SC to receive Massa coins
 * @param _ unused
 */
export function receiveCoins(_: StaticArray<u8>): void {}
