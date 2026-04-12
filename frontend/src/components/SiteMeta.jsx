import { Helmet } from "react-helmet-async";

const SITE_URL = import.meta.env.VITE_SITE_URL || "https://igwtstore.com.ar";

export default function SiteMeta({
  title = "IGWT Store | Artículos y accesorios electrónicos",
  description = "Venta de artículos y accesorios electrónicos. Encontrá los mejores productos al mejor precio en IGWT Store.",
  image = `${SITE_URL}/og-image.png`,
  url = SITE_URL,
}) {
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />

      {/* Open Graph */}
      <meta property="og:type"        content="website" />
      <meta property="og:url"         content={url} />
      <meta property="og:title"       content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image"       content={image} />
      <meta property="og:locale"      content="es_AR" />
      <meta property="og:site_name"   content="IGWT Store" />

      {/* Twitter Card */}
      <meta name="twitter:card"        content="summary_large_image" />
      <meta name="twitter:title"       content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image"       content={image} />
    </Helmet>
  );
}
