import { render, screen, waitFor } from "@testing-library/react-native";
import { BusPosition } from "../src/screens/BusPosition";
import { operations } from "../src/operations";
jest.mock("../src/operations", () => ({ operations: { position: jest.fn() } }));
it("shows coordinates with stale age instead of claiming live position", async () => {
  jest.mocked(operations.position).mockResolvedValue({ busPlate: "B 1234", position: { lat: -6.2, lng: 106.8, accuracy: 5, capturedAt: new Date(Date.now() - 180000).toISOString() } } as never);
  await render(<BusPosition bookingId="booking" onClose={jest.fn()} />);
  await waitFor(() => expect(screen.getByText("-6.200000, 106.800000")).toBeTruthy());
  expect(screen.getByText(/Posisi terakhir \(bukan live\)/)).toBeTruthy();
  expect(operations.position).toHaveBeenCalledWith("booking");
});
it("does not invent coordinates before the driver reports", async () => {
  jest.mocked(operations.position).mockResolvedValue({ position: null } as never);
  await render(<BusPosition bookingId="booking" onClose={jest.fn()} />);
  expect(screen.getByText("Belum ada lokasi bus.")).toBeTruthy();
});
