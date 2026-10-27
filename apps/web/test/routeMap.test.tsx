import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { RouteMap } from "../src/RouteMap";

const STOPS = [
  { id: "s1", name: "Terminal", seq: 1, lat: -6.3, lng: 107.15, active: true },
  { id: "s2", name: "Nonaktif", seq: 2, lat: -6.31, lng: 107.16, active: false },
];

describe("route map editing", () => {
  test("only active pins are draggable and a click selects the stop", () => {
    const onSelect = vi.fn();
    const { container } = render(<RouteMap stops={STOPS} color="#123456" onMove={vi.fn()} onSelect={onSelect} showInactive />);
    const pins = Array.from(container.querySelectorAll<HTMLElement>(".map-pin"));
    expect(pins).toHaveLength(2);
    expect(pins[0]!.classList.contains("movable")).toBe(true);
    expect(pins[1]!.classList.contains("movable")).toBe(false);

    fireEvent.click(pins[0]!);
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  test("a deactivated pin is hidden unless inactive points are shown", () => {
    const { container } = render(<RouteMap stops={STOPS} color="#123456" />);
    expect(container.querySelectorAll(".map-pin")).toHaveLength(1);
  });

  test("dropping a saved pin reports the stop and its new position", async () => {
    const onMove = vi.fn();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { container } = render(<RouteMap stops={STOPS} color="#123456" onMove={onMove} />);
    // Leaflet attaches its drag handler to the marker icon element, the span with the pin is its child.
    const pin = container.querySelector<HTMLElement>(".leaflet-marker-icon")!;
    // Dragging is ignored while the icon carries the zoom-animation class that fitBounds sets.
    await waitFor(() => expect(pin.classList.contains("leaflet-zoom-anim")).toBe(false));
    // Leaflet's left-button guard reads the legacy `which`; jsdom always reports 0, so set it on the event.
    const mouse = (type: string, clientX: number, clientY: number) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0, buttons: 1 });
      Object.defineProperty(e, "which", { value: 1 });
      return e;
    };
    pin.dispatchEvent(mouse("mousedown", 10, 10));
    pin.dispatchEvent(mouse("mousemove", 60, 40));
    pin.dispatchEvent(mouse("mouseup", 60, 40));
    scrollTo.mockRestore();

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]![0]).toBe("s1");
    expect(onMove.mock.calls[0]![1]).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });
  });
});
