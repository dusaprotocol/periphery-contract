import {
  Address,
  balanceOf,
  // call,
  // createSC,
  // fileToByteArray,
  generateEvent,
  // transferCoins,
} from '@massalabs/massa-as-sdk';
// import { ONE_COIN } from '@dusalabs/core';
// import { NoArg } from '@massalabs/as-types';
import { IDCA } from '../interfaces';
import { u256 } from 'as-bignum/assembly/integer/u256';
import { IERC20, ONE_COIN } from '@dusalabs/core';

export function main(_: StaticArray<u8>): void {
  // const faucetWasm: StaticArray<u8> = fileToByteArray('build/faucet.wasm');
  // const faucet = createSC(faucetWasm);
  // transferCoins(faucet, 400_000 * ONE_COIN);

  // call(faucet, 'constructor', NoArg, 0);
  // generateEvent('Deployed Faucet: ' + faucet.toString());

  const dca = new IDCA(
    new Address('AS1yAYzFgXfhw8rMmbBBaQttuJHTB5UjHniWn9uGJbuQymWG6ApW'),
  );

  const usdc = new IERC20(
    new Address('AS1LA1y5NgFpfGrUyQqeownYkdCSN7ZAcguuiAv8HHm9cigvtQB4'),
  );

  const wmas = new IERC20(
    new Address('AS1W51iDpFF5pPgAKuVdcSeRW6bT66wdjH9k8SdTdrDkwrFps32q'),
  );

  const amountEachDCA = u256.fromU64(1 * 10 ** 4); // 0.1 MAS
  const interval = 1000 * 60; // * 60 * 24 * 8; // 8 days in milliseconds
  const nbOfDCA = 15; // if end time not set: nbOfDCA = 0
  const tokenPath = [usdc._origin, wmas._origin];
  const startIn = 0;

  usdc.increaseAllowance(dca._origin, u256.Max);

  dca.startDCA(
    amountEachDCA,
    interval,
    nbOfDCA,
    tokenPath.reverse(),
    10,
    false,
    startIn,
    ONE_COIN,
  );

  generateEvent(
    ['balance: ', balanceOf(dca._origin.toString()).toString()].join(' '),
  );
}
