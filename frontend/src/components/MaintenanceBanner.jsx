import { useState, useEffect } from "react";
import { useSiteConfig } from "../context/SiteConfigContext";

// Calcula el tiempo restante entre ahora y targetDate.
// Devuelve null si targetDate ya pasó o es null.
function getTimeLeft(targetDate) {
  if (!targetDate) return null;
  const diff = targetDate.getTime() - Date.now();
  if (diff <= 0) return null;

  const totalSeconds = Math.floor(diff / 1000);
  const days    = Math.floor(totalSeconds / 86400);
  const hours   = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
}

// Formatea una fecha en formato legible: "lun 14 de abr a las 15:30"
function formatDate(date) {
  return date.toLocaleString("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MaintenanceBanner() {
  const { scheduledAt, maintenance } = useSiteConfig();
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(scheduledAt));

  useEffect(() => {
    // Actualizar el countdown cada segundo
    const interval = setInterval(() => {
      setTimeLeft(getTimeLeft(scheduledAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [scheduledAt]);

  // No mostrar si:
  // - no hay fecha programada
  // - el mantenimiento ya está activo (la página de mantenimiento toma el control)
  // - el tiempo ya expiró (countdown llegó a 0)
  if (!scheduledAt || maintenance || !timeLeft) return null;

  const pad = (n) => String(n).padStart(2, "0");

  return (
    <div className="sticky top-0 w-full bg-amber-500 text-white px-4 py-2.5 flex items-center justify-center gap-3 text-sm font-medium z-50 shadow-sm">
      {/* Ícono */}
      <span className="text-base flex-shrink-0">🔧</span>

      {/* Mensaje */}
      <span className="hidden sm:inline">
        Mantenimiento programado para el {formatDate(scheduledAt)} —
      </span>
      <span className="sm:hidden">Mantenimiento en</span>

      {/* Countdown */}
      <span className="font-mono font-bold tracking-wider bg-amber-600/50 px-2.5 py-0.5 rounded-lg text-sm">
        {timeLeft.days > 0 && `${timeLeft.days}d `}
        {pad(timeLeft.hours)}:{pad(timeLeft.minutes)}:{pad(timeLeft.seconds)}
      </span>
    </div>
  );
}
