import { Args } from '@massalabs/as-types';
import { Address, call } from '@massalabs/massa-as-sdk';

export class IUpgradeable {
  constructor(public _origin: Address) {}

  upgrade(bytecode: StaticArray<u8>): void {
    call(this._origin, 'upgrade', new Args(bytecode), 0);
  }
}
