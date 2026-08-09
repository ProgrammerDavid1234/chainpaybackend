const { baselineDb }        = require('../../db/knex');
const { ethers }           = require('ethers');
const crypto               = require('crypto');

const INITIAL_FUND_AMOUNT  = '100000000000000000000000'; // 100000 ETH in wei

async function ensureTables() {
  const exists = await baselineDb.schema.hasTable('balances');
  if (!exists) {
    await baselineDb.schema.createTable('balances', (table) => {
      table.string('wallet_address', 42).primary();
      table.string('amount_wei', 78).notNullable().defaultTo('0');
      table.timestamp('updated_at').defaultTo(baselineDb.fn.now());
    });
    await baselineDb.schema.createTable('transactions', (table) => {
      table.increments('id').primary();
      table.string('tx_hash', 66).unique().notNullable();
      table.string('from_address', 42).notNullable();
      table.string('to_address', 42).notNullable();
      table.string('amount_wei', 78).notNullable();
      table.enu('status', ['pending', 'confirmed', 'failed']).notNullable().defaultTo('pending');
      table.integer('block_number').nullable();
      table.string('metadata_hash', 66).nullable();
      table.timestamp('confirmed_at').nullable();
      table.timestamp('created_at').defaultTo(baselineDb.fn.now());
      table.timestamp('updated_at').defaultTo(baselineDb.fn.now());
    });
  }
}

class CentralizedTransferService {
  constructor() {
    this.ready = false;
  }

  async init() {
    await ensureTables();
    this.ready = true;
  }

  async createWallet(userId) {
    const walletAddress = ethers.Wallet.createRandom().address.toLowerCase();
    await baselineDb('balances')
      .insert({ wallet_address: walletAddress, amount_wei: INITIAL_FUND_AMOUNT })
      .onConflict('wallet_address').ignore();
    return { userId, walletAddress, balanceWei: INITIAL_FUND_AMOUNT };
  }

  async getBalance(walletAddress) {
    const row = await baselineDb('balances').where({ wallet_address: walletAddress.toLowerCase() }).first();
    return row ? row.amount_wei : '0';
  }

  async transfer(fromAddress, toAddress, amountWei) {
    if (fromAddress === toAddress) {
      throw new Error('Sender and receiver cannot be the same');
    }

    const from = fromAddress.toLowerCase();
    const to   = toAddress.toLowerCase();
    const amt  = BigInt(amountWei);

    if (amt <= 0n) {
      throw new Error('Amount must be positive');
    }

    let txHash;
    const trx = await baselineDb.transaction(async (tx) => {
      const senderBalance = await tx('balances').where({ wallet_address: from }).first();
      const currentBalance = BigInt(senderBalance ? senderBalance.amount_wei : '0');

      if (currentBalance < amt) {
        throw new Error(`Insufficient balance: ${currentBalance} < ${amt}`);
      }

      await tx('balances')
        .where({ wallet_address: from })
        .update({
          amount_wei: (currentBalance - amt).toString(),
          updated_at: new Date(),
        });

      const receiverRow = await tx('balances').where({ wallet_address: to }).first();
      const receiverBalance = BigInt(receiverRow ? receiverRow.amount_wei : '0');
      const newReceiverBalance = receiverBalance + amt;

      if (receiverRow) {
        await tx('balances')
          .where({ wallet_address: to })
          .update({
            amount_wei: newReceiverBalance.toString(),
            updated_at: new Date(),
          });
      } else {
        await tx('balances')
          .insert({
            wallet_address: to,
            amount_wei:     newReceiverBalance.toString(),
          })
          .onConflict('wallet_address').ignore();
      }

      txHash = crypto.randomBytes(32).toString('hex');
      txHash = '0x' + txHash;

      await tx('transactions').insert({
        tx_hash:       txHash,
        from_address:  from,
        to_address:    to,
        amount_wei:    amountWei.toString(),
        status:        'confirmed',
        confirmed_at:  new Date(),
      });

      return txHash;
    });

    return { txHash, status: 'confirmed', from, to, amountWei: amountWei.toString() };
  }

  async getTransactions(walletAddress, limit = 20) {
    const wallet = walletAddress.toLowerCase();
    return baselineDb('transactions')
      .where('from_address', wallet)
      .orWhere('to_address', wallet)
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  stats = {};
}

module.exports = new CentralizedTransferService();
