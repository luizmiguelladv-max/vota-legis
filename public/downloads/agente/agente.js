/**
 * Agente Local GetPonto
 *
 * Este agente roda na rede local do cliente e:
 * 1. Conecta aos REPs (Control iD / ZKTeco) na rede local
 * 2. Coleta os registros de ponto
 * 3. Envia para a API do GetPonto na nuvem
 */

const https = require('https');
const http = require('http');
const tls = require('tls');
const fs = require('fs');

// Permitir certificados SSL inválidos/autoassinados
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const path = require('path');
const readline = require('readline');

// Configuracoes
const CONFIG_FILE = path.join(__dirname, 'config.json');
const LOG_FILE = path.join(__dirname, 'agente.log');

// Carregar ou criar configuracao
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

// Perguntar ao usuario
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

// Configuracao inicial interativa
async function configuracaoInicial() {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('    CONFIGURACAO INICIAL - AGENTE GETPONTO');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('Este agente sincroniza os REPs da rede local com o servidor.');
  console.log('');

  const servidor = await pergunta('Servidor GetPonto [https://getponto.inf.br]: ') || 'https://getponto.inf.br';
  const apiKey = await pergunta('API Key da entidade: ');

  if (!apiKey) {
    console.log('');
    console.log('ERRO: API Key e obrigatoria!');
    console.log('');
    console.log('Obtenha a API Key no painel administrativo do GetPonto:');
    console.log('  Menu -> Configuracoes -> Integracao -> API Key');
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
      console.log('ERRO: API Key invalida ou servidor inacessivel!');
      console.log('');
      process.exit(1);
    }

    const data = await response.json();
    console.log(`OK - API Key valida! ${data.equipamentos?.length || 0} equipamentos cadastrados.`);
  } catch (error) {
    console.log('');
    console.log(`ERRO: Nao foi possivel conectar ao servidor: ${error.message}`);
    console.log('');
    process.exit(1);
  }

  const intervaloStr = await pergunta('Intervalo de sincronizacao em segundos [60]: ') || '60';
  const intervalo = parseInt(intervaloStr) || 60;

  const config = {
    servidor,
    apiKey,
    intervalo,
    ultimoNsr: {}
  };

  saveConfig(config);

  console.log('');
  console.log('OK - Configuracao salva com sucesso!');
  console.log('');

  return config;
}

// ============================================================================
// CONTROL ID - API REST via HTTPS
// ============================================================================

// Criar agent HTTPS que ignora certificados invalidos
function criarHttpsAgent() {
  return new https.Agent({
    rejectUnauthorized: false,
    checkServerIdentity: () => undefined,
    secureOptions: require('constants').SSL_OP_LEGACY_SERVER_CONNECT
  });
}

// Fazer requisicao HTTP/HTTPS para Control iD
function controlIdRequest(ip, porta, path, data = null) {
  return new Promise((resolve, reject) => {
    const isHttps = porta === 443;
    const protocol = isHttps ? https : http;

    // Preparar body se houver dados
    const jsonData = data ? JSON.stringify(data) : null;

    const options = {
      hostname: ip,
      port: porta,
      path: path,
      method: data ? 'POST' : 'GET',
      headers: {},
      timeout: 15000,
      // Control iD envia headers não-padrão, precisamos aceitar
      insecureHTTPParser: true
    };

    // Adicionar headers apenas se houver dados (Control iD exige Content-Length)
    if (jsonData) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(jsonData);
    }

    if (isHttps) {
      options.agent = criarHttpsAgent();
      options.rejectUnauthorized = false;
    }

    log(`  [${options.method}] ${isHttps ? 'https' : 'http'}://${ip}:${porta}${path}`);

    const req = protocol.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        log(`  [HTTP ${res.statusCode}] Resposta: ${body.substring(0, 200)}`);

        try {
          const json = JSON.parse(body);
          json._statusCode = res.statusCode;
          resolve(json);
        } catch (e) {
          resolve({ raw: body, _statusCode: res.statusCode, parseError: true });
        }
      });
    });

    req.on('error', (err) => {
      log(`  [HTTP] Erro: ${err.message}`);
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout na conexao'));
    });

    if (jsonData) {
      req.write(jsonData);
    }

    req.end();
  });
}

// Login no Control iD - retorna session
async function controlIdLogin(ip, porta, login = 'admin', password = 'admin') {
  log(`  Tentando login com usuario: ${login}`);

  try {
    const result = await controlIdRequest(ip, porta, '/login.fcgi', { login, password });

    if (result.session) {
      log(`  OK - Session obtida: ${result.session.substring(0, 20)}...`);
      return { session: result.session };
    }

    throw new Error(`Login falhou. Resposta: ${JSON.stringify(result).substring(0, 100)}`);
  } catch (error) {
    log(`  ERRO login: ${error.message}`);
    throw error;
  }
}

// Buscar AFD do Control iD - session via query parameter (conforme documentacao)
async function controlIdGetAfd(ip, porta, session, ultimoNsr = 0) {
  // Control iD usa session como query parameter: /get_afd.fcgi?session=xxx
  const path = `/get_afd.fcgi?session=${session}`;
  return await controlIdRequest(ip, porta, path, { initial_nsr: ultimoNsr });
}

// Parser do formato AFD texto Control iD
// Formato curto (24 chars): NSR(9) + TIPO(1) + DATA(8) + HORA(4) + USERID(2)
// Formato longo (38 chars): NSR(9) + TIPO(1) + DATA(8) + HORA(4) + PIS(12) + extras
function parseAfdTexto(afdTexto, ultimoNsr = 0) {
  const registros = [];
  const linhas = afdTexto.split('\n').filter(l => l.trim().length > 0);

  for (const linha of linhas) {
    // Ignorar linhas de cabeçalho/identificação do REP (> 80 chars)
    if (linha.length > 80) continue;

    // Ignorar linhas muito curtas
    if (linha.length < 22) continue;

    const nsr = parseInt(linha.substring(0, 9)) || 0;
    if (nsr <= ultimoNsr) continue; // Já processado

    // Control iD format: NSR(9) + Type(1) + Date(8) + Time(4) + UserCode/PIS
    const dataStr = linha.substring(10, 18); // DDMMAAAA (posição 10-17)
    const horaStr = linha.substring(18, 22); // HHMM (posição 18-21)

    // User code pode ter tamanhos diferentes
    let userCode = '';
    if (linha.length >= 34) {
      // Formato longo com PIS (12 dígitos após hora)
      userCode = linha.substring(22, 34).trim();
    } else if (linha.length >= 24) {
      // Formato curto (2+ dígitos após hora)
      userCode = linha.substring(22).trim();
    }

    if (!dataStr || dataStr.length < 8) continue;

    // Converter data/hora
    const dia = dataStr.substring(0, 2);
    const mes = dataStr.substring(2, 4);
    const ano = dataStr.substring(4, 8);
    const hora = horaStr.substring(0, 2);
    const min = horaStr.substring(2, 4);

    const dataHora = new Date(`${ano}-${mes}-${dia}T${hora}:${min}:00`);
    if (isNaN(dataHora.getTime())) continue;

    registros.push({
      nsr,
      pis: userCode || nsr.toString(),
      data_hora: dataHora.toISOString()
    });
  }

  return registros;
}

// Filtrar registros por data inicial (se configurado)
function filtrarPorData(registros, dataInicial) {
  if (!dataInicial) return registros;

  const dataLimite = new Date(dataInicial);
  dataLimite.setHours(0, 0, 0, 0);

  return registros.filter(r => {
    const dataReg = new Date(r.data_hora);
    return dataReg >= dataLimite;
  });
}

// Buscar registros do Control iD
async function buscarRegistrosControlId(equipamento, ultimoNsr = 0) {
  const ip = equipamento.ip;
  const porta = equipamento.porta || 80;
  const login = equipamento.login || 'admin';
  const senha = equipamento.senha || 'admin';

  log(`Conectando em ${equipamento.nome || ip} (Control iD ${ip}:${porta})...`);

  try {
    // Login
    const { session } = await controlIdLogin(ip, porta, login, senha);
    log(`  OK - Login realizado`);

    // Buscar AFD
    const afdData = await controlIdGetAfd(ip, porta, session, ultimoNsr);

    // Verificar se veio em formato JSON ou texto AFD
    let afdRegistros = [];

    if (afdData.afd_registros && Array.isArray(afdData.afd_registros)) {
      // Formato JSON
      afdRegistros = afdData.afd_registros.map(reg => ({
        nsr: reg.nsr,
        pis: reg.pis || reg.user_id,
        data_hora: reg.time ? new Date(reg.time * 1000).toISOString() : null
      })).filter(r => r.data_hora && r.nsr > ultimoNsr);
    } else if (afdData.raw || typeof afdData === 'string') {
      // Formato AFD texto (Portaria 671)
      const textoAfd = afdData.raw || afdData;
      afdRegistros = parseAfdTexto(textoAfd, ultimoNsr);
    }

    if (afdRegistros.length === 0) {
      log(`  Nenhum registro novo encontrado`);
      return { registros: [], ultimoNsr: ultimoNsr };
    }

    log(`  ${afdRegistros.length} registros novos encontrados`);

    // Formatar registros para envio
    let registros = afdRegistros.map(reg => ({
      visitorId: reg.pis,
      data_hora: reg.data_hora,
      equipamento_ip: ip,
      equipamento_nome: equipamento.nome,
      nsr: reg.nsr
    }));

    // Filtrar por data inicial (se configurado)
    if (equipamento.dataInicial) {
      const antes = registros.length;
      registros = filtrarPorData(registros, equipamento.dataInicial);
      if (registros.length < antes) {
        log(`  Filtrado por data >= ${equipamento.dataInicial}: ${registros.length} de ${antes}`);
      }
    }

    // Encontrar maior NSR
    const maiorNsr = Math.max(...afdRegistros.map(r => r.nsr || 0), ultimoNsr);

    return { registros, ultimoNsr: maiorNsr };
  } catch (error) {
    log(`  ERRO: ${error.message}`);
    return { registros: [], ultimoNsr: ultimoNsr };
  }
}

// ============================================================================
// ZKTECO - Usando zkteco-js
// ============================================================================

let Zkteco = null;
try {
  Zkteco = require('zkteco-js');
} catch (e) {
  // ZKTeco library not installed
}

async function buscarRegistrosZkteco(equipamento) {
  if (!Zkteco) {
    log(`  AVISO: Biblioteca zkteco-js nao instalada. Pulando equipamento ZKTeco.`);
    return [];
  }

  const ip = equipamento.ip;
  const porta = equipamento.porta || 4370;

  log(`Conectando em ${equipamento.nome || ip} (ZKTeco ${ip}:${porta})...`);

  const device = new Zkteco(ip, porta, 5200, 10000);

  try {
    await device.createSocket();
    log(`  OK - Conectado`);

    const logs = await device.getAttendances();
    log(`  ${logs.length} registros encontrados`);

    await device.disconnect();

    // Formatar registros
    const registros = logs.map(l => ({
      visitorId: l.visitorId || l.id,
      data_hora: l.recordTime,
      equipamento_ip: ip,
      equipamento_nome: equipamento.nome,
      nsr: l.id
    }));

    return registros;
  } catch (error) {
    log(`  ERRO: ${error.message || JSON.stringify(error)}`);
    try { await device.disconnect(); } catch (e) {}
    return [];
  }
}

// ============================================================================
// FUNCOES PRINCIPAIS
// ============================================================================

// Buscar registros de qualquer tipo de REP
async function buscarRegistrosREP(equipamento, config) {
  const modelo = (equipamento.modelo || '').toLowerCase();
  const ip = equipamento.ip;

  // Determinar tipo pelo modelo ou porta
  if (modelo.includes('control') || modelo.includes('idclass') || modelo.includes('idx') || equipamento.porta === 443 || equipamento.porta === 80) {
    // Control iD
    const ultimoNsr = config.ultimoNsr?.[ip] || 0;
    const resultado = await buscarRegistrosControlId(equipamento, ultimoNsr);

    // Salvar ultimo NSR
    if (resultado.ultimoNsr > ultimoNsr) {
      config.ultimoNsr = config.ultimoNsr || {};
      config.ultimoNsr[ip] = resultado.ultimoNsr;
      saveConfig(config);
    }

    return resultado.registros;
  } else {
    // ZKTeco (padrao)
    return await buscarRegistrosZkteco(equipamento);
  }
}

// Enviar registros para o servidor (em lotes de 500)
async function enviarRegistros(config, registros) {
  if (registros.length === 0) {
    return;
  }

  const BATCH_SIZE = 500;
  let totalProcessados = 0;
  let totalDuplicados = 0;
  let totalErros = 0;

  // Dividir em lotes
  for (let i = 0; i < registros.length; i += BATCH_SIZE) {
    const lote = registros.slice(i, i + BATCH_SIZE);
    const loteNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalLotes = Math.ceil(registros.length / BATCH_SIZE);

    log(`  Enviando lote ${loteNum}/${totalLotes} (${lote.length} registros)...`);

    try {
      const response = await fetch(`${config.servidor}/api/agente/registros`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.apiKey
        },
        body: JSON.stringify({ registros: lote })
      });

      if (response.ok) {
        const result = await response.json();
        totalProcessados += result.processados || 0;
        totalDuplicados += result.duplicados || 0;
      } else {
        const error = await response.text();
        log(`  ERRO lote ${loteNum}: ${response.status} - ${error.substring(0, 100)}`);
        totalErros++;
      }
    } catch (error) {
      log(`  ERRO conexao lote ${loteNum}: ${error.message}`);
      totalErros++;
    }

    // Pequena pausa entre lotes para não sobrecarregar
    if (i + BATCH_SIZE < registros.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  log(`OK - ${totalProcessados} novos registros enviados (${totalDuplicados} duplicados, ${totalErros} erros)`);
}

// Buscar configuracao de equipamentos do servidor
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
    log(`AVISO: Erro ao buscar equipamentos do servidor: ${error.message}`);
  }
  return [];
}

// Ciclo de sincronizacao
async function sincronizar(config) {
  log('Iniciando sincronizacao...');

  // Buscar lista de equipamentos do servidor
  const equipamentos = await buscarEquipamentosServidor(config);

  if (!equipamentos || equipamentos.length === 0) {
    log('AVISO: Nenhum equipamento cadastrado no servidor');
    return;
  }

  log(`${equipamentos.length} equipamento(s) para sincronizar`);

  // Buscar registros de cada REP
  let todosRegistros = [];
  for (const eq of equipamentos) {
    const registros = await buscarRegistrosREP(eq, config);
    todosRegistros = todosRegistros.concat(registros);
  }

  // Enviar para o servidor
  if (todosRegistros.length > 0) {
    await enviarRegistros(config, todosRegistros);
  } else {
    log('Nenhum registro novo encontrado');
  }

  log(`Sincronizacao concluida`);
}

// Verificar conexao com internet
async function temConexao(servidor) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${servidor}/api/health`, {
      method: 'GET',
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

// Iniciar agente
async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('    AGENTE LOCAL GETPONTO - v1.3.0');
  console.log('    Suporta: Control iD (iDClass, iDX) e ZKTeco');
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  // Carregar ou criar configuracao
  let config = loadConfig();

  if (!config || !config.apiKey) {
    config = await configuracaoInicial();
  }

  log(`Servidor: ${config.servidor}`);
  log(`Intervalo: ${config.intervalo} segundos`);
  log('');

  let estavaSemConexao = false;

  // Loop de sincronizacao com deteccao de rede
  async function ciclo() {
    const temRede = await temConexao(config.servidor);

    if (temRede) {
      if (estavaSemConexao) {
        log('Conexao restabelecida! Sincronizando...');
        estavaSemConexao = false;
      }
      await sincronizar(config);
    } else {
      if (!estavaSemConexao) {
        log('AVISO: Sem conexao com o servidor. Aguardando...');
        estavaSemConexao = true;
      }
    }

    // Proximo ciclo
    setTimeout(ciclo, config.intervalo * 1000);
  }

  // Primeira sincronizacao
  await ciclo();

  log('');
  log('Agente rodando. Pressione Ctrl+C para encerrar.');
}

main().catch(err => {
  log(`ERRO fatal: ${err.message}`);
  process.exit(1);
});
