import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Scanner } from "../src/screens/Scanner";
import { dataWedge } from "../src/datawedge";
jest.mock("expo-camera", () => ({ useCameraPermissions: () => [{ granted: false }, jest.fn()], CameraView: () => null }));
jest.mock("../src/datawedge", () => ({ dataWedge: { start: jest.fn(), stop: jest.fn().mockResolvedValue(undefined), addListener: jest.fn().mockReturnValue({ remove: jest.fn() }) } }));
it("waits for native configuration confirmation before accepting DataWedge events", async () => {
  let confirm!: () => void;
  jest.mocked(dataWedge!.start).mockReturnValue(new Promise<void>((resolve) => { confirm = resolve; }));
  const scan = jest.fn().mockResolvedValue(undefined);
  await render(<Scanner zebra onScan={scan} onClose={jest.fn()} />);
  const listener = jest.mocked(dataWedge!.addListener).mock.calls[0]![1];
  await act(async () => listener({ data: "QR" })); expect(scan).not.toHaveBeenCalled();
  await act(async () => confirm());
  expect(screen.getByText("Profil Zebra dikonfirmasi DataWedge.")).toBeTruthy();
  await act(async () => listener({ data: "QR" }));
  expect(scan).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByText("Konfirmasi scan scanner")));
  expect(scan).toHaveBeenCalledWith("QR", "DATAWEDGE");
});
it("shows fallback on a rejected or timed out native profile request", async () => {
  jest.mocked(dataWedge!.start).mockRejectedValue(new Error("timeout"));
  await render(<Scanner zebra onScan={jest.fn()} onClose={jest.fn()} />);
  await waitFor(() => expect(screen.getByText("DataWedge belum dikonfirmasi. Gunakan kamera.")).toBeTruthy());
});
