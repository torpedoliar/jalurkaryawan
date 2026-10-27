import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { Btn, S } from "../ui";

export type TicketCode = { qrPayload: string; expiresAt: string };
/** Server-issued opaque ticket only. Never generates a QR from a booking ID. */
export function Ticket({ ticket, onClose }: { ticket: TicketCode; onClose(): void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const valid = Number.isFinite(Date.parse(ticket.expiresAt)) && Date.parse(ticket.expiresAt) > now;
  return <View style={S.card}>
    <Text style={S.text}>Tiket QR pribadi. Jangan bagikan kepada orang lain.</Text>
    {valid ? <View accessibilityLabel="Kode QR tiket booking" style={{ alignItems: "center", padding: 20, backgroundColor: "white" }}><QRCode value={ticket.qrPayload} size={220} /></View>
      : <Text accessibilityRole="alert" style={S.text}>Tiket kedaluwarsa. Tutup dan minta tiket baru.</Text>}
    <Text style={S.text}>Berlaku sampai {ticket.expiresAt}. QR bukan bukti check-in.</Text>
    <Btn title="Tutup tiket" onPress={onClose} />
  </View>;
}
