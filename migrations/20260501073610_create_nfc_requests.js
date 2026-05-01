exports.up = function(knex) {
  return knex.schema.createTable('nfc_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('from_user_id').notNullable();
    t.string('to_address').notNullable();
    t.string('amount_eth').notNullable();
    t.string('tx_hash').nullable();
    t.string('status').defaultTo('pending');
    t.timestamps(true, true);
  });
};
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('nfc_requests');
};
