import { Address } from '@massalabs/massa-as-sdk';
import { Args } from '@massalabs/as-types';
import { IPair } from '@dusalabs/core';
import { u256 } from 'as-bignum/assembly/integer/u256';

/** Return the fees amounts that are cached for a given user
 * @param LBPair the address of the pair
 * @param user the address of the user
 * @return amountX the amount of tokenX that are cached
 * @return amountY the amount of tokenY that are cached
 */
export function getCachedFees(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const pair = new Address(args.nextString().unwrap());
  const user = new Address(args.nextString().unwrap());

  const r = _getCachedFees(pair, user);
  return new Args().add(r.amountX).add(r.amountY).serialize();
}

class GetCachedFeesReturn {
  constructor(
    public amountX: u256,
    public amountY: u256,
  ) {}
}

function _getCachedFees(pair: Address, user: Address): GetCachedFeesReturn {
  const r = new IPair(pair).pendingFees(user, []);
  return new GetCachedFeesReturn(r.amountX, r.amountY);
}

// ======================================== //

/** Return the ids and amounts that have fees for a given user in the given list of ids
 * @dev The returned arrays will be equal or smaller than the given arrays
 * @param LBPair the address of the pair
 * @param user the address of the user
 * @param ids the list of ids where the user want to know if there are pending fees
 * @return cachedX the amount of tokenX that are cached
 * @return cachedY the amount of tokenY that are cached
 * @return idsWithFees the list of ids that have pending fees
 * @return amountsX the list of amount of tokenX that are pending for each id
 * @return amountsY the list of amount of tokenY that are pending for each id
 */
export function getIdsWithFees(bs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(bs);
  const pair = new Address(args.nextString().unwrap());
  const user = new Address(args.nextString().unwrap());
  const ids = args.nextFixedSizeArray<u64>().unwrap();

  const r = _getIdsWithFees(pair, user, ids);
  return new Args()
    .add(r.cachedX)
    .add(r.cachedY)
    .add(r.idsWithFees)
    .add(r.amountsX)
    .add(r.amountsY)
    .serialize();
}

class GetIdsWithFeesReturn {
  constructor(
    public cachedX: u256,
    public cachedY: u256,
    public idsWithFees: u64[],
    public amountsX: u256[],
    public amountsY: u256[],
  ) {}
}

function _getIdsWithFees(
  pair: Address,
  user: Address,
  ids: u64[],
): GetIdsWithFeesReturn {
  let idsWithFees = new Array<u64>(ids.length);
  let amountsX = new Array<u256>(ids.length).fill(u256.Zero);
  let amountsY = new Array<u256>(ids.length).fill(u256.Zero);

  let id = new Array<u64>(1);

  const r = _getCachedFees(pair, user);

  let j: i32 = 0;
  for (let i = 0; i < ids.length; i++) {
    id[0] = ids[i];

    const r2 = new IPair(pair).pendingFees(user, id);

    if (r2.amountX > r.amountX || r2.amountY > r.amountY) {
      idsWithFees[j] = ids[i];

      if (r2.amountX > r.amountX) amountsX[j] = u256.sub(r2.amountX, r.amountX);
      if (r2.amountY > r.amountY) amountsY[j] = u256.sub(r2.amountY, r.amountY);

      ++j;
    }

    ++i;
  }

  return new GetIdsWithFeesReturn(
    r.amountX,
    r.amountY,
    idsWithFees,
    amountsX,
    amountsY,
  );
}
