import { stringToBytes } from '@massalabs/as-types';
import { LimitOrder } from '../structs';
import { PersistentMap } from '@dusalabs/core';

// HOOKS Storage
export const PAIR = 'PAIR';

// Limit Order Storage
export const USER = new PersistentMap<string, StaticArray<u8>>('User');
export const ORDERS = new PersistentMap<u32, LimitOrder>('Orders');
export const BIN = new PersistentMap<u64, StaticArray<u8>>('Bin');
export const ORDER_ID = stringToBytes('ORDER_ID');
export const PREVIOUS_BIN = stringToBytes('PREV_BIN');
export const WMAS = 'WMAS';
