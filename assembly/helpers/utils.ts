import { Context } from '@massalabs/massa-as-sdk';

export function onlyAutonomous(): void {
  assert(
    Context.caller().equals(Context.callee()) || Context.isDeployingContract(),
    'Autonomous function launched only by internal call',
  );
}
