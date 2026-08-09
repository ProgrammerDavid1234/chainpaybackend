exports.up = function(knex) {
  return knex.schema.createTable('users', (table) => {
    table.string('id', 36).primary();
    table.string('name', 100).notNullable();
    table.string('email', 255).unique().notNullable();
    table.string('password_hash', 255).notNullable();
    table.string('wallet_address', 42).unique().nullable();
    table.timestamp('wallet_registered_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('users');
};
