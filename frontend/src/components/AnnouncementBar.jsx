import { useSiteConfig } from "../context/SiteConfigContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";

const BG_MAP = {
  blue:   "bg-blue-600",
  green:  "bg-emerald-600",
  amber:  "bg-amber-400",
  red:    "bg-red-600",
  slate:  "bg-slate-800",
  black:  "bg-black",
  purple: "bg-purple-600",
};

const TEXT_MAP = {
  white:  "text-white",
  black:  "text-black",
  yellow: "text-yellow-300",
  amber:  "text-amber-900",
  slate:  "text-slate-200",
};

function BannerRow({ banner }) {
  const bgCls   = BG_MAP[banner.bgColor]   || "bg-blue-600";
  const textCls = TEXT_MAP[banner.textColor] || "text-white";

  const renderContent = () => {
    const { text, linkText, url } = banner;
    if (!linkText || !url || !text.includes(linkText)) return text;
    const idx = text.indexOf(linkText);
    return (
      <>
        {text.slice(0, idx)}
        <a href={url} className="underline font-semibold hover:opacity-80 transition-opacity">
          {linkText}
        </a>
        {text.slice(idx + linkText.length)}
      </>
    );
  };

  return (
    <div className={`${bgCls} ${textCls} text-sm py-2 ${banner.scrollDir === "none" ? "text-center px-4" : "overflow-hidden"}`}>
      {banner.scrollDir === "none" ? (
        <span>{renderContent()}</span>
      ) : (
        <span className={banner.scrollDir === "rtl" ? "ann-rtl" : "ann-ltr"}>
          {renderContent()}
        </span>
      )}
    </div>
  );
}

export default function AnnouncementBar() {
  const { announcement } = useSiteConfig();
  const { customer } = useCustomerAuth();

  if (!announcement || !Array.isArray(announcement) || announcement.length === 0) return null;

  const customerType = customer?.type || "MINORISTA";

  const visible = announcement.filter((b) => {
    if (!b.active || !b.text) return false;
    if (b.visibleFor === "AMBOS") return true;
    return b.visibleFor === customerType;
  });

  if (visible.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes ann-ltr { 0% { transform: translateX(-100%); } 100% { transform: translateX(100vw); } }
        @keyframes ann-rtl { 0% { transform: translateX(100vw); } 100% { transform: translateX(-100%); } }
        .ann-ltr { display:inline-block; white-space:nowrap; animation: ann-ltr 22s linear infinite; }
        .ann-rtl { display:inline-block; white-space:nowrap; animation: ann-rtl 22s linear infinite; }
      `}</style>
      {visible.map((b) => <BannerRow key={b.id} banner={b} />)}
    </>
  );
}
