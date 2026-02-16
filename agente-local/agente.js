/**
 * Agente Local GetPonto
 *
 * Este agente roda na rede local do cliente e:
 * 1. Conecta aos REPs (ZKTeco) na rede local
 * 2. Coleta os registros de ponto
 * 3. Envia para a API do GetPonto na nuvem
 */

const fetch = require('node-fetch');
const ZKLib = require('zklib');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Configurações
const CONFIG_FILE = path.join(__dirname, 'config.json');
const LOG_FILE = path.join(__dirname, 'agente.log');

// Carregar ou criar configuração
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
  return null;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Log com timestamp
function log(msg) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}`;
  console.log(logMsg);
  fs.appendFileSync(LOG_FILE, logMsg + '\n');
}

// Perguntar ao usuário
function pergunta(texto) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(texto, (resposta) => {
      rl.close();
      resolve(resposta.trim());
    });
  });
}

// Configuração inicial interativa
async function configuracaoInicial() {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('    CONFIGURAÇÃO INICIAL - AGENTE GETPONTO');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('Este agente sincroniza os REPs da rede local com o servidor.');
  console.log('');

  const servidor = await pergunta('Servidor GetPonto [https://getponto.inf.br]: ') || 'https://getponto.inf.br';
  const apiKey = await pergunta('API Key da entidade: ');

  if (!apiKey) {
    console.log('');
    console.log('ERRO: API Key é obrigatória!');
    console.log('');
    console.log('Obtenha a API Key no painel administrativo do GetPonto:');
    console.log('  Menu → Configurações → Integração → API Key');
    console.log('');
    process.exit(1);
  }

  // Validar API Key no servidor
  console.log('');
  console.log('Validando API Key...');

  try {
    const response = await fetch(`${servidor}/api/agente/equipamentos`, {
      headers: { 'X-API-Key': apiKey }
    });

    if (!response.ok) {
      console.log('');
      console.log('ERRO: API Key inválida ou servidor inacessível!');
      console.log('');
      process.exit(1);
    }

    const data = await response.json();
    console.log(`✅ API Key válida! ${data.equipamentos?.length || 0} equipamentos cadastrados.`);
  } catch (error) {
    console.log('');
    console.log(`ERRO: Não foi possível conectar ao servidor: ${error.message}`);
    console.log('');
    process.exit(1);
  }

  const intervaloStr = await pergunta('Intervalo de sincronização em segundos [60]: ') || '60';
  const intervalo = parseInt(intervaloStr) || 60;

  const config = {
    servidor,
    apiKey,
    intervalo,
    equipamentos: [] // Será buscado automaticamente do servidor
  };

  saveConfig(config);

  console.log('');
  console.log('✅ Configuração salva com sucesso!');
  console.log('');

  return config;
}

// Conectar ao REP e buscar registros
async function buscarRegistrosREP(equipamento) {
  return new Promise((resolve) => {
    const zk = new ZKLib({
      ip: equipamento.ip,
      port: equipamento.porta || 4370,
      inport: 5200,
      timeout: 10000
    });

    zk.connect((err) => {
      if (err) {
        log(`❌ Erro ao conectar em ${equipamento.nome} (${equipamento.ip}): ${err.message}`);
        return resolve([]);
      }

      log(`✅ Conectado em ${equipamento.nome} (${equipamento.ip})`);

      zk.getAttendance((err, logs) => {
        if (err) {
          log(`❌ Erro ao buscar registros de ${equipamento.nome}: ${err.message}`);
          zk.disconnect();
          return resolve([]);
        }

        log(`📥 ${logs.length} registros encontrados em ${equipamento.nome}`);

        // Formatar registros
        const registros = logs.map(l => ({
          pis: l.visitorId || l.cardno || l.id,
          data_hora: l.timestamp,
          equipamento_ip: equipamento.ip,
          equipamento_nome: equipamento.nome,
          nsr: l.id
        }));

        zk.disconnect();
        resolve(registros);
      });
    });
  });
}

// Enviar registros para o servidor
async function enviarRegistros(config, registros) {
  if (registros.length === 0) {
    return;
  }

  try {
    const response = await fetch(`${config.servidor}/api/agente/registros`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey
      },
      body: JSON.stringify({ registros })
    });

    if (response.ok) {
      const result = await response.json();
      log(`✅ ${result.processados || 0} novos registros enviados (${result.duplicados || 0} duplicados)`);
    } else {
      const error = await response.text();
      log(`❌ Erro ao enviar registros: ${response.status} - ${error}`);
    }
  } catch (error) {
    log(`❌ Erro de conexão com servidor: ${error.message}`);
  }
}

// Buscar configuração de equipamentos do servidor
async function buscarEquipamentosServidor(config) {
  try {
    const response = await fetch(`${config.servidor}/api/agente/equipamentos`, {
      headers: { 'X-API-Key': config.apiKey }
    });

    if (response.ok) {
      const data = await response.json();
      return data.equipamentos || [];
    }
  } catch (error) {
    log(`⚠️ Erro ao buscar equipamentos do servidor: ${error.message}`);
  }
  return [];
}

// Ciclo de sincronização
async function sincronizar(config) {
  log('🔄 Iniciando sincronização...');

  // Buscar lista de equipamentos do servidor
  const equipamentos = await buscarEquipamentosServidor(config);

  if (!equipamentos || equipamentos.length === 0) {
    log('⚠️ Nenhum equipamento cadastrado no servidor');
    return;
  }

  log(`📋 ${equipamentos.length} equipamento(s) para sincronizar`);

  // Buscar registros de cada REP
  let todosRegistros = [];
  for (const eq of equipamentos) {
    const registros = await buscarRegistrosREP(eq);
    todosRegistros = todosRegistros.concat(registros);
  }

  // Enviar para o servidor
  if (todosRegistros.length > 0) {
    await enviarRegistros(config, todosRegistros);
  } else {
    log('📭 Nenhum registro novo encontrado');
  }

  log(`✅ Sincronização concluída`);
}

// Verificar conexão com internet
async function temConexao(servidor) {
  try {
    const response = await fetch(`${servidor}/api/health`, {
      method: 'GET',
      timeout: 5000
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Iniciar agente
async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('    AGENTE LOCAL GETPONTO - v1.0.0');
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  // Carregar ou criar configuração
  let config = loadConfig();

  if (!config || !config.apiKey) {
    config = await configuracaoInicial();
  }

  log(`🌐 Servidor: ${config.servidor}`);
  log(`⏱️ Intervalo: ${config.intervalo} segundos`);
  log('');

  let estavaSemConexao = false;

  // Loop de sincronização com detecção de rede
  async function ciclo() {
    const temRede = await temConexao(config.servidor);

    if (temRede) {
      if (estavaSemConexao) {
        log('🌐 Conexão restabelecida! Sincronizando...');
        estavaSemConexao = false;
      }
      await sincronizar(config);
    } else {
      if (!estavaSemConexao) {
        log('⚠️ Sem conexão com o servidor. Aguardando...');
        estavaSemConexao = true;
      }
    }

    // Próximo ciclo
    setTimeout(ciclo, config.intervalo * 1000);
  }

  // Primeira sincronização
  await ciclo();

  log('');
  log('Agente rodando. Pressione Ctrl+C para encerrar.');
}

main().catch(err => {
  log(`❌ Erro fatal: ${err.message}`);
  process.exit(1);
});
