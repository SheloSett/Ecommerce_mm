const net = require("net");

// ¿La IP es de un nodo de Cloudflare? Si el backend ve una de estas como IP del cliente, es que Caddy
// no está pasando la IP real (ver deploy/igwtstore.caddy, @cloudflare + CF-Connecting-IP) y esa IP la
// comparten muchos clientes a la vez. Los límites por IP la usan para no castigar a todos juntos.
// Misma lista que la del Caddyfile: https://www.cloudflare.com/ips-v4 y /ips-v6.
const CLOUDFLARE_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CLOUDFLARE_V6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32",
];

const blockList = new net.BlockList();
for (const cidr of CLOUDFLARE_V4) { const [addr, prefix] = cidr.split("/"); blockList.addSubnet(addr, Number(prefix), "ipv4"); }
for (const cidr of CLOUDFLARE_V6) { const [addr, prefix] = cidr.split("/"); blockList.addSubnet(addr, Number(prefix), "ipv6"); }

function isCloudflareIp(ip) {
  if (!ip || typeof ip !== "string") return false;
  const clean = ip.replace(/^::ffff:/, ""); // IPv4 escrita como IPv6
  if (net.isIPv4(clean)) return blockList.check(clean, "ipv4");
  if (net.isIPv6(clean)) return blockList.check(clean, "ipv6");
  return false;
}

module.exports = { isCloudflareIp };
