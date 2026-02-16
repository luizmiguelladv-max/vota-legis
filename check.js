const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const schemas = await c.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'municipio_%' LIMIT 1");
  if (schemas.rows.length) {
    const schema = schemas.rows[0].schema_name;
    console.log('Schema:', schema);
    const r = await c.query(`SELECT id, tipo, origem FROM ${schema}.registros_ponto WHERE origem = 'MANUAL' ORDER BY id DESC LIMIT 5`);
    console.log('Registros Manuais:', JSON.stringify(r.rows));
    const nullTipo = await c.query(`SELECT id, tipo, origem FROM ${schema}.registros_ponto WHERE tipo IS NULL LIMIT 5`);
    if (nullTipo.rows.length) {
      console.log('Registros com tipo NULL:', JSON.stringify(nullTipo.rows));
    }
  }
  await c.end();
})().catch(console.error);
