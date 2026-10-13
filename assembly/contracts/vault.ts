import {
  Address,
  Context,
  Storage,
  generateEvent,
  sendMessage,
} from '@massalabs/massa-as-sdk';
import {
  Args,
  byteToBool,
  bytesToU256,
  bytesToU64,
  u256ToBytes,
  u64ToBytes,
} from '@massalabs/as-types';
import { u256 } from 'as-bignum/assembly/integer/u256';
import {
  IERC20,
  IPair,
  Math512Bits,
  PRECISION,
  u256ToString,
  createEvent,
} from '@dusalabs/core';
import { ILBStrategy } from '../interfaces';
import { onlyAutonomous } from '../helpers/utils';
import { IS_ON, LAST_HARVEST, harvestDelay } from '../storage/LBStrategy';
import { StratCandidate } from '../structs';
import {
  APPROVAL_DELAY,
  STRATEGY,
  STRAT_CANDIDATE,
  TOKEN_X,
  TOKEN_Y,
} from '../storage/vault';

// TODO : add solidiy like events
// TODO : use struct for returns
// TODO : add transferOwnership -> use massa owner standard
// TODO : add automatisation of strategy choice

// ===============================================================
// ======================  ERC20  ================================
// ===============================================================

import {
  totalSupply,
  constructor as _constructor,
} from '@massalabs/sc-standards/assembly/contracts/FT';
import {
  _balance,
  _setBalance,
} from '@massalabs/sc-standards/assembly/contracts/FT/token-internals';
import { onlyOwner } from '@massalabs/sc-standards/assembly/contracts/utils/ownership';
import {
  _mint,
  _increaseTotalSupply,
} from '@massalabs/sc-standards/assembly/contracts/FT/mintable/mint-internal';
import {
  _burn,
  _decreaseTotalSupply,
} from '@massalabs/sc-standards/assembly/contracts/FT/burnable/burn-internal';
import { setOwner } from '@massalabs/sc-standards/assembly/contracts/utils/ownership';
import { Amounts } from '@dusalabs/core/assembly/structs/Returns';

export * from '@massalabs/sc-standards/assembly/contracts/FT/token';

// ===============================================================
// ====================  CONSTRUCTOR  ============================
// ===============================================================

// TEMP
export { recover, upgrade } from './Upgradeable';

export function constructor(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  Storage.set(APPROVAL_DELAY, u64ToBytes(args.nextU64().unwrap()));

  Storage.set(TOKEN_X, args.nextString().unwrap());
  Storage.set(TOKEN_Y, args.nextString().unwrap());
  const args2 = new Args()
    .add(args.nextString().unwrap())
    .add(args.nextString().unwrap())
    .add(args.nextU8().unwrap())
    .add(u256.Zero);
  _constructor(args2.serialize());

  setOwner(new Args().add(Context.caller()).serialize());
}

/// -----------------------------------------------------------
/// Public functions
/// -----------------------------------------------------------

export function deposit(bs: StaticArray<u8>): StaticArray<u8> {
  const to = new Address(new Args(bs).nextString().unwrap());

  const tokenX: IERC20 = getTokenX();
  const tokenY: IERC20 = getTokenY();

  const amountX = tokenX.balanceOf(Context.callee());
  const amountY = tokenY.balanceOf(Context.callee());

  assert(!amountX.isZero() || !amountY.isZero(), 'Vault: deposit cannot be 0');
  const strategy = getStrategy();
  //harvest any pending rewards to prevent flash theft of yield

  if (!bytesToU256(totalSupply([])).isZero()) {
    strategy.harvest();
  }
  // Calculate amounts proportional to vault's holdings
  const res = calcSharesAndAmounts(amountX, amountY);
  const shares = res[0];
  const amountXActual = res[1];
  const amountYActual = res[2];

  assert(!shares.isZero(), 'shares');

  //transfer tokens required into the strategy

  if (amountXActual > u256.Zero) {
    strategy.tokenX().transfer(strategy._origin, amountXActual);
  }
  if (amountYActual > u256.Zero) {
    strategy.tokenY().transfer(strategy._origin, amountYActual);
  }

  // _increaseTotalSupply is called within _mint
  _mint(new Args().add(to).add(shares).serialize());

  if (amountX > amountXActual) {
    tokenX.transfer(to, u256.sub(amountX, amountXActual));
  }

  if (amountY > amountYActual) {
    tokenY.transfer(to, u256.sub(amountY, amountYActual));
  }

  const event = createEvent('DEPOSIT', [
    Context.caller().toString(),
    u256ToString(amountXActual),
    u256ToString(amountYActual),
    u256ToString(shares),
  ]);
  generateEvent(event);

  return new Args()
    .add(shares)
    .add(amountXActual)
    .add(amountYActual)
    .serialize();
}

export function withdrawAll(): void {
  withdraw(u256ToBytes(_balance(Context.caller())));
}

export function withdraw(bs: StaticArray<u8>): StaticArray<u8> {
  const _to = new Address(new Args(bs).nextString().unwrap());
  const _shares = _balance(Context.callee());

  assert(!_shares.isZero(), 'Vault: burn 0 not allowed');

  //fetch the total supply of receipt tokens
  let _totalSupply = bytesToU256(totalSupply([]));
  //Burn the shares that are being returned
  _decreaseTotalSupply(_shares);
  _burn(Context.callee(), _shares);

  const strategy = getStrategy();
  // Calculate token amounts proportional to unused balances
  let unusedAmountX = u256.div(
    u256.mul(strategy.getBalanceX(), _shares),
    _totalSupply,
  );
  let unusedAmountY = u256.div(
    u256.mul(strategy.getBalanceY(), _shares),
    _totalSupply,
  );
  let amountReturn = _getAmountsOf(
    strategy._origin,
    strategy.strategyActiveBins(),
    strategy.pair(),
  );
  // unusedAmount is already the user's share of the idle balance:
  // only the deployed liquidity still needs to be scaled by _shares / _totalSupply
  let _amountXneeded = u256.add(
    unusedAmountX,
    u256.div(u256.mul(amountReturn.amountX, _shares), _totalSupply),
  );
  let _amountYneeded = u256.add(
    unusedAmountY,
    u256.div(u256.mul(amountReturn.amountY, _shares), _totalSupply),
  );
  if (_amountXneeded > unusedAmountX || _amountYneeded > unusedAmountY) {
    //if liquidity is deployed remove in the correct proportion
    let _amountX = u256.Zero;
    let _amountY = u256.Zero;
    if (amountReturn.amountX > u256.Zero || amountReturn.amountY > u256.Zero) {
      let removedDenominator = u256.div(
        u256.mul(u256.from(PRECISION), _totalSupply),
        _shares,
      );
      let r = strategy.removeLiquidity(removedDenominator);
      _amountX = r.amountX;
      _amountY = r.amountY;
    }
    // Sum up total amounts owed to recipient
    _amountXneeded = u256.add(unusedAmountX, _amountX);
    _amountYneeded = u256.add(unusedAmountY, _amountY);
  }
  //transfer tokens back to the user from the strategy
  if (_amountXneeded > u256.Zero) {
    strategy.tokenX().transferFrom(strategy._origin, _to, _amountXneeded);
  }
  if (_amountYneeded > u256.Zero) {
    strategy.tokenY().transferFrom(strategy._origin, _to, _amountYneeded);
  }
  //emit an event
  const event = createEvent('WITHDRAW', [
    _to.toString(),
    u256ToString(_amountXneeded),
    u256ToString(_amountYneeded),
    u256ToString(_shares),
  ]);
  generateEvent(event);

  //return
  return new Args().add(_amountXneeded).add(_amountYneeded).serialize();
}

/// -----------------------------------------------------------
/// View functions
/// -----------------------------------------------------------

function _getAmountsOf(user: Address, ids: u64[], pair: IPair): Amounts {
  let amountX = u256.Zero;
  let amountY = u256.Zero;

  for (let i = 0; i < ids.length; ++i) {
    const id = ids[i] as u32;

    const liquiditiy = pair.balanceOf(user, id);
    const bin = pair.getBin(id);
    const totalSupply = pair.totalSupply(id);

    amountX = u256.add(
      amountX,
      Math512Bits.mulDivRoundDown(liquiditiy, bin.reserveX, totalSupply),
    );
    amountY = u256.add(
      amountY,
      Math512Bits.mulDivRoundDown(liquiditiy, bin.reserveY, totalSupply),
    );
  }

  return new Amounts(amountX, amountY);
}

function calcSharesAndAmounts(
  amountXDesired: u256,
  amountYDesired: u256,
): u256[] {
  const strategy = getStrategy();
  let amountX = u256.Zero;
  let amountY = u256.Zero;
  let shares = u256.Zero;
  let _totalSupply = bytesToU256(totalSupply([]));
  //add currently active tokens supplied as liquidity
  let amountReturn = _getAmountsOf(
    strategy._origin,
    strategy.strategyActiveBins(),
    strategy.pair(),
  );
  //add currently unused tokens in the strategy

  let totalX = u256.add(amountReturn.amountX, strategy.getBalanceX());
  let totalY = u256.add(amountReturn.amountY, strategy.getBalanceY());

  // If total supply > 0, vault can't be empty
  assert(
    _totalSupply.isZero() || totalX > u256.Zero || totalY > u256.Zero,
    'Vault: Vault cannot be empty if totalSupply > 0',
  );
  if (_totalSupply.isZero()) {
    // For first deposit, just use the amounts desired
    amountX = amountXDesired;
    amountY = amountYDesired;
    shares = amountX > amountY ? amountX : amountY;
  } else if (totalX.isZero()) {
    amountY = amountYDesired;
    shares = u256.div(u256.mul(amountY, _totalSupply), totalY);
  } else if (totalY.isZero()) {
    amountX = amountXDesired;
    shares = u256.div(u256.mul(amountX, _totalSupply), totalX);
  } else {
    let cross =
      u256.mul(amountXDesired, totalY) < u256.mul(amountYDesired, totalX)
        ? u256.mul(amountXDesired, totalY)
        : u256.mul(amountYDesired, totalX);
    assert(cross != u256.Zero, 'cross');

    // Round up amounts
    amountX = u256.div(u256.sub(cross, u256.One), u256.add(totalY, u256.One));
    amountY = u256.div(u256.sub(cross, u256.One), u256.add(totalX, u256.One));
    shares = u256.div(u256.div(u256.mul(cross, _totalSupply), totalX), totalY);
  } //TODO: check errors less than amount wanted

  return [shares, amountX, amountY];
}

export function want(): StaticArray<u8> {
  const strategy = getStrategy();
  return new Args()
    .add(strategy.tokenX()._origin)
    .add(strategy.tokenY()._origin)
    .serialize();
}

export function getUnderlyingAssets(bs: StaticArray<u8>): StaticArray<u8> {
  let _shares = new Args(bs).nextU256().unwrap();
  let _totalSupply = bytesToU256(totalSupply([]));
  if (_totalSupply.isZero()) {
    return new Args().add(u256.Zero).add(u256.Zero).serialize();
  }
  const strategy = getStrategy();

  //add currently active tokens supplied as liquidity
  let amountReturn = _getAmountsOf(
    strategy._origin,
    strategy.strategyActiveBins(),
    strategy.pair(),
  );
  //add currently unused tokens in the strategy
  let totalX = u256.add(amountReturn.amountX, strategy.getBalanceX());
  let totalY = u256.add(amountReturn.amountY, strategy.getBalanceY());

  totalX = u256.div(u256.mul(totalX, _shares), _totalSupply);
  totalY = u256.div(u256.mul(totalY, _shares), _totalSupply);
  return new Args().add(totalX).add(totalY).serialize();
}

/// -----------------------------------------------------------
/// Owner functions
/// -----------------------------------------------------------

export function setStrategyAddress(bs: StaticArray<u8>): void {
  onlyOwner();

  assert(
    !Storage.has(STRATEGY) ||
      new Address(Storage.get(STRATEGY)).equals(new Address('0')),
    'Vault: Strategy already Set',
  );

  let _strategy = new Args(bs).nextString().unwrap();
  Storage.set(STRATEGY, _strategy);

  //emit an event
  const event = createEvent('UPGRADE_STRAT', [_strategy]);
  generateEvent(event);
}

export function proposeStrat(bs: StaticArray<u8>): void {
  onlyOwner();

  const _implementation = new Address(new Args(bs).nextString().unwrap());
  assert(
    Context.callee() == new ILBStrategy(_implementation).vault(),
    'Proposal not valid for this Vault',
  );
  let strategyCurrent = getStrategy();

  let strategyProposed = new ILBStrategy(_implementation);
  assert(
    strategyCurrent.tokenX().equals(strategyProposed.tokenX()),
    'Proposal: tokens X not match',
  );
  assert(
    strategyCurrent.tokenY().equals(strategyProposed.tokenY()),
    'Proposal: tokens Y not match',
  );

  Storage.set(
    STRAT_CANDIDATE,
    new StratCandidate(_implementation, Context.timestamp()).serialize(),
  );
  //emit an event
  const event = createEvent('NEW_STRAT_CANDIDATE', [
    _implementation.toString(),
  ]);
  generateEvent(event);
}

export function upgradeStrat(): void {
  onlyOwner();

  let strategy = getStrategy();

  let stratCandidate = new Args(Storage.get(STRAT_CANDIDATE))
    .nextSerializable<StratCandidate>()
    .unwrap();
  let _implementation = new ILBStrategy(stratCandidate.implementation);
  assert(_implementation._origin != new Address('0'), 'There is no candidate');
  assert(
    stratCandidate.proposedTime + bytesToU64(Storage.get(APPROVAL_DELAY)) <=
      Context.timestamp(),
    'Delay has not passed',
  );

  //emit an event
  const event = createEvent('UPGRADE_STRAT', [
    _implementation._origin.toString(),
  ]);
  generateEvent(event);

  strategy.retireStrat();
  strategy = _implementation;
  Storage.set(STRATEGY, strategy._origin.toString());
  Storage.set(
    STRAT_CANDIDATE,
    new StratCandidate(new Address('0'), 5000000000).serialize(),
  );

  let balanceX = strategy.tokenX().balanceOf(Context.callee());
  let balanceY = strategy.tokenY().balanceOf(Context.callee());

  if (balanceX > u256.Zero) {
    strategy.tokenX().transfer(strategy._origin, balanceX);
  }
  if (balanceY > u256.Zero) {
    strategy.tokenY().transfer(strategy._origin, balanceY);
  }
}

export function inCaseLBTokensGetStuck(bs: StaticArray<u8>): void {
  onlyOwner();

  let _lbToken = new IPair(new Address(new Args(bs).nextString().unwrap()));
  let _id = new Args(bs).nextU64().unwrap();

  let amount = _lbToken.balanceOf(Context.callee(), _id);
  _lbToken.safeTransferFrom(Context.callee(), Context.caller(), _id, amount, 0);
}

/// -----------------------------------------------------------
/// Automation functions
/// -----------------------------------------------------------

export function start(_: StaticArray<u8>): void {
  onlyOwner();

  let next_period = Context.currentPeriod() + 1_350; // 6h between check up
  let next_thread = Context.currentThread();

  sendMessage(
    Context.callee(),
    'advance',
    next_period,
    next_thread,
    next_period + 1_010, //a few period after LBStrategy automatisation
    next_thread,
    700_000_000,
    0,
    0,
    [],
  );

  generateEvent('Start automatisation of the SC');
}

export function advance(_: StaticArray<u8>): void {
  onlyAutonomous();
  assert(
    byteToBool(Storage.getOf(getStrategy()._origin, IS_ON)),
    'Automation is not started',
  );

  let next_period = Context.currentPeriod() + 1_350;
  let next_thread = Context.currentThread();

  if (checkLBStrategy()) next_period += 10;

  sendMessage(
    Context.callee(),
    'advance',
    next_period,
    next_thread,
    next_period + 1_000,
    next_thread,
    100_000_000,
    0,
    0,
    [],
  ); //6h bewteen check up
}

function checkLBStrategy(): bool {
  let strategy = getStrategy();
  let lastHarvest = bytesToU64(Storage.getOf(strategy._origin, LAST_HARVEST));
  let time = Context.timestamp();

  if (time > lastHarvest + harvestDelay + 100_000) {
    //Automatisation error, relaunch
    strategy.start();
    return true;
  }
  return false;
}

// HELPERS

function getStrategy(): ILBStrategy {
  return new ILBStrategy(new Address(Storage.get(STRATEGY)));
}

function getTokenX(): IERC20 {
  return new IERC20(new Address(Storage.get(TOKEN_X)));
}

function getTokenY(): IERC20 {
  return new IERC20(new Address(Storage.get(TOKEN_Y)));
}
