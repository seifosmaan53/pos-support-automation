import { describe, expect, it } from "vitest";
import { classifyDeviceLabel } from "./microphoneDevices";

describe("classifyDeviceLabel", () => {
  it("classifies common macOS built-in mics as builtin", () => {
    expect(classifyDeviceLabel("MacBook Pro Microphone")).toBe("builtin");
    expect(classifyDeviceLabel("Built-in Microphone")).toBe("builtin");
    expect(classifyDeviceLabel("Default - MacBook Pro Microphone (Built-in)")).toBe(
      "builtin",
    );
  });

  it("classifies common external mics as external", () => {
    expect(classifyDeviceLabel("AirPods Pro")).toBe("external");
    expect(classifyDeviceLabel("Logitech USB Headset")).toBe("external");
    expect(classifyDeviceLabel("Blue Yeti")).toBe("external");
    expect(classifyDeviceLabel("Bluetooth Headphones")).toBe("external");
    expect(classifyDeviceLabel("USB Audio CODEC")).toBe("external");
  });

  it("returns unknown for blank labels (no mic permission yet)", () => {
    expect(classifyDeviceLabel("")).toBe("unknown");
    expect(classifyDeviceLabel("   ")).toBe("unknown");
  });

  it("returns unknown for ambiguous device labels", () => {
    expect(classifyDeviceLabel("Microphone")).toBe("unknown");
    expect(classifyDeviceLabel("CoreAudio Device 0")).toBe("unknown");
  });

  it("prefers external when both signals appear (USB built-in card)", () => {
    expect(classifyDeviceLabel("USB Built-in Sound Adapter")).toBe("external");
  });
});
