import pg from 'pg';

async function check() {
    const client = new pg.Client('postgresql://postgres:LhSistemas@localhost:5432/ponto_eletronico');
    await client.connect();

    // Set schema
    await client.query('SET search_path TO santo_andre, public');

    // Check columns
    const result = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'banco_horas' 
    AND table_schema = 'santo_andre'
  `);

    console.log('Colunas na tabela banco_horas:');
    console.log(result.rows.map(r => r.column_name));

    await client.end();
}

check().catch(console.error);
