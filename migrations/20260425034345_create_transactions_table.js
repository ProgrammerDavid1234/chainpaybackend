exports.up = function(knex) {
  return knex.schema.createTable('transactions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('tx_hash', 66).unique().notNullable();
    table.string('from_address', 42).notNullable();
    table.string('to_address', 42).notNullable();
    table.specificType('amount_wei', 'NUMERIC(78,0)').notNullable();
    table.enu('status', ['pending', 'confirmed', 'failed']).notNullable().defaultTo('pending');
    table.integer('block_number').nullable();
    table.string('metadata_hash', 66).nullable();
    table.integer('tx_index').nullable();
    table.text('revert_reason').nullable();
    table.timestamp('confirmed_at').nullable();
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('transactions');
};