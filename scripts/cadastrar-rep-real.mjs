// cadastrar-rep-real.mjs
// Remove equipamentos de teste e cadastra o REP real
// Uso: node cadastrar-rep-real.mjs

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
    console.log('🧹 Limpando dados de teste...\n')
    
    // Remove registros de ponto simulados primeiro
    await client.query('DELETE FROM santo_andre.registros_ponto')
    console.log('✅ Registros de ponto simulados removidos')
    
    // Remove equipamentos de teste
    await client.query('DELETE FROM santo_andre.equipamentos')
    console.log('✅ Equipamentos de teste removidos')
    
    // Cadastra o REP real
    console.log('\n📝 Cadastrando REP real...\n')
    
    const rep = {
      codigo: 'REP-001',
      nome: 'REP Principal - Prefeitura',
      modelo: 'iDClass',
      fabricante: 'Control iD',
      numero_serie: '',
      ip: '192.168.0.200',
      porta: 443,
      tipo: 'REP',
      status: 'ONLINE'
    }
    
    await client.query(`
      INSERT INTO santo_andre.equipamentos 
      (codigo, nome, modelo, fabricante, numero_serie, ip, porta, tipo, status, ultima_comunicacao)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    `, [rep.codigo, rep.nome, rep.modelo, rep.fabricante, rep.numero_serie, rep.ip, rep.porta, rep.tipo, rep.status])
    
    console.log('✅ REP cadastrado!')
    console.log(`   Código: ${rep.codigo}`)
    console.log(`   Nome: ${rep.nome}`)
    console.log(`   Modelo: ${rep.modelo} (${rep.fabricante})`)
    console.log(`   IP: ${rep.ip}:${rep.porta}`)
    
    // Lista equipamentos
    console.log('\n📋 Equipamentos cadastrados:')
    const result = await client.query(`
      SELECT id, codigo, nome, modelo, fabricante, ip, porta, status 
      FROM santo_andre.equipamentos 
      ORDER BY id
    `)
    console.table(result.rows)
    
    console.log('\n✅ Pronto! Agora pode sincronizar os funcionários:')
    console.log('   node sincronizar-rep.mjs')
    
  } catch (error) {
    console.error('❌ Erro:', error.message)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
