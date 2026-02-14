// Script para corrigir códigos de jornadas
// Execute: node fix-jornadas.js

const { Pool } = require('pg')

const pool = new Pool({
    connectionString: 'postgresql://postgres.kfxlmxvjqojysqqswdlb:Tl160221@aws-0-sa-east-1.pooler.supabase.com:6543/postgres'
})

async function fix() {
    try {
        // Busca jornadas
        const result = await pool.query(`
      SELECT id, codigo, nome, carga_horaria_semanal 
      FROM santo_andre.jornadas 
      ORDER BY id
    `)

        console.log('Jornadas atuais:')
        result.rows.forEach(r => console.log(`  ID: ${r.id}, Código: ${r.codigo}, Nome: ${r.nome}, CH: ${r.carga_horaria_semanal}`))

        // Corrige códigos baseados na carga horária
        for (const row of result.rows) {
            const ch = parseInt(row.carga_horaria_semanal || 0)
            let novoCodigo = row.codigo

            if (ch > 0) {
                if (ch <= 20) {
                    novoCodigo = ch + 'H'
                } else {
                    novoCodigo = 'J' + ch
                }
            }

            if (novoCodigo !== row.codigo) {
                console.log(`\nCorrigindo ID ${row.id}: ${row.codigo} -> ${novoCodigo}`)
                await pool.query('UPDATE santo_andre.jornadas SET codigo = $1 WHERE id = $2', [novoCodigo, row.id])
            }
        }

        console.log('\n✅ Concluído!')
    } catch (error) {
        console.error('Erro:', error)
    } finally {
        await pool.end()
    }
}

fix()
