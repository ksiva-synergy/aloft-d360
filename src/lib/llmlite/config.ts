import 'server-only';
import dns from 'node:dns';
import https from 'node:https';

/**
 * Known public CNAME target and static fallback IPs for `aigw.synergymarinegroup.com`.
 * In the AWS VPC, a private Route 53 hosted zone for `synergymarinegroup.com` can shadow
 * the public DNS record for `aigw.synergymarinegroup.com` (`getaddrinfo ENOTFOUND`),
 * while `*.elb.amazonaws.com` always resolves inside the AWS VPC.
 */
const AIGW_ELB_CNAME = 'k8s-litellmg-litellmi-eb153028d2-585642608.ap-south-1.elb.amazonaws.com';
const AIGW_FALLBACK_IPS = ['13.207.65.190', '65.1.207.73'];

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

const origLookup = dns.lookup.bind(dns);
const publicResolver = new dns.promises.Resolver();
try {
  publicResolver.setServers(['1.1.1.1', '8.8.8.8']);
} catch {
  /* ignore if setServers is restricted */
}

const dohCache = new Map<string, { ips: string[]; expiresAt: number }>();

function resolveViaDoh(hostname: string): Promise<string[]> {
  const cached = dohCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.ips);

  return new Promise((resolve) => {
    const req = https.get(
      `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      { headers: { Accept: 'application/dns-json' }, timeout: 2500 },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw) as { Answer?: { type: number; data: string }[] };
            const ips = (parsed.Answer ?? [])
              .filter((a) => a.type === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(a.data))
              .map((a) => a.data);
            if (ips.length > 0) {
              dohCache.set(hostname, { ips, expiresAt: Date.now() + 60_000 });
            }
            resolve(ips);
          } catch {
            resolve([]);
          }
        });
      },
    );
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

async function resolveFallbackIps(hostname: string): Promise<string[]> {
  // 1. If this is the Synergy AI gateway, resolve its underlying AWS ELB hostname via VPC DNS
  if (hostname.toLowerCase() === 'aigw.synergymarinegroup.com') {
    const elbIps = await new Promise<string[]>((resolve) => {
      origLookup(AIGW_ELB_CNAME, { all: true, family: 4 }, (err, addrs) => {
        if (!err && Array.isArray(addrs) && addrs.length > 0) {
          resolve(addrs.map((a) => a.address));
        } else {
          resolve([]);
        }
      });
    });
    if (elbIps.length > 0) return elbIps;
  }

  // 2. Public UDP DNS (1.1.1.1 / 8.8.8.8)
  try {
    const ips = await publicResolver.resolve4(hostname);
    if (ips && ips.length > 0) return ips;
  } catch {
    /* fall through to DoH */
  }

  // 3. DNS-over-HTTPS over TCP 443
  const dohIps = await resolveViaDoh(hostname);
  if (dohIps.length > 0) return dohIps;

  // 4. Static fallback for aigw.synergymarinegroup.com
  if (hostname.toLowerCase() === 'aigw.synergymarinegroup.com') {
    return AIGW_FALLBACK_IPS;
  }

  return [];
}

let dnsFallbackInstalled = false;

export function ensureLlmLiteDnsFallback(): void {
  if (dnsFallbackInstalled) return;
  dnsFallbackInstalled = true;

  const patchedLookup = ((
    hostname: string,
    options: dns.LookupOptions | number | LookupCallback,
    callback?: LookupCallback,
  ) => {
    let opts: dns.LookupOptions = {};
    let cb: LookupCallback;
    if (typeof options === 'function') {
      cb = options;
    } else if (typeof options === 'number') {
      opts = { family: options };
      cb = callback!;
    } else {
      opts = options ?? {};
      cb = callback!;
    }

    origLookup(hostname, opts, (err, address, family) => {
      if (!err || (err.code !== 'ENOTFOUND' && err.code !== 'EAI_AGAIN')) {
        return cb(err, address, family);
      }
      void resolveFallbackIps(hostname).then((ips) => {
        if (!ips || ips.length === 0) return cb(err, address, family);
        if (opts.all) {
          return cb(
            null,
            ips.map((ip) => ({ address: ip, family: 4 })),
          );
        }
        return cb(null, ips[0], 4);
      });
    });
  }) as typeof dns.lookup;

  try {
    dns.lookup = patchedLookup;
  } catch {
    /* ignore if read-only in test runner */
  }
}

ensureLlmLiteDnsFallback();

/** OpenAI-compatible Synergy LLM Lite gateway (LiteLLM proxy). */
export function getLlmLiteBaseUrl(): string | null {
  ensureLlmLiteDnsFallback();
  const raw =
    process.env.LLMLITE_BASE_URL?.trim() ||
    process.env.llmlite_base_url?.trim() ||
    '';
  return raw ? raw.replace(/\/$/, '') : null;
}

export function getLlmLiteApiKey(): string | null {
  const raw =
    process.env.LLMLITE_API_KEY?.trim() ||
    process.env.llmlite_api_key?.trim() ||
    '';
  return raw || null;
}

export function isLlmLiteConfigured(): boolean {
  return !!(getLlmLiteBaseUrl() && getLlmLiteApiKey());
}
