import { stringToBytes } from '@massalabs/as-types';

// The minimum time that has to pass before a strat candidate can be approved.
export const APPROVAL_DELAY = stringToBytes('APPROVAL_DELAY');
// The strategy currently in use by the vault.
export const STRATEGY = 'STRATEGY';
// The last proposed strategy to switch to.
export const STRAT_CANDIDATE = stringToBytes('STRAT_CANDIDATE');

export const TOKEN_X = 'TOKEN_X';
export const TOKEN_Y = 'TOKEN_Y';
