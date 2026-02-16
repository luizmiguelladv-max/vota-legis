const { Client } = require('pg');
console.log('Iniciando...');
const connStr = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}`;
console.log('Host:', process.env.DB_HOST);
(async () => {
  console.log('Conectando...');
  const c = new Client({ connectionString: connStr, ssl: false });
  await c.connect();
  console.log('Conectado!');
  const schemas = await c.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'municipio_%' LIMIT 1");
  if (schemas.rows.length) {
    const schema = schemas.rows[0].schema_name;
    console.log('Schema:', schema);
    const r = await c.query(`SELECT id, tipo, origem FROM ${schema}.registros_ponto WHERE origem = 'MANUAL' ORDER BY id DESC LIMIT 5`);
    console.log('Registros Manuais:', JSON.stringify(r.rows));
  } else {
    console.log('Nenhum schema encontrado');
  }
  await c.end();
  console.log('Fim');
})().catch(e => console.error('ERRO:', e.message));
