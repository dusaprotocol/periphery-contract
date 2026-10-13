import {
  Address,
  Context,
  Storage,
  callerHasWriteAccess,
  generateEvent,
  sendMessage,
} from '@massalabs/massa-as-sdk';
import { FeeManager, StrategyParameters } from '../structs';
import {
  Args,
  boolToByte,
  byteToBool,
  bytesToFixedSizeArray,
  bytesToNativeTypeArray,
  bytesToU32,
  bytesToU64,
  fixedSizeArrayToBytes,
  nativeTypeArrayToBytes,
  u32ToBytes,
  u64ToBytes,
} from '@massalabs/as-types';
import {
  IERC20,
  IPair,
  IRouter,
  LiquidityParameters,
  MAX_FEE,
  PRECISION,
  u256ToString,
  createEvent,
} from '@dusalabs/core';
import { _getAmountsOf } from '../helpers/LiquidityAmounts';
import { u256 } from 'as-bignum/assembly/integer/u256';
import { Amounts } from '@dusalabs/core/assembly/structs/Returns';
import { onlyAutonomous } from '../helpers/utils';
import {
  bFalse,
  bTrue,
  BINSTEP,
  ACTIVE_BINS,
  DELTA_IDS,
  DISTRIBUTION_X,
  DISTRIBUTION_Y,
  IDSLIPPAGE,
  FEES_MANAGERS,
  IS_ON,
  LAST_ADD,
  BIN_OFFSET,
  CENTER_OFFSET,
  IS_TOKEN_X_WEIGHTED,
  IS_TOKEN_Y_WEIGHTED,
  harvestDelay,
  LAST_HARVEST,
  rebalanceDelay,
  REBALANCE_TIMESTAMP,
  IS_PENDING_REBALANCE,
} from '../storage/LBStrategy';
import { PERIODS_PER_HOUR } from '../helpers/constants';

// TODO : use struct for returns
// TODO : solidity like events
// TODO : optimise by using less u64 and more u32
// TODO: remove useless comments

// TEMP
export { recover, upgrade } from './Upgradeable';

export function constructor(bs: StaticArray<u8>): void {
  assert(callerHasWriteAccess(), 'caller must have write access');

  const args = new Args(bs);
  const _dusaRouter = new Address(args.nextString().unwrap());
  const _vault = new Address(args.nextString().unwrap());
  const _feeRecipient = new Address(args.nextString().unwrap());
  const _strategyParams = args.nextSerializable<StrategyParameters>().unwrap();

  const feeManager = new FeeManager(_vault, _feeRecipient, Context.caller());

  assert(_strategyParams.deltaIds.length < 50, 'Strategy: Too many bins');

  assert(
    _strategyParams.deltaIds.length == _strategyParams.distributionX.length &&
      _strategyParams.distributionX.length ==
        _strategyParams.distributionY.length,
    'Strategy: Unbalanced params',
  );

  Storage.set('VAULT', _vault.toString());
  Storage.set('ROUTER', _dusaRouter.toString());
  Storage.set('PAIR', _strategyParams.pair.toString());
  Storage.set(BINSTEP, u64ToBytes(_strategyParams.binStep));
  Storage.set('TOKEN_X', _strategyParams.tokenX._origin.toString());
  Storage.set('TOKEN_Y', _strategyParams.tokenY._origin.toString());
  Storage.set(IDSLIPPAGE, u64ToBytes(_strategyParams.idSlippage));
  Storage.set(DELTA_IDS, nativeTypeArrayToBytes(_strategyParams.deltaIds));
  Storage.set(
    DISTRIBUTION_X,
    fixedSizeArrayToBytes(_strategyParams.distributionX),
  );
  Storage.set(
    DISTRIBUTION_Y,
    fixedSizeArrayToBytes(_strategyParams.distributionY),
  );
  Storage.set(FEES_MANAGERS, feeManager.serialize());
  Storage.set(IS_TOKEN_X_WEIGHTED, bFalse);
  Storage.set(IS_TOKEN_Y_WEIGHTED, bFalse);
  Storage.set(BIN_OFFSET, u64ToBytes(args.nextU64().unwrap())); //1
  Storage.set(CENTER_OFFSET, u64ToBytes(args.nextU64().unwrap())); //5
  Storage.set(ACTIVE_BINS, nativeTypeArrayToBytes([]));
  Storage.set(IS_ON, bFalse);
  Storage.set(LAST_HARVEST, u64ToBytes(Context.timestamp()));
  Storage.set(REBALANCE_TIMESTAMP, u64ToBytes(Context.timestamp()));
  Storage.set(IS_PENDING_REBALANCE, bFalse);
}

export function strategyPositionAtIndex(bs: StaticArray<u8>): StaticArray<u8> {
  return u64ToBytes(_strategyPositionAtIndex(new Args(bs).nextU32().unwrap()));
}

function _strategyPositionAtIndex(_index: u32): u64 {
  let activeBinsArray = getActiveBins();
  return activeBinsArray[_index];
}

export function strategyPositionNumber(): StaticArray<u8> {
  return u64ToBytes(_strategyPositionNumber());
}

function _strategyPositionNumber(): u32 {
  return getActiveBins().length;
}

export function checkProposedBinLength(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const proposedDeltas = bytesToNativeTypeArray<i64>(args.nextBytes().unwrap());
  const activeId = args.nextU32().unwrap();
  return u32ToBytes(_checkProposedBinLength(proposedDeltas, activeId));
}

function _checkProposedBinLength(proposedDeltas: i64[], activeId: u32): u32 {
  let newIdCount = 0;
  let activeBinsArray: u64[] = Storage.has(ACTIVE_BINS) ? getActiveBins() : [];
  for (let i = 0; i < proposedDeltas.length; i++) {
    let _id = u32(i64(activeId) + proposedDeltas[i]);
    if (!activeBinsArray.includes(_id)) {
      newIdCount += 1;
    }
  }
  return newIdCount + _strategyPositionNumber();
}

/// -----------------------------------------------------------
/// Internal functions
/// -----------------------------------------------------------

function _addLiquidity(
  amountX: u256,
  amountY: u256,
  amountXMin: u256,
  amountYMin: u256,
): void {
  // Fetch the current active Id.
  const pair = getPair();
  const router = getRouter();
  let activeId = pair.getPairInformation().activeId;
  let deltaIds = bytesToNativeTypeArray<i64>(Storage.get(DELTA_IDS));
  // Check bin lengths are less than 50 bins due to block limit. Further liquidity cannot be added until rebalanced.
  assert(
    _checkProposedBinLength(deltaIds, activeId) < 50,
    'Strategy: Requires Rebalance',
  );

  // Set the required liquidity parameters.
  let liquidityParameters = new LiquidityParameters(
    getTokenX(),
    getTokenY(),
    bytesToU64(Storage.get(BINSTEP)),
    amountX,
    amountY,
    amountXMin,
    amountYMin,
    activeId,
    bytesToU64(Storage.get(IDSLIPPAGE)),
    bytesToNativeTypeArray<i64>(Storage.get(DELTA_IDS)),
    bytesToFixedSizeArray<u256>(Storage.get(DISTRIBUTION_X)),
    bytesToFixedSizeArray<u256>(Storage.get(DISTRIBUTION_Y)),
    Context.callee(),
    Context.timestamp(),
  );

  // Add the required liquidity into the pair.
  let liquidityReturn = router.addLiquidity(liquidityParameters, 0);
  let depositIds = liquidityReturn.depositIds;
  let liquidityMinted = liquidityReturn.liquidityMinted;

  // Sum the total amount of liquidity minted.
  let liquidtyMintedHolder = u256.Zero;
  let _activeBins: u64[] = Storage.has(ACTIVE_BINS) ? getActiveBins() : [];

  for (let i: i32 = 0; i < liquidityMinted.length; i++) {
    liquidtyMintedHolder = u256.add(liquidtyMintedHolder, liquidityMinted[i]);
    // Add the ID's to the user set.
    if (!_activeBins.includes(depositIds[i])) _activeBins.push(depositIds[i]);
  }
  _activeBins.sort();

  assert(
    _activeBins.length < 50,
    'Strategy: Too many bins after add; manager check bin slippage and call rebalance',
  );

  Storage.set(ACTIVE_BINS, nativeTypeArrayToBytes(_activeBins));
  Storage.set(LAST_ADD, u64ToBytes(Context.timestamp()));
  // Emit an event.
  const event = createEvent('ADD_LIQUIDITY', [
    Context.caller().toString(),
    u256ToString(amountX),
    u256ToString(amountY),
    u256ToString(liquidtyMintedHolder),
  ]);
  generateEvent(event);
}

function _removeLiquidity(denominator: u256): Amounts {
  let activeBinIds = getActiveBins();
  let amounts = new Array<u256>(activeBinIds.length).fill(u256.Zero);

  // let totalXBalanceWithdrawn: u64 = 0;
  // let totalYBalanceWithdrawn: u64 = 0;
  const pair = getPair();
  const router = getRouter();

  // To figure out amountXMin and amountYMin, we calculate how much X and Y underlying we have as liquidity.
  for (let i: i32 = 0; i < activeBinIds.length; i++) {
    // Amount of LBToken in each active bin.

    let LBTokenAmount = u256.Zero;

    if (denominator == PRECISION) {
      LBTokenAmount = pair.balanceOf(Context.callee(), activeBinIds[i]);
    } else {
      LBTokenAmount = u256.div(
        u256.mul(
          u256.from(PRECISION),
          pair.balanceOf(Context.callee(), activeBinIds[i]),
        ),
        u256.from(denominator),
      );
    }

    amounts[i] = LBTokenAmount;
    // let bin = pair.getBin(activeBinIds[i] as u32);

    // totalXBalanceWithdrawn = u256
    //     .add(totalXBalanceWithdrawn,
    //     .div(
    //         u256.mul(LBTokenAmount, bin.reserveX),
    //         pair.totalSupply(activeBinIds[i]),
    //     ));
    //     //utile ?
    // totalYBalanceWithdrawn = u256
    //     .add(totalYBalanceWithdrawn,
    //     .div(
    //         u256.mul(LBTokenAmount, bin.reserveY),
    //         pair.totalSupply(activeBinIds[i]),
    //     ));
    //     //utile ?
  }

  // Remove the liquidity required.
  let removeReturn = router.removeLiquidity(
    getTokenX()._origin,
    getTokenY()._origin,
    bytesToU32(Storage.get(BINSTEP)), // u32???
    u256.Zero,
    u256.Zero,
    activeBinIds,
    amounts,
    Context.callee(),
    Context.timestamp() + 1,
    0,
  );

  // Remove the ID's from the user set. This needs to occur if we are withdrawing all liquidity or if we are rebalancing not each time liquidity is withdrawn.
  if (denominator == PRECISION) {
    let _activeBins: u64[] = [];
    Storage.set(ACTIVE_BINS, nativeTypeArrayToBytes(_activeBins));
  }

  // Emit event.
  const event = createEvent('REMOVE_LIQUIDITY', [
    Context.caller().toString(),
    u256ToString(removeReturn.amountX),
    u256ToString(removeReturn.amountY),
  ]);
  generateEvent(event);

  return removeReturn;
}

function _giveAllowances(): void {
  let MAX_INT = u256.Max;
  let tokenX = getTokenX();
  let tokenY = getTokenY();
  let pair = getPair();
  let router = getRouter()._origin;
  const feeManager = getFeeManager();

  tokenX.increaseAllowance(router, MAX_INT);
  tokenY.increaseAllowance(router, MAX_INT);

  tokenX.increaseAllowance(feeManager.vault, MAX_INT);
  tokenY.increaseAllowance(feeManager.vault, MAX_INT);

  // Provide required lb token approvals.
  pair.setApprovalForAll(true, router, 0);
}

function _removeAllowances(): void {
  let MAX_INT = u256.Max;
  let tokenX = getTokenX();
  let tokenY = getTokenY();
  let pair = getPair();
  let router = getRouter()._origin;
  const feeManager = getFeeManager();

  tokenX.decreaseAllowance(router, MAX_INT);
  tokenY.decreaseAllowance(router, MAX_INT);

  tokenX.decreaseAllowance(feeManager.vault, MAX_INT);
  tokenY.decreaseAllowance(feeManager.vault, MAX_INT);

  // Revoke required lb token approvals.
  pair.setApprovalForAll(false, router, 0);
}

function _swap(amountIn: u256, _swapForY: bool): void {
  //const pair = getPair();
  // const activeId = pair.getPairInformation().activeId;
  // const time1 = 300; //5 minutes;
  // const time2 = 600; //10 minutes;
  // const binMedium =
  //     (((pair.getOracleSampleFrom(time1).cumulativeId as i64) -
  //         (pair.getOracleSampleFrom(time2).cumulativeId as i64)) as u64) /
  //     (time2 - time1);
  // const binstep = pair.feeParameters().binStep;
  // const priceNow = BinHelper.getPriceFromId(activeId, binstep);
  // const priceMedium = BinHelper.getPriceFromId(binMedium, binstep);

  let tokenPath = new Array<IERC20>(2);
  let tokenX = getTokenX();
  let tokenY = getTokenY();
  // Set the required token paths.
  if (_swapForY) {
    // Check if the price is within the bounds.
    //if (priceNow > u256.mul(priceMedium, u256.from(1.02))) return; //TODO: check is forY or not
    tokenPath[0] = tokenX;
    tokenPath[1] = tokenY;
  } else {
    // Check if the price is within the bounds.
    //if (priceNow < u256.mul(priceMedium, u256.from(0.98))) return; //TODO: check is forY or not
    tokenPath[0] = tokenY;
    tokenPath[1] = tokenX;
  }

  // Compute the required bin step.
  let binStep = bytesToU64(Storage.get(BINSTEP));
  let pairBinSteps: u64[] = [binStep];

  // Perform the swapping of tokens.
  let router = getRouter();

  router.swapExactTokensForTokens(
    amountIn,
    u256.Zero,
    pairBinSteps,
    tokenPath,
    Context.callee(),
    Context.timestamp() + 1,
    0,
  );
}

function _harvest(): Amounts {
  // Collects pending rewards.

  Storage.set(LAST_HARVEST, u64ToBytes(Context.timestamp()));

  return _collectRewards();
}

function _collectRewards(): Amounts {
  const before = _getTotalAmounts();

  const activeBinIds = _getActiveBinIds();

  const pair = getPair();

  const feesReturn = pair.collectFees(Context.callee(), activeBinIds, 0);

  if (feesReturn.amountX > u256.Zero || feesReturn.amountX > u256.Zero) {
    _chargeFees(feesReturn.amountX, feesReturn.amountY);
  }

  const after = _getTotalAmounts();

  const event = createEvent('FEE_COLLECTED', [
    bytesToU64(Storage.get(LAST_HARVEST)).toString(),
    u256ToString(before.amountX),
    u256ToString(before.amountY),
    u256ToString(after.amountX),
    u256ToString(after.amountY),
  ]);
  generateEvent(event);

  return new Amounts(feesReturn.amountX, feesReturn.amountY);
}

function _chargeFees(amountXReceived: u256, amountYReceived: u256): void {
  //TODO: change to onlyy dusa Fee
  const feeManager = getFeeManager();
  let balX = u256.div(
    u256.mul(amountXReceived, u256.from(feeManager.performanceFee)),
    u256.from(MAX_FEE),
  );
  let balY = u256.div(
    u256.mul(amountYReceived, u256.from(feeManager.performanceFee)),
    u256.from(MAX_FEE),
  );

  if (balX > u256.Zero) {
    getTokenX().transfer(feeManager.feeRecipient, balX);
  }
  if (balY > u256.Zero) {
    getTokenY().transfer(feeManager.feeRecipient, balY);
  }

  // Emit an event.
  const event = createEvent('FEE_TRANSFER', [
    u256ToString(balX),
    u256ToString(balY),
  ]);
  generateEvent(event);
}

function _checkDistribution(_distribution: u256[]): void {
  let total = u256.Zero;

  // Loop over the distribution provided and make sure to sum to PRECISION.
  for (let i: i32 = 0; i < _distribution.length; ++i) {
    total = u256.add(total, _distribution[i]);
  }
  assert(total == PRECISION, 'Strategy: Distribution incorrect');
}

/// -----------------------------------------------------------
/// External functions
/// -----------------------------------------------------------

export function earn(): StaticArray<u8> {
  const feeManager = getFeeManager();
  feeManager.onlyOwnerOrVault();

  let balanceX = getBalanceX();
  let balanceY = getBalanceY();

  // Gas saving check if there is idle funds in the contract.
  assert(
    balanceX >= u256.from(100_000) && balanceY >= u256.from(100_000),
    'Vault: Insufficient idle funds in strategy',
  );

  let deltaIds = bytesToNativeTypeArray<i64>(Storage.get(DELTA_IDS));
  // Require the amounts to be deposited into the correct bin distributions.
  let amounts = _calculateAmountsPerformSwap(deltaIds, balanceX, balanceY);

  // Use the funds in the strategy to add liquidty.
  if (amounts.amountX > u256.Zero || amounts.amountY > u256.Zero) {
    _addLiquidity(amounts.amountX, amounts.amountY, u256.Zero, u256.Zero);
  }

  return new Args().add(amounts.amountX).add(amounts.amountY).serialize();
}

export function removeLiquidity(bs: StaticArray<u8>): StaticArray<u8> {
  const denominator = new Args(bs).nextU256().unwrap();
  const feeManager = getFeeManager();

  assert(Context.caller() == feeManager.vault, 'Strategy: !vault');

  const r = _removeLiquidity(denominator);
  return new Args().add(r.amountX).add(r.amountY).serialize();
}

export function harvest(_: StaticArray<u8>): StaticArray<u8> {
  let r = _harvest();
  return new Args().add(r.amountX).add(r.amountY).serialize();
}

/// -----------------------------------------------------------
/// View functions
/// -----------------------------------------------------------

export function getActiveBinIds(): StaticArray<u8> {
  return nativeTypeArrayToBytes<u64>(_getActiveBinIds());
}

function _getActiveBinIds(): u64[] {
  let _userPositionNumber = _strategyPositionNumber() as i32;
  let activeBinIds = new Array<u64>(_userPositionNumber);

  for (let i: i32 = 0; i < _userPositionNumber; ++i) {
    let userPosition = _strategyPositionAtIndex(i);
    activeBinIds[i] = userPosition;
  }

  return activeBinIds;
}

export function getTotalAmounts(): StaticArray<u8> {
  const res = _getTotalAmounts();
  return new Args().add(res.amountX).add(res.amountY).serialize();
}

function _getTotalAmounts(): Amounts {
  const pair = getPair();

  // Add currently active tokens supplied as liquidity.
  let amounts = _getAmountsOf(Context.callee(), getActiveBins(), pair);

  // Add currently unused tokens.
  // @ts-ignore
  amounts.amountX += getBalanceX();
  // @ts-ignore
  amounts.amountY += getBalanceY();

  return amounts;
}

export function binHasXLiquidity(bs: StaticArray<u8>): StaticArray<u8> {
  return boolToByte(
    _binHasXLiquidity(new Args(bs).nextFixedSizeArray<i64>().unwrap()),
  );
}

function _binHasXLiquidity(_deltaIds: i64[]): bool {
  for (let i: i32 = 0; i < _deltaIds.length; i++) {
    if (_deltaIds[i] >= 0) {
      return true;
    }
  }
  return false;
}

export function binHasYLiquidity(bs: StaticArray<u8>): StaticArray<u8> {
  return boolToByte(
    _binHasYLiquidity(new Args(bs).nextFixedSizeArray<i64>().unwrap()),
  );
}

function _binHasYLiquidity(_deltaIds: i64[]): bool {
  for (let i: i32 = 0; i < _deltaIds.length; i++) {
    if (_deltaIds[i] <= 0) {
      return true;
    }
  }
  return false;
}

export function rewardsAvailable(bs: StaticArray<u8>): StaticArray<u8> {
  const _increasingBinIds = new Args(bs).nextFixedSizeArray<u64>().unwrap();

  assert(_increasingBinIds.length != 0, 'Strat: Supply valid ids');

  let pair = getPair();

  // Pending fees requires strictly increasing ids (require sorting off chain).
  const res = pair.pendingFees(Context.callee(), _increasingBinIds);
  return new Args().add(res.amountX).add(res.amountY).serialize();
}

function getBalanceX(): u256 {
  return getTokenX().balanceOf(Context.callee());
}

function getBalanceY(): u256 {
  return getTokenY().balanceOf(Context.callee());
}

/// -----------------------------------------------------------
/// Manager / Owner functions
/// -----------------------------------------------------------

export function retireStrat(): void {
  const feeManager = getFeeManager();
  feeManager.onlyOwnerOrVault();

  const pair = getPair();

  // Add currently active tokens supplied as liquidity.
  const amounts = _getAmountsOf(Context.callee(), getActiveBins(), pair);

  if (amounts.amountX > u256.Zero || amounts.amountY > u256.Zero) {
    _removeLiquidity(PRECISION);
  }

  const tokenX = getTokenX();
  const tokenY = getTokenY();

  const tokenXBal = tokenX.balanceOf(Context.callee());
  const tokenYBal = tokenY.balanceOf(Context.callee());

  tokenX.transfer(feeManager.vault, tokenXBal);
  tokenY.transfer(feeManager.vault, tokenYBal);
}

export function panic(): void {
  const feeManager = getFeeManager();
  feeManager.onlyOwnerOrVault();
  stop([]);

  const pair = getPair();

  // Add currently active tokens supplied as liquidity.
  const amounts = _getAmountsOf(Context.callee(), getActiveBins(), pair);

  // If there is liquidity remove it from dex and hold in strat.
  if (amounts.amountX > u256.Zero || amounts.amountY > u256.Zero) {
    _removeLiquidity(PRECISION);
  }
}

export function setPerformanceFee(bs: StaticArray<u8>): void {
  const feeManager = getFeeManager();
  feeManager.setPerformanceFee(bs);
  updateFeeManager(feeManager);
}

export function setFeeRecipient(bs: StaticArray<u8>): void {
  const feeManager = getFeeManager();
  feeManager.setFeeRecipient(bs);
  updateFeeManager(feeManager);
}

export function setOwner(bs: StaticArray<u8>): void {
  const feeManager = getFeeManager();
  feeManager.setOwner(bs);
  updateFeeManager(feeManager);
}

/// -----------------------------------------------------------
/// Rebalance functions
/// -----------------------------------------------------------

export function executeRebalance(bs: StaticArray<u8>): StaticArray<u8> {
  const feeManager = getFeeManager();
  feeManager.onlyOwnerOrVault();

  const args = new Args(bs);
  const deltaIds = args.nextFixedSizeArray<i64>().unwrap();
  const distributionX = args.nextFixedSizeArray<u256>().unwrap();
  const distributionY = args.nextFixedSizeArray<u256>().unwrap();
  const idSlippage = args.nextU64().unwrap();

  // Update the strategy params.
  Storage.set(DELTA_IDS, nativeTypeArrayToBytes(deltaIds));
  Storage.set(DISTRIBUTION_X, fixedSizeArrayToBytes(distributionX));
  Storage.set(DISTRIBUTION_Y, fixedSizeArrayToBytes(distributionY));
  Storage.set(IDSLIPPAGE, u64ToBytes(idSlippage));

  const res = _executeRebalance(
    deltaIds,
    distributionX,
    distributionY,
    idSlippage,
  );
  return new Args().add(res.amountX).add(res.amountY).serialize();
}

function _executeRebalance(
  _deltaIds: i64[],
  _distributionX: u256[],
  _distributionY: u256[],
  _idSlippage: u64,
): Amounts {
  // Ensure that we are keeping to the 50 bin limit.
  assert(_deltaIds.length < 50, 'Strategy: Bins shall be limited to <50');

  // Check parameters are equal in length.
  assert(
    _deltaIds.length == _distributionX.length &&
      _distributionX.length == _distributionY.length,
    'Strategy: Unbalanced params',
  );

  // Check the distributions are correct.
  if (_binHasXLiquidity(_deltaIds)) {
    _checkDistribution(_distributionX);
  }

  if (_binHasYLiquidity(_deltaIds)) {
    _checkDistribution(_distributionY);
  }

  // Harvest any pending fees. This may save strategy from performing a swap of tokens.
  _collectRewards();

  const before = _getTotalAmounts();

  // Remove any liquidity from joeRouter and clear active bins set.
  if (_strategyPositionNumber() > 0) {
    _removeLiquidity(PRECISION);
  }

  let calculatedAmounts = new Amounts(u256.Zero, u256.Zero);
  // Calculate new amounts to deposit if existing deposits.
  if (before.amountX > u256.Zero || before.amountY > u256.Zero) {
    calculatedAmounts = _calculateAmountsPerformSwap(
      _deltaIds,
      getTokenX().balanceOf(Context.callee()),
      getTokenY().balanceOf(Context.callee()),
    );
  }

  // Only add liquidity if strategy has funds.
  if (
    calculatedAmounts.amountX > u256.Zero ||
    calculatedAmounts.amountY > u256.Zero
  ) {
    _addLiquidity(
      calculatedAmounts.amountX,
      calculatedAmounts.amountY,
      u256.Zero,
      u256.Zero,
    );
  }

  const amounts = _getTotalAmounts();

  // Emit event
  const event = createEvent('REBALANCE', []);
  generateEvent(event);

  return amounts;
}

function _calculateAmountsPerformSwap(
  _deltaIds: i64[],
  _amountX: u256,
  _amountY: u256,
): Amounts {
  let amountX = u256.Zero;
  let amountY = u256.Zero;
  const tokenX = getTokenX();
  const tokenY = getTokenY();
  const callee = Context.callee();
  // Only token y liquidity.
  if (!_binHasXLiquidity(_deltaIds) && _binHasYLiquidity(_deltaIds)) {
    // Swap X for Y.
    _swap(_amountX, true);
    amountY = tokenY.balanceOf(callee);
    amountX = u256.Zero;
  }

  // Only token x liquidity.
  if (!_binHasXLiquidity(_deltaIds) && _binHasYLiquidity(_deltaIds)) {
    // Swap Y for X.
    _swap(_amountY, false);
    amountX = tokenX.balanceOf(callee);
    amountY = u256.Zero;
  }

  // If has both token x and token y liquidity.
  if (_binHasXLiquidity(_deltaIds) && _binHasYLiquidity(_deltaIds)) {
    // If bins move too much we need to swap for both. We want to minimise
    // the swap amounts limit to 1% used to seed bins with a minimal amount
    // of liquidity to reduce swap fee and slippage.
    if (_amountX.isZero()) {
      // Swap y for x (minimise amount, only to seed liquidity).
      _swap(u256.div(_amountY, u256.from(100)), false);
    }

    if (_amountY.isZero()) {
      // Swap x for y (minimise amount, only to seed liquidity).
      _swap(u256.div(_amountX, u256.from(100)), true);
    }

    // Set the final amounts for deposits.
    amountX = tokenX.balanceOf(callee);
    amountY = tokenY.balanceOf(callee);
  }

  return new Amounts(amountX, amountY);
}

/// -----------------------------------------------------------
/// Automation functions
/// -----------------------------------------------------------
export function stop(_: StaticArray<u8>): void {
  const feeManager = getFeeManager();
  feeManager.onlyOwnerOrVault();

  Storage.set(IS_ON, [0]);
  _removeAllowances();

  generateEvent('Stop automatisation of the SC');
}

/**
 * @notice Start the contract automation
 * @param _ unused see https://github.com/massalabs/massa-sc-std/issues/18
 */
export function start(_: StaticArray<u8>): void {
  const feeManager = getFeeManager();
  feeManager.onlyOwnerOrVault();

  Storage.set(IS_ON, bTrue);
  _giveAllowances();

  sendAsyncMessage(Context.currentPeriod() + 1);

  generateEvent('Start automatisation of the SC');
}

export function advance(_: StaticArray<u8>): void {
  onlyAutonomous();
  assert(byteToBool(Storage.get(IS_ON)), 'Automation is not started');

  if (checkUpkeep()) performUpkeep();

  const balanceX = getTokenX().balanceOf(Context.callee());
  const balanceY = getTokenY().balanceOf(Context.callee());

  // Gas saving check if there is idle funds in the contract.
  if (balanceX > u256.from(100_000_000) && balanceY > u256.from(100_000_000)) {
    // TODO: problem value plutot en dollars ? and && ou ||
    const deltaIds = bytesToNativeTypeArray<i64>(Storage.get(DELTA_IDS));
    // Require the amounts to be deposited into the correct bin distributions.
    const amounts = _calculateAmountsPerformSwap(deltaIds, balanceX, balanceY);

    // Use the funds in the strategy to add liquidty.
    if (amounts.amountX > u256.Zero || amounts.amountY > u256.Zero) {
      _addLiquidity(amounts.amountX, amounts.amountY, u256.Zero, u256.Zero);
    }
  }

  const nextPeriod = Context.currentPeriod() + PERIODS_PER_HOUR; //TODO : change to every hour
  sendAsyncMessage(nextPeriod);
}

function checkUpkeep(): bool {
  // Get active bins from strategy
  let activeBins = getActiveBins();
  if (activeBins.length < 2) return false;
  const centerOffset = bytesToU64(Storage.get(CENTER_OFFSET));
  const binOffset = bytesToU64(Storage.get(BIN_OFFSET));
  const isPendingRebalance = byteToBool(Storage.get(IS_PENDING_REBALANCE));
  const rebalanceTimestamp = bytesToU64(Storage.get(REBALANCE_TIMESTAMP));
  const isTokenYWeighted = byteToBool(Storage.get(IS_TOKEN_Y_WEIGHTED));
  const isTokenXWeighted = byteToBool(Storage.get(IS_TOKEN_X_WEIGHTED));
  const lastHarvestTimestamp = bytesToU64(Storage.get(LAST_HARVEST));

  // Get min and max active bins
  const binInfo = _checkMinMaxActiveBins(activeBins);

  //get activeId & mediumId
  const pair = getPair();
  const activeId = pair.getPairInformation().activeId;
  const time1 = 120; //2 minutes;
  const time2 = 300; //5 minutes;
  const binMedium =
    (((pair.getOracleSampleFrom(time1).cumulativeId as i64) -
      (pair.getOracleSampleFrom(time2).cumulativeId as i64)) as u64) /
    (time2 - time1);

  // Get center bin
  const binLength: u64 = activeBins.length;
  const centerBin: u64 = binLength / 2;
  const minCenterBin = activeBins[(centerBin - centerOffset) as i32];
  const maxCenterBin = activeBins[(centerBin + centerOffset) as i32];

  // Check rebalance cases
  if (
    isPendingRebalance &&
    Context.timestamp() >= rebalanceTimestamp + rebalanceDelay
  ) {
    return true;
  }
  //if the strategy has come back into range remove the volatility params
  else if (
    isPendingRebalance &&
    activeId >= binInfo.minBin + binOffset &&
    activeId <= binInfo.maxBin - binOffset &&
    binMedium >= binInfo.minBin + binOffset &&
    binMedium <= binInfo.maxBin - binOffset
  ) {
    return true;
  }
  //else if the strategy is lopsided we should try to balance towards the center
  else if (
    (isTokenYWeighted &&
      activeId <= minCenterBin &&
      binMedium <= minCenterBin) ||
    (isTokenXWeighted && activeId >= maxCenterBin && binMedium >= maxCenterBin)
  ) {
    return true;
  }
  //else if the strategy is near to going out of range start the time rebalance flow
  else if (
    (activeId <= binInfo.minBin + binOffset &&
      binMedium <= binInfo.minBin + binOffset) ||
    (activeId >= binInfo.maxBin - binOffset &&
      binMedium >= binInfo.maxBin - binOffset)
  ) {
    return true;
  } else if (Context.timestamp() >= lastHarvestTimestamp + harvestDelay) {
    // Only harvest needed
    return true;
  }

  return false;
}

function performUpkeep(): void {
  // Get active bins from strategy
  const activeBins = getActiveBins();
  // Get min and max active bins
  const binInfo = _checkMinMaxActiveBins(activeBins);
  const centerOffset = bytesToU64(Storage.get(CENTER_OFFSET));
  const binOffset = bytesToU64(Storage.get(BIN_OFFSET));
  const isPendingRebalance = byteToBool(Storage.get(IS_PENDING_REBALANCE));
  const rebalanceTimestamp = bytesToU64(Storage.get(REBALANCE_TIMESTAMP));
  const lastHarvestTimestamp = bytesToU64(Storage.get(LAST_HARVEST));

  // Get center bin
  const binLength: u64 = activeBins.length;
  const centerBin = binLength / 2;
  const minCenterBin = activeBins[(centerBin - centerOffset) as i32];
  const maxCenterBin = activeBins[(centerBin + centerOffset) as i32];

  // Get active ID from LB pair
  const lbPair = new Address(Storage.get('PAIR'));
  let activeId = new IPair(lbPair).getPairInformation().activeId;

  // Check rebalance cases
  if (
    isPendingRebalance &&
    Context.timestamp() >= rebalanceTimestamp + rebalanceDelay
  ) {
    // Out of range and enough delay
    if (activeId <= binInfo.minBin + binOffset) {
      // Token X weighted
      Storage.set(IS_TOKEN_X_WEIGHTED, bTrue);
      Storage.set(IS_TOKEN_Y_WEIGHTED, bFalse);
    }
    if (activeId >= binInfo.maxBin - binOffset) {
      // Token Y weighted
      Storage.set(IS_TOKEN_X_WEIGHTED, bFalse);
      Storage.set(IS_TOKEN_Y_WEIGHTED, bTrue);
    }
    _rebalance();
  }
  // Remove volatility params if in range
  else if (
    isPendingRebalance &&
    activeId >= binInfo.minBin + binOffset &&
    activeId <= binInfo.maxBin - binOffset
  ) {
    // Reset volatility params
    Storage.set(REBALANCE_TIMESTAMP, u64ToBytes(0));
    Storage.set(IS_PENDING_REBALANCE, bFalse);
  }
  // Rebalance if lopsided
  else if (
    (activeId <= minCenterBin &&
      byteToBool(Storage.get(IS_TOKEN_Y_WEIGHTED))) ||
    (activeId >= maxCenterBin && byteToBool(Storage.get(IS_TOKEN_X_WEIGHTED)))
  ) {
    // Reset weighting switch
    Storage.set(IS_TOKEN_X_WEIGHTED, bFalse);
    Storage.set(IS_TOKEN_Y_WEIGHTED, bFalse);

    _harvest();
    _rebalance();
  }
  // Start rebalance timer if near out of range
  else if (
    activeId <= binInfo.minBin + binOffset ||
    activeId >= binInfo.maxBin - binOffset
  ) {
    // Start pending rebalance timer
    Storage.set(REBALANCE_TIMESTAMP, u64ToBytes(Context.timestamp()));
    Storage.set(IS_PENDING_REBALANCE, bTrue);
  } else if (Context.timestamp() >= lastHarvestTimestamp + harvestDelay) {
    // Only harvest needed
    _harvest();
  }
}

function _rebalance(): void {
  // Rebalance with same params
  const deltaIds = bytesToNativeTypeArray<i64>(Storage.get(DELTA_IDS));
  const distributionX = bytesToFixedSizeArray<u256>(
    Storage.get(DISTRIBUTION_X),
  );
  const distributionY = bytesToFixedSizeArray<u256>(
    Storage.get(DISTRIBUTION_Y),
  );
  const idSlippage = bytesToU64(Storage.get(IDSLIPPAGE));
  _executeRebalance(deltaIds, distributionX, distributionY, idSlippage);

  // Reset params
  Storage.set(REBALANCE_TIMESTAMP, u64ToBytes(0));
  Storage.set(IS_PENDING_REBALANCE, bFalse);
}

class MinMaxActiveBins {
  constructor(
    public minBin: u64,
    public maxBin: u64,
  ) {}
}

function _checkMinMaxActiveBins(activeBins: u64[]): MinMaxActiveBins {
  // Set min bin to first item
  let minBin: u64 = u64.MAX_VALUE;
  let maxBin: u64 = 0;

  for (let i = 0; i < activeBins.length; i++) {
    if (activeBins[i] < minBin) {
      minBin = activeBins[i];
    }
    if (activeBins[i] > maxBin) {
      maxBin = activeBins[i];
    }
  }

  return new MinMaxActiveBins(minBin, maxBin);
}

// HELPERS

function updateFeeManager(fm: FeeManager): void {
  Storage.set(FEES_MANAGERS, fm.serialize());
}

function getFeeManager(): FeeManager {
  return new Args(Storage.get(FEES_MANAGERS))
    .nextSerializable<FeeManager>()
    .unwrap();
}

function getPair(): IPair {
  return new IPair(new Address(Storage.get('PAIR')));
}

function getRouter(): IRouter {
  return new IRouter(new Address(Storage.get('ROUTER')));
}

function getTokenX(): IERC20 {
  return new IERC20(new Address(Storage.get('TOKEN_X')));
}

function getTokenY(): IERC20 {
  return new IERC20(new Address(Storage.get('TOKEN_Y')));
}

function getActiveBins(): u64[] {
  return bytesToNativeTypeArray<u64>(Storage.get(ACTIVE_BINS));
}

function sendAsyncMessage(nextPeriod: u64): void {
  const nextThread = Context.currentThread();
  sendMessage(
    Context.callee(),
    'advance',
    nextPeriod,
    nextThread,
    nextPeriod + 1_000,
    nextThread,
    700_000_000,
    0,
    0,
    [],
  );
}
