import { BaseSeeder } from '@adonisjs/lucid/seeders'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'

export default class extends BaseSeeder {
  async run() {
    // Criar usuario super admin padrao
    const adminExists = await db.from('usuarios').where('login', 'admin').first()

    if (!adminExists) {
      const senhaHash = await hash.make('admin123')

      await db.table('usuarios').insert({
        nome: 'Administrador',
        email: 'admin@sistema.com',
        login: 'admin',
        senha: senhaHash,
        perfil_id: 1, // super_admin
        municipio_id: null, // null = acesso a todas as camaras
        ativo: true,
        created_at: new Date(),
      })

      console.log('Usuario admin criado com sucesso!')
      console.log('Login: admin')
      console.log('Senha: admin123')
    } else {
      console.log('Usuario admin ja existe')
    }
  }
}
