import { dbManager } from './build/app/services/database_manager_service.js';

const tenant = { municipioId: 2, entidadeId: 3 };

const lotacoes = await dbManager.queryTenant(tenant, 
  "SELECT id, codigo, nome FROM lotacoes WHERE LOWER(nome) LIKE '%comissionado%' ORDER BY codigo");

console.log('Lotações com comissionado:');
for (const l of lotacoes) {
  const [count] = await dbManager.queryTenant(tenant,
    "SELECT COUNT(*) as total FROM funcionarios WHERE lotacao_id = $1", [l.id]);
  console.log(`  ${l.codigo} - ${l.nome} (ID: ${l.id}) -> ${count.total} func`);
}

process.exit(0);
