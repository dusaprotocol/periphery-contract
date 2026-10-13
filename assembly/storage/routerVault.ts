import { PersistentMap } from '@dusalabs/core';

// The strategy currently in use by the vault.
// @dev key is
export const VAULTS = new PersistentMap<string, string>('vaults');

export const WMAS = 'WMAS';
