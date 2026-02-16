// scripts/rep-proxy.mjs
// Proxy para comunicação com múltiplos REPs Control iD
// Requer: node --insecure-http-parser scripts/rep-proxy.mjs

import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG_FILE = path.join(__dirname, 'proxy-log.txt')

function logToFile(msg) {
    const timestamp = new Date().toISOString()
    const logLine = `[${timestamp}] ${msg}\n`
    try {
        fs.appendFileSync(LOG_FILE, logLine)
    } catch {}
    console.log(msg)
}

const DB_CONFIG = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
}

const pool = new Pool(DB_CONFIG)
const PROXY_PORT = 3334
const REP_USER = 'admin'
const REP_PASS = '12345' // Idealmente viria do banco ou env

// Cache: { [rep_id]: { id, nome, ip, online, session, usuarios: Set<pis>, lastUpdate } }
let repsCache = {}
let funcionariosDbCache = [] // Cache da lista "oficial" do banco

// Parse do arquivo AFD (formato Portaria 671/1510)
function parseAFD(afdText) {
    const lines = afdText.split('\n').filter(l => l.trim())
    const registros = []

    for (const line of lines) {
        // Tipo 3 = Registro de ponto (batida)
        // Formato: NSR(9) + Tipo(1) + Data(8 DDMMAAAA) + Hora(4 HHMM) + PIS(12)
        if (line.length >= 34 && line.charAt(9) === '3') {
            const nsr = line.substring(0, 9)
            const data = line.substring(10, 18) // DDMMAAAA
            const hora = line.substring(18, 22) // HHMM
            const pis = line.substring(22, 34).trim()

            const dia = data.substring(0, 2)
            const mes = data.substring(2, 4)
            const ano = data.substring(4, 8)
            const hh = hora.substring(0, 2)
            const mm = hora.substring(2, 4)

            const dataHora = new Date(`${ano}-${mes}-${dia}T${hh}:${mm}:00`)

            registros.push({
                nsr,
                dataHora,
                pis,
                dataStr: `${dia}/${mes}/${ano}`,
                horaStr: `${hh}:${mm}`
            })
        }
    }

    return registros
}

// Helper para requests HTTPS ignorando SSL
function httpsRequest(ip, path, method, body = null) {
    return new Promise((resolve, reject) => {
        const bodyString = body ? JSON.stringify(body) : ''
        const options = {
            hostname: ip,
            port: 443,
            path: path,
            method: method,
            rejectUnauthorized: false,
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyString)
            }
        }
        const req = https.request(options, (res) => {
            let data = ''
            res.on('data', chunk => data += chunk)
            res.on('end', () => {
                try { resolve(JSON.parse(data)) }
                catch { resolve(data) }
            })
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
        if (bodyString) req.write(bodyString)
        req.end()
    })
}

// Carrega equipamentos do banco
async function carregarEquipamentos() {
    try {
        const client = await pool.connect()
        const res = await client.query(`
      SELECT id, nome, ip 
      FROM santo_andre.equipamentos 
      WHERE ativo = true AND ip IS NOT NULL AND ip != ''
    `)
        client.release()

        // Atualiza cache mantendo dados existentes se possível
        const novosReps = {}
        for (const row of res.rows) {
            novosReps[row.id] = {
                id: row.id,
                nome: row.nome,
                ip: row.ip,
                online: false,
                session: null,
                usuarios: repsCache[row.id]?.usuarios || new Set(),
                lastUpdate: null
            }
        }
        repsCache = novosReps
        console.log(`[REP Proxy] ${Object.keys(repsCache).length} equipamentos carregados`)
        return true
    } catch (err) {
        console.error('[REP Proxy] Erro ao carregar equipamentos:', err.message)
        return false
    }
}

// Carrega funcionários do banco (lista oficial)
async function carregarFuncionariosDb() {
    try {
        const client = await pool.connect()
        const res = await client.query(`
      SELECT id, nome, cpf, pis, matricula 
      FROM santo_andre.funcionarios 
      WHERE ativo = true
    `)
        client.release()

        funcionariosDbCache = res.rows.map(f => {
            let pis = f.pis?.replace(/\D/g, '') || ''
            if (!pis && f.cpf) pis = f.cpf.replace(/\D/g, '').padStart(11, '0')
            return {
                ...f,
                pis: pis ? pis.padStart(11, '0') : null
            }
        })
        console.log(`[REP Proxy] ${funcionariosDbCache.length} funcionários no banco`)
    } catch (err) {
        console.error('[REP Proxy] Erro ao carregar funcionários do DB:', err.message)
    }
}

// Verifica status e tenta listar usuários de um REP
async function verificarRep(repId) {
    const rep = repsCache[repId]
    if (!rep) return

    try {
        // 1. Login
        const loginData = await httpsRequest(rep.ip, '/login.fcgi', 'POST', { login: REP_USER, password: REP_PASS })
        if (!loginData.session) throw new Error('Falha login')

        rep.session = loginData.session
        rep.online = true

        // 2. Tenta listar usuários (se falhar, assume lista vazia ou mantém anterior)
        try {
            const usersData = await httpsRequest(rep.ip, `/load_objects.fcgi?session=${rep.session}`, 'POST', { object: 'users' })
            if (usersData.error || !usersData.users) {
                // Falha esperada em alguns modelos
            } else {
                rep.usuarios = new Set(usersData.users.map(u => u.pis))
            }
        } catch (e) {
            console.log(`[REP Proxy] Erro ao listar usuários de ${rep.nome}:`, e.message)
        }

        rep.lastUpdate = new Date().toISOString()
        console.log(`[REP Proxy] ${rep.nome} (${rep.ip}) Online`)

    } catch (err) {
        rep.online = false
        rep.session = null
        console.log(`[REP Proxy] ${rep.nome} (${rep.ip}) Offline: ${err.message}`)
    }
}

// Envia funcionário para um REP
async function sincronizarUsuario(repId, funcionarioId) {
    const rep = repsCache[repId]
    if (!rep || !rep.online || !rep.session) return { success: false, error: 'REP Offline' }

    const func = funcionariosDbCache.find(f => f.id == funcionarioId)
    if (!func || !func.pis) return { success: false, error: 'Funcionário sem PIS ou não encontrado' }

    try {
        // CORREÇÃO: PIS e Matrícula convertidos para INTEIROS
        const userPayload = {
            name: func.nome.substring(0, 50),
            registration: parseInt(func.matricula?.replace(/\D/g, '') || func.id),
            pis: parseInt(func.pis),
            password: ''
        }

        const res = await httpsRequest(rep.ip, `/update_users.fcgi?session=${rep.session}`, 'POST', {
            users: [userPayload]
        })

        if (res && !res.error) {
            rep.usuarios.add(func.pis) // Marca como presente localmente
            return { success: true }
        }
        return { success: false, error: JSON.stringify(res) }
    } catch (err) {
        return { success: false, error: err.message }
    }
}

// Loop de monitoramento
async function loopMonitoramento() {
    await carregarFuncionariosDb() // Atualiza DB
    const promises = Object.keys(repsCache).map(id => verificarRep(id))
    await Promise.all(promises)
}

// Servidor
const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')

    // Endpoint de Status/Lista
    if (req.url === '/status' || req.url === '/usuarios') {
        const response = {
            reps: Object.values(repsCache).map(r => ({ id: r.id, nome: r.nome, ip: r.ip, online: r.online })),
            sinc_status: {}
        }

        funcionariosDbCache.forEach(f => {
            if (f.pis) {
                const statusRep = {}
                Object.values(repsCache).forEach(r => {
                    statusRep[r.id] = r.usuarios.has(f.pis)
                })
                response.sinc_status[f.pis] = statusRep
            }
        })

        res.end(JSON.stringify(response))

    } else if (req.url === '/sincronizar' && req.method === 'POST') {
        let body = ''
        req.on('data', c => body += c)
        req.on('end', async () => {
            try {
                const { rep_id, funcionario_id } = JSON.parse(body)
                const result = await sincronizarUsuario(rep_id, funcionario_id)
                res.end(JSON.stringify(result))
            } catch (e) {
                res.end(JSON.stringify({ success: false, error: e.message }))
            }
        })

    } else if (req.url === '/sincronizar_tudo' && req.method === 'POST') {
        logToFile('[REP Proxy] Iniciando sincronização em massa...')
        let total = 0
        let sucessos = 0
        let erros = 0

        for (const repId of Object.keys(repsCache)) {
            const rep = repsCache[repId]
            if (!rep.online) continue

            console.log(`[REP Proxy] Enviando ${funcionariosDbCache.length} usuários para ${rep.nome}...`)

            for (const func of funcionariosDbCache) {
                if (!func.pis) continue
                total++
                const res = await sincronizarUsuario(repId, func.id)
                if (res.success) sucessos++
                else erros++
            }
        }

        console.log(`[REP Proxy] Sincronização finalizada: ${sucessos} sucessos, ${erros} erros.`)

        // --- INÍCIO IMPORTAÇÃO DO REP (Novos Funcionários) ---
        let totalImportados = 0
        logToFile('[REP Proxy] Verificando usuários novos nos REPs...')

        for (const repId of Object.keys(repsCache)) {
            const rep = repsCache[repId]
            if (!rep.online || !rep.session) continue

            try {
                // Carregar todos usuários do REP
                const dataRep = await httpsRequest(rep.ip, `/load_objects.fcgi?session=${rep.session}`, 'POST', {
                    object: 'users'
                })

                if (dataRep && dataRep.users) {
                    logToFile(`[REP Proxy] Analisando ${dataRep.users.length} usuários de ${rep.nome}...`)
                    const client = await pool.connect()

                    for (const uRep of dataRep.users) {
                        let pisStr = String(uRep.pis).trim();
                        let cpfStr = pisStr.padStart(11, '0').substring(0, 11); // Default: usa PIS como CPF

                        // SE NÃO TIVER PIS (ou for inválido), GERA SEQUENCIAL
                        if (!uRep.pis || uRep.pis.trim() === '') {
                            // console.log(`[REP Proxy] Usuário ${uRep.name} sem PIS. Gerando fictício...`)

                            // Busca maior CPF fictício no banco para incrementar
                            try {
                                const resMax = await client.query("SELECT MAX(cpf) as max_cpf FROM santo_andre.funcionarios WHERE cpf LIKE '000000%'");
                                let maxSeq = 0;
                                if (resMax.rows.length > 0 && resMax.rows[0].max_cpf) {
                                    const currentMax = resMax.rows[0].max_cpf;
                                    maxSeq = parseInt(currentMax);
                                }

                                const newSeq = maxSeq + 1;
                                const newSeqStr = String(newSeq).padStart(11, '0');

                                pisStr = newSeqStr; // Usa o mesmo para Matrícula/PIS
                                cpfStr = newSeqStr;

                                logToFile(`[REP Proxy] Gerado CPF/PIS sequencial para ${uRep.name}: ${newSeqStr}`);
                            } catch (errSeq) {
                                logToFile(`[REP Proxy ERROR] Erro ao gerar sequência: ${errSeq.message}`);
                                continue;
                            }
                        }

                        // Verifica se já existe no cache (por PIS ou Nome, para evitar duplicar quem tem nome mas não PIS)
                        // A busca por nome é perigosa se houver homônimos, mas para "sem CPF" é o único jeito de não duplicar se já foi importado
                        const existe = funcionariosDbCache.find(f =>
                            String(f.pis).trim() === pisStr ||
                            (pisStr.startsWith('000000') && f.nome.toLowerCase() === uRep.name.toLowerCase())
                        )

                        if (!existe) {
                            logToFile(`[REP Proxy] Usuário novo encontrado no REP ${rep.nome}: ${uRep.name} (PIS: ${pisStr})`)

                            // Tenta inserir
                            try {
                                await client.query(`
                                    INSERT INTO santo_andre.funcionarios 
                                    (matricula, cpf, pis, nome, data_admissao, ativo, created_at, updated_at)
                                    VALUES ($1, $2, $3, $4, NOW(), true, NOW(), NOW())
                                    ON CONFLICT (pis) DO NOTHING
                                `, [
                                    pisStr, // Matrícula
                                    cpfStr, // CPF
                                    pisStr, // PIS
                                    uRep.name
                                ])
                                totalImportados++
                            } catch (errInsert) {
                                console.error(`[REP Proxy] Erro ao importar ${uRep.name}:`, errInsert.message)
                            }
                        }
                    }
                    client.release()
                }
            } catch (e) {
                console.error(`[REP Proxy] Erro ao ler usuários do REP ${rep.nome} para importação:`, e.message)
            }
        }

        // Recarrega cache se houve importação
        if (totalImportados > 0) {
            console.log(`[REP Proxy] ${totalImportados} usuários importados. Recarregando cache...`)
            await carregarFuncionariosDb()
        }
        // --- FIM IMPORTAÇÃO ---

        res.end(JSON.stringify({ success: true, total, sucessos, erros, importados: totalImportados }))

    } else if (req.url === '/refresh') {
        await carregarEquipamentos()
        await loopMonitoramento()
        res.end(JSON.stringify({ success: true }))

        // ============ ENDPOINTS DE DIGITAIS ============

    } else if (req.url.startsWith('/digitais/baixar/') && req.method === 'POST') {
        // Baixa digitais de um funcionário do REP e salva no banco
        const funcionarioId = parseInt(req.url.split('/').pop())
        const func = funcionariosDbCache.find(f => f.id == funcionarioId)
        if (!func || !func.pis) {
            res.end(JSON.stringify({ success: false, error: 'Funcionário não encontrado' }))
            return
        }

        let digitaisEncontradas = 0

        for (const rep of Object.values(repsCache)) {
            if (!rep.online || !rep.session) continue

            try {
                // Busca templates do usuário pelo PIS (usando String para preservar zeros à esquerda)
                const pisParaBusca = func.pis.toString().trim()
                console.log(`[REP Proxy] Buscando templates para PIS: ${pisParaBusca} no REP ${rep.nome}`)

                const data = await httpsRequest(rep.ip, `/load_objects.fcgi?session=${rep.session}`, 'POST', {
                    object: 'templates',
                    where: { users: { pis: pisParaBusca } }
                })

                console.log(`[REP Proxy] Resposta do REP ${rep.nome}:`, JSON.stringify(data).substring(0, 200))

                if (data.templates && data.templates.length > 0) {
                    const client = await pool.connect()
                    for (const tpl of data.templates) {
                        await client.query(`
                            INSERT INTO santo_andre.funcionarios_digitais 
                            (funcionario_id, finger_type, template, updated_at)
                            VALUES ($1, $2, $3, NOW())
                            ON CONFLICT (funcionario_id, finger_type) 
                            DO UPDATE SET template = $3, updated_at = NOW()
                        `, [funcionarioId, tpl.finger_type || 0, tpl.template])
                        digitaisEncontradas++
                    }
                    client.release()
                    console.log(`[REP Proxy] ${digitaisEncontradas} digitais baixadas de ${rep.nome} para func ${funcionarioId}`)
                    break // Encontrou em um REP, não precisa continuar
                }
            } catch (e) {
                console.log(`[REP Proxy] Erro ao baixar digitais de ${rep.nome}:`, e.message)
            }
        }

        res.end(JSON.stringify({ success: true, digitais: digitaisEncontradas }))

    } else if (req.url.startsWith('/digitais/enviar/') && req.method === 'POST') {
        // Envia digitais do banco para todos os REPs
        const funcionarioId = parseInt(req.url.split('/').pop())
        const func = funcionariosDbCache.find(f => f.id == funcionarioId)
        if (!func || !func.pis) {
            res.end(JSON.stringify({ success: false, error: 'Funcionário não encontrado' }))
            return
        }

        // Busca digitais do banco
        const client = await pool.connect()
        const result = await client.query(
            'SELECT finger_type, template FROM santo_andre.funcionarios_digitais WHERE funcionario_id = $1',
            [funcionarioId]
        )
        client.release()

        if (result.rows.length === 0) {
            res.end(JSON.stringify({ success: false, error: 'Nenhuma digital cadastrada no banco' }))
            return
        }

        let enviados = 0
        let erros = 0

        for (const rep of Object.values(repsCache)) {
            if (!rep.online || !rep.session) continue

            try {
                // Primeiro garante que o usuário existe no REP
                await sincronizarUsuario(rep.id, funcionarioId)

                // Envia cada template
                for (const dig of result.rows) {
                    const tplData = await httpsRequest(rep.ip, `/create_objects.fcgi?session=${rep.session}`, 'POST', {
                        object: 'templates',
                        values: [{
                            user_id: parseInt(func.pis),
                            finger_type: dig.finger_type,
                            template: dig.template
                        }]
                    })

                    if (tplData && !tplData.error) enviados++
                    else erros++
                }
            } catch (e) {
                console.log(`[REP Proxy] Erro ao enviar digitais para ${rep.nome}:`, e.message)
                erros++
            }
        }

        res.end(JSON.stringify({ success: true, enviados, erros }))

    } else if (req.url.startsWith('/digitais/listar/')) {
        // Lista digitais de um funcionário no banco
        const funcionarioId = parseInt(req.url.split('/').pop())
        const client = await pool.connect()
        const result = await client.query(
            'SELECT id, finger_type, created_at, updated_at FROM santo_andre.funcionarios_digitais WHERE funcionario_id = $1',
            [funcionarioId]
        )
        client.release()
        res.end(JSON.stringify({ success: true, digitais: result.rows }))

    } else if (req.url === '/afd/importar' && req.method === 'POST') {
        // Importa registros AFD de todos os REPs online
        let body = ''
        req.on('data', c => body += c)
        req.on('end', async () => {
            try {
                const { data_inicial } = JSON.parse(body || '{}')
                console.log(`[REP Proxy] Importando AFD... Data inicial: ${data_inicial || 'todas'}`)

                let totalImportados = 0
                let totalDuplicados = 0
                let totalIgnorados = 0
                let totalErros = 0

                for (const rep of Object.values(repsCache)) {
                    if (!rep.online || !rep.session) continue

                    console.log(`[REP Proxy] Buscando AFD de ${rep.nome}...`)

                    try {
                        // Busca AFD do REP
                        let params = {}
                        if (data_inicial) {
                            const dataInicial = new Date(data_inicial + 'T00:00:00')
                            params.initial_date = Math.floor(dataInicial.getTime() / 1000)
                        }

                        const afdData = await httpsRequest(rep.ip, `/get_afd.fcgi?session=${rep.session}`, 'POST', params)

                        // Parse do AFD (formato texto ou JSON)
                        let registros = []
                        if (typeof afdData === 'string') {
                            registros = parseAFD(afdData)
                        } else if (afdData.records) {
                            registros = afdData.records
                        }

                        console.log(`[REP Proxy] ${registros.length} registros encontrados em ${rep.nome}`)

                        // Importa para o banco
                        const client = await pool.connect()

                        for (const reg of registros) {
                            try {
                                // Filtra por data
                                if (data_inicial) {
                                    const dataReg = reg.dataHora.toISOString().split('T')[0]
                                    if (dataReg < data_inicial) {
                                        totalIgnorados++
                                        continue
                                    }
                                }

                                // Busca funcionário
                                const funcRes = await client.query(
                                    'SELECT id FROM santo_andre.funcionarios WHERE pis = $1 LIMIT 1',
                                    [reg.pis]
                                )
                                if (funcRes.rows.length === 0) {
                                    totalErros++
                                    continue
                                }

                                const funcId = funcRes.rows[0].id

                                // Verifica duplicidade
                                const dupRes = await client.query(
                                    'SELECT id FROM santo_andre.registros_ponto WHERE funcionario_id = $1 AND nsr = $2',
                                    [funcId, reg.nsr]
                                )
                                if (dupRes.rows.length > 0) {
                                    totalDuplicados++
                                    continue
                                }

                                // Calcula sentido
                                const dataRegistro = reg.dataHora.toISOString().split('T')[0]
                                const batidasRes = await client.query(
                                    'SELECT COUNT(*) as total FROM santo_andre.registros_ponto WHERE funcionario_id = $1 AND DATE(data_hora) = $2',
                                    [funcId, dataRegistro]
                                )
                                const totalBatidas = parseInt(batidasRes.rows[0].total || '0')
                                const sentido = totalBatidas % 2 === 0 ? 'ENTRADA' : 'SAIDA'

                                // Insere
                                await client.query(
                                    `INSERT INTO santo_andre.registros_ponto
                                     (funcionario_id, equipamento_id, data_hora, sentido, tipo, origem, nsr, pis, created_at)
                                     VALUES ($1, $2, $3, $4, 'ORIGINAL', 'AFD_REP', $5, $6, NOW())`,
                                    [funcId, rep.id, reg.dataHora, sentido, reg.nsr, reg.pis]
                                )
                                totalImportados++

                            } catch (err) {
                                totalErros++
                            }
                        }

                        client.release()

                    } catch (err) {
                        console.error(`[REP Proxy] Erro ao buscar AFD de ${rep.nome}:`, err.message)
                    }
                }

                res.end(JSON.stringify({
                    success: true,
                    importados: totalImportados,
                    duplicados: totalDuplicados,
                    ignorados: totalIgnorados,
                    erros: totalErros
                }))

            } catch (e) {
                res.end(JSON.stringify({ success: false, error: e.message }))
            }
        })

    } else if (req.url.startsWith('/digitais/capturar/') && req.method === 'POST') {
        // Captura remota de digital via REP
        let body = ''
        req.on('data', c => body += c)
        req.on('end', async () => {
            try {
                const { rep_id, finger_type } = JSON.parse(body)
                const funcionarioId = parseInt(req.url.split('/').pop())
                const client = await pool.connect()
                const result = await client.query('SELECT * FROM santo_andre.funcionarios WHERE id = $1', [funcionarioId])
                const func = result.rows[0]

                console.log(`[REP Proxy] Buscando funcionário ID: ${funcionarioId}. Encontrado: ${func ? 'SIM' : 'NÃO'}`)

                if (!func || !func.pis) {
                    client.release()
                    console.error(`[REP Proxy] Erro: Funcionário ${funcionarioId} não encontrado ou sem PIS.`)
                    res.end(JSON.stringify({ success: false, error: 'Funcionário não encontrado no banco de dados' }))
                    return
                }

                const rep = repsCache[rep_id]
                if (!rep || !rep.online || !rep.session) {
                    client.release()
                    res.end(JSON.stringify({ success: false, error: 'REP offline' }))
                    return
                }

                // Verifica limite de 3 digitais
                // client já está aberto, reutiliza
                const countResult = await client.query(
                    'SELECT COUNT(*) FROM santo_andre.funcionarios_digitais WHERE funcionario_id = $1',
                    [funcionarioId]
                )

                if (parseInt(countResult.rows[0].count) >= 3) {
                    client.release()
                    res.end(JSON.stringify({ success: false, error: 'Limite de 3 digitais atingido' }))
                    return
                }

                // Garante que usuário existe no REP antes de capturar
                await sincronizarUsuario(rep_id, funcionarioId)

                console.log(`[REP Proxy] Iniciando captura remota para ${func.nome} no ${rep.nome}...`)

                // Envia comando de captura remota síncrona
                try {
                    const enrollResult = await httpsRequest(rep.ip, `/remote_enroll.fcgi?session=${rep.session}`, 'POST', {
                        type: 'fp', // fingerprint
                        save: true,
                        sync: true,
                        user_id: parseInt(func.pis)
                    })

                    if (enrollResult && enrollResult.template) {
                        // Salva no banco
                        await client.query(`
                            INSERT INTO santo_andre.funcionarios_digitais 
                            (funcionario_id, finger_type, template, updated_at)
                            VALUES ($1, $2, $3, NOW())
                            ON CONFLICT (funcionario_id, finger_type) 
                            DO UPDATE SET template = $3, updated_at = NOW()
                        `, [funcionarioId, finger_type || 0, enrollResult.template])

                        client.release()
                        console.log(`[REP Proxy] Digital capturada com sucesso para ${func.nome}`)
                        res.end(JSON.stringify({ success: true, message: 'Digital capturada com sucesso!' }))
                    } else {
                        client.release()
                        console.log('[REP Proxy] Falha na captura:', enrollResult)
                        res.end(JSON.stringify({ success: false, error: 'Tempo esgotado ou falha na captura. Tente novamente.' }))
                    }
                } catch (err) {
                    client.release()
                    console.error('[REP Proxy] Erro no remote_enroll:', err.message)

                    if (err.message.includes('Invalid command') || err.message.includes('404')) {
                        res.end(JSON.stringify({
                            success: false,
                            error: 'Seu modelo de REP não suporta captura remota via sistema. Por favor, cadastre a digital no menu do REP e use a opção "Baixar do REP".'
                        }))
                    } else {
                        res.end(JSON.stringify({ success: false, error: 'Erro na comunicação com REP: ' + err.message }))
                    }
                }

            } catch (e) {
                console.log(`[REP Proxy] Erro na captura remota: `, e.message)
                res.end(JSON.stringify({ success: false, error: e.message }))
            }
        })

    } else {
        res.end(JSON.stringify({ error: 'Endpoint inválido' }))
    }
})

// Inicialização
carregarEquipamentos().then(() => {
    loopMonitoramento()
    // Atualiza status a cada 5 minutos
    setInterval(loopMonitoramento, 5 * 60 * 1000)
    server.listen(PROXY_PORT, () => {
        console.log(`[REP Proxy] Múltiplos REPs rodando na porta ${PROXY_PORT} `)
    })
})
