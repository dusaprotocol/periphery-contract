import { Args } from '@massalabs/as-types';
import { Address, Context, generateEvent } from '@massalabs/massa-as-sdk';
import { createEvent } from '@dusalabs/core/assembly/libraries/Utils';

export class StratManager {
  constructor(
    public vault: Address,
    public feeRecipient: Address,
    public owner: Address,
  ) {}

  onlyOwner(): void {
    assert(Context.caller().equals(this.owner), '!owner');
  }

  onlyOwnerOrVault(): void {
    assert(
      Context.caller().equals(this.owner) ||
        Context.caller().equals(this.vault),
      '!owner && !vault',
    );
  }

  setFeeRecipient(bs: StaticArray<u8>): void {
    this.onlyOwner();
    const _feeRecipient = new Address(new Args(bs).nextString().unwrap());
    //assert(_feeRecipient.notEqual(new Address("0")), "0 address");
    this.feeRecipient = _feeRecipient;

    //emit
    const event = createEvent('FEE_RECIPIENT_SET', [
      this.feeRecipient.toString(),
    ]);
    generateEvent(event);
  }

  setOwner(bs: StaticArray<u8>): void {
    this.onlyOwner();
    const _owner = new Address(new Args(bs).nextString().unwrap());
    //assert(_owner.notEqual(new Address("0")), "0 address");
    this.owner = _owner;

    //emit
    const event = createEvent('OWNER_SET', [this.owner.toString()]);
    generateEvent(event);
  }
}
