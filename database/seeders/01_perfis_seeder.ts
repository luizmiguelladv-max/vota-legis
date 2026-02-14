import { BaseSeeder } from '@adonisjs/lucid/seeders'
import db from '@adonisjs/lucid/services/db'

export default class extends BaseSeeder {
  async run() {
    // Inserir perfis padrao
    const perfis = [
      { codigo: 'super_admin', nome: 'Super Administrador', descricao: 'Acesso total ao sistema, gerencia todas as camaras' },
      { codigo: 'presidente', nome: 'Presidente da Camara', descricao: 'Controle total da sessao, pode abrir/encerrar sessoes e votacoes' },
      { codigo: 'vice_presidente', nome: 'Vice-Presidente', descricao: 'Substitui o presidente em suas ausencias' },
      { codigo: 'secretario', nome: 'Secretario', descricao: 'Gestao de pautas, atas e registro de presencas' },
      { codigo: 'vereador', nome: 'Vereador', descricao: 'Pode votar, solicitar tempo de fala e assinar materias' },
      { codigo: 'assessor', nome: 'Assessor', descricao: 'Acesso de visualizacao e suporte' },
      { codigo: 'operador_painel', nome: 'Operador de Painel', descricao: 'Controla o painel eletronico do plenario' },
      { codigo: 'publico', nome: 'Publico', descricao: 'Acesso ao portal de transparencia (somente leitura)' },
    ]

    for (const perfil of perfis) {
      // Usar SQL direto para evitar incompatibilidade de types do QueryBuilder com onConflict.
      await db.rawQuery(
        `
          INSERT INTO perfis (codigo, nome, descricao, ativo, created_at, updated_at)
          VALUES ($1, $2, $3, true, $4, $4)
          ON CONFLICT (codigo) DO NOTHING
        `,
        [perfil.codigo, perfil.nome, perfil.descricao, new Date()]
      )
    }

    console.log('Perfis inseridos com sucesso!')
  }
}
