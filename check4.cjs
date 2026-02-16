const { Client } = require('pg');
const connStr = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}`;
(async () => {
  const c = new Client({ connectionString: connStr, ssl: false });
  await c.connect();
  const schema = 'nova_floresta_adrielly_de_castro_silva_olive';
  
  // Verificar estrutura da tabela
  const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = 'registros_ponto' ORDER BY ordinal_position`);
  console.log('Colunas:', cols.rows.map(r => r.column_name).join(', '));
  
  // Buscar registros manuais
  const r = await c.query(`SELECT id, tipo, origem FROM ${schema}.registros_ponto WHERE origem = 'MANUAL' ORDER BY id DESC LIMIT 5`);
  console.log('Registros Manuais:', JSON.stringify(r.rows));
  
  // Verificar registros sem tipo
  const nullTipo = await c.query(`SELECT id, tipo, origem FROM ${schema}.registros_ponto WHERE tipo IS NULL LIMIT 5`);
  console.log('Registros com tipo NULL:', JSON.stringify(nullTipo.rows));
  
  await c.end();
})().catch(e => console.error('ERRO:', e.message));
