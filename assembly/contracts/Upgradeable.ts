import {
  Context,
  balance,
  setBytecode,
  transferCoins,
} from '@massalabs/massa-as-sdk';
import { onlyOwner } from '@massalabs/sc-standards/assembly/contracts/utils/ownership';

export function upgrade(binaryArgs: StaticArray<u8>): void {
  onlyOwner();
  setBytecode(binaryArgs);
}

export function recover(_: StaticArray<u8>): void {
  onlyOwner();
  transferCoins(Context.caller(), balance());
}
