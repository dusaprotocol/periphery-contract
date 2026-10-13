import {
  Address,
//   call,
//   Context,
  createSC,
  fileToByteArray,
  generateEvent,
  transferCoins,
} from '@massalabs/massa-as-sdk';
import { ILimitOrder } from '../interfaces/ILimitOrder';
import {
    _sortTokens,
  AFTER_SWAP_FLAG,
  HooksParameters,
  IERC20,
  IFactory,
  IPair,
  IWMAS,
  ONE_COIN,
} from '@dusalabs/core';
// import { Args } from '@massalabs/as-types';

export function constructor(_: StaticArray<u8>): void {
  main(_);
}

export function main(_: StaticArray<u8>): void {
  const loWasm: StaticArray<u8> = fileToByteArray('build/LimitOrder.wasm');
  const limitOrder = new ILimitOrder(createSC(loWasm));
  transferCoins(limitOrder._origin, 10 * ONE_COIN);

  const wmas = new IWMAS(
    new Address('AS12FW5Rs5YN2zdpEnqwj4iHUUPt9R4Eqjq2qtpJFNKW3mn33RuLU'),
  );

  const usdc = new IERC20(
    new Address('AS12N76WPYB3QNYKGhV2jZuQs1djdhNJLQgnm7m52pHWecvvj1fCQ'),
  );

  const pairWmasUsdc = new IPair(
    new Address('AS1abQtk94nKYMUm9TTqHZzdMXWTBmdgEydwe1sPNyXhoiGeeBry'),
  );

  const factory = new IFactory(new Address('AS12Z4M5PpwnajdQZDmxyuduJ5vonNuCe96jVEaiaNXx4n1CEPA66'));

//   call(factory._origin, 'grantRole', new Args().add('HOOKS_MANAGER').add(Context.caller()), 0);

  limitOrder.init(pairWmasUsdc, wmas._origin);

  const tokens = _sortTokens(usdc._origin, wmas._origin);

  factory.setLBHooksParametersOnPair(
    tokens.token0,
    tokens.token1,
    pairWmasUsdc.feeParameters().binStep,
    new HooksParameters(limitOrder._origin, AFTER_SWAP_FLAG),
    [],
  )

  generateEvent(
    ['limitOrder address:', limitOrder._origin.toString()].join(' '),
  );
  return;
}
