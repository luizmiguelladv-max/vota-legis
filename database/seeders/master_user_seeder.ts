import { BaseSeeder } from '@adonisjs/lucid/seeders'
import UsuarioMaster from '#models/usuario_master'

export default class extends BaseSeeder {
  async run() {
    // Verifica se já existe um usuário master
    const existingUser = await UsuarioMaster.findBy('login', 'master')

    if (!existingUser) {
      await UsuarioMaster.create({
        login: 'master',
        senha: 'admin123', // Será hasheado automaticamente pelo hook @beforeSave
        nome: 'Administrador Master',
        email: 'admin@sistema.com',
        ativo: true,
      })

      console.log('✅ Usuário master criado: master / admin123')
    } else {
      console.log('⚠️ Usuário master já existe')
    }
  }
}
