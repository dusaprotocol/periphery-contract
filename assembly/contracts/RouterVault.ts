import { Address, Context, Storage } from '@massalabs/massa-as-sdk';
import { Args } from '@massalabs/as-types';
import { u256 } from 'as-bignum/assembly/integer/u256';
import { IVault } from '../interfaces/IVault';
import { IERC20, IWMAS, _sortTokens } from '@dusalabs/core';
import { transferredCoins } from '@massalabs/massa-as-sdk/assembly/std/context';
import {
  onlyOwner,
  setOwner,
} from '@massalabs/sc-standards/assembly/contracts/utils/ownership';
import { WMAS, VAULTS } from '../storage/routerVault';

// TODO : use struct for returns
// TODO : add transferOwnership -> use massa owner standard

// ===============================================================
// ====================  CONSTRUCTOR  ============================
// ===============================================================

// TEMP
export { recover, upgrade } from './Upgradeable';

export function constructor(bs: StaticArray<u8>): void {
  const wmas = new Address(new Args(bs).nextString().unwrap());
  Storage.set(WMAS, wmas.toString());
  setOwner(new Args().add(Context.caller()).serialize());
}

/// -----------------------------------------------------------
/// Public functions
/// -----------------------------------------------------------

export function deposit(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const tokenX = new Address(args.nextString().unwrap());
  const tokenY = new Address(args.nextString().unwrap());
  const type = args.nextU64().unwrap();
  const amountX = args.nextU256().unwrap();
  const amountY = args.nextU256().unwrap();
  const amountXMin = args.nextU256().unwrap();
  const amountYMin = args.nextU256().unwrap();

  const vault = getVault(tokenX, tokenY, type);

  assert(!amountX.isZero() || !amountY.isZero(), 'Vault: deposit cannot be 0');

  //transfer tokens required into the strategy
  if (amountX > u256.Zero) {
    new IERC20(tokenX).transferFrom(Context.caller(), vault._origin, amountX);
  }
  if (amountY > u256.Zero) {
    new IERC20(tokenY).transferFrom(Context.caller(), vault._origin, amountY);
  }

  return _deposit(
    vault,
    amountXMin,
    amountYMin,
    tokenX.equals(vault.tokenX()._origin),
  );
}

//TODO reverse order in return if needed
export function depositMAS(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const tokenX = new Address(args.nextString().unwrap());
  const tokenY = new Address(args.nextString().unwrap());
  const type = args.nextU64().unwrap();
  const amountY = args.nextU256().unwrap();
  const amountXMin = args.nextU256().unwrap();
  const amountYMin = args.nextU256().unwrap();
  assert(tokenX.equals(getWMAS()._origin), 'tokenX must be WMAS');
  const tokens = _sortTokens(tokenX, tokenY);
  const vault = getVault(tokens.token0, tokens.token1, type);

  const amountX = transferredCoins();

  assert(amountX != 0 || !amountY.isZero(), 'Vault: deposit cannot be 0');

  if (amountX > 0) {
    const wmas = getWMAS();
    wmas.deposit(amountX);
    wmas.transfer(vault._origin, u256.from(amountX));
  }
  if (amountY > u256.Zero) {
    new IERC20(tokenY).transferFrom(Context.caller(), vault._origin, amountY);
  }

  return _deposit(
    vault,
    amountXMin,
    amountYMin,
    tokens.token0.notEqual(tokenX),
  );
}

function _deposit(
  vault: IVault,
  amountXMin: u256,
  amountYMin: u256,
  inverse: bool,
): StaticArray<u8> {
  const r = vault.deposit(Context.caller());

  const cond3 = inverse
    ? r.amountYAdded < amountXMin || r.amountXAdded < amountYMin
    : r.amountXAdded < amountXMin || r.amountYAdded < amountYMin;
  //TODO: inverse in events
  assert(
    !cond3,
    `RouterVault__AmountSlippageCaught 
      ${amountXMin},
      ${r.amountXAdded},
      ${amountYMin},
      ${r.amountYAdded}`,
  );

  return new Args()
    .add(r.shares)
    .add(r.amountXAdded)
    .add(r.amountYAdded)
    .serialize();
}

export function withdrawAll(bs: StaticArray<u8>): void {
  const args = new Args(bs);
  const tokenX = new Address(args.nextString().unwrap());
  const tokenY = new Address(args.nextString().unwrap());
  const type = args.nextU64().unwrap();
  const vault = getVault(tokenX, tokenY, type);
  _withdraw(
    vault,
    vault.balanceOf(Context.caller()),
    Context.caller(),
    Context.caller(),
  );
}

export function withdraw(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const tokenX = new Address(args.nextString().unwrap());
  const tokenY = new Address(args.nextString().unwrap());
  const type = args.nextU64().unwrap();
  const _shares = args.nextU256().unwrap();
  const vault = getVault(tokenX, tokenY, type);

  return new Args()
    .add(_withdraw(vault, _shares, Context.caller(), Context.caller()))
    .serialize();
}

export function withdrawAllMAS(bs: StaticArray<u8>): void {
  const caller = Context.caller();
  const args = new Args(bs);
  const tokenX = new Address(args.nextString().unwrap());
  const wmas = getWMAS();
  const type = args.nextU64().unwrap();

  const tokens = _sortTokens(tokenX, wmas._origin);
  const vault = getVault(tokens.token0, tokens.token1, type);
  const res = _withdraw(
    vault,
    vault.balanceOf(caller),
    Context.caller(),
    Context.callee(),
  );
  _sendWithdrawnToCaller(vault, wmas, res, caller);
}

export function withdrawMAS(bs: StaticArray<u8>): StaticArray<u8> {
  const caller = Context.caller();
  const args = new Args(bs);
  const tokenX = new Address(args.nextString().unwrap());
  const wmas = getWMAS();
  const type = args.nextU64().unwrap();
  const _shares = args.nextU256().unwrap();
  const tokens = _sortTokens(tokenX, wmas._origin);
  const vault = getVault(tokens.token0, tokens.token1, type);
  const res = _withdraw(vault, _shares, Context.caller(), Context.callee());
  _sendWithdrawnToCaller(vault, wmas, res, caller);
  //TODO: inverse res if !isMASTokenY
  return new Args().add(res).serialize();
}

function _withdraw(
  vault: IVault,
  _shares: u256,
  from: Address,
  to: Address,
): u256[] {
  vault.transferFrom(from, vault._origin, _shares);

  //TODO: add check min amountOut
  return vault.withdraw(to);
}

/**
 * Forward both withdrawn tokens to the caller: unwrap the WMAS side as MAS
 * and transfer the other token as is (it was previously left in the router).
 * @param res amounts withdrawn from the vault, [amountX, amountY]
 */
function _sendWithdrawnToCaller(
  vault: IVault,
  wmas: IWMAS,
  res: u256[],
  caller: Address,
): void {
  const isMASTokenY = wmas._origin.equals(vault.tokenY()._origin);
  const amountMas = isMASTokenY ? res[1] : res[0];
  const amountOther = isMASTokenY ? res[0] : res[1];
  const otherToken = isMASTokenY ? vault.tokenX() : vault.tokenY();

  wmas.withdraw(amountMas.toU64(), caller);
  if (amountOther > u256.Zero) otherToken.transfer(caller, amountOther);
}

export function addVault(bs: StaticArray<u8>): void {
  onlyOwner();

  const args = new Args(bs);
  const tokenA = new Address(args.nextString().unwrap());
  const tokenB = new Address(args.nextString().unwrap());
  const type = args.nextU64().unwrap();
  const vault = args.nextString().unwrap();
  const tokens = _sortTokens(tokenA, tokenB);

  const key = buildVaultKey(tokens.token0, tokens.token1, type);
  assert(!VAULTS.contains(key), 'vault already exists');
  VAULTS.set(key, vault);
}

// HELPERS

function getVault(tokenA: Address, tokenB: Address, type: u64): IVault {
  return new IVault(
    new Address(
      VAULTS.getSome(buildVaultKey(tokenA, tokenB, type), 'vault not found'),
    ),
  );
}

function buildVaultKey(tokenA: Address, tokenB: Address, type: u64): string {
  return tokenA.toString() + tokenB.toString() + type.toString();
}

function getWMAS(): IWMAS {
  return new IWMAS(new Address(Storage.get(WMAS)));
}
