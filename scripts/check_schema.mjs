import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function run() {
    try {
        const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'santo_andre' 
      AND table_name = 'equipamentos'
    `);
        console.log('Colunas da tabela equipamentos:', res.rows);
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        pool.end();
    }
}

run();
