exports.up = function(knex) {
  return knex.schema.createTable('sessions', (table) => {
    table.string('jti', 36).primary();
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.timestamp('invalidated_at').defaultTo(knex.fn.now());
    table.timestamp('expires_at').notNullable();
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('sessions');
};