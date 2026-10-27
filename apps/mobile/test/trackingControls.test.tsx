import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TrackingControls } from "../src/screens/TrackingControls";
import { activeTracking, stopTracking } from "../src/tracking";
import { operations } from "../src/operations";
jest.mock("../src/tracking", () => ({ activeTracking: jest.fn(), stopTracking: jest.fn(), startTracking: jest.fn(), trackingError: () => null }));
jest.mock("../src/operations", () => ({ operations: { start: jest.fn(), end: jest.fn() }, flushTelemetry: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../src/telemetryQueue", () => ({ discardLocations: jest.fn().mockResolvedValue(undefined) }));
beforeEach(() => { jest.clearAllMocks(); jest.mocked(activeTracking).mockResolvedValue("other-trip"); });
it("does not start a second server run while another trip owns GPS", async () => {
  await render(<TrackingControls tripId="viewed-trip" />);
  await fireEvent.press(screen.getByText("Mulai GPS perjalanan"));
  await waitFor(() => expect(screen.getByText("Akhiri pelacakan perjalanan sebelumnya terlebih dahulu.")).toBeTruthy());
  expect(operations.start).not.toHaveBeenCalled();
});
it("scopes GPS stop to the viewed trip and preserves unrelated active run display", async () => {
  await render(<TrackingControls tripId="viewed-trip" />);
  await fireEvent.press(screen.getByText("Akhiri perjalanan dan GPS"));
  await waitFor(() => expect(operations.end).toHaveBeenCalledWith("viewed-trip"));
  expect(stopTracking).toHaveBeenCalledWith("viewed-trip");
  expect(screen.getByText("GPS aktif untuk perjalanan lain")).toBeTruthy();
});
