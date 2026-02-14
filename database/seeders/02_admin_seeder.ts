import { BaseSeeder } from '@adonisjs/lucid/seeders'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'

export default class extends BaseSeeder {
  async run() {
    // Criar usuario super admin padrao (master/admin123)
    const masterExists = await db.from('usuarios').where('login', 'master').first()

    if (!masterExists) {
      const superAdminPerfil = await db.from('perfis').where('codigo', 'super_admin').first()
      if (!superAdminPerfil) {
        throw new Error("Perfil 'super_admin' nao encontrado. Rode o seeder de perfis primeiro.")
      }

      const senhaHash = await hash.make('admin123')

      await db.table('usuarios').insert({
        nome: 'Master',
        email: 'master@sistema.com',
        login: 'master',
        senha: senhaHash,
        perfil_id: superAdminPerfil.id, // super_admin
        municipio_id: null, // null = acesso a todas as camaras
        ativo: true,
        created_at: new Date(),
      })

      console.log('Usuario master criado com sucesso!')
      console.log('Login: master')
      console.log('Senha: admin123')
    } else {
      console.log('Usuario master ja existe')
    }
  }
}
