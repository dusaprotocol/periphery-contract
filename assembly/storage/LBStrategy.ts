import { boolToByte, stringToBytes } from '@massalabs/as-types';

export const bFalse = boolToByte(false);
export const bTrue = boolToByte(true);

export const BINSTEP = stringToBytes('BINSTEP');
export const ACTIVE_BINS = stringToBytes('ACTIVE_BINS');
export const DELTA_IDS = stringToBytes('DELTA_IDS');
export const DISTRIBUTION_X = stringToBytes('DISTRIBUTION_X');
export const DISTRIBUTION_Y = stringToBytes('DISTRIBUTION_Y');
export const IDSLIPPAGE = stringToBytes('IDSLIPPAGE');
export const FEES_MANAGERS = stringToBytes('FEES_MANAGERS');
export const IS_ON = stringToBytes('IS_ON');
export const LAST_ADD = stringToBytes('LAST_ADD');

//tracks rebalances and attempts to ~equal weight on next rebalance
export const BIN_OFFSET = stringToBytes('BIN_OFFSET');
export const CENTER_OFFSET = stringToBytes('CENTER_OFFSET');
export const IS_TOKEN_X_WEIGHTED = stringToBytes('IS_TOKEN_X_WEIGHTED');
export const IS_TOKEN_Y_WEIGHTED = stringToBytes('IS_TOKEN_Y_WEIGHTED');

//harvesting params
export const harvestDelay = 21_600_000; //6 hours;
export const LAST_HARVEST = stringToBytes('LAST_HARVEST');

//rebalance params
export const rebalanceDelay = 259_200_000; //3 days;
export const REBALANCE_TIMESTAMP = stringToBytes('REBALANCE_TIMESTAMP');
export const IS_PENDING_REBALANCE = stringToBytes('IS_PENDING_REBALANCE');
