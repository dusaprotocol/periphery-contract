import { stringToBytes } from '@massalabs/as-types';
import { PersistentMap } from '../helpers/PersitentMap';
import { DCA } from '../structs';

// @dev key: user address
export const DCAS = new PersistentMap<string, DCA>('D');
export const DCA_ID = stringToBytes('DCA_ID');
export const QUOTER = 'QUOTER';
export const WMAS = 'WMAS';
export const USDC = 'USDC';
export const PAIR_MAS_USDC = 'PAIR_MAS_USDC';
export const MAX_GAS = stringToBytes('MAX_GAS');
export const MAX_SWAP = stringToBytes('MAX_SWAP');
export const MAX_PRICE = stringToBytes('MAX_PRICE');
