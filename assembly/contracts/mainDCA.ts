import {
  Address,
  createSC,
  fileToByteArray,
  generateEvent,
  transferCoins,
} from '@massalabs/massa-as-sdk';
import { IDCA } from '../interfaces/IDCA';
import { IERC20, IPair, IWMAS, ONE_COIN } from '@dusalabs/core';

export function constructor(_: StaticArray<u8>): void {
  main(_);
}

export function main(_: StaticArray<u8>): void {
  const dcaWasm: StaticArray<u8> = fileToByteArray('build/DCA.wasm');
  const dca = new IDCA(createSC(dcaWasm));
  transferCoins(dca._origin, 100 * ONE_COIN);
  const quoterAddress = new Address(
    'AS1Wse7vxWvB1iP1DwNQTQQctwU1fQ1jrq5JgdSPZH132UYrYrXF',
  );
  const usdc = new IERC20(
    new Address('AS12N76WPYB3QNYKGhV2jZuQs1djdhNJLQgnm7m52pHWecvvj1fCQ'),
  );

  const wmas = new IWMAS(
    new Address('AS12FW5Rs5YN2zdpEnqwj4iHUUPt9R4Eqjq2qtpJFNKW3mn33RuLU'),
  );

  const pairWmasUsdc = new IPair(
    new Address('AS112Wdy9pM4fvLNLHQXyf7uam9waMPdG5ekr4vxCyQHPkrMMPPY'),
  );

  dca.init(quoterAddress, wmas._origin, usdc._origin, pairWmasUsdc._origin);

  generateEvent(['dca address:', dca._origin.toString()].join(' '));
  return;
}
