const { Client } = require('pg');
const connStr = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}`;
(async () => {
  const c = new Client({ connectionString: connStr, ssl: false });
  await c.connect();
  const schemas = await c.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') ORDER BY schema_name");
  console.log('Schemas:', schemas.rows.map(r => r.schema_name).join(', '));
  await c.end();
})().catch(e => console.error('ERRO:', e.message));
