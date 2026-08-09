require('dotenv').config();
const db = require('./src/db/knex');

const API_V2    = `https://api.etherscan.io/v2/api?chainid=11155111&module=account&action=txlist&startblock=0&endblock=99999999&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}&address=`;

(async () => {
  await db.connect;
  const wallets = await db('users').whereNotNull('wallet_address').select('wallet_address');
  console.log('tracking', wallets.length, 'wallets via Etherscan V2');

  let totalStored = 0;

  for (const w of wallets) {
    const addr = String(w.wallet_address);
    const url = `${API_V2}${addr}`;
    const res = await fetch(url).then(r => r.json());
    if (res.status !== '1') {
      console.log(addr.slice(0,10), '=>', res.message || 'no data', res.result || '');
      continue;
    }
    const txs = Array.isArray(res.result) ? res.result : [];
    console.log(addr.slice(0,10), '->', txs.length, 'transactions on explorer');

    for (const t of txs) {
      const status = t.txreceipt_status === '1' ? 'confirmed' : (t.isError === '1' ? 'failed' : 'confirmed');
      try {
        await db('transactions')
          .insert({
            tx_hash:       t.hash,
            from_address:  t.from,
            to_address:    t.to || null,
            amount_wei:    t.value,
            status,
            block_number:  t.blockNumber ? Number(t.blockNumber) : null,
            confirmed_at:  t.timeStamp ? new Date(Number(t.timeStamp) * 1000) : null,
            created_at:    t.timeStamp ? new Date(Number(t.timeStamp) * 1000) : null,
            updated_at:    new Date(),
          })
          .onConflict('tx_hash')
          .merge({ status, block_number: t.blockNumber ? Number(t.blockNumber) : null, confirmed_at: t.timeStamp ? new Date(Number(t.timeStamp) * 1000) : null });
      } catch (e) {
        console.error('insert err', t.hash, e.message);
      }
    }
  }

  const count = await db('transactions').count('id as c').first();
  console.log('done. total Supabase transactions now:', count.c);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });