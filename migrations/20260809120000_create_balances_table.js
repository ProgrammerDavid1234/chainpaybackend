exports.up = function(knex) {
  return knex.schema.createTable('balances', (table) => {
    table.string('wallet_address', 42).primary();
    table.string('amount_wei', 78).notNullable().defaultTo('0');
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('balances');
};
