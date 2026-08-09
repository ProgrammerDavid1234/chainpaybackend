exports.up = function(knex) {
  return knex.schema.createTable('transactions', (table) => {
    table.increments('id').primary();
    table.string('tx_hash', 66).unique().notNullable();
    table.string('from_address', 42).notNullable();
    table.string('to_address', 42).notNullable();
    table.string('amount_wei', 78).notNullable();
    table.enu('status', ['pending', 'confirmed', 'failed']).notNullable().defaultTo('pending');
    table.integer('block_number').nullable();
    table.string('metadata_hash', 66).nullable();
    table.text('revert_reason').nullable();
    table.timestamp('confirmed_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('transactions');
};
