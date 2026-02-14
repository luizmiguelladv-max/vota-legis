// simular-ponto.mjs
// Cria equipamentos e simula registros de ponto
// Uso: node simular-ponto.mjs

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
    console.log('🔧 Criando tabelas e simulando dados...\n')
    
    // =====================================================
    // 1. TABELA EQUIPAMENTOS
    // =====================================================
    await client.query('DROP TABLE IF EXISTS santo_andre.equipamentos CASCADE')
    await client.query(`
      CREATE TABLE santo_andre.equipamentos (
        id SERIAL PRIMARY KEY,
        codigo VARCHAR(20) UNIQUE NOT NULL,
        nome VARCHAR(100) NOT NULL,
        modelo VARCHAR(100),
        fabricante VARCHAR(100),
        numero_serie VARCHAR(100),
        ip VARCHAR(45),
        porta INTEGER DEFAULT 4370,
        lotacao_id INTEGER REFERENCES santo_andre.lotacoes(id),
        tipo VARCHAR(20) DEFAULT 'REP',
        status VARCHAR(20) DEFAULT 'OFFLINE',
        ultima_comunicacao TIMESTAMP,
        ativo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `)
    console.log('✅ Tabela equipamentos criada')
    
    // Inserir equipamentos
    const equipamentos = [
      ['REP001', 'REP Entrada Principal', 'iDClass', 'Control iD', 'CID-001-2024', '192.168.1.100', 4370, 'REP', 'ONLINE'],
      ['REP002', 'REP Secretaria Admin', 'iDFlex', 'Control iD', 'CID-002-2024', '192.168.1.101', 4370, 'REP', 'ONLINE'],
      ['REP003', 'REP Saúde', 'SS 710', 'Intelbras', 'INT-003-2024', '192.168.1.102', 4370, 'FACIAL', 'ONLINE'],
      ['REP004', 'REP Educação', 'SS 710', 'Intelbras', 'INT-004-2024', '192.168.1.103', 4370, 'FACIAL', 'OFFLINE'],
    ]
    
    for (const eq of equipamentos) {
      await client.query(`
        INSERT INTO santo_andre.equipamentos (codigo, nome, modelo, fabricante, numero_serie, ip, porta, tipo, status, ultima_comunicacao)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() - INTERVAL '${Math.floor(Math.random() * 60)} minutes')
      `, eq)
    }
    console.log(`✅ ${equipamentos.length} equipamentos inseridos`)
    
    // =====================================================
    // 2. TABELA REGISTROS_PONTO
    // =====================================================
    await client.query('DROP TABLE IF EXISTS santo_andre.registros_ponto CASCADE')
    await client.query(`
      CREATE TABLE santo_andre.registros_ponto (
        id SERIAL PRIMARY KEY,
        funcionario_id INTEGER NOT NULL REFERENCES santo_andre.funcionarios(id),
        equipamento_id INTEGER REFERENCES santo_andre.equipamentos(id),
        data_hora TIMESTAMP NOT NULL,
        tipo VARCHAR(20) DEFAULT 'BIOMETRIA',
        sentido VARCHAR(10),
        nsr VARCHAR(20),
        pis VARCHAR(20),
        origem VARCHAR(20) DEFAULT 'EQUIPAMENTO',
        justificativa TEXT,
        aprovado BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `)
    await client.query('CREATE INDEX idx_registros_func ON santo_andre.registros_ponto(funcionario_id)')
    await client.query('CREATE INDEX idx_registros_data ON santo_andre.registros_ponto(data_hora)')
    console.log('✅ Tabela registros_ponto criada')
    
    // =====================================================
    // 3. BUSCAR FUNCIONÁRIOS PARA SIMULAR
    // =====================================================
    const funcResult = await client.query(`
      SELECT id, pis FROM santo_andre.funcionarios 
      WHERE ativo = true 
      ORDER BY RANDOM() 
      LIMIT 50
    `)
    const funcionarios = funcResult.rows
    console.log(`📋 ${funcionarios.length} funcionários selecionados para simulação`)
    
    // =====================================================
    // 4. GERAR REGISTROS DE PONTO
    // =====================================================
    let totalRegistros = 0
    let nsr = 1
    
    // Últimos 10 dias úteis
    for (let d = 10; d >= 0; d--) {
      const data = new Date()
      data.setDate(data.getDate() - d)
      
      // Pula fins de semana
      if (data.getDay() === 0 || data.getDay() === 6) continue
      
      const dataStr = data.toISOString().split('T')[0]
      
      for (const func of funcionarios) {
        const sorteio = Math.random()
        
        // 5% falta (sem registros)
        if (sorteio < 0.05) continue
        
        // Equipamento aleatório (1-3, online)
        const eqId = Math.floor(Math.random() * 3) + 1
        
        // Variações de horário (em minutos)
        const varEntrada = Math.floor(Math.random() * 20) - 10  // -10 a +10
        const varAlmoco = Math.floor(Math.random() * 10) - 5    // -5 a +5
        const varSaida = Math.floor(Math.random() * 20) - 10    // -10 a +10
        
        // Horários base: 08:00, 12:00, 13:00, 17:00
        const registros = []
        
        // Entrada (08:00 +/- variação)
        const entrada = new Date(`${dataStr}T08:00:00`)
        entrada.setMinutes(entrada.getMinutes() + varEntrada)
        registros.push({ hora: entrada, sentido: 'ENTRADA' })
        
        // 95% tem dia completo (4 marcações)
        if (sorteio >= 0.10) {
          // Saída almoço (12:00)
          const saidaAlmoco = new Date(`${dataStr}T12:00:00`)
          saidaAlmoco.setMinutes(saidaAlmoco.getMinutes() + varAlmoco)
          registros.push({ hora: saidaAlmoco, sentido: 'SAIDA' })
          
          // Volta almoço (13:00)
          const voltaAlmoco = new Date(`${dataStr}T13:00:00`)
          voltaAlmoco.setMinutes(voltaAlmoco.getMinutes() + varAlmoco)
          registros.push({ hora: voltaAlmoco, sentido: 'ENTRADA' })
        }
        
        // Saída (17:00)
        const saida = new Date(`${dataStr}T17:00:00`)
        saida.setMinutes(saida.getMinutes() + varSaida)
        registros.push({ hora: saida, sentido: 'SAIDA' })
        
        // Inserir registros
        for (const reg of registros) {
          await client.query(`
            INSERT INTO santo_andre.registros_ponto 
            (funcionario_id, equipamento_id, data_hora, tipo, sentido, nsr, pis, origem)
            VALUES ($1, $2, $3, 'BIOMETRIA', $4, $5, $6, 'EQUIPAMENTO')
          `, [func.id, eqId, reg.hora, reg.sentido, String(nsr++).padStart(9, '0'), func.pis || ''])
          totalRegistros++
        }
      }
    }
    
    console.log(`✅ ${totalRegistros} registros de ponto gerados`)
    
    // =====================================================
    // 5. RESUMO
    // =====================================================
    console.log('\n📊 Resumo:')
    
    const eqCount = await client.query('SELECT COUNT(*) FROM santo_andre.equipamentos')
    console.log(`   Equipamentos: ${eqCount.rows[0].count}`)
    
    const regCount = await client.query('SELECT COUNT(*) FROM santo_andre.registros_ponto')
    console.log(`   Registros de ponto: ${regCount.rows[0].count}`)
    
    const hoje = new Date().toISOString().split('T')[0]
    const regHoje = await client.query(`
      SELECT COUNT(*) FROM santo_andre.registros_ponto 
      WHERE data_hora::date = $1
    `, [hoje])
    console.log(`   Registros hoje: ${regHoje.rows[0].count}`)
    
    console.log('\n✅ Simulação concluída! Acesse /ponto e /equipamentos no sistema.')
    
  } catch (error) {
    console.error('❌ Erro:', error.message)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
