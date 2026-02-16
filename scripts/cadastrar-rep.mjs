// cadastrar-rep.mjs
// Cadastra o REP Control iD real no sistema
// Uso: node cadastrar-rep.mjs

import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
})

async function run() {
  const client = await pool.connect()
  
  try {
    console.log('🔧 Cadastrando REP Control iD...\n')
    
    // Dados do REP (ajuste conforme necessário)
    const rep = {
      codigo: 'REP-PMSA-001',           // Código único
      nome: 'REP Principal - Prefeitura',
      modelo: 'iDClass',
      fabricante: 'Control iD',
      numero_serie: '',                  // Preencher com o serial real
      ip: '192.168.100.100',
      porta: 8080,
      tipo: 'REP',
      status: 'OFFLINE'
    }
    
    // Verifica se já existe
    const [existe] = await client.query(`
      SELECT id FROM santo_andre.equipamentos WHERE codigo = $1
    `, [rep.codigo])
    
    if (existe) {
      // Atualiza
      await client.query(`
        UPDATE santo_andre.equipamentos 
        SET nome = $2, modelo = $3, fabricante = $4, ip = $5, porta = $6, tipo = $7, updated_at = NOW()
        WHERE codigo = $1
      `, [rep.codigo, rep.nome, rep.modelo, rep.fabricante, rep.ip, rep.porta, rep.tipo])
      console.log('✅ REP atualizado!')
    } else {
      // Insere
      await client.query(`
        INSERT INTO santo_andre.equipamentos (codigo, nome, modelo, fabricante, numero_serie, ip, porta, tipo, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [rep.codigo, rep.nome, rep.modelo, rep.fabricante, rep.numero_serie, rep.ip, rep.porta, rep.tipo, rep.status])
      console.log('✅ REP cadastrado!')
    }
    
    // Lista equipamentos
    console.log('\n📋 Equipamentos cadastrados:')
    const result = await client.query(`
      SELECT id, codigo, nome, modelo, ip, porta, status 
      FROM santo_andre.equipamentos 
      WHERE ativo = true
      ORDER BY id
    `)
    console.table(result.rows)
    
    console.log('\n📝 Próximos passos:')
    console.log('1. Acesse o REP pelo navegador: http://192.168.100.100:8080')
    console.log('2. Vá em: Menu > Comunicação > Servidor')
    console.log('3. Configure:')
    console.log('   - Habilitar: SIM')
    console.log('   - URL: https://SEU_DOMINIO/api/webhook/controlid')
    console.log('   - Identificador: REP-PMSA-001')
    console.log('4. Salve e teste uma batida!')
    
  } catch (error) {
    console.error('❌ Erro:', error.message)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
