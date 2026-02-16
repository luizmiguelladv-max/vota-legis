import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    host: '92.112.178.164',
    port: 5432,
    user: 'postgres',
    password: 'PfrIHk36ctTf79P6nQrSyGmJsXWfLsVB',
    database: 'postgres'
});

const sql = `
INSERT INTO public.entidades (
    municipio_id, tipo, categoria, nome, nome_curto,
    db_schema, db_host, db_port, db_name, db_user, db_password,
    modulo_facial, modulo_digital, status, ativo, banco_criado_em
)
SELECT
    id as municipio_id,
    'PUBLICA' as tipo,
    'PREFEITURA' as categoria,
    'Prefeitura Municipal de ' || nome as nome,
    'Prefeitura' as nome_curto,
    db_schema, db_host, db_port, db_name, db_user, db_password,
    COALESCE(modulo_facial, true),
    COALESCE(modulo_digital, true),
    COALESCE(status, 'ATIVO'),
    COALESCE(ativo, true),
    banco_criado_em
FROM public.municipios m
WHERE NOT EXISTS (
    SELECT 1 FROM public.entidades e WHERE e.municipio_id = m.id
)
RETURNING id, nome, db_schema;
`;

try {
    const result = await pool.query(sql);
    if (result.rows.length > 0) {
        console.log('✅ Entidades criadas:');
        result.rows.forEach(e => console.log(`  - ${e.nome} (${e.db_schema})`));
    } else {
        console.log('ℹ️ Nenhuma nova entidade criada (já existem)');
    }
} catch (e) {
    console.log('ERRO:', e.message);
} finally {
    await pool.end();
}
