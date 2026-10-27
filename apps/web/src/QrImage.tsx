import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Renders an opaque QR payload as an image. The payload text itself is never shown. */
export function QrImage({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" }).then((d) => { if (live) setSrc(d); }, () => { if (live) setSrc(""); });
    return () => { live = false; };
  }, [value, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt={label} /> : <div className="qr" style={{ width: size, height: size }} aria-label={label} />;
}
