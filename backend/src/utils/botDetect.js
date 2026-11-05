// ¿El pedido viene de un robot? Buscadores (Google, Bing), verificadores de anuncios y de catálogos (Meta,
// TikTok), herramientas de SEO y programas que manejan un navegador. No son visitantes: cada página que
// recorrían contaba como un visitante nuevo de una sola acción y las analíticas mostraban miles de
// "visitas" que nadie hizo (05/11/2026: 1.169 en tres horas).
//
// Se mira solo el User-Agent, que es lo que hay sin guardar nada del visitante. Un robot que se hace pasar
// por un navegador común no se detecta acá; para eso las analíticas muestran aparte cuántos visitantes
// hicieron dos o más acciones.
//
// (?<!cu)bot: "Googlebot", "bingbot", "AdsBot-Google"... pero no los celulares de la marca Cubot.
// Los navegadores de las apps de Instagram, Facebook y TikTok NO son robots: no llevan ninguna de estas
// palabras (el robot de Facebook es "facebookexternalhit"; el de TikTok, "Bytespider" o "TikTokSpider").
const BOT_UA = /(?<!cu)bot\b|crawl|spider|slurp|facebookexternalhit|facebookcatalog|meta-external|headlesschrome|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|statuscake|bingpreview|google-inspectiontool|mediapartners|feedfetcher|ia_archiver|curl\/|wget\/|python-|go-http-client|node-fetch|axios\/|okhttp|scrapy|libwww|phantomjs|puppeteer|playwright|selenium|whatsapp\/|skypeuripreview|embedly|quora link preview|vkshare/i;

function isBot(userAgent) {
  const ua = String(userAgent || "");
  return ua.length < 10 || BOT_UA.test(ua);
}

module.exports = { isBot };
