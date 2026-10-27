import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text as MockText } from "react-native";
import { Scanner } from "../src/screens/Scanner";

jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
  CameraView: ({ onBarcodeScanned }: { onBarcodeScanned?: (event: { data: string }) => void }) =>
    <MockText testID="camera" onPress={() => onBarcodeScanned?.({ data: "signed-qr" })}>Camera</MockText>,
}));
jest.mock("../src/datawedge", () => ({ dataWedge: null }));

describe("QR scanner", () => {
  it("locks duplicate decodes and requires explicit re-arm after a server failure", async () => {
    const onScan = jest.fn().mockRejectedValue(new Error("Server menolak QR"));
    await render(<Scanner onScan={onScan} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId("camera"));
    await fireEvent.press(screen.getByTestId("camera"));
    await waitFor(() => expect(screen.getByText("Server menolak QR")).toBeTruthy());
    expect(onScan).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText("Pindai lagi"));
    await fireEvent.press(screen.getByTestId("camera"));
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2));
  });
});
