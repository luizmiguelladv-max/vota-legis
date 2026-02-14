/**
 * Script para resetar a senha do usuário master
 * Execute: node reset-password.js
 */

const { Pool } = require('pg')
const bcrypt = require('bcryptjs')

const pool = new Pool({
  host: 'aws-1-sa-east-1.pooler.supabase.com',
  port: 6543,
  user: 'postgres.biducobatymgdgkwdcqb',
  password: 'Pmsa2025dbPmsa2025db',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
})

async function resetPassword() {
  try {
    console.log('Conectando ao banco de dados...')

    // Gera hash da nova senha
    const novaSenha = 'admin123'
    const hash = await bcrypt.hash(novaSenha, 10)

    // Verifica se o usuário existe
    const checkUser = await pool.query(
      `SELECT id, login, nome FROM usuarios_master WHERE login = $1`,
      ['master']
    )

    if (checkUser.rows.length === 0) {
      console.log('Usuário "master" não encontrado. Criando...')

      await pool.query(
        `INSERT INTO usuarios_master (login, senha, nome, email, ativo, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        ['master', hash, 'Administrador Master', 'admin@sistema.com', true]
      )

      console.log('✅ Usuário master criado com sucesso!')
    } else {
      console.log(`Usuário encontrado: ${checkUser.rows[0].nome}`)

      // Atualiza a senha
      await pool.query(
        `UPDATE usuarios_master SET senha = $1, updated_at = NOW() WHERE login = $2`,
        [hash, 'master']
      )

      console.log('✅ Senha atualizada com sucesso!')
    }

    console.log('')
    console.log('=================================')
    console.log('Credenciais de acesso:')
    console.log('Login: master')
    console.log('Senha: admin123')
    console.log('=================================')

  } catch (error) {
    console.error('❌ Erro:', error.message)
  } finally {
    await pool.end()
  }
}

resetPassword()
