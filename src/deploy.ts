/* eslint-disable no-console */
import {
  Account,
  Args,
  Mas,
  SmartContract,
  Web3Provider,
} from '@massalabs/massa-web3';
import { getScByteCode } from './utils';

const account = await Account.fromEnv();
console.log(account.address.toString());
const provider = Web3Provider.mainnet(account);
console.log('Deploying contract...');

const byteCode = getScByteCode('build', 'LiquidityAmounts.wasm');
const contract = await SmartContract.deploy(provider, byteCode, new Args(), {
  coins: Mas.fromString('5'),
});
console.log('Contract deployed at:', contract.address);

const events = await provider.getEvents({
  smartContractAddress: contract.address,
});
for (const event of events) {
  console.log('Event message:', event.data);
}
