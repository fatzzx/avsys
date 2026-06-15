import { redis } from '../../config/redis'

// Script Lua atômico: só deleta a chave se o valor for o token do dono do lock.
// Garante que um processo não libere o lock de outro processo em caso de expiração de TTL.
const RELEASE_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`

export abstract class DistributedLockService {
  /**
   * Tenta adquirir o lock.
   * Usa SET NX EX — atômico no Redis (single-threaded):
   *   NX = "set only if Not eXists"
   *   EX ttlSeconds = expira automaticamente após ttlSeconds (anti-deadlock)
   *
   * Retorna true se o lock foi adquirido, false se já estava tomado.
   */
  static async acquire(key: string, token: string, ttlSeconds: number): Promise<boolean> {
    const result = await redis.set(key, token, 'EX', ttlSeconds, 'NX')
    return result === 'OK'
  }

  /**
   * Libera o lock, mas APENAS se este processo for o dono (token correto).
   * O script Lua garante que a verificação + deleção seja uma operação atômica.
   */
  static async release(key: string, token: string): Promise<void> {
    await redis.eval(RELEASE_LUA, 1, key, token)
  }
}
