// Servis teşhisi için saf (G/Ç yapmayan) yardımcılar. G/Ç `doctor.mjs` ve `dev.mjs` içinde kalır,
// böylece bu kurallar Docker, ağ ya da MySQL olmadan test edilebilir.

/** mysql://user:pass@host:port/db → {user, host, port, database}. Parola döndürülmez. */
export function parseDatabaseUrl(url) {
  try {
    const u = new URL(url)
    return {
      user: decodeURIComponent(u.username),
      host: u.hostname,
      port: Number(u.port || 3306),
      database: u.pathname.replace(/^\//, ''),
    }
  } catch {
    return null
  }
}

/** Günlüğe ve ekrana yazılabilsin diye parolayı gizler. */
export function maskDatabaseUrl(url) {
  return String(url).replace(/(\/\/[^:/@]+):[^@]*@/, '$1:***@')
}

/** `localhost` Windows'ta IPv6'ya (::1) çözülebilir; Docker yalnız 127.0.0.1'i yayınlar. */
export function prefersLoopbackIp(url) {
  return /^(mysql|mariadb):\/\/[^@]+@localhost[:/]/.test(String(url))
}

export function useLoopbackIp(url) {
  return String(url).replace(/^((?:mysql|mariadb):\/\/[^@]+@)localhost([:/])/, '$1127.0.0.1$2')
}

/** `docker ps -a --format "{{.Names}}|{{.State}}|{{.Status}}"` çıktısı → satır nesneleri. */
export function parseDockerPs(text) {
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, state, ...status] = l.split('|')
      return { name, state, status: status.join('|') }
    })
}

/** MySQL'i bu proje Docker ile yönetiyor mu? (kurulum .env.docker üretmişse ve adres yerelse) */
export function usesDockerMysql({ envDockerExists, host }) {
  return Boolean(envDockerExists) && ['localhost', '127.0.0.1', '::1'].includes(host)
}

/**
 * Docker kontrolünün sonucu: 'skipped' ise Docker bu kurulum için gerekli değildir.
 * Docker kapalı olsa bile veritabanı ulaşılabilirse MySQL başka yoldan sağlanıyordur.
 */
export function effectiveDockerStatus({ dockerStatus, mysqlReachable, envDockerExists, host }) {
  if (!usesDockerMysql({ envDockerExists, host })) return 'skipped'
  if (dockerStatus !== 'running' && mysqlReachable) return 'skipped'
  return dockerStatus
}

/** knot_mysql konteynerinin durumu: missing | stopped | starting | healthy | running. */
export function mysqlContainerState(rows, name = 'knot_mysql') {
  const row = rows.find((r) => r.name === name)
  if (!row) return 'missing'
  if (row.state !== 'running') return 'stopped'
  if (/health: starting|starting/i.test(row.status)) return 'starting'
  if (/unhealthy/i.test(row.status)) return 'unhealthy'
  if (/\(healthy\)/i.test(row.status)) return 'healthy'
  return 'running'
}

/** Windows `netstat -ano` çıktısından bir portu dinleyen süreç numaraları. */
export function listeningPidsFromNetstat(text, port) {
  const pids = new Set()
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i)
    if (m && Number(m[1]) === Number(port)) pids.add(Number(m[2]))
  }
  return [...pids]
}

/** Dinleyen süreç bizim izlediğimiz biri mi, yoksa başkasının mı? */
export function classifyPortOwner(listenerPids, trackedPids) {
  if (!listenerPids.length) return 'free'
  const tracked = new Set(trackedPids)
  return listenerPids.every((p) => tracked.has(p)) ? 'ours' : 'foreign'
}

/** Ollama /v1/models cevabından model adları. */
export function modelNames(body) {
  const list = Array.isArray(body?.data) ? body.data : []
  return list.map((m) => m?.id).filter((x) => typeof x === 'string')
}

const level = (l, text, fix = null) => ({ level: l, text, fix })

/**
 * Toplanan olgulardan teşhis listesi üretir. Her madde: ok | warn | fail ve (varsa) ne yapılacağı.
 * facts: {node, docker, mysqlState, mysqlReachable, databaseUrl, ports, ollama, llm, envFiles}
 */
export function diagnose(f) {
  const out = []
  const [major, minor] = String(f.node || '0.0').split('.').map(Number)
  out.push(
    major > 20 || (major === 20 && minor >= 19)
      ? level('ok', `Node.js ${f.node}`)
      : level('fail', `Node.js ${f.node} çok eski`, 'Node.js 20.19 veya üstünü kurun (önerilen 22).'),
  )

  for (const file of f.envFiles?.missing ?? [])
    out.push(level('fail', `${file} yok`, 'Önce şunu çalıştırın: npm run setup'))

  if (f.docker === 'running') out.push(level('ok', 'Docker çalışıyor'))
  else if (f.docker === 'skipped') out.push(level('ok', 'Docker kullanılmıyor (harici veritabanı)'))
  else
    out.push(
      level('fail', f.docker === 'missing' ? 'Docker kurulu değil' : 'Docker çalışmıyor', 'Docker Desktop\'ı açın, hazır olunca tekrar deneyin.'),
    )

  const state = f.mysqlState
  if (f.docker === 'running') {
    if (state === 'healthy') out.push(level('ok', 'MySQL konteyneri sağlıklı (knot_mysql)'))
    else if (state === 'starting') out.push(level('warn', 'MySQL konteyneri açılıyor', '20–40 saniye bekleyip tekrar deneyin.'))
    else if (state === 'stopped')
      out.push(level('fail', 'MySQL konteyneri kapalı (Docker yeniden başlayınca kendiliğinden açılmaz)', 'docker start knot_mysql   (ya da: npm run start:all)'))
    else if (state === 'unhealthy')
      out.push(level('fail', 'MySQL konteyneri sağlıksız', 'Günlüğe bakın: docker logs knot_mysql --tail 30'))
    else if (state === 'missing')
      out.push(level('fail', 'MySQL konteyneri yok', 'docker compose --env-file .env.docker up -d db   (ya da: npm run setup)'))
    else out.push(level('warn', `MySQL konteyner durumu belirsiz: ${state}`))
  }

  if (f.databaseUrl) {
    const db = parseDatabaseUrl(f.databaseUrl)
    if (!db) out.push(level('fail', 'backend/.env içindeki DATABASE_URL okunamadı'))
    else {
      out.push(
        f.mysqlReachable
          ? level('ok', `Veritabanına bağlanılabiliyor (${db.host}:${db.port})`)
          : level('fail', `Veritabanına bağlanılamıyor (${db.host}:${db.port})`, 'MySQL konteynerinin sağlıklı olduğundan ve portun doğru olduğundan emin olun.'),
      )
      if (f.mysqlReachable && f.dbLogin && !f.dbLogin.skipped)
        out.push(
          f.dbLogin.ok
            ? level('ok', 'Veritabanına giriş yapılabiliyor (backend sürücüsüyle)')
            : level('fail', `Veritabanına giriş yapılamıyor: ${f.dbLogin.error}`, 'Önce: cd backend && npm run build (güncel kodla dene). Sürerse backend/.env içindeki kullanıcı adı/şifre yanlış olabilir (sürücü bunu da "pool timeout" diye bildirir); docker logs knot_mysql çıktısına bakın.'),
        )
      if (prefersLoopbackIp(f.databaseUrl))
        out.push(level('warn', 'DATABASE_URL "localhost" kullanıyor; Windows\'ta IPv6\'ya çözülüp bağlantı zaman aşımına uğrayabilir', 'npm run doctor -- --fix   (adresi 127.0.0.1 yapar)'))
    }
  }

  for (const [name, p] of Object.entries(f.ports ?? {})) {
    if (p.owner === 'free') out.push(level('ok', `${name} portu (${p.port}) boş`))
    else if (p.owner === 'ours') out.push(level('ok', `${name} (${p.port}) K-not tarafından çalışıyor`))
    else
      out.push(
        level('fail', `${name} portunu (${p.port}) başka bir program tutuyor${p.pids?.length ? ` (PID ${p.pids.join(', ')})` : ''}`,
          'Önce npm run stop:all deneyin; sorun sürerse o programı kapatın. K-not eski süreçle konuşmasın diye başlatma durur.'),
      )
  }

  if (f.llm?.configured) {
    if (!f.ollama?.reachable) out.push(level('warn', `Yerel model sunucusuna ulaşılamıyor (${f.llm.baseUrl})`, 'Ollama\'yı açın. Özet ve sınav stili soru üretimi bu olmadan 503 verir.'))
    else if (!f.ollama.models.includes(f.llm.model))
      out.push(level('warn', `"${f.llm.model}" modeli Ollama'da yok`, `ollama pull ${f.llm.model}`))
    else out.push(level('ok', `Yerel model hazır: ${f.llm.model}`))
  } else out.push(level('warn', 'Yerel model ayarlı değil (UNIFIED_LLM_BASE_URL / UNIFIED_LLM_MODEL)', 'ai-service/.env içine ekleyin; özet ve sınav üretimi için gerekli.'))

  if (f.poppler === false)
    out.push(level('warn', 'Poppler (pdftoppm) kurulu değil: PDF sayfa görüntüleri ve taranmış PDF okuma çalışmaz ("Görüntü açılamadı")', 'Windows: winget install oschwartz10612.Poppler  (ya da scoop install poppler), sonra yeni terminal açıp start:all. Metin soruları etkilenmez.'))
  if (f.modelProbe)
    out.push(
      f.modelProbe.ok
        ? level('ok', `Model gerçekten yanıt veriyor (${Math.round(f.modelProbe.ms / 100) / 10} sn)`)
        : level('fail', `Model yanıt vermiyor: ${f.modelProbe.error}`, 'Quiz ve özet üretilemez. "ollama run <model>" ile modelin açıldığını doğrulayın; bellek yetmiyorsa daha küçük model seçin.'),
    )
  return out
}

export const hasFailure = (items) => items.some((i) => i.level === 'fail')

export function formatReport(items) {
  const icon = { ok: '✓', warn: '!', fail: '✗' }
  return items.map((i) => `  ${icon[i.level]} ${i.text}${i.fix ? `\n      → ${i.fix}` : ''}`).join('\n')
}
