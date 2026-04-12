import { useLocation } from "react-router-dom";

const WHATSAPP_NUMBER = "5491150395166";

export default function WhatsAppButton() {
  const { pathname } = useLocation();

  // No mostrar en el panel de admin
  if (pathname.startsWith("/admin")) return null;

  return (
    <a
      href={`https://wa.me/${WHATSAPP_NUMBER}`}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full shadow-lg hover:scale-110 transition-transform"
      style={{ backgroundColor: "#25D366" }}
      aria-label="Contactar por WhatsApp"
    >
      <svg viewBox="0 0 32 32" width="30" height="30" fill="white" xmlns="http://www.w3.org/2000/svg">
        <path d="M16.003 2.667C8.639 2.667 2.667 8.639 2.667 16c0 2.354.636 4.559 1.743 6.461L2.667 29.333l7.077-1.716A13.267 13.267 0 0016.003 29.333C23.364 29.333 29.333 23.361 29.333 16S23.364 2.667 16.003 2.667zm0 24.267a11.012 11.012 0 01-5.64-1.555l-.404-.24-4.197 1.018 1.056-3.981-.264-.409A10.973 10.973 0 015.001 16c0-6.065 4.937-11 11.002-11C22.066 5 27 9.935 27 16s-4.934 11-10.997 11zm6.04-8.23c-.33-.165-1.953-.963-2.256-1.073-.303-.11-.523-.165-.743.165-.22.33-.853 1.073-1.045 1.293-.192.22-.385.247-.715.082-.33-.165-1.393-.514-2.653-1.638-.981-.875-1.643-1.956-1.835-2.286-.192-.33-.02-.508.144-.672.148-.147.33-.385.495-.577.165-.193.22-.33.33-.55.11-.22.055-.413-.027-.578-.083-.165-.744-1.793-1.018-2.455-.268-.645-.54-.557-.743-.568l-.633-.011c-.22 0-.578.082-.88.413-.302.33-1.154 1.128-1.154 2.751 0 1.622 1.182 3.191 1.347 3.411.165.22 2.327 3.554 5.641 4.985.789.34 1.404.543 1.884.695.791.252 1.511.216 2.08.131.635-.095 1.953-.799 2.228-1.57.275-.771.275-1.432.192-1.57-.082-.138-.302-.22-.633-.385z"/>
      </svg>
    </a>
  );
}
