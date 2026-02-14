
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'

async function run() {
    try {
        console.log('Criando usuário admin...')

        // Hash da senha 'admin123' (ou similar)
        // Nota: Como não tenho acesso fácil ao servico de hash fora do contexto HTTP,
        // vou tentar inserir usando um hash conhecido ou usar uma rota API temporária.
        // Melhor: Criar via rota de debug que já temos acesso ao contexto do Adonis.

        // Vou usar a rota /teste/criar-admin que vou adicionar agora.

    } catch (error) {
        console.error(error)
    }
}
