import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: { rejectUnauthorized: false }
})

async function criarLotacaoGenerica() {
  const client = await pool.connect()

  try {
    // Verifica se já existe lotação genérica
    const existe = await client.query(
      `SELECT id FROM santo_andre.lotacoes WHERE nome ILIKE '%IMPORTA%' OR nome ILIKE '%PENDENTE%'`
    )

    if (existe.rows.length > 0) {
      console.log('Lotacao generica ja existe:', existe.rows[0].id)
      return existe.rows[0].id
    }

    // Pega primeira secretaria (Administração)
    const sec = await client.query('SELECT id FROM santo_andre.secretarias WHERE ativo = true ORDER BY id LIMIT 1')
    const secretariaId = sec.rows[0]?.id || 1

    // Cria lotação genérica
    const result = await client.query(
      `INSERT INTO santo_andre.lotacoes (secretaria_id, codigo, nome, ativo, created_at, updated_at)
       VALUES ($1, $2, $3, true, NOW(), NOW()) RETURNING id`,
      [secretariaId, 'IMPORT', 'IMPORTADOS DO REP - PENDENTE ALOCACAO']
    )

    console.log('Lotacao generica criada com ID:', result.rows[0].id)
    return result.rows[0].id
  } finally {
    client.release()
    pool.end()
  }
}

criarLotacaoGenerica()
