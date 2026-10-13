import { BinHelper, IPair, Math512Bits, SCALE_OFFSET } from '@dusalabs/core';
import { Amounts } from '@dusalabs/core/assembly/structs/Returns';
import { Args } from '@massalabs/as-types';
import { Address } from '@massalabs/massa-as-sdk';
import { u256 } from 'as-bignum/assembly/integer/u256';

/** Return the liquidities amounts received for a given amount of tokenX and tokenY
 * @param ids the list of ids where the user want to add liquidity, ids need to be in ascending order to assert uniqueness
 * @param binStep the binStep of the pair
 * @param amountX the amount of tokenX
 * @param amountY the amount of tokenY
 * @return liquidities the amounts of liquidity received
 */
export function getLiquiditiesForAmounts(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const ids = args.nextFixedSizeArray<u64>().unwrap();
  const binStep = args.nextU32().unwrap();
  const amountX = args.nextU256().unwrap();
  const amountY = args.nextU256().unwrap();

  const liquidities = _getLiquiditiesForAmounts(ids, binStep, amountX, amountY);
  return new Args().add(liquidities).serialize();
}

function _getLiquiditiesForAmounts(
  ids: u64[],
  binStep: u32,
  amountX: u256,
  amountY: u256,
): u256[] {
  const liquidities = new Array<u256>(ids.length);

  for (let i = 0; i < ids.length; ++i) {
    const price = BinHelper.getPriceFromId(ids[i], binStep);

    liquidities[i] = u256.add(
      Math512Bits.mulShiftRoundDown(price, amountX, SCALE_OFFSET),
      amountY,
    );
  }

  return liquidities;
}

// ======================================== //

/** Return the amounts of token received for a given amount of liquidities
 * @dev The different arrays needs to use the same binId for each index
 * @param liquidities the list of liquidity amounts for each binId
 * @param totalSupplies the list of totalSupply for each binId
 * @param binReservesX the list of reserve of token X for each binId
 * @param binReservesY the list of reserve of token Y for each binId
 * @return amountX the amount of tokenX received by the user
 * @return amountY the amount of tokenY received by the user
 */
export function getAmountsForLiquidities(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const liquidities = args.nextFixedSizeArray<u256>().unwrap();
  const totalSupplies = args.nextFixedSizeArray<u256>().unwrap();
  const binReservesX = args.nextFixedSizeArray<u256>().unwrap();
  const binReservesY = args.nextFixedSizeArray<u256>().unwrap();

  const r = _getAmountsForLiquidities(
    liquidities,
    totalSupplies,
    binReservesX,
    binReservesY,
  );
  return new Args().add(r.amountX).add(r.amountY).serialize();
}

export function _getAmountsForLiquidities(
  liquidities: u256[],
  totalSupplies: u256[],
  binReservesX: u256[],
  binReservesY: u256[],
): Amounts {
  if (
    liquidities.length != totalSupplies.length &&
    liquidities.length != binReservesX.length &&
    liquidities.length != binReservesY.length
  )
    assert(false, 'LiquidityAmounts__LengthMismatch');

  let amountX = u256.Zero;
  let amountY = u256.Zero;
  for (let i = 0; i < liquidities.length; ++i) {
    amountX = u256.add(
      amountX,
      Math512Bits.mulDivRoundDown(
        liquidities[i],
        binReservesX[i],
        totalSupplies[i],
      ),
    );
    amountY = u256.add(
      amountY,
      Math512Bits.mulDivRoundDown(
        liquidities[i],
        binReservesY[i],
        totalSupplies[i],
      ),
    );
  }

  return new Amounts(amountX, amountY);
}

// ======================================== //

/** Return the liquidities of a user
 * @param user The address of the user
 * @param ids the list of ids where the user have liquidity, ids need to be in ascending order to assert uniqueness
 * @param LBPair The address of the LBPair
 * @return liquidities the list of amount of liquidity of the user
 */
export function getLiquiditiesOf(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const user = new Address(args.nextString().unwrap());
  const ids = args.nextFixedSizeArray<u64>().unwrap();
  const pair = new Address(args.nextString().unwrap());

  const liquidities = _getLiquiditiesOf(user, ids, pair);
  return new Args().add(liquidities).serialize();
}

function _getLiquiditiesOf(user: Address, ids: u64[], pair: Address): u256[] {
  const liquidities = new Array<u256>(ids.length);

  for (let i = 0; i < ids.length; ++i) {
    liquidities[i] = new IPair(pair).balanceOf(user, ids[i]);
  }

  return liquidities;
}

// ======================================== //

/** Return the amounts received by a user if he were to burn all its liquidity
 * @param user The address of the user
 * @param ids the list of ids where the user would remove its liquidity, ids need to be in ascending order to assert uniqueness
 * @param LBPair The address of the LBPair
 * @return amountX the amount of tokenX received by the user
 * @return amountY the amount of tokenY received by the user
 */
export function getAmountsOf(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const user = new Address(args.nextString().unwrap());
  const ids = args.nextFixedSizeArray<u64>().unwrap();
  const pair = new Address(args.nextString().unwrap());

  const r = _getAmountsOf(user, ids, new IPair(pair));
  return new Args().add(r.amountX).add(r.amountY).serialize();
}

export function _getAmountsOf(user: Address, ids: u64[], pair: IPair): Amounts {
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

// ======================================== //

/** Return the depth
 * @param startId
 * @param endId
 * @param LBPair The address of the LBPair
 * @return
 */
export function getDepth(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const startId = args.nextU32().unwrap();
  const endId = args.nextU32().unwrap();
  const pair = new Address(args.nextString().unwrap());

  const reserves = _getDepth(startId, endId, new IPair(pair));
  return new Args().add(reserves.amountX).add(reserves.amountY).serialize();
}

function _getDepth(startId: u32, endId: u32, pair: IPair): Amounts {
  let amountX = u256.Zero;
  let amountY = u256.Zero;

  const length = endId - startId + 1;
  //   const ids = new Array<u64>(length);

  for (let i: u32 = 0; i < length; ++i) {
    const id = startId + i;
    const reserves = pair.getBin(id);
    amountX = u256.add(amountX, reserves.reserveX);
    amountY = u256.add(amountY, reserves.reserveY);
  }

  return new Amounts(amountX, amountY);
}
