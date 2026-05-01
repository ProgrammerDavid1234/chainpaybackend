exports.up = function(knex) {
  return knex.schema.alterTable('transactions', (t) => {
    t.string('tx_hash', 100).alter();
  });
};
exports.down = function(knex) {
  return knex.schema.alterTable('transactions', (t) => {
    t.string('tx_hash', 66).alter();
  });
};
