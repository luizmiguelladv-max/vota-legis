const { Client } = require('pg');
const connStr = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}`;

(async () => {
  const c = new Client({ connectionString: connStr, ssl: false });
  await c.connect();
  
  // Buscar todos os schemas de entidades
  const schemas = await c.query(`
    SELECT schema_name 
    FROM information_schema.schemata 
    WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'public', 
      '_realtime', 'auth', 'extensions', 'graphql', 'graphql_public', 'net', 
      'pgbouncer', 'pgsodium', 'pgsodium_masks', 'realtime', 'storage', 'supabase_functions', 'vault')
    AND schema_name NOT LIKE 'pg_temp%'
    AND schema_name NOT LIKE 'pg_toast_temp%'
  `);
  
  for (const row of schemas.rows) {
    const schema = row.schema_name;
    console.log(`Processando schema: ${schema}`);
    
    // Verificar se tem tabela registros_ponto
    const hasTable = await c.query(`
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = $1 AND table_name = 'registros_ponto'
    `, [schema]);
    
    if (!hasTable.rows.length) {
      console.log(`  -> Sem tabela registros_ponto, pulando`);
      continue;
    }
    
    // Buscar registros com tipo errado (MANUAL, EDITADO, etc que não seja ENTRADA/SAIDA)
    const wrongRecords = await c.query(`
      SELECT id, funcionario_id, data_hora, tipo
      FROM ${schema}.registros_ponto
      WHERE tipo NOT IN ('ENTRADA', 'SAIDA')
      ORDER BY funcionario_id, data_hora
    `);
    
    if (!wrongRecords.rows.length) {
      console.log(`  -> Nenhum registro para corrigir`);
      continue;
    }
    
    console.log(`  -> ${wrongRecords.rows.length} registros para corrigir`);
    
    // Agrupar por funcionário e data
    const groups = {};
    for (const r of wrongRecords.rows) {
      const date = new Date(r.data_hora).toISOString().split('T')[0];
      const key = `${r.funcionario_id}_${date}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    
    // Para cada grupo, determinar entrada/saída baseado na ordem
    let updated = 0;
    for (const [key, records] of Object.entries(groups)) {
      const [funcId, date] = key.split('_');
      
      // Buscar todos os registros do dia (inclusive os corretos) para determinar a ordem
      const allRecords = await c.query(`
        SELECT id, tipo, data_hora
        FROM ${schema}.registros_ponto
        WHERE funcionario_id = $1 AND DATE(data_hora) = $2
        ORDER BY data_hora
      `, [funcId, date]);
      
      // Atribuir ENTRADA/SAIDA alternadamente
      for (let i = 0; i < allRecords.rows.length; i++) {
        const rec = allRecords.rows[i];
        const expectedTipo = i % 2 === 0 ? 'ENTRADA' : 'SAIDA';
        
        if (rec.tipo !== expectedTipo) {
          await c.query(`UPDATE ${schema}.registros_ponto SET tipo = $1 WHERE id = $2`, [expectedTipo, rec.id]);
          updated++;
        }
      }
    }
    
    console.log(`  -> ${updated} registros atualizados`);
  }
  
  await c.end();
  console.log('Concluído!');
})().catch(e => console.error('ERRO:', e.message));
