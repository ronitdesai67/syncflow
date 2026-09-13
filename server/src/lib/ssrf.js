// SSRF (Server-Side Request Forgery) defense for the HTTP_REQUEST step.
//
// The whole premise of SyncFlow is "paste a URL and we'll call it from our
// server" — triggered by a public, unauthenticated webhook. Without this
// module an attacker could point a workflow's HTTP_REQUEST step at
// 127.0.0.1, an internal service, or the cloud metadata endpoint
// (169.254.169.254) and use this server as a proxy into private
// infrastructure. This module is the single choke point all HTTP_REQUEST
// execution must go through, on every trigger path (webhook, schedule,
// manual) — the validation lives here, not in the trigger layer, so it
// can never accidentally be bypassed by adding a new trigger type later.
const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Hostnames that should never resolve, rejected before any DNS lookup.
const FORBIDDEN_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::', '::0']);

// ipaddr.js classifies an address into a "range" (loopback, private,
// linkLocal, uniqueLocal, reserved, carrierGradeNat, multicast,
// broadcast, unspecified, unicast, ...). We allow ONLY "unicast" —
// a default-deny allowlist is safer than trying to enumerate every
// private/reserved block by hand.
const ALLOWED_RANGES = new Set(['unicast']);

class SSRFBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SSRFBlockedError';
  }
}

/**
 * Validates a target URL for the HTTP_REQUEST step and resolves it to a safe,
 * pinned IP address to connect to.
 *
 * IMPORTANT: this must be called immediately before every outbound request
 * (not just once at save time) — resolving once and reusing the result would
 * be vulnerable to DNS rebinding (the attacker's DNS answers a safe IP on the
 * first lookup, then a private IP on a second lookup performed later by the
 * HTTP client). By resolving here and then connecting directly to the
 * resolved IP (rather than letting the HTTP client re-resolve the hostname),
 * we close that gap.
 */
async function validateAndResolveUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SSRFBlockedError(`Invalid URL: "${rawUrl}"`);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new SSRFBlockedError(
      `Blocked: protocol "${parsed.protocol}" is not allowed (only http/https)`
    );
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (FORBIDDEN_HOSTNAMES.has(hostname)) {
    throw new SSRFBlockedError(`Blocked: hostname "${hostname}" is not allowed`);
  }

  // If the hostname is already a literal IP, ipaddr.js can classify it
  // directly without a DNS lookup.
  let addresses;
  if (ipaddr.isValid(hostname)) {
    addresses = [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv6' ? 6 : 4 }];
  } else {
    try {
      addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new SSRFBlockedError(`Blocked: could not resolve hostname "${hostname}"`);
    }
  }

  if (!addresses.length) {
    throw new SSRFBlockedError(`Blocked: hostname "${hostname}" did not resolve to any address`);
  }

  for (const { address } of addresses) {
    let range;
    try {
      range = ipaddr.process(address).range();
    } catch {
      throw new SSRFBlockedError(`Blocked: could not classify resolved address "${address}"`);
    }
    if (!ALLOWED_RANGES.has(range)) {
      throw new SSRFBlockedError(
        `Blocked: "${hostname}" resolved to ${address} (${range}), which is not a publicly routable address`
      );
    }
  }

  // Pin to the first validated address — this is the IP we will actually
  // connect to, bypassing any further DNS resolution by the HTTP client.
  return {
    hostname,
    protocol: parsed.protocol,
    port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
    path: `${parsed.pathname}${parsed.search}`,
    pinnedAddress: addresses[0].address,
    pinnedFamily: addresses[0].family,
  };
}

module.exports = { validateAndResolveUrl, SSRFBlockedError };
