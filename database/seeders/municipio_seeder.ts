import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Municipio from '#models/municipio'

export default class MunicipioSeeder extends BaseSeeder {
  async run() {
    // IMPORTANT: Do not seed hardcoded municipalities/DB credentials by default.
    // Turn this on explicitly if you really want seed data.
    if (process.env.SEED_MUNICIPIOS !== 'true') {
      console.log('ℹ️ MunicipioSeeder: pulando (defina SEED_MUNICIPIOS=true para executar)')
      return
    }

    // Example seed (fill with your real data on demand)
    const slug = 'exemplo-municipio'
    const existe = await Municipio.findBy('slug', slug)

    if (!existe) {
      await Municipio.create({
        codigoIbge: '0000000',
        nome: 'Exemplo',
        uf: 'XX',
        slug,
        corPrimaria: '#1a73e8',
        corSecundaria: '#4285f4',
        status: 'PENDENTE',
        ativo: true,
      })
      console.log('✅ Município exemplo criado!')
    } else {
      console.log('ℹ️ Município exemplo já existe')
    }
  }
}
